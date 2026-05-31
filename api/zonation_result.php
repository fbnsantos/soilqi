<?php
/**
 * api/zonation_result.php
 * Endpoint chamado por Zonation.py (via HTTP POST) para entregar o resultado.
 *
 * Método: POST (JSON)
 * Campos sucesso: api_key, request_id, status="done",
 *                 png_data (base64), min_lat, max_lat, min_lng, max_lng,
 *                 legend (JSON array)
 * Campos erro:    api_key, request_id, status="error", error_msg
 */

ini_set('display_errors', 0);
ini_set('log_errors', 1);
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => "PHP Error $errno: $errstr in $errfile:$errline"]);
    exit;
});
register_shutdown_function(function() {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => "Fatal: {$e['message']} in {$e['file']}:{$e['line']}"]);
    }
});

header('Content-Type: application/json');

require_once __DIR__ . '/../config.php';

$response = ['success' => false, 'message' => ''];

try {
    // ── Autenticação ──────────────────────────────────────────────────────────
    $apiKey = defined('RASTER_API_KEY') ? RASTER_API_KEY : '';
    if ($apiKey === '') {
        http_response_code(503);
        $response['message'] = 'RASTER_API_KEY não configurada no servidor.';
        echo json_encode($response); exit;
    }

    // Aceitar JSON ou form-data
    $input = [];
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (strpos($contentType, 'application/json') !== false) {
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
    } else {
        $input = $_POST;
    }

    $givenKey = trim($input['api_key'] ?? '');
    if (!hash_equals($apiKey, $givenKey)) {
        http_response_code(403);
        $response['message'] = 'Chave de API inválida.';
        echo json_encode($response); exit;
    }

    // ── Validar campos obrigatórios ───────────────────────────────────────────
    $requestId = trim($input['request_id'] ?? '');
    $status    = trim($input['status']     ?? '');

    if (!$requestId || !in_array($status, ['done', 'error'], true)) {
        http_response_code(400);
        $response['message'] = 'request_id ou status em falta / inválido.';
        echo json_encode($response); exit;
    }

    $pdo = getDBConnection();

    // ── Verificar que o pedido existe ─────────────────────────────────────────
    $stmt = $pdo->prepare("SELECT id, status FROM zonation_results WHERE request_id = ?");
    $stmt->execute([$requestId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404);
        $response['message'] = 'Pedido não encontrado.';
        echo json_encode($response); exit;
    }
    if ($row['status'] === 'done') {
        // Idempotente — já processado, não sobrescrever
        $response['success'] = true;
        $response['message'] = 'Já processado.';
        echo json_encode($response); exit;
    }

    // ── Actualizar registo ────────────────────────────────────────────────────
    if ($status === 'error') {
        $errMsg = substr(trim($input['error_msg'] ?? 'Erro desconhecido.'), 0, 2000);
        $pdo->prepare("
            UPDATE zonation_results
               SET status = 'error', error_msg = ?
             WHERE request_id = ?
        ")->execute([$errMsg, $requestId]);

    } else {
        // Descodificar PNG
        $pngB64 = $input['png_data'] ?? '';
        $pngB64 = preg_replace('/^data:image\/[a-z]+;base64,/', '', $pngB64);
        $pngBin = base64_decode($pngB64, true);

        if (!$pngBin || strlen($pngBin) < 8) {
            http_response_code(400);
            $response['message'] = 'png_data inválido ou vazio.';
            echo json_encode($response); exit;
        }

        $minLat  = isset($input['min_lat'])  ? floatval($input['min_lat'])  : null;
        $maxLat  = isset($input['max_lat'])  ? floatval($input['max_lat'])  : null;
        $minLng  = isset($input['min_lng'])  ? floatval($input['min_lng'])  : null;
        $maxLng  = isset($input['max_lng'])  ? floatval($input['max_lng'])  : null;
        $legend  = $input['legend'] ?? null;
        // Normalizar legenda para JSON string
        if (is_array($legend)) {
            $legend = json_encode($legend);
        } elseif (is_string($legend) && $legend !== '') {
            // Validar que é JSON válido
            $decoded = json_decode($legend, true);
            $legend  = ($decoded !== null) ? $legend : '[]';
        } else {
            $legend = '[]';
        }

        $pdo->prepare("
            UPDATE zonation_results
               SET status   = 'done',
                   png_data = ?,
                   min_lat  = ?, max_lat = ?,
                   min_lng  = ?, max_lng = ?,
                   legend   = ?
             WHERE request_id = ?
        ")->execute([$pngBin, $minLat, $maxLat, $minLng, $maxLng, $legend, $requestId]);
    }

    $response['success'] = true;
    $response['message'] = 'Actualizado com sucesso.';

} catch (Throwable $e) {
    http_response_code(500);
    $response['message'] = 'Erro interno: ' . $e->getMessage();
}

echo json_encode($response);
