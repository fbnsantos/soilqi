<?php
/**
 * api/prescription_download.php
 * Download do ZIP do shapefile de prescrição.
 * GET: ?id=<prescription_id>   (requer sessão autenticada)
 */

session_start();
require_once __DIR__ . '/../config.php';

// Verificar autenticação
if (empty($_SESSION['user_id'])) {
    http_response_code(403);
    echo 'Acesso negado.';
    exit;
}

$id     = intval($_GET['id'] ?? 0);
$userId = (int)$_SESSION['user_id'];

if ($id <= 0) {
    http_response_code(400); echo 'ID inválido.'; exit;
}

try {
    $pdo = getDBConnection();
    $st  = $pdo->prepare("
        SELECT name, shapefile_zip
        FROM prescription_results
        WHERE id = ? AND user_id = ? AND status = 'done'
    ");
    $st->execute([$id, $userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row || !$row['shapefile_zip']) {
        http_response_code(404); echo 'Ficheiro não encontrado.'; exit;
    }

    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $row['name']);
    $safe = substr($safe, 0, 60) ?: 'prescription';

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $safe . '.zip"');
    header('Content-Length: ' . strlen($row['shapefile_zip']));
    header('Cache-Control: no-cache');
    echo $row['shapefile_zip'];

} catch (Throwable $e) {
    http_response_code(500);
    echo 'Erro interno: ' . $e->getMessage();
}
