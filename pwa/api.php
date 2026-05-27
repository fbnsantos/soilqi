<?php
/**
 * SoilQI Field PWA — API
 * Autenticação: Bearer token (api_tokens) ou sessão PHP partilhada.
 */
require_once '../config.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

// ── Auto-reparar .htaccess de uploads/photos ──────────────────────────────────
// Garante que o directório de fotos nunca fica bloqueado por um .htaccess errado.
// Corre em cada pedido à API — custo negligenciável (só escreve se necessário).
(function () {
    $photosDir = __DIR__ . '/uploads/photos/';
    $htacc     = $photosDir . '.htaccess';
    $correct   = "Options -Indexes\n";
    if (is_dir($photosDir)) {
        if (!file_exists($htacc) || file_get_contents($htacc) !== $correct) {
            @file_put_contents($htacc, $correct);
        }
    }
})();

// ── Autenticação ──────────────────────────────────────────────────────────────
// 1. Tentar token Bearer (Authorization: Bearer <token>)
$currentUser = null;

$authHeader = '';
if (function_exists('getallheaders')) {
    $hdrs = getallheaders();
    $authHeader = $hdrs['Authorization'] ?? $hdrs['authorization'] ?? '';
} elseif (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
} elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $authHeader = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
}

if (preg_match('/^Bearer\s+(\S+)$/i', $authHeader, $m)) {
    $bearerToken = trim($m[1]);
    try {
        $pdoAuth = getDBConnection();
        $stmtAuth = $pdoAuth->prepare("
            SELECT u.id, u.username, u.email, u.role
              FROM api_tokens t
              JOIN users u ON u.id = t.user_id
             WHERE t.token = ? AND t.expires_at > NOW()
        ");
        $stmtAuth->execute([$bearerToken]);
        $tokenUser = $stmtAuth->fetch(PDO::FETCH_ASSOC);
        if ($tokenUser) {
            $currentUser = $tokenUser;
            // Actualizar last_used_at (sem bloquear resposta)
            $pdoAuth->prepare("UPDATE api_tokens SET last_used_at = NOW() WHERE token = ?")
                    ->execute([$bearerToken]);
        }
    } catch (PDOException $e) {
        // Tabela api_tokens ainda não existe (migração 003) — ignorar, tentar sessão
    }
}

// 2. Fallback para sessão PHP
if (!$currentUser) {
    if (!isLoggedIn()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Não autenticado', 'redirect' => '../login.php']);
        exit;
    }
    $currentUser = getCurrentUser();
}

// ── Parse do body ─────────────────────────────────────────────────────────────
$action = $_GET['action'] ?? '';
$body   = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (strpos($ct, 'application/json') !== false) {
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
    } else {
        $body = $_POST;
    }
    $action = $body['action'] ?? $action;
}

$response = ['success' => false, 'message' => ''];

try {
    $pdo = getDBConnection();

    switch ($action) {

        // ── Auth ───────────────────────────────────────────────────────────────
        case 'check_auth':
            $response['success']  = true;
            $response['username'] = $currentUser['username'];
            $response['user_id']  = $currentUser['id'];
            break;

        // ── Token de sessão persistente ────────────────────────────────────────
        case 'generate_token':
            $device  = sanitizeInput($body['device_name'] ?? 'SoilQI PWA');
            $token   = bin2hex(random_bytes(32));          // 64 chars hex
            $expires = date('Y-m-d H:i:s', strtotime('+90 days'));

            // Limpar tokens expirados do utilizador
            $pdo->prepare("DELETE FROM api_tokens WHERE user_id = ? AND expires_at < NOW()")
                ->execute([$currentUser['id']]);

            // Manter máximo 10 tokens activos por utilizador (apagar os mais antigos)
            $pdo->prepare("
                DELETE FROM api_tokens WHERE user_id = ?
                ORDER BY created_at ASC
                LIMIT (SELECT GREATEST(0, COUNT(*) - 9) FROM (
                    SELECT id FROM api_tokens WHERE user_id = ?
                ) AS sub)
            ")->execute([$currentUser['id'], $currentUser['id']]);

            $pdo->prepare("INSERT INTO api_tokens (user_id, token, device_name, expires_at) VALUES (?, ?, ?, ?)")
                ->execute([$currentUser['id'], $token, $device, $expires]);

            $response['success']    = true;
            $response['token']      = $token;
            $response['expires_at'] = $expires;
            break;

        case 'revoke_token':
            $tok = $body['token'] ?? '';
            if ($tok) {
                $pdo->prepare("DELETE FROM api_tokens WHERE token = ? AND user_id = ?")
                    ->execute([$tok, $currentUser['id']]);
            }
            $response['success'] = true;
            break;

        // ── Medições ───────────────────────────────────────────────────────────
        case 'save_measurement':
            $lat        = isset($body['latitude'])     ? floatval($body['latitude'])     : null;
            $lng        = isset($body['longitude'])    ? floatval($body['longitude'])    : null;
            $accuracy   = isset($body['gps_accuracy']) && $body['gps_accuracy'] !== '' && $body['gps_accuracy'] !== null
                          ? floatval($body['gps_accuracy']) : null;
            $ec         = isset($body['conductivity']) && $body['conductivity'] !== '' && $body['conductivity'] !== null
                          ? floatval($body['conductivity']) : null;
            $ph         = isset($body['ph'])           && $body['ph']           !== '' && $body['ph']           !== null
                          ? floatval($body['ph'])           : null;
            $temp       = isset($body['temperature'])  && $body['temperature']  !== '' && $body['temperature']  !== null
                          ? floatval($body['temperature'])  : null;
            $moisture   = isset($body['moisture'])     && $body['moisture']     !== '' && $body['moisture']     !== null
                          ? floatval($body['moisture'])     : null;
            $notes      = sanitizeInput($body['notes'] ?? '');
            $terrain_id = !empty($body['terrain_id']) ? intval($body['terrain_id']) : null;
            $measured_at = !empty($body['measured_at']) ? $body['measured_at'] : date('Y-m-d H:i:s');
            $photo_b64   = $body['photo_b64'] ?? null;

            if ($lat === null || $lng === null || ($lat == 0 && $lng == 0)) {
                $response['message'] = 'Coordenadas GPS inválidas.';
                break;
            }

            $stmt = $pdo->prepare(
                "INSERT INTO field_measurements
                    (user_id, terrain_id, latitude, longitude, gps_accuracy,
                     conductivity, ph, temperature, moisture, notes, measured_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([
                $currentUser['id'], $terrain_id, $lat, $lng, $accuracy,
                $ec, $ph, $temp, $moisture, $notes, $measured_at
            ]);

            $measurement_id = (int)$pdo->lastInsertId();
            $photo_path     = null;

            // Guardar fotografia (se enviada e coluna existir)
            if ($photo_b64 && $photo_b64 !== 'null') {
                try {
                    $raw = base64_decode(preg_replace('#^data:image/\w+;base64,#', '', $photo_b64), true);
                    if ($raw && strlen($raw) > 100) {
                        $dir = __DIR__ . '/uploads/photos/';
                        if (!is_dir($dir)) mkdir($dir, 0755, true);

                        // Desativar listagem mas garantir que ficheiros são acessíveis
                        // (sempre sobrescrever — evita .htaccess antigo com "Deny from all")
                        $htacc = $dir . '.htaccess';
                        file_put_contents($htacc, "Options -Indexes\n");

                        $fname      = $measurement_id . '_' . time() . '.jpg';
                        $fullPath   = $dir . $fname;
                        file_put_contents($fullPath, $raw);
                        $photo_path = 'uploads/photos/' . $fname;

                        // UPDATE só funciona se a coluna photo_path já existir (migração 004)
                        $pdo->prepare("UPDATE field_measurements SET photo_path = ? WHERE id = ?")
                            ->execute([$photo_path, $measurement_id]);
                    }
                } catch (Exception $photoErr) {
                    // Foto falhou mas medição foi guardada — não bloquear resposta
                    error_log('[SoilQI] Photo save error: ' . $photoErr->getMessage());
                }
            }

            $response['success']    = true;
            $response['message']    = 'Medição guardada com sucesso!';
            $response['id']         = $measurement_id;
            $response['photo_path'] = $photo_path;
            break;

        case 'get_measurements':
            // Garantir coluna photo_path (migração 004) — idempotente, custo zero se já existir
            try { $pdo->exec("ALTER TABLE field_measurements ADD COLUMN photo_path VARCHAR(255) NULL AFTER notes"); }
            catch (PDOException $ignored) { /* já existe — ignorar */ }

            $limit = min(intval($_GET['limit'] ?? 200), 500);
            $stmt  = $pdo->prepare(
                "SELECT m.id, m.latitude, m.longitude, m.gps_accuracy,
                        m.conductivity, m.ph, m.temperature, m.moisture,
                        m.notes, m.measured_at,
                        COALESCE(m.photo_path, '') AS photo_path,
                        t.name AS terrain_name
                   FROM field_measurements m
                   LEFT JOIN terrains t ON m.terrain_id = t.id
                  WHERE m.user_id = ?
                  ORDER BY m.measured_at DESC
                  LIMIT ?"
            );
            $stmt->execute([$currentUser['id'], $limit]);
            $response['success']      = true;
            $response['measurements'] = $stmt->fetchAll();
            break;

        case 'get_terrains':
            $stmt = $pdo->prepare("SELECT id, name FROM terrains WHERE user_id = ? ORDER BY name ASC");
            $stmt->execute([$currentUser['id']]);
            $response['success']  = true;
            $response['terrains'] = $stmt->fetchAll();
            break;

        case 'delete_measurement':
            $id = intval($body['id'] ?? 0);
            if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }

            // Apagar foto associada, se existir
            try {
                $stmtP = $pdo->prepare("SELECT photo_path FROM field_measurements WHERE id = ? AND user_id = ?");
                $stmtP->execute([$id, $currentUser['id']]);
                $row = $stmtP->fetch(PDO::FETCH_ASSOC);
                if ($row && $row['photo_path']) {
                    $fpath = __DIR__ . '/' . $row['photo_path'];
                    if (file_exists($fpath)) unlink($fpath);
                }
            } catch (Exception $e) {}

            $stmt = $pdo->prepare("DELETE FROM field_measurements WHERE id = ? AND user_id = ?");
            $stmt->execute([$id, $currentUser['id']]);
            if ($stmt->rowCount() > 0) {
                $response['success'] = true;
                $response['message'] = 'Medição eliminada.';
            } else {
                $response['message'] = 'Medição não encontrada.';
            }
            break;

        default:
            http_response_code(400);
            $response['message'] = 'Ação desconhecida: ' . htmlspecialchars($action);
    }

} catch (PDOException $e) {
    http_response_code(500);
    $code = $e->getCode();
    if ($code === '42S02' || strpos($e->getMessage(), "doesn't exist") !== false) {
        $response['message'] = 'Tabela não existe. Execute as migrações em Admin → Migrações.';
    } else {
        $response['message'] = 'Erro na base de dados: ' . $e->getMessage();
    }
}

echo json_encode($response);
