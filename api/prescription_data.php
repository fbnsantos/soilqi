<?php
/**
 * api/prescription_data.php
 * Chamado por Prescription.py para obter o PNG da zonagem, legenda e
 * valores de prescrição por zona.
 *
 * POST JSON: { api_key, request_id }
 * Resposta:  { success, png, bounds, legend, prescriptions, name }
 */

ini_set('display_errors', 0); ini_set('log_errors', 1);
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>"PHP Error $errno: $errstr in $errfile:$errline"]);
    exit;
});
register_shutdown_function(function() {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR,E_PARSE,E_CORE_ERROR,E_COMPILE_ERROR])) {
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['success'=>false,'message'=>"Fatal: {$e['message']} in {$e['file']}:{$e['line']}"]);
    }
});

header('Content-Type: application/json');
require_once __DIR__ . '/../config.php';

$response = ['success' => false, 'message' => ''];

try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    $apiKey = defined('RASTER_API_KEY') ? RASTER_API_KEY : '';
    if ($apiKey === '') {
        http_response_code(503); $response['message'] = 'RASTER_API_KEY não configurada.';
        echo json_encode($response); exit;
    }

    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    $input = strpos($contentType, 'application/json') !== false
        ? (json_decode(file_get_contents('php://input'), true) ?? [])
        : $_POST;

    if (!hash_equals($apiKey, trim($input['api_key'] ?? ''))) {
        http_response_code(403); $response['message'] = 'Chave de API inválida.';
        echo json_encode($response); exit;
    }

    $requestId = trim($input['request_id'] ?? '');
    if (!$requestId) {
        http_response_code(400); $response['message'] = 'request_id em falta.';
        echo json_encode($response); exit;
    }

    $pdo = getDBConnection();

    // ── Obter registo da prescrição ───────────────────────────────────────────
    $st = $pdo->prepare("
        SELECT pr.id, pr.name, pr.zone_prescriptions,
               zr.png_data, zr.min_lat, zr.max_lat, zr.min_lng, zr.max_lng, zr.legend
        FROM prescription_results pr
        JOIN zonation_results zr ON zr.id = pr.zonation_id
        WHERE pr.request_id = ?
    ");
    $st->execute([$requestId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404); $response['message'] = 'Pedido não encontrado.';
        echo json_encode($response); exit;
    }
    if (!$row['png_data']) {
        http_response_code(404); $response['message'] = 'Zonagem sem PNG guardado.';
        echo json_encode($response); exit;
    }

    // Marcar como processing
    $pdo->prepare("UPDATE prescription_results SET status='processing' WHERE request_id=?")
        ->execute([$requestId]);

    $response['success']       = true;
    $response['name']          = $row['name'];
    $response['png']           = base64_encode($row['png_data']);
    $response['bounds']        = [
        'min_lat' => (float)$row['min_lat'],
        'max_lat' => (float)$row['max_lat'],
        'min_lng' => (float)$row['min_lng'],
        'max_lng' => (float)$row['max_lng'],
    ];
    $response['legend']        = json_decode($row['legend'] ?? '[]', true) ?: [];
    $response['prescriptions'] = json_decode($row['zone_prescriptions'] ?? '[]', true) ?: [];

} catch (Throwable $e) {
    http_response_code(500);
    $response['message'] = 'Erro interno: ' . $e->getMessage();
}

echo json_encode($response);
