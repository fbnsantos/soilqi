<?php
/**
 * api/zonation_download_png.php
 * Download ZIP com PNG + ficheiro de georeferenciação (.pgw) de um mapa de zonagem.
 * GET: ?id=<zonation_id>  (requer sessão autenticada)
 */

session_start();
require_once __DIR__ . '/../config.php';

if (empty($_SESSION['user_id'])) {
    http_response_code(403); header('Content-Type: text/plain'); echo 'Acesso negado.'; exit;
}

$id     = intval($_GET['id'] ?? 0);
$userId = (int)$_SESSION['user_id'];

if ($id <= 0) {
    http_response_code(400); header('Content-Type: text/plain'); echo 'ID inválido.'; exit;
}

function make_pgw(string $png_bin, float $min_lat, float $max_lat, float $min_lng, float $max_lng): string
{
    $size = @getimagesizefromstring($png_bin);
    if (!$size || $size[0] <= 0 || $size[1] <= 0) return '';
    $w = $size[0]; $h = $size[1];
    $px = ($max_lng - $min_lng) / $w;
    $py = -($max_lat - $min_lat) / $h;
    $cx = $min_lng + $px / 2.0;
    $cy = $max_lat + $py / 2.0;
    return implode("\n", [
        number_format($px, 15, '.', ''),
        '0.0',
        '0.0',
        number_format($py, 15, '.', ''),
        number_format($cx, 15, '.', ''),
        number_format($cy, 15, '.', ''),
    ]) . "\n";
}

try {
    $pdo = getDBConnection();
    $st  = $pdo->prepare("
        SELECT name, method, png_data, min_lat, max_lat, min_lng, max_lng, legend
        FROM zonation_results
        WHERE id = ? AND user_id = ? AND status = 'done'
    ");
    $st->execute([$id, $userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row || !$row['png_data']) {
        http_response_code(404); header('Content-Type: text/plain'); echo 'Ficheiro não encontrado.'; exit;
    }

    $method = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $row['method'] ?: 'zonagem');
    $name   = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $row['name'] ?: '');
    $safe   = trim('zonagem_' . $method . '_' . substr($name, 0, 40), '_') ?: 'zonagem';

    $pgw = make_pgw(
        $row['png_data'],
        (float)$row['min_lat'], (float)$row['max_lat'],
        (float)$row['min_lng'], (float)$row['max_lng']
    );

    // Gerar CSV de legenda de zonas
    $legend = json_decode($row['legend'] ?? '[]', true) ?: [];
    $csvLines = ["zone_id,zona,cor,area_pct"];
    foreach ($legend as $z) {
        $csvLines[] = implode(',', [
            intval($z['zone_id'] ?? $z['id'] ?? 0),
            '"' . str_replace('"', '""', $z['label'] ?? '') . '"',
            '"' . ($z['color'] ?? '') . '"',
            number_format((float)($z['area_pct'] ?? 0), 1, '.', ''),
        ]);
    }
    $csv = implode("\n", $csvLines) . "\n";

    $zipPath = tempnam(sys_get_temp_dir(), 'soilqi_zon_');
    $zip = new ZipArchive();
    $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $zip->addFromString($safe . '.png', $row['png_data']);
    if ($pgw !== '') $zip->addFromString($safe . '.pgw', $pgw);
    $zip->addFromString($safe . '_legenda.csv', $csv);
    $zip->close();

    $zipData = file_get_contents($zipPath);
    @unlink($zipPath);

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $safe . '.zip"');
    header('Cache-Control: no-cache, no-store');
    echo $zipData;

} catch (Throwable $e) {
    http_response_code(500); header('Content-Type: text/plain'); echo 'Erro interno: ' . $e->getMessage();
}
