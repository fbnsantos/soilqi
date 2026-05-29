<?php
/**
 * api/raster_result.php
 * Endpoint chamado pelo Sentinel.py (via HTTP POST) para entregar o PNG gerado.
 * Autenticação: chave estática RASTER_API_KEY definida em config.php.
 *
 * POST body (multipart ou application/json):
 *   api_key      — chave secreta partilhada
 *   request_id   — UUID do pedido original
 *   status       — 'done' | 'error'
 *   png_data     — PNG em base64 (apenas se status=done)
 *   min_lat / max_lat / min_lng / max_lng — bounding-box
 *   error_msg    — mensagem de erro (apenas se status=error)
 */

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

    // Aceitar tanto POST form-data como JSON no body
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
    $status    = trim($input['status']     ?? '');

    if (!$requestId || !in_array($status, ['done', 'error'], true)) {
        http_response_code(400);
        $response['message'] = 'request_id ou status em falta / inválido.';
        echo json_encode($response); exit;
    }

    $pdo = getDBConnection();

    // ── Verificar que o pedido existe ─────────────────────────────────────────
    $stmt = $pdo->prepare("SELECT id, status FROM raster_results WHERE request_id = ?");
    $stmt->execute([$requestId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        http_response_code(404);
        $response['message'] = 'Pedido não encontrado.';
        echo json_encode($response); exit;
    }
    if ($row['status'] === 'done') {
        // Já processado — idempotente, aceitar mas não sobrescrever
        $response['success'] = true;
        $response['message'] = 'Já processado.';
        echo json_encode($response); exit;
    }

    // ── Actualizar registo ────────────────────────────────────────────────────
    if ($status === 'error') {
        $errMsg = substr(trim($input['error_msg'] ?? 'Erro desconhecido.'), 0, 2000);
        $upd = $pdo->prepare("
            UPDATE raster_results
               SET status = 'error', error_msg = ?, updated_at = NOW()
             WHERE request_id = ?
        ");
        $upd->execute([$errMsg, $requestId]);

    } else {
        // Descodificar PNG
        $pngB64 = $input['png_data'] ?? '';
        // Remover prefixo data URL se presente
        $pngB64 = preg_replace('/^data:image\/[a-z]+;base64,/', '', $pngB64);
        $pngBin = base64_decode($pngB64, true);
        if (!$pngBin || strlen($pngBin) < 8) {
            http_response_code(400);
            $response['message'] = 'png_data inválido ou vazio.';
            echo json_encode($response); exit;
        }

        $minLat = isset($input['min_lat']) ? floatval($input['min_lat']) : null;
        $maxLat = isset($input['max_lat']) ? floatval($input['max_lat']) : null;
        $minLng = isset($input['min_lng']) ? floatval($input['min_lng']) : null;
        $maxLng = isset($input['max_lng']) ? floatval($input['max_lng']) : null;

        $upd = $pdo->prepare("
            UPDATE raster_results
               SET status   = 'done',
                   png_data = ?,
                   min_lat  = ?, max_lat = ?,
                   min_lng  = ?, max_lng = ?,
                   updated_at = NOW()
             WHERE request_id = ?
        ");
        $upd->execute([$pngBin, $minLat, $maxLat, $minLng, $maxLng, $requestId]);
    }

    $response['success'] = true;
    $response['message'] = 'Actualizado com sucesso.';

} catch (Throwable $e) {
    http_response_code(500);
    $response['message'] = 'Erro interno: ' . $e->getMessage();
}

echo json_encode($response);
