<?php
require_once '../config.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Não autenticado', 'redirect' => '../login.php']);
    exit;
}

$currentUser = getCurrentUser();
$action = $_GET['action'] ?? '';

// Parse JSON body for POST requests
$body = [];
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

        case 'check_auth':
            $response['success'] = true;
            $response['username'] = $currentUser['username'];
            break;

        case 'save_measurement':
            $lat        = isset($body['latitude'])     ? floatval($body['latitude'])     : null;
            $lng        = isset($body['longitude'])    ? floatval($body['longitude'])    : null;
            $accuracy   = isset($body['gps_accuracy']) && $body['gps_accuracy'] !== '' ? floatval($body['gps_accuracy']) : null;
            $ec         = isset($body['conductivity']) && $body['conductivity'] !== '' ? floatval($body['conductivity']) : null;
            $ph         = isset($body['ph'])           && $body['ph']           !== '' ? floatval($body['ph'])           : null;
            $temp       = isset($body['temperature'])  && $body['temperature']  !== '' ? floatval($body['temperature'])  : null;
            $moisture   = isset($body['moisture'])     && $body['moisture']     !== '' ? floatval($body['moisture'])     : null;
            $notes      = sanitizeInput($body['notes'] ?? '');
            $terrain_id = !empty($body['terrain_id'])  ? intval($body['terrain_id'])     : null;
            $measured_at = !empty($body['measured_at']) ? $body['measured_at'] : date('Y-m-d H:i:s');

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

            $response['success'] = true;
            $response['message'] = 'Medição guardada com sucesso!';
            $response['id'] = (int)$pdo->lastInsertId();
            break;

        case 'get_measurements':
            $limit = min(intval($_GET['limit'] ?? 200), 500);
            $stmt = $pdo->prepare(
                "SELECT m.id, m.latitude, m.longitude, m.gps_accuracy,
                        m.conductivity, m.ph, m.temperature, m.moisture,
                        m.notes, m.measured_at, t.name AS terrain_name
                   FROM field_measurements m
                   LEFT JOIN terrains t ON m.terrain_id = t.id
                  WHERE m.user_id = ?
                  ORDER BY m.measured_at DESC
                  LIMIT ?"
            );
            $stmt->execute([$currentUser['id'], $limit]);
            $response['success'] = true;
            $response['measurements'] = $stmt->fetchAll();
            break;

        case 'get_terrains':
            $stmt = $pdo->prepare("SELECT id, name FROM terrains WHERE user_id = ? ORDER BY name ASC");
            $stmt->execute([$currentUser['id']]);
            $response['success'] = true;
            $response['terrains'] = $stmt->fetchAll();
            break;

        case 'delete_measurement':
            $id = intval($body['id'] ?? 0);
            if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }
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
            $response['message'] = 'Ação desconhecida.';
    }

} catch (PDOException $e) {
    http_response_code(500);
    $response['message'] = 'Erro na base de dados.';
}

echo json_encode($response);
