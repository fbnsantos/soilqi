<?php
/**
 * SoilQI CAN Controller PWA — API
 * Autenticação: Bearer token (api_tokens) ou sessão PHP partilhada.
 */
require_once '../config.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

// ── Autenticação ──────────────────────────────────────────────────────────────
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
            $pdoAuth->prepare("UPDATE api_tokens SET last_used_at = NOW() WHERE token = ?")
                    ->execute([$bearerToken]);
        }
    } catch (PDOException $e) { }
}

if (!$currentUser) {
    if (!isLoggedIn()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Não autenticado']);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(string $hex): array {
    $hex = ltrim($hex, '#');
    if (strlen($hex) === 3) {
        $hex = $hex[0].$hex[0].$hex[1].$hex[1].$hex[2].$hex[2];
    }
    return [hexdec(substr($hex,0,2)), hexdec(substr($hex,2,2)), hexdec(substr($hex,4,2))];
}

/**
 * Determina o zone_id (1-based) correspondente a lat/lng no PNG de zonação.
 * Retorna null se fora dos limites ou se GD não estiver disponível.
 */
function getZoneAtLocation(array $zonation, float $lat, float $lng): ?int {
    if (!function_exists('imagecreatefromstring')) return null;

    $minLat = (float)$zonation['min_lat'];
    $maxLat = (float)$zonation['max_lat'];
    $minLng = (float)$zonation['min_lng'];
    $maxLng = (float)$zonation['max_lng'];

    if ($lat < $minLat || $lat > $maxLat || $lng < $minLng || $lng > $maxLng) {
        return null;
    }

    $img = @imagecreatefromstring($zonation['png_data']);
    if (!$img) return null;

    $w = imagesx($img);
    $h = imagesy($img);

    $px = (int)round(($lng - $minLng) / ($maxLng - $minLng) * ($w - 1));
    $py = (int)round(($maxLat - $lat) / ($maxLat - $minLat) * ($h - 1));
    $px = max(0, min($w - 1, $px));
    $py = max(0, min($h - 1, $py));

    $rgb = imagecolorat($img, $px, $py);
    imagedestroy($img);

    $r = ($rgb >> 16) & 0xFF;
    $g = ($rgb >> 8)  & 0xFF;
    $b =  $rgb        & 0xFF;

    // Pixel totalmente transparente → fora do polígono
    if (($rgb >> 24) & 0x7F) return null;

    $legend = json_decode($zonation['legend'], true);
    if (!$legend) return null;

    $bestZone = null;
    $bestDist = PHP_INT_MAX;
    foreach ($legend as $i => $entry) {
        [$lr, $lg, $lb] = hexToRgb($entry['color']);
        $dist = abs($r - $lr) + abs($g - $lg) + abs($b - $lb);
        if ($dist < $bestDist) {
            $bestDist = $dist;
            $bestZone = $i + 1; // 1-indexed
        }
    }

    return $bestZone;
}

/**
 * Constrói a mensagem CAN raw para a percentagem indicada.
 */
function buildCanRaw(int $pct): string {
    $hex = strtoupper(dechex($pct));
    if (strlen($hex) < 2) $hex = '0' . $hex;
    return 'T18EF88F78A101' . $hex . 'FFFFFFFFFF';
}

// ── Actions ───────────────────────────────────────────────────────────────────
try {
    $pdo = getDBConnection();

    switch ($action) {

        case 'check_auth':
            $response['success']  = true;
            $response['username'] = $currentUser['username'];
            $response['user_id']  = $currentUser['id'];
            break;

        case 'get_terrains':
            $stmt = $pdo->prepare("SELECT id, name FROM terrains WHERE user_id = ? ORDER BY name ASC");
            $stmt->execute([$currentUser['id']]);
            $response['success']  = true;
            $response['terrains'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
            break;

        case 'get_prescriptions':
            $terrain_id = intval($_GET['terrain_id'] ?? $body['terrain_id'] ?? 0);
            if ($terrain_id <= 0) { $response['message'] = 'terrain_id inválido'; break; }

            $stmt = $pdo->prepare("
                SELECT id, name, status, created_at, zone_prescriptions
                  FROM prescription_results
                 WHERE user_id = ? AND terrain_id = ? AND status = 'done'
                 ORDER BY created_at DESC
            ");
            $stmt->execute([$currentUser['id'], $terrain_id]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // Obter lista de campos de prescrição disponíveis (N, P2O5, K2O, …)
            foreach ($rows as &$row) {
                $zp = json_decode($row['zone_prescriptions'] ?? '[]', true) ?: [];
                $fields = [];
                foreach ($zp as $z) {
                    foreach (array_keys($z) as $k) {
                        if ($k !== 'zone_id' && $k !== 'label') $fields[] = $k;
                    }
                }
                $row['fields'] = array_values(array_unique($fields));
                unset($row['zone_prescriptions']); // não enviar payload completo
            }
            unset($row);

            $response['success']       = true;
            $response['prescriptions'] = $rows;
            break;

        case 'get_zone_value':
            $prescription_id = intval($body['prescription_id'] ?? 0);
            $lat             = isset($body['lat']) ? floatval($body['lat']) : null;
            $lng             = isset($body['lng']) ? floatval($body['lng']) : null;
            $field           = sanitizeInput($body['field'] ?? 'N');

            if (!$prescription_id || $lat === null || $lng === null) {
                $response['message'] = 'Parâmetros inválidos.';
                break;
            }

            // Carregar prescrição + zonação
            $stmtP = $pdo->prepare("
                SELECT pr.zone_prescriptions, pr.zonation_id,
                       zr.png_data, zr.min_lat, zr.max_lat, zr.min_lng, zr.max_lng, zr.legend
                  FROM prescription_results pr
                  JOIN zonation_results zr ON zr.id = pr.zonation_id
                 WHERE pr.id = ? AND pr.user_id = ? AND pr.status = 'done'
            ");
            $stmtP->execute([$prescription_id, $currentUser['id']]);
            $row = $stmtP->fetch(PDO::FETCH_ASSOC);

            if (!$row) { $response['message'] = 'Prescrição não encontrada.'; break; }

            $zone_prescriptions = json_decode($row['zone_prescriptions'], true) ?: [];

            // Determinar zona pelo GPS
            $zone_id = getZoneAtLocation($row, $lat, $lng);

            if ($zone_id === null) {
                $response['message'] = 'Posição GPS fora do terreno ou zonação indisponível.';
                $response['out_of_bounds'] = true;
                break;
            }

            // Encontrar prescrição da zona
            $zone_data = null;
            foreach ($zone_prescriptions as $z) {
                if ((int)$z['zone_id'] === $zone_id) { $zone_data = $z; break; }
            }

            if (!$zone_data) { $response['message'] = 'Zona sem dados de prescrição.'; break; }

            // Calcular percentagem em relação ao máximo do campo
            $value = isset($zone_data[$field]) ? floatval($zone_data[$field]) : null;
            $max_value = 0;
            foreach ($zone_prescriptions as $z) {
                if (isset($z[$field])) $max_value = max($max_value, floatval($z[$field]));
            }

            $suggested_pct = 0;
            if ($value !== null && $max_value > 0) {
                $raw_pct = ($value / $max_value) * 100;
                $suggested_pct = (int)(round($raw_pct / 25) * 25);
                $suggested_pct = max(0, min(100, $suggested_pct));
            }

            $response['success']       = true;
            $response['zone_id']       = $zone_id;
            $response['value']         = $value;
            $response['max_value']     = $max_value;
            $response['field']         = $field;
            $response['suggested_pct'] = $suggested_pct;
            $response['zone_data']     = $zone_data;
            break;

        case 'get_map_image':
            $prescription_id = intval($_GET['prescription_id'] ?? $body['prescription_id'] ?? 0);
            if (!$prescription_id) { $response['message'] = 'prescription_id inválido'; break; }

            // Tentar PNG da própria prescrição; fallback para PNG da zonação
            $stmtM = $pdo->prepare("
                SELECT pr.png_data AS pr_png,
                       zr.png_data AS zr_png,
                       zr.min_lat, zr.max_lat, zr.min_lng, zr.max_lng, zr.legend,
                       pr.zone_prescriptions, pr.name
                  FROM prescription_results pr
                  JOIN zonation_results zr ON zr.id = pr.zonation_id
                 WHERE pr.id = ? AND pr.user_id = ?
            ");
            $stmtM->execute([$prescription_id, $currentUser['id']]);
            $rowM = $stmtM->fetch(PDO::FETCH_ASSOC);

            if (!$rowM) { $response['message'] = 'Prescrição não encontrada.'; break; }

            $pngData = $rowM['pr_png'] ?: $rowM['zr_png'];
            if (!$pngData) { $response['message'] = 'Mapa de prescrição não disponível.'; break; }

            $response['success']            = true;
            $response['png_b64']            = base64_encode($pngData);
            $response['bounds']             = [
                'min_lat' => (float)$rowM['min_lat'],
                'max_lat' => (float)$rowM['max_lat'],
                'min_lng' => (float)$rowM['min_lng'],
                'max_lng' => (float)$rowM['max_lng'],
            ];
            $response['legend']             = json_decode($rowM['legend'], true);
            $response['zone_prescriptions'] = json_decode($rowM['zone_prescriptions'], true);
            $response['name']               = $rowM['name'];
            break;

        case 'publish_can':
            $pct = intval($body['pct'] ?? -1);
            if (!in_array($pct, [0, 25, 50, 75, 100])) {
                $response['message'] = 'Percentagem inválida. Use 0, 25, 50, 75 ou 100.';
                break;
            }

            // Permitir override das credenciais MQTT vindas da app
            $mqttHost = !empty($body['mqtt_host']) ? trim($body['mqtt_host']) : MQTT_HOST;
            $mqttPort = !empty($body['mqtt_port']) ? intval($body['mqtt_port'])  : MQTT_PORT;
            $mqttUser = isset($body['mqtt_user']) && $body['mqtt_user'] !== '' ? $body['mqtt_user'] : (MQTT_USER ?: null);
            $mqttPass = isset($body['mqtt_pass']) && $body['mqtt_pass'] !== '' ? $body['mqtt_pass'] : (MQTT_PASS ?: null);

            $raw     = buildCanRaw($pct);
            $payload = json_encode(['payload' => ['raw' => $raw]]);
            $topic   = '/tlvt/can/in';

            require_once '../lib/MqttPublisher.php';
            $mqtt = new MqttPublisher(
                $mqttHost, $mqttPort,
                'soilqi-can-' . $currentUser['id'] . '-' . time(),
                $mqttUser, $mqttPass
            );
            $mqtt->publish($topic, $payload, 0);
            $mqtt->disconnect();

            $response['success'] = true;
            $response['pct']     = $pct;
            $response['raw']     = $raw;
            $response['topic']   = $topic;
            break;

        default:
            http_response_code(400);
            $response['message'] = 'Ação desconhecida: ' . htmlspecialchars($action);
    }

} catch (PDOException $e) {
    http_response_code(500);
    $response['message'] = 'Erro na base de dados: ' . $e->getMessage();
} catch (RuntimeException $e) {
    http_response_code(500);
    $response['message'] = 'Erro MQTT: ' . $e->getMessage();
}

echo json_encode($response);
