<?php
/**
 * api/prescription_download_png.php
 * Download ZIP com PNG limpo da zonagem + georeferenciação (.pgw) + CSV de prescrições.
 * GET: ?id=<prescription_id>  (requer sessão autenticada)
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
    // JOIN com zonation_results para obter PNG, bounds e legenda
    $st = $pdo->prepare("
        SELECT pr.name                AS presc_name,
               pr.zone_prescriptions,
               pr.png_data            AS presc_png,
               zr.png_data            AS zon_png,
               zr.min_lat, zr.max_lat, zr.min_lng, zr.max_lng,
               zr.legend
        FROM prescription_results pr
        JOIN zonation_results zr ON zr.id = pr.zonation_id
        WHERE pr.id = ? AND pr.user_id = ? AND pr.status = 'done'
    ");
    $st->execute([$id, $userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404); header('Content-Type: text/plain'); echo 'Prescrição não encontrada.'; exit;
    }

    // Usar PNG da prescrição se existir, caso contrário PNG da zonagem
    $pngBin = $row['presc_png'] ?: $row['zon_png'];
    if (!$pngBin) {
        http_response_code(404); header('Content-Type: text/plain'); echo 'PNG não disponível.'; exit;
    }

    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $row['presc_name'] ?: '');
    $safe = substr($safe, 0, 60) ?: 'prescricao';

    // Ficheiro de georeferenciação
    $pgw = make_pgw(
        $pngBin,
        (float)$row['min_lat'], (float)$row['max_lat'],
        (float)$row['min_lng'], (float)$row['max_lng']
    );

    // CSV de prescrições por zona
    $legend        = json_decode($row['legend']             ?? '[]', true) ?: [];
    $prescriptions = json_decode($row['zone_prescriptions'] ?? '[]', true) ?: [];
    $prescByZone   = [];
    foreach ($prescriptions as $p) {
        $zid = intval($p['zone_id'] ?? 0);
        $prescByZone[$zid] = $p;
    }

    $csvLines = ["zone_id,zona,cor,area_pct,spray_lha,fert_n_kg,fert_p_kg,fert_k_kg"];
    foreach ($legend as $z) {
        $zid = intval($z['zone_id'] ?? $z['id'] ?? 0);
        $p   = $prescByZone[$zid] ?? [];
        $csvLines[] = implode(',', [
            $zid,
            '"' . str_replace('"', '""', $z['label'] ?? '') . '"',
            '"' . ($z['color'] ?? '') . '"',
            number_format((float)($z['area_pct'] ?? 0), 1, '.', ''),
            number_format((float)($p['spray']  ?? 0), 2, '.', ''),
            number_format((float)($p['fert_n'] ?? 0), 2, '.', ''),
            number_format((float)($p['fert_p'] ?? 0), 2, '.', ''),
            number_format((float)($p['fert_k'] ?? 0), 2, '.', ''),
        ]);
    }
    $csv = implode("\n", $csvLines) . "\n";

    $zipPath = tempnam(sys_get_temp_dir(), 'soilqi_presc_');
    $zip = new ZipArchive();
    $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $zip->addFromString('prescricao_' . $safe . '.png', $pngBin);
    if ($pgw !== '') $zip->addFromString('prescricao_' . $safe . '.pgw', $pgw);
    $zip->addFromString('prescricao_' . $safe . '_valores.csv', $csv);
    $zip->close();

    $zipData = file_get_contents($zipPath);
    @unlink($zipPath);

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="prescricao_' . $safe . '.zip"');
    header('Cache-Control: no-cache, no-store');
    echo $zipData;

} catch (Throwable $e) {
    http_response_code(500); header('Content-Type: text/plain'); echo 'Erro interno: ' . $e->getMessage();
}
