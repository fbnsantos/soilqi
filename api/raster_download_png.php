<?php
/**
 * api/raster_download_png.php
 * Download do PNG de um raster de satélite.
 * GET: ?id=<raster_id>  (requer sessão autenticada)
 */

session_start();
require_once __DIR__ . '/../config.php';

if (empty($_SESSION['user_id'])) {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo 'Acesso negado.';
    exit;
}

$id     = intval($_GET['id'] ?? 0);
$userId = (int)$_SESSION['user_id'];

if ($id <= 0) {
    http_response_code(400);
    header('Content-Type: text/plain');
    echo 'ID inválido.';
    exit;
}

try {
    $pdo = getDBConnection();
    $st  = $pdo->prepare("
        SELECT name, raster_type, png_data
        FROM raster_results
        WHERE id = ? AND user_id = ? AND status = 'done'
    ");
    $st->execute([$id, $userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row || !$row['png_data']) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'Ficheiro não encontrado.';
        exit;
    }

    $type = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $row['raster_type'] ?: 'raster');
    $name = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $row['name'] ?: '');
    $safe = trim($type . '_' . substr($name, 0, 50), '_') ?: 'raster';

    header('Content-Type: image/png');
    header('Content-Disposition: attachment; filename="' . $safe . '.png"');
    header('Cache-Control: no-cache, no-store');
    echo $row['png_data'];

} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: text/plain');
    echo 'Erro interno: ' . $e->getMessage();
}
