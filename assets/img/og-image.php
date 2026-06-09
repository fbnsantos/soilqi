<?php
/**
 * Gera dinamicamente a imagem Open Graph (1200×630)
 * Acesso: /assets/img/og-image.png via rewrite ou directamente como og-image.php
 */
header('Content-Type: image/png');
header('Cache-Control: public, max-age=604800'); // 1 semana

$w = 1200; $h = 630;
$img = imagecreatetruecolor($w, $h);

// Cores
$bgDark   = imagecolorallocate($img, 26,  58, 42);   // #1a3a2a
$bgLight  = imagecolorallocate($img, 45, 106, 79);   // #2d6a4f
$white    = imagecolorallocate($img, 255, 255, 255);
$offwhite = imagecolorallocate($img, 220, 237, 228);
$accent   = imagecolorallocate($img, 134, 239, 172);  // verde claro

// Gradiente de fundo (simulado com rectângulos)
for ($y = 0; $y < $h; $y++) {
    $r = (int)(26  + (45  - 26)  * $y / $h);
    $g = (int)(58  + (106 - 58)  * $y / $h);
    $b = (int)(42  + (79  - 42)  * $y / $h);
    $c = imagecolorallocate($img, $r, $g, $b);
    imageline($img, 0, $y, $w, $y, $c);
}

// Faixa lateral esquerda decorativa
imagefilledrectangle($img, 0, 0, 8, $h, $accent);

// Título principal
$font = 5; // fonte GD built-in
$title = 'SoilQI';
imagestring($img, $font, 60, 180, $title, $white);

// Sub-título
$sub = 'Precision Agriculture Platform';
imagestring($img, 4, 60, 230, $sub, $offwhite);

$sub2 = 'Universidade do Porto';
imagestring($img, 3, 60, 265, $sub2, $accent);

// Linha divisória
imageline($img, 60, 310, 500, 310, $accent);

// Tags / keywords
$tags = ['IoT Sensors', 'Robotic Monitoring', 'VRT Maps', 'Satellite Imagery', 'Field Data'];
$x = 60; $y2 = 330;
foreach ($tags as $tag) {
    $tw = strlen($tag) * 7 + 20;
    imagefilledroundrect($img, $x, $y2, $x + $tw, $y2 + 26, 6, 6, imagecolorallocatealpha($img, 134, 239, 172, 90));
    imagestring($img, 2, $x + 10, $y2 + 7, $tag, $bgDark);
    $x += $tw + 10;
    if ($x > 900) { $x = 60; $y2 += 36; }
}

// URL
imagestring($img, 2, 60, $h - 50, 'soilqi.com', $offwhite);

imagepng($img);
imagedestroy($img);

function imagefilledroundrect($img, $x1, $y1, $x2, $y2, $rx, $ry, $color) {
    imagefilledrectangle($img, $x1 + $rx, $y1, $x2 - $rx, $y2, $color);
    imagefilledrectangle($img, $x1, $y1 + $ry, $x2, $y2 - $ry, $color);
    imagefilledellipse($img, $x1 + $rx, $y1 + $ry, $rx * 2, $ry * 2, $color);
    imagefilledellipse($img, $x2 - $rx, $y1 + $ry, $rx * 2, $ry * 2, $color);
    imagefilledellipse($img, $x1 + $rx, $y2 - $ry, $rx * 2, $ry * 2, $color);
    imagefilledellipse($img, $x2 - $rx, $y2 - $ry, $rx * 2, $ry * 2, $color);
}
