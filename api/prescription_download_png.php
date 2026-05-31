<?php
/**
 * api/prescription_download_png.php
 * Download do PNG de visualização de uma prescrição.
 * GET: ?id=<prescription_id>  (requer sessão autenticada)
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
        SELECT name, png_data
        FROM prescription_results
        WHERE id = ? AND user_id = ? AND status = 'done'
    ");
    $st->execute([$id, $userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row || !$row['png_data']) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'Ficheiro não encontrado ou PNG não disponível.';
        exit;
    }

    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $row['name'] ?: '');
    $safe = substr($safe, 0, 60) ?: 'prescricao';

    header('Content-Type: image/png');
    header('Content-Disposition: attachment; filename="prescricao_' . $safe . '.png"');
    header('Cache-Control: no-cache, no-store');
    echo $row['png_data'];

} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: text/plain');
    echo 'Erro interno: ' . $e->getMessage();
}
