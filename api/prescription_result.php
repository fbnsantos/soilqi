<?php
/**
 * api/prescription_result.php
 * Callback chamado por Prescription.py para entregar o ZIP do shapefile.
 *
 * POST JSON: { api_key, request_id, status, zip_data } ou { ..., error_msg }
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
    $status    = trim($input['status']     ?? '');

    if (!$requestId || !in_array($status, ['done','error'], true)) {
        http_response_code(400); $response['message'] = 'Campos obrigatórios em falta.';
        echo json_encode($response); exit;
    }

    $pdo = getDBConnection();

    $st = $pdo->prepare("SELECT id, status FROM prescription_results WHERE request_id = ?");
    $st->execute([$requestId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404); $response['message'] = 'Pedido não encontrado.';
        echo json_encode($response); exit;
    }
    if ($row['status'] === 'done') {
        $response['success'] = true; $response['message'] = 'Já processado.';
        echo json_encode($response); exit;
    }

    if ($status === 'error') {
        $errMsg = substr(trim($input['error_msg'] ?? 'Erro desconhecido.'), 0, 2000);
        $pdo->prepare("UPDATE prescription_results SET status='error', error_msg=? WHERE request_id=?")
            ->execute([$errMsg, $requestId]);
    } else {
        $zipB64 = $input['zip_data'] ?? '';
        $zipB64 = preg_replace('/^data:[^;]+;base64,/', '', $zipB64);
        $zipBin = base64_decode($zipB64, true);
        if (!$zipBin || strlen($zipBin) < 4) {
            http_response_code(400); $response['message'] = 'zip_data inválido.';
            echo json_encode($response); exit;
        }
        $pdo->prepare("UPDATE prescription_results SET status='done', shapefile_zip=? WHERE request_id=?")
            ->execute([$zipBin, $requestId]);
    }

    $response['success'] = true;
    $response['message'] = 'Actualizado.';

} catch (Throwable $e) {
    http_response_code(500);
    $response['message'] = 'Erro interno: ' . $e->getMessage();
}

echo json_encode($response);
