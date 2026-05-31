<?php
/**
 * api/zonation_data.php
 * Chamado por Zonation.py (máquina separada) para obter as imagens PNG
 * das camadas raster necessárias para um pedido de zonagem.
 *
 * Método: POST (JSON ou form-data)
 * Campos: api_key, request_id
 * Resposta: {success: true, method, params, layers: [{id, name, type, png, bounds}]}
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

    // ── Validar campos ────────────────────────────────────────────────────────
    $requestId = trim($input['request_id'] ?? '');
    if (!$requestId) {
        http_response_code(400);
        $response['message'] = 'request_id em falta.';
        echo json_encode($response); exit;
    }

    $pdo = getDBConnection();

    // ── Encontrar registo de zonagem pendente ─────────────────────────────────
    $stmt = $pdo->prepare("
        SELECT id, method, params, input_raster_ids, user_id, terrain_id
        FROM zonation_results
        WHERE request_id = ?
    ");
    $stmt->execute([$requestId]);
    $job = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$job) {
        http_response_code(404);
        $response['message'] = 'Pedido não encontrado.';
        echo json_encode($response); exit;
    }

    $rasterIds = json_decode($job['input_raster_ids'] ?? '[]', true) ?: [];
    if (empty($rasterIds)) {
        http_response_code(400);
        $response['message'] = 'Nenhuma camada associada a este pedido.';
        echo json_encode($response); exit;
    }

    // Marcar como "processing"
    $pdo->prepare("UPDATE zonation_results SET status='processing' WHERE request_id=?")
        ->execute([$requestId]);

    // ── Recolher PNG de cada raster ───────────────────────────────────────────
    $layers = [];
    foreach ($rasterIds as $rid) {
        $rid = intval($rid);
        if ($rid <= 0) continue;

        $st = $pdo->prepare("
            SELECT id, name, raster_type,
                   png_data,
                   min_lat, max_lat, min_lng, max_lng
            FROM raster_results
            WHERE id = ? AND user_id = ? AND status = 'done'
        ");
        $st->execute([$rid, $job['user_id']]);
        $row = $st->fetch(PDO::FETCH_ASSOC);

        if ($row && $row['png_data']) {
            $layers[] = [
                'id'     => (int)$rid,
                'name'   => $row['name'],
                'type'   => $row['raster_type'],
                'png'    => base64_encode($row['png_data']),
                'bounds' => [
                    'min_lat' => (float)$row['min_lat'],
                    'max_lat' => (float)$row['max_lat'],
                    'min_lng' => (float)$row['min_lng'],
                    'max_lng' => (float)$row['max_lng'],
                ],
            ];
        }
    }

    if (empty($layers)) {
        // Marcar como erro para o JS poder mostrar mensagem
        $pdo->prepare("UPDATE zonation_results SET status='error', error_msg=? WHERE request_id=?")
            ->execute(['Nenhuma camada raster válida encontrada.', $requestId]);
        http_response_code(404);
        $response['message'] = 'Nenhuma camada raster válida encontrada.';
        echo json_encode($response); exit;
    }

    $response['success']   = true;
    $response['method']    = $job['method'];
    $response['params']    = json_decode($job['params'] ?? '{}', true) ?: [];
    $response['layers']    = $layers;

} catch (Throwable $e) {
    http_response_code(500);
    $response['message'] = 'Erro interno: ' . $e->getMessage();
}

echo json_encode($response);
