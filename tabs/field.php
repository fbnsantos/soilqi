<?php
/**
 * Tab: Medições de Campo
 * Visualização dos dados recolhidos pela PWA SoilQI Field
 */

if (!isset($isLoggedIn)) $isLoggedIn = false;
if (!isset($isAdmin))    $isAdmin    = false;
if (!isset($currentUser)) $currentUser = null;

// ── RTKLIB .pos → GeoJSON ────────────────────────────────────────────────────
function pos_to_geojson_fld(string $posText): array {
    $qLabels = [1=>'fix',2=>'float',3=>'sbas',4=>'dgps',5=>'single',6=>'ppp'];
    $features = [];
    foreach (preg_split('/\r?\n/', $posText) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '%') continue;
        // date time lat lon height Q ns sdn sde sdu sdne sdeu sdun age ratio
        $parts = preg_split('/\s+/', $line);
        if (count($parts) < 7) continue;
        $lat = isset($parts[2]) ? (float)$parts[2] : null;
        $lon = isset($parts[3]) ? (float)$parts[3] : null;
        if ($lat === null || $lon === null || ($lat == 0 && $lon == 0)) continue;
        $q  = isset($parts[5]) ? (int)$parts[5] : 0;
        $features[] = [
            'type'     => 'Feature',
            'geometry' => ['type' => 'Point', 'coordinates' => [$lon, $lat, isset($parts[4]) ? (float)$parts[4] : 0]],
            'properties' => [
                'time'   => ($parts[0] ?? '') . ' ' . ($parts[1] ?? ''),
                'Q'      => $q,
                'status' => $qLabels[$q] ?? 'unknown',
                'ns'     => isset($parts[6]) ? (int)$parts[6] : null,
                'height' => isset($parts[4]) ? (float)$parts[4] : null,
                'sdn'    => isset($parts[7])  ? (float)$parts[7]  : null,
                'sde'    => isset($parts[8])  ? (float)$parts[8]  : null,
                'sdu'    => isset($parts[9])  ? (float)$parts[9]  : null,
                'ratio'  => isset($parts[14]) ? (float)$parts[14] : null,
            ],
        ];
    }
    return ['type' => 'FeatureCollection', 'features' => $features];
}

// ── KML → GeoJSON helpers ─────────────────────────────────────────────────────
function kml_parse_coords_fld(?DOMNode $node): ?array {
    if (!$node) return null;
    $text   = trim($node->textContent);
    $points = [];
    foreach (preg_split('/[\s\r\n]+/', $text) as $triple) {
        $triple = trim($triple);
        if ($triple === '') continue;
        $parts = explode(',', $triple);
        if (count($parts) >= 2) {
            $points[] = [(float)$parts[0], (float)$parts[1]]; // [lon, lat]
        }
    }
    return $points ?: null;
}

function kml_geom_to_geojson_fld(DOMElement $node, DOMXPath $xp): ?array {
    $ln = $node->localName;

    if ($ln === 'Point') {
        $cn  = $xp->query('.//*[local-name()="coordinates"]', $node)->item(0);
        $pts = kml_parse_coords_fld($cn);
        return $pts ? ['type' => 'Point', 'coordinates' => $pts[0]] : null;
    }
    if ($ln === 'LineString') {
        $cn  = $xp->query('.//*[local-name()="coordinates"]', $node)->item(0);
        $pts = kml_parse_coords_fld($cn);
        return $pts ? ['type' => 'LineString', 'coordinates' => $pts] : null;
    }
    if ($ln === 'Polygon') {
        $rings = [];
        $outer = $xp->query('.//*[local-name()="outerBoundaryIs"]//*[local-name()="coordinates"]', $node)->item(0);
        $outerPts = kml_parse_coords_fld($outer);
        if ($outerPts) $rings[] = $outerPts;
        foreach ($xp->query('.//*[local-name()="innerBoundaryIs"]//*[local-name()="coordinates"]', $node) as $inner) {
            $innerPts = kml_parse_coords_fld($inner);
            if ($innerPts) $rings[] = $innerPts;
        }
        return $rings ? ['type' => 'Polygon', 'coordinates' => $rings] : null;
    }
    if ($ln === 'MultiGeometry') {
        $geoms = [];
        foreach ($node->childNodes as $child) {
            if (!($child instanceof DOMElement)) continue;
            $g = kml_geom_to_geojson_fld($child, $xp);
            if ($g) $geoms[] = $g;
        }
        return $geoms ? ['type' => 'GeometryCollection', 'geometries' => $geoms] : null;
    }
    return null;
}

function kml_to_geojson_fld(string $kmlStr): array {
    libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $dom->loadXML($kmlStr);
    libxml_clear_errors();

    $xp         = new DOMXPath($dom);
    $placemarks = $xp->query('//*[local-name()="Placemark"]');
    $features   = [];

    foreach ($placemarks as $pm) {
        $name = '';
        $desc = '';
        $geom = null;
        foreach ($pm->childNodes as $child) {
            if (!($child instanceof DOMElement)) continue;
            $ln = $child->localName;
            if ($ln === 'name') {
                $name = trim($child->textContent);
            } elseif ($ln === 'description') {
                $desc = trim(strip_tags($child->textContent));
            } elseif (in_array($ln, ['Point','LineString','Polygon','MultiGeometry'])) {
                $geom = kml_geom_to_geojson_fld($child, $xp);
            }
        }
        if ($geom) {
            $props = [];
            if ($name !== '') $props['name'] = $name;
            if ($desc !== '') $props['description'] = $desc;
            $features[] = ['type' => 'Feature', 'geometry' => $geom, 'properties' => $props];
        }
    }
    return ['type' => 'FeatureCollection', 'features' => $features];
}

// ── API Handler (POST) ───────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isLoggedIn) {
    header('Content-Type: application/json');
    $action   = $_POST['action'] ?? '';
    $response = ['success' => false, 'message' => ''];

    try {
        $pdo = getDBConnection();

        // Auto-migração: objectos de campo (árvores, plantas, postes)
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS field_objects (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                user_id     INT NOT NULL,
                terrain_id  INT,
                type        VARCHAR(50)  NOT NULL DEFAULT 'tree',
                species     VARCHAR(100),
                label       VARCHAR(255),
                lat         DOUBLE,
                lng         DOUBLE,
                altitude    DOUBLE DEFAULT 0,
                notes       TEXT,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_fo_user    (user_id),
                INDEX idx_fo_terrain (terrain_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");

        switch ($action) {

            case 'get_field_measurements':
                $where  = [];
                $params = [];

                if (!$isAdmin) {
                    $where[]  = 'm.user_id = ?';
                    $params[] = $currentUser['id'];
                } elseif (!empty($_POST['user_id'])) {
                    $where[]  = 'm.user_id = ?';
                    $params[] = intval($_POST['user_id']);
                }

                if (!empty($_POST['terrain_id'])) {
                    $where[]  = 'm.terrain_id = ?';
                    $params[] = intval($_POST['terrain_id']);
                }
                if (!empty($_POST['date_from'])) {
                    $where[]  = 'DATE(m.measured_at) >= ?';
                    $params[] = $_POST['date_from'];
                }
                if (!empty($_POST['date_to'])) {
                    $where[]  = 'DATE(m.measured_at) <= ?';
                    $params[] = $_POST['date_to'];
                }

                $wc = $where ? 'WHERE ' . implode(' AND ', $where) : '';

                // Garantir coluna photo_path (migração 004) — idempotente
                try { $pdo->exec("ALTER TABLE field_measurements ADD COLUMN photo_path VARCHAR(255) NULL AFTER notes"); }
                catch (PDOException $ignored) { /* já existe */ }

                $stmt = $pdo->prepare("
                    SELECT m.id, m.latitude, m.longitude, m.gps_accuracy,
                           m.conductivity, m.ph, m.temperature, m.moisture,
                           m.notes, m.measured_at,
                           COALESCE(m.photo_path, '') AS photo_path,
                           t.name  AS terrain_name,
                           u.username
                    FROM   field_measurements m
                    LEFT JOIN terrains t ON m.terrain_id = t.id
                    LEFT JOIN users    u ON m.user_id    = u.id
                    $wc
                    ORDER BY m.measured_at DESC
                    LIMIT 1000
                ");
                $stmt->execute($params);
                $rows = $stmt->fetchAll();

                // Estatísticas do mesmo conjunto — resiliente: nunca derruba a resposta
                $stats = ['total' => 0, 'avg_ec' => null, 'avg_ph' => null, 'avg_temp' => null];
                try {
                    $sStmt = $pdo->prepare("
                        SELECT COUNT(*)          AS total,
                               AVG(conductivity) AS avg_ec,
                               AVG(ph)           AS avg_ph,
                               AVG(temperature)  AS avg_temp
                        FROM   field_measurements m
                        $wc
                    ");
                    $sStmt->execute($params);
                    $row = $sStmt->fetch();
                    if ($row) {
                        $stats = [
                            'total'   => (int)   $row['total'],
                            'avg_ec'  => $row['avg_ec']   !== null ? (float) $row['avg_ec']   : null,
                            'avg_ph'  => $row['avg_ph']   !== null ? (float) $row['avg_ph']   : null,
                            'avg_temp'=> $row['avg_temp'] !== null ? (float) $row['avg_temp'] : null,
                        ];
                    }
                } catch (PDOException $e) {
                    // Stats não críticos — falhar silenciosamente, measurements continuam ok
                    error_log('[SoilQI] Erro na query de stats: ' . $e->getMessage());
                }

                $response['success']      = true;
                $response['measurements'] = $rows;
                $response['stats']        = $stats;
                break;

            case 'get_field_stats':
                // Stats leves (sem measurements) — para carregar no arranque da página
                $where2  = [];
                $params2 = [];
                if (!$isAdmin) {
                    $where2[]  = 'm.user_id = ?';
                    $params2[] = $currentUser['id'];
                } elseif (!empty($_POST['user_id'])) {
                    $where2[]  = 'm.user_id = ?';
                    $params2[] = intval($_POST['user_id']);
                }
                if (!empty($_POST['terrain_id'])) {
                    $where2[]  = 'm.terrain_id = ?';
                    $params2[] = intval($_POST['terrain_id']);
                }
                if (!empty($_POST['date_from'])) {
                    $where2[]  = 'DATE(m.measured_at) >= ?';
                    $params2[] = $_POST['date_from'];
                }
                if (!empty($_POST['date_to'])) {
                    $where2[]  = 'DATE(m.measured_at) <= ?';
                    $params2[] = $_POST['date_to'];
                }
                $wc2 = $where2 ? 'WHERE ' . implode(' AND ', $where2) : '';

                $sStmt2 = $pdo->prepare("
                    SELECT COUNT(*)          AS total,
                           AVG(conductivity) AS avg_ec,
                           AVG(ph)           AS avg_ph,
                           AVG(temperature)  AS avg_temp
                    FROM   field_measurements m
                    $wc2
                ");
                $sStmt2->execute($params2);
                $sRow = $sStmt2->fetch();
                $response['success'] = true;
                $response['stats'] = [
                    'total'    => (int) ($sRow['total']    ?? 0),
                    'avg_ec'   => $sRow['avg_ec']   !== null ? (float) $sRow['avg_ec']   : null,
                    'avg_ph'   => $sRow['avg_ph']   !== null ? (float) $sRow['avg_ph']   : null,
                    'avg_temp' => $sRow['avg_temp'] !== null ? (float) $sRow['avg_temp'] : null,
                ];
                break;

            case 'get_terrain_geom':
                $tid = intval($_POST['terrain_id'] ?? 0);
                if ($tid <= 0) { $response['message'] = 'ID inválido.'; break; }
                if ($isAdmin) {
                    $stmt = $pdo->prepare("SELECT id, name, coordinates FROM terrains WHERE id = ?");
                    $stmt->execute([$tid]);
                } else {
                    try {
                        $stmt = $pdo->prepare("
                            SELECT t.id, t.name, t.coordinates FROM terrains t
                            WHERE t.id = ?
                              AND (t.user_id = ?
                                   OR EXISTS (SELECT 1 FROM terrain_shares s
                                              WHERE s.terrain_id = t.id AND s.shared_with = ? AND s.status = 'accepted'))
                        ");
                        $stmt->execute([$tid, $currentUser['id'], $currentUser['id']]);
                    } catch (PDOException $e) {
                        $stmt = $pdo->prepare("SELECT id, name, coordinates FROM terrains WHERE id = ? AND user_id = ?");
                        $stmt->execute([$tid, $currentUser['id']]);
                    }
                }
                $t = $stmt->fetch();
                if (!$t) { $response['message'] = 'Terreno não encontrado.'; break; }
                $response['success']  = true;
                $response['terrain']  = $t;
                break;

            case 'save_field_measurement':
                $lat        = floatval($_POST['latitude']    ?? 0);
                $lng        = floatval($_POST['longitude']   ?? 0);
                $ec         = (isset($_POST['conductivity']) && $_POST['conductivity'] !== '') ? floatval($_POST['conductivity']) : null;
                $ph         = (isset($_POST['ph'])           && $_POST['ph']           !== '') ? floatval($_POST['ph'])           : null;
                $temp       = (isset($_POST['temperature'])  && $_POST['temperature']  !== '') ? floatval($_POST['temperature'])  : null;
                $moisture   = (isset($_POST['moisture'])     && $_POST['moisture']     !== '') ? floatval($_POST['moisture'])     : null;
                $terrain_id = !empty($_POST['terrain_id'])   ? intval($_POST['terrain_id'])    : null;
                $notes      = sanitizeInput($_POST['notes']  ?? '');
                $measured_at = !empty($_POST['measured_at']) ? $_POST['measured_at'] : date('Y-m-d H:i:s');

                if ($lat == 0 && $lng == 0) { $response['message'] = 'Coordenadas inválidas.'; break; }

                $stmt = $pdo->prepare(
                    "INSERT INTO field_measurements
                        (user_id, terrain_id, latitude, longitude, gps_accuracy,
                         conductivity, ph, temperature, moisture, notes, measured_at)
                     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)"
                );
                $stmt->execute([
                    $currentUser['id'], $terrain_id, $lat, $lng,
                    $ec, $ph, $temp, $moisture, $notes, $measured_at
                ]);
                $response['success'] = true;
                $response['message'] = 'Medição guardada com sucesso!';
                $response['id']      = (int)$pdo->lastInsertId();
                break;

            case 'delete_field_measurement':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }

                if ($isAdmin) {
                    $stmt = $pdo->prepare("DELETE FROM field_measurements WHERE id = ?");
                    $stmt->execute([$id]);
                } else {
                    $stmt = $pdo->prepare("DELETE FROM field_measurements WHERE id = ? AND user_id = ?");
                    $stmt->execute([$id, $currentUser['id']]);
                }

                if ($stmt->rowCount() > 0) {
                    $response['success'] = true;
                    $response['message'] = 'Medição eliminada.';
                } else {
                    $response['message'] = 'Medição não encontrada ou sem permissão.';
                }
                break;

            // ── Interpolações guardadas ────────────────────────────────────────

            case 'save_interpolation':
                $name       = trim($_POST['name'] ?? '');
                $terrain_id = !empty($_POST['terrain_id']) ? intval($_POST['terrain_id']) : null;
                $param      = $_POST['param']     ?? '';
                $colormap   = $_POST['colormap']  ?? '';
                $resolution = intval($_POST['resolution'] ?? 256);
                $power      = floatval($_POST['power']    ?? 2);
                $method     = sanitizeInput($_POST['method'] ?? 'idw');
                $min_lat    = floatval($_POST['min_lat']  ?? 0);
                $max_lat    = floatval($_POST['max_lat']  ?? 0);
                $min_lng    = floatval($_POST['min_lng']  ?? 0);
                $max_lng    = floatval($_POST['max_lng']  ?? 0);
                $min_val    = isset($_POST['min_val']) && $_POST['min_val'] !== '' ? floatval($_POST['min_val']) : null;
                $max_val    = isset($_POST['max_val']) && $_POST['max_val'] !== '' ? floatval($_POST['max_val']) : null;
                $png_b64    = $_POST['png_data'] ?? '';

                if (!$name)    { $response['message'] = 'Nome obrigatório.'; break; }
                if (!$png_b64) { $response['message'] = 'Dados PNG em falta.'; break; }

                // Auto-migração: adicionar coluna method se não existir
                try {
                    $pdo->exec("ALTER TABLE field_interpolations ADD COLUMN method VARCHAR(20) NOT NULL DEFAULT 'idw'");
                } catch (PDOException $ignored) { /* já existe */ }

                // Strip data URL prefix and decode
                $png_b64    = preg_replace('#^data:image/\w+;base64,#', '', $png_b64);
                $png_binary = base64_decode($png_b64, true);
                if ($png_binary === false) { $response['message'] = 'PNG inválido (base64 corrompido).'; break; }

                $stmt = $pdo->prepare("
                    INSERT INTO field_interpolations
                        (user_id, terrain_id, name, param, colormap, resolution, power, method,
                         min_lat, max_lat, min_lng, max_lng, min_val, max_val, png_data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([
                    $currentUser['id'], $terrain_id, $name, $param, $colormap,
                    $resolution, $power, $method,
                    $min_lat, $max_lat, $min_lng, $max_lng,
                    $min_val, $max_val,
                    $png_binary
                ]);
                $response['success'] = true;
                $response['id']      = (int)$pdo->lastInsertId();
                $response['message'] = 'Interpolação guardada com sucesso.';
                break;

            case 'get_interpolations':
                $where  = [];
                $params = [];
                if (!$isAdmin) {
                    $where[]  = 'fi.user_id = ?';
                    $params[] = $currentUser['id'];
                }
                $wc   = $where ? 'WHERE ' . implode(' AND ', $where) : '';
                $stmt = $pdo->prepare("
                    SELECT fi.id, fi.name, fi.param, fi.colormap, fi.resolution, fi.power,
                           COALESCE(fi.method, 'idw') AS method,
                           fi.min_lat, fi.max_lat, fi.min_lng, fi.max_lng,
                           fi.min_val, fi.max_val, fi.created_at,
                           t.name AS terrain_name,
                           u.username
                    FROM field_interpolations fi
                    LEFT JOIN terrains t ON t.id = fi.terrain_id
                    LEFT JOIN users    u ON u.id = fi.user_id
                    $wc
                    ORDER BY fi.created_at DESC
                ");
                $stmt->execute($params);
                $response['success']        = true;
                $response['interpolations'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                break;

            case 'get_interpolation_png':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }

                if ($isAdmin) {
                    $stmt = $pdo->prepare("
                        SELECT png_data, min_lat, max_lat, min_lng, max_lng, name
                        FROM field_interpolations WHERE id = ?");
                    $stmt->execute([$id]);
                } else {
                    $stmt = $pdo->prepare("
                        SELECT png_data, min_lat, max_lat, min_lng, max_lng, name
                        FROM field_interpolations WHERE id = ? AND user_id = ?");
                    $stmt->execute([$id, $currentUser['id']]);
                }
                $row = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$row) { $response['message'] = 'Interpolação não encontrada ou sem permissão.'; break; }

                $response['success'] = true;
                $response['png']     = 'data:image/png;base64,' . base64_encode($row['png_data']);
                $response['min_lat'] = (float)$row['min_lat'];
                $response['max_lat'] = (float)$row['max_lat'];
                $response['min_lng'] = (float)$row['min_lng'];
                $response['max_lng'] = (float)$row['max_lng'];
                $response['name']    = $row['name'];
                break;

            case 'delete_interpolation':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }

                if ($isAdmin) {
                    $stmt = $pdo->prepare("DELETE FROM field_interpolations WHERE id = ?");
                    $stmt->execute([$id]);
                } else {
                    $stmt = $pdo->prepare("DELETE FROM field_interpolations WHERE id = ? AND user_id = ?");
                    $stmt->execute([$id, $currentUser['id']]);
                }
                if ($stmt->rowCount() > 0) {
                    $response['success'] = true;
                    $response['message'] = 'Interpolação eliminada.';
                } else {
                    $response['message'] = 'Não encontrada ou sem permissão.';
                }
                break;

            // ── Camadas GeoJSON ────────────────────────────────────────────────

            case 'save_geojson':
                $name       = trim(sanitizeInput($_POST['name'] ?? ''));
                $descr      = trim(sanitizeInput($_POST['description'] ?? ''));
                $terrain_id = !empty($_POST['terrain_id']) ? intval($_POST['terrain_id']) : null;
                $geojson    = $_POST['geojson_data'] ?? '';

                if (!$name)    { $response['message'] = 'Nome obrigatório.'; break; }
                if (!$geojson) { $response['message'] = 'Dados GeoJSON em falta.'; break; }

                // Validar JSON e calcular bounding box + contagem de features
                $parsed = json_decode($geojson, true);
                if (!$parsed) { $response['message'] = 'GeoJSON inválido (JSON malformado).'; break; }

                $features = [];
                if (($parsed['type'] ?? '') === 'FeatureCollection') {
                    $features = $parsed['features'] ?? [];
                } elseif (($parsed['type'] ?? '') === 'Feature') {
                    $features = [$parsed];
                }
                $fcount = count($features);

                // Calcular bounding box — abordagem iterativa (sem funções aninhadas)
                // que causavam Fatal Error em PHP na segunda chamada recursiva
                $minLat = $maxLat = $minLng = $maxLng = null;
                $stack = [];
                foreach ($features as $f) {
                    $geom = $f['geometry'] ?? null;
                    if ($geom && isset($geom['coordinates'])) $stack[] = $geom['coordinates'];
                }
                // Suporte a Feature simples ou Geometry directa (sem FeatureCollection)
                if (empty($features)) {
                    if (isset($parsed['geometry']['coordinates'])) $stack[] = $parsed['geometry']['coordinates'];
                    elseif (isset($parsed['coordinates']))          $stack[] = $parsed['coordinates'];
                }
                while (!empty($stack)) {
                    $item = array_pop($stack);
                    if (!is_array($item)) continue;
                    // Par [lng, lat] — primeiro elemento numérico e não-array
                    if (count($item) >= 2 && is_numeric($item[0]) && !is_array($item[0])) {
                        $lng = (float)$item[0]; $lat = (float)$item[1];
                        if ($minLat === null || $lat < $minLat) $minLat = $lat;
                        if ($maxLat === null || $lat > $maxLat) $maxLat = $lat;
                        if ($minLng === null || $lng < $minLng) $minLng = $lng;
                        if ($maxLng === null || $lng > $maxLng) $maxLng = $lng;
                    } else {
                        foreach ($item as $child) {
                            if (is_array($child)) $stack[] = $child;
                        }
                    }
                }

                $stmt = $pdo->prepare("
                    INSERT INTO field_geojson
                        (user_id, terrain_id, name, description, geojson_data,
                         feature_count, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([
                    $currentUser['id'], $terrain_id, $name, $descr ?: null, $geojson,
                    $fcount, $minLat, $maxLat, $minLng, $maxLng
                ]);
                $response['success'] = true;
                $response['id']      = (int)$pdo->lastInsertId();
                $response['message'] = "GeoJSON \"{$name}\" guardado ({$fcount} feature(s)).";
                break;

            case 'save_kmz':
                $name       = trim(sanitizeInput($_POST['name'] ?? ''));
                $descr      = trim(sanitizeInput($_POST['description'] ?? ''));
                $terrain_id = !empty($_POST['terrain_id']) ? intval($_POST['terrain_id']) : null;

                if (!$name) { $response['message'] = 'Nome obrigatório.'; break; }

                $file = $_FILES['kmz_file'] ?? null;
                if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
                    $response['message'] = 'Erro no upload do ficheiro (código: ' . ($file['error'] ?? '?') . ').';
                    break;
                }

                $ext    = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
                $kmlStr = null;

                if ($ext === 'kmz') {
                    if (!class_exists('ZipArchive')) {
                        $response['message'] = 'ZipArchive não está disponível neste servidor.'; break;
                    }
                    $zip = new ZipArchive();
                    if ($zip->open($file['tmp_name']) !== true) {
                        $response['message'] = 'Não foi possível abrir o ficheiro KMZ.'; break;
                    }
                    for ($i = 0; $i < $zip->numFiles; $i++) {
                        $zname = $zip->getNameIndex($i);
                        if (strtolower(pathinfo($zname, PATHINFO_EXTENSION)) === 'kml') {
                            $kmlStr = $zip->getFromIndex($i);
                            break;
                        }
                    }
                    $zip->close();
                    if (!$kmlStr) { $response['message'] = 'Nenhum ficheiro KML encontrado dentro do KMZ.'; break; }
                } elseif ($ext === 'kml') {
                    $kmlStr = file_get_contents($file['tmp_name']);
                } else {
                    $response['message'] = 'Formato não suportado. Use .kmz ou .kml.'; break;
                }

                $parsed   = kml_to_geojson_fld($kmlStr);
                $features = $parsed['features'] ?? [];
                $fcount   = count($features);

                if ($fcount === 0) {
                    $response['message'] = 'Nenhuma geometria encontrada no ficheiro. Verifique se o KML contém Placemarks com geometria.';
                    break;
                }

                $geojson = json_encode($parsed, JSON_UNESCAPED_UNICODE);

                // Calcular bounding box (mesmo algoritmo iterativo do save_geojson)
                $minLat = $maxLat = $minLng = $maxLng = null;
                $stack  = [];
                foreach ($features as $f) {
                    $geom = $f['geometry'] ?? null;
                    if ($geom && isset($geom['coordinates'])) $stack[] = $geom['coordinates'];
                    elseif ($geom && isset($geom['geometries'])) {
                        foreach ($geom['geometries'] as $g) {
                            if (isset($g['coordinates'])) $stack[] = $g['coordinates'];
                        }
                    }
                }
                while (!empty($stack)) {
                    $item = array_pop($stack);
                    if (!is_array($item)) continue;
                    if (count($item) >= 2 && is_numeric($item[0]) && !is_array($item[0])) {
                        $lng = (float)$item[0]; $lat = (float)$item[1];
                        if ($minLat === null || $lat < $minLat) $minLat = $lat;
                        if ($maxLat === null || $lat > $maxLat) $maxLat = $lat;
                        if ($minLng === null || $lng < $minLng) $minLng = $lng;
                        if ($maxLng === null || $lng > $maxLng) $maxLng = $lng;
                    } else {
                        foreach ($item as $child) { if (is_array($child)) $stack[] = $child; }
                    }
                }

                $stmt = $pdo->prepare("
                    INSERT INTO field_geojson
                        (user_id, terrain_id, name, description, geojson_data,
                         feature_count, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([
                    $currentUser['id'], $terrain_id, $name, $descr ?: null, $geojson,
                    $fcount, $minLat, $maxLat, $minLng, $maxLng
                ]);
                $response['success'] = true;
                $response['id']      = (int)$pdo->lastInsertId();
                $response['message'] = "KMZ/KML \"{$name}\" convertido e guardado ({$fcount} feature(s)).";
                break;

            case 'save_pos':
                $name       = trim(sanitizeInput($_POST['name'] ?? ''));
                $descr      = trim(sanitizeInput($_POST['description'] ?? ''));
                $terrain_id = !empty($_POST['terrain_id']) ? intval($_POST['terrain_id']) : null;

                if (!$name) { $response['message'] = 'Nome obrigatório.'; break; }

                $file = $_FILES['pos_file'] ?? null;
                if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
                    $response['message'] = 'Erro no upload do ficheiro (código: ' . ($file['error'] ?? '?') . ').';
                    break;
                }

                $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
                if ($ext !== 'pos') {
                    $response['message'] = 'Formato não suportado. Use .pos (RTKLIB).'; break;
                }

                // Auto-migração: coluna source_type para distinguir .pos das camadas genéricas
                try { $pdo->exec("ALTER TABLE field_geojson ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT 'geojson'"); }
                catch (PDOException $ignored) { /* já existe */ }

                $posText  = file_get_contents($file['tmp_name']);
                $parsed   = pos_to_geojson_fld($posText);
                $features = $parsed['features'] ?? [];
                $fcount   = count($features);

                if ($fcount === 0) {
                    $response['message'] = 'Nenhum ponto válido encontrado no ficheiro .pos.'; break;
                }

                // Estatísticas de qualidade para feedback
                $qCounts = [1=>0, 2=>0, 'other'=>0];
                foreach ($features as $f) {
                    $q = $f['properties']['Q'] ?? 0;
                    if ($q === 1) $qCounts[1]++;
                    elseif ($q === 2) $qCounts[2]++;
                    else $qCounts['other']++;
                }

                $geojson = json_encode($parsed, JSON_UNESCAPED_UNICODE);

                $minLat = $maxLat = $minLng = $maxLng = null;
                foreach ($features as $f) {
                    $coords = $f['geometry']['coordinates'] ?? null;
                    if (!$coords) continue;
                    $lng = (float)$coords[0]; $lat = (float)$coords[1];
                    if ($minLat === null || $lat < $minLat) $minLat = $lat;
                    if ($maxLat === null || $lat > $maxLat) $maxLat = $lat;
                    if ($minLng === null || $lng < $minLng) $minLng = $lng;
                    if ($maxLng === null || $lng > $maxLng) $maxLng = $lng;
                }

                $stmt = $pdo->prepare("
                    INSERT INTO field_geojson
                        (user_id, terrain_id, name, description, geojson_data,
                         feature_count, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
                         source_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pos')
                ");
                $stmt->execute([
                    $currentUser['id'], $terrain_id, $name, $descr ?: null, $geojson,
                    $fcount, $minLat, $maxLat, $minLng, $maxLng
                ]);
                $response['success']  = true;
                $response['id']       = (int)$pdo->lastInsertId();
                $response['q_fix']    = $qCounts[1];
                $response['q_float']  = $qCounts[2];
                $response['q_other']  = $qCounts['other'];
                $response['message']  = "GNSS .pos \"{$name}\" importado — {$fcount} pontos (fix:{$qCounts[1]} float:{$qCounts[2]}).";
                break;

            case 'get_pos_layers':
                $where  = [];
                $params = [];
                if (!$isAdmin) {
                    $where[]  = 'g.user_id = ?';
                    $params[] = $currentUser['id'];
                }
                $where[]  = "COALESCE(g.source_type,'geojson') = 'pos'";
                $wc   = 'WHERE ' . implode(' AND ', $where);
                try {
                    $stmt = $pdo->prepare("
                        SELECT g.id, g.name, g.description, g.feature_count,
                               g.bbox_min_lat, g.bbox_max_lat, g.bbox_min_lng, g.bbox_max_lng,
                               g.created_at, t.name AS terrain_name, u.username
                        FROM field_geojson g
                        LEFT JOIN terrains t ON t.id = g.terrain_id
                        LEFT JOIN users    u ON u.id = g.user_id
                        $wc
                        ORDER BY g.created_at DESC
                    ");
                    $stmt->execute($params);
                    $response['success'] = true;
                    $response['layers']  = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $e2) {
                    $response['success'] = true;
                    $response['layers']  = [];
                }
                break;

            case 'get_geojson_layers':
                $where  = [];
                $params = [];
                if (!$isAdmin) {
                    $where[]  = 'g.user_id = ?';
                    $params[] = $currentUser['id'];
                }
                $wc   = $where ? 'WHERE ' . implode(' AND ', $where) : '';
                $stmt = $pdo->prepare("
                    SELECT g.id, g.name, g.description, g.feature_count,
                           g.bbox_min_lat, g.bbox_max_lat, g.bbox_min_lng, g.bbox_max_lng,
                           g.created_at, t.name AS terrain_name, u.username
                    FROM field_geojson g
                    LEFT JOIN terrains t ON t.id = g.terrain_id
                    LEFT JOIN users    u ON u.id = g.user_id
                    $wc
                    ORDER BY g.created_at DESC
                ");
                $stmt->execute($params);
                $response['success'] = true;
                $response['layers']  = $stmt->fetchAll(PDO::FETCH_ASSOC);
                break;

            case 'get_geojson_data':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }

                if ($isAdmin) {
                    $stmt = $pdo->prepare("SELECT id, name, geojson_data, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng FROM field_geojson WHERE id = ?");
                    $stmt->execute([$id]);
                } else {
                    $stmt = $pdo->prepare("SELECT id, name, geojson_data, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng FROM field_geojson WHERE id = ? AND user_id = ?");
                    $stmt->execute([$id, $currentUser['id']]);
                }
                $row = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$row) { $response['message'] = 'Camada não encontrada ou sem permissão.'; break; }

                $response['success']     = true;
                $response['id']          = (int)$row['id'];
                $response['name']        = $row['name'];
                $response['geojson']     = $row['geojson_data'];
                $response['bbox_min_lat'] = $row['bbox_min_lat'] !== null ? (float)$row['bbox_min_lat'] : null;
                $response['bbox_max_lat'] = $row['bbox_max_lat'] !== null ? (float)$row['bbox_max_lat'] : null;
                $response['bbox_min_lng'] = $row['bbox_min_lng'] !== null ? (float)$row['bbox_min_lng'] : null;
                $response['bbox_max_lng'] = $row['bbox_max_lng'] !== null ? (float)$row['bbox_max_lng'] : null;
                break;

            case 'delete_geojson':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }

                if ($isAdmin) {
                    $stmt = $pdo->prepare("DELETE FROM field_geojson WHERE id = ?");
                    $stmt->execute([$id]);
                } else {
                    $stmt = $pdo->prepare("DELETE FROM field_geojson WHERE id = ? AND user_id = ?");
                    $stmt->execute([$id, $currentUser['id']]);
                }
                if ($stmt->rowCount() > 0) {
                    $response['success'] = true;
                    $response['message'] = 'Camada GeoJSON eliminada.';
                } else {
                    $response['message'] = 'Não encontrada ou sem permissão.';
                }
                break;

            case 'save_field_object':
                $type     = sanitizeInput($_POST['type']      ?? 'tree');
                $species  = sanitizeInput($_POST['species']   ?? '');
                $label    = sanitizeInput($_POST['label']     ?? '');
                $lat      = floatval($_POST['lat']      ?? 0);
                $lng      = floatval($_POST['lng']      ?? 0);
                $altitude = floatval($_POST['altitude'] ?? 0);
                $notes    = sanitizeInput($_POST['notes']     ?? '');
                $tid      = intval($_POST['terrain_id'] ?? 0) ?: null;
                if (!$lat && !$lng) { $response['message'] = 'Posição GPS obrigatória.'; break; }
                $stmt = $pdo->prepare("
                    INSERT INTO field_objects (user_id, terrain_id, type, species, label, lat, lng, altitude, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([$currentUser['id'], $tid, $type, $species, $label, $lat, $lng, $altitude, $notes]);
                $response['success'] = true;
                $response['id']      = (int)$pdo->lastInsertId();
                $response['message'] = 'Objecto guardado.';
                break;

            case 'get_field_objects':
                $tid    = intval($_POST['terrain_id'] ?? 0);
                $where  = ['o.user_id = ?'];
                $params = [$currentUser['id']];
                if ($tid > 0) { $where[] = 'o.terrain_id = ?'; $params[] = $tid; }
                $wc = 'WHERE ' . implode(' AND ', $where);
                $stmt = $pdo->prepare("
                    SELECT o.*, t.name AS terrain_name
                    FROM field_objects o
                    LEFT JOIN terrains t ON o.terrain_id = t.id
                    $wc
                    ORDER BY o.created_at DESC
                ");
                $stmt->execute($params);
                $response['success'] = true;
                $response['objects'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                break;

            case 'delete_field_object':
                $id   = intval($_POST['id'] ?? 0);
                $stmt = $pdo->prepare("DELETE FROM field_objects WHERE id = ? AND user_id = ?");
                $stmt->execute([$id, $currentUser['id']]);
                $response['success'] = $stmt->rowCount() > 0;
                $response['message'] = $response['success'] ? 'Eliminado.' : 'Não encontrado.';
                break;

            // ── Rasters de satélite (Sentinel Hub via MQTT) ───────────────────

            case 'request_raster':
                $terrainId  = intval($_POST['terrain_id']  ?? 0);
                $rasterType = trim($_POST['raster_type']   ?? '');
                $dateFrom   = trim($_POST['date_from']     ?? '');
                $dateTo     = trim($_POST['date_to']       ?? '');
                $dateFrom2  = trim($_POST['date_from2']    ?? '');
                $dateTo2    = trim($_POST['date_to2']      ?? '');

                $allowed = [
                    // Sentinel-2 vegetação
                    'ndvi','ndmi','evi','msavi','gndvi','ndre','ndwi','nbr','bsi',
                    // Sentinel-2 diferenças temporais
                    'ndvi_anomaly','ndvi_diff',
                    // Sentinel-3 / Meteo
                    'lst','chuva',
                    // SAR Sentinel-1
                    'humidade_solo','sar_vv','sar_vh','sar_ratio','sar_rvi','sar_agua',
                    // DEM / Topografia
                    'altitude','declive','aspect',
                ];
                if (!$terrainId || !in_array($rasterType, $allowed, true) || !$dateFrom || !$dateTo) {
                    $response['message'] = 'Dados em falta ou tipo de raster inválido.';
                    break;
                }
                if (in_array($rasterType, ['ndvi_anomaly','ndvi_diff'], true) && (!$dateFrom2 || !$dateTo2)) {
                    $response['message'] = 'Para este tipo de raster é necessário definir o período de referência.';
                    break;
                }

                // Obter geometria do terreno e calcular bbox
                $stmt = $pdo->prepare("SELECT id, name, coordinates FROM terrains WHERE id = ? AND user_id = ?");
                $stmt->execute([$terrainId, $currentUser['id']]);
                $terrain = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$terrain) { $response['message'] = 'Terreno não encontrado.'; break; }

                $coords  = json_decode($terrain['coordinates'], true) ?? [];
                $lats    = array_map(fn($c) => isset($c['lat']) ? (float)$c['lat'] : (float)$c[0], $coords);
                $lngs    = array_map(fn($c) => isset($c['lng']) ? (float)$c['lng'] : (float)$c[1], $coords);
                if (!$lats || !$lngs) { $response['message'] = 'Geometria do terreno inválida.'; break; }

                $bbox = [min($lngs), min($lats), max($lngs), max($lats)]; // [minLon, minLat, maxLon, maxLat]

                // Gerar UUID
                $requestId = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                    mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff),
                    mt_rand(0,0x0fff)|0x4000, mt_rand(0,0x3fff)|0x8000,
                    mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff));

                // Labels amigáveis
                $typeLabels = [
                    'ndvi'          => 'NDVI', 'ndmi'  => 'NDMI',
                    'evi'           => 'EVI',  'msavi' => 'MSAVI',
                    'gndvi'         => 'GNDVI','ndre'  => 'NDRE',
                    'ndwi'          => 'NDWI', 'nbr'   => 'NBR',
                    'bsi'           => 'BSI',
                    'ndvi_anomaly'  => 'NDVI Anomalia',
                    'ndvi_diff'     => 'NDVI Diferença',
                    'lst'           => 'LST Temperatura',
                    'chuva'         => 'Chuva',
                    'humidade_solo' => 'Humidade Solo',
                    'sar_vv'        => 'SAR VV',
                    'sar_vh'        => 'SAR VH',
                    'sar_ratio'     => 'SAR VV/VH',
                    'sar_rvi'       => 'SAR RVI',
                    'sar_agua'      => 'SAR Água',
                    'altitude'      => 'Altitude',
                    'declive'       => 'Declive',
                    'aspect'        => 'Aspect',
                ];
                $name = ($typeLabels[$rasterType] ?? $rasterType)
                      . ' · ' . $terrain['name']
                      . ' · ' . date('d/m/Y', strtotime($dateFrom));

                // Auto-migrar tabela se não existir
                $pdo->exec("
                    CREATE TABLE IF NOT EXISTS raster_results (
                        id INT NOT NULL AUTO_INCREMENT,
                        user_id INT NOT NULL, terrain_id INT NULL,
                        request_id VARCHAR(36) NOT NULL,
                        raster_type VARCHAR(50) NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        status ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
                        png_data MEDIUMBLOB NULL,
                        min_lat DECIMAL(10,7) NULL, max_lat DECIMAL(10,7) NULL,
                        min_lng DECIMAL(10,7) NULL, max_lng DECIMAL(10,7) NULL,
                        date_from DATE NULL, date_to DATE NULL,
                        date_from2 DATE NULL, date_to2 DATE NULL,
                        error_msg TEXT NULL,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        PRIMARY KEY (id),
                        UNIQUE KEY uidx_request (request_id),
                        INDEX idx_rr_user (user_id), INDEX idx_rr_terrain (terrain_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                ");

                // Inserir registo pendente
                $ins = $pdo->prepare("
                    INSERT INTO raster_results
                        (user_id, terrain_id, request_id, raster_type, name,
                         date_from, date_to, date_from2, date_to2,
                         min_lat, max_lat, min_lng, max_lng)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                ");
                $ins->execute([
                    $currentUser['id'], $terrainId, $requestId, $rasterType, $name,
                    $dateFrom ?: null, $dateTo ?: null,
                    $dateFrom2 ?: null, $dateTo2 ?: null,
                    $bbox[1], $bbox[3], $bbox[0], $bbox[2],
                ]);

                // Publicar via MQTT
                $mqttError = null;
                if (defined('MQTT_HOST') && MQTT_HOST !== '' && MQTT_HOST !== '{{MQTT_HOST}}') {
                    try {
                        require_once __DIR__ . '/../lib/MqttPublisher.php';
                        $mqtt = new MqttPublisher(
                            MQTT_HOST,
                            defined('MQTT_PORT') ? (int)MQTT_PORT : 1883,
                            'soilqi_web_' . substr($requestId, 0, 8),
                            defined('MQTT_USER') ? MQTT_USER : '',
                            defined('MQTT_PASS') ? MQTT_PASS : ''
                        );
                        $payload = json_encode([
                            'request_id'   => $requestId,
                            'user_id'      => $currentUser['id'],
                            'terrain_id'   => $terrainId,
                            'terrain_name' => $terrain['name'],
                            'bbox'         => $bbox,
                            'raster_type'  => $rasterType,
                            'date_from'    => $dateFrom,
                            'date_to'      => $dateTo,
                            'date_from2'   => $dateFrom2 ?: null,
                            'date_to2'     => $dateTo2  ?: null,
                            'callback_url' => (defined('SITE_URL') ? rtrim(SITE_URL,'/') : '') . '/api/raster_result.php',
                            'api_key'      => defined('RASTER_API_KEY') ? RASTER_API_KEY : '',
                        ]);
                        $mqtt->publish(defined('MQTT_TOPIC') ? MQTT_TOPIC : '/soilqi/request', $payload, 1, false);
                        $mqtt->disconnect();
                    } catch (Throwable $mqttEx) {
                        $mqttError = $mqttEx->getMessage();
                    }
                } else {
                    $mqttError = 'MQTT não configurado — verifique config.php.';
                }

                $response['success']    = true;
                $response['request_id'] = $requestId;
                $response['name']       = $name;
                if ($mqttError) {
                    $response['mqtt_warning'] = $mqttError;
                }
                break;

            case 'get_raster_status':
                $requestId = trim($_POST['request_id'] ?? '');
                if (!$requestId) { $response['message'] = 'request_id em falta.'; break; }
                try {
                    $stmt = $pdo->prepare("
                        SELECT id, status, error_msg, name, raster_type,
                               min_lat, max_lat, min_lng, max_lng,
                               UNIX_TIMESTAMP(updated_at) as updated_ts
                        FROM raster_results
                        WHERE request_id = ? AND user_id = ?
                    ");
                    $stmt->execute([$requestId, $currentUser['id']]);
                    $row = $stmt->fetch(PDO::FETCH_ASSOC);
                    if (!$row) { $response['message'] = 'Pedido não encontrado.'; break; }
                    $response['success'] = true;
                    $response['status']  = $row['status'];
                    $response['name']    = $row['name'];
                    $response['error']   = $row['error_msg'];
                    $response['id']      = (int)$row['id'];
                } catch (PDOException $e2) {
                    $response['message'] = 'Tabela não existe — aplique a migração 006.';
                }
                break;

            case 'get_rasters':
                $tid = intval($_POST['terrain_id'] ?? 0);
                try {
                    if ($tid > 0) {
                        $stmt = $pdo->prepare("
                            SELECT id, request_id, raster_type, name, status,
                                   date_from, date_to, date_from2, date_to2,
                                   error_msg, created_at
                            FROM raster_results
                            WHERE user_id = ? AND terrain_id = ?
                            ORDER BY created_at DESC LIMIT 50
                        ");
                        $stmt->execute([$currentUser['id'], $tid]);
                    } else {
                        $stmt = $pdo->prepare("
                            SELECT r.id, r.request_id, r.raster_type, r.name, r.status,
                                   r.date_from, r.date_to, r.error_msg, r.created_at,
                                   t.name AS terrain_name
                            FROM raster_results r
                            LEFT JOIN terrains t ON t.id = r.terrain_id
                            WHERE r.user_id = ?
                            ORDER BY r.created_at DESC LIMIT 50
                        ");
                        $stmt->execute([$currentUser['id']]);
                    }
                    $response['success'] = true;
                    $response['rasters'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $e2) {
                    $response['success'] = true;
                    $response['rasters'] = [];
                }
                break;

            // ── Parâmetros de Campo ──────────────────────────────────────────────
            case 'get_field_parameters':
                try {
                    $stmt = $pdo->prepare("
                        SELECT id, name, unit, description, scope, user_id
                        FROM field_parameters
                        WHERE scope = 'global' OR user_id = ?
                        ORDER BY scope DESC, name ASC
                    ");
                    $stmt->execute([$currentUser['id']]);
                    $response['success']    = true;
                    $response['parameters'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $e2) {
                    // tabela ainda não existe — devolve lista vazia
                    $response['success']    = true;
                    $response['parameters'] = [];
                    $response['hint']       = 'Execute a migração 007 em Admin → Migrações.';
                }
                break;

            case 'add_field_parameter':
                $pname = trim($_POST['param_name'] ?? '');
                $punit = trim($_POST['param_unit'] ?? '');
                $pdesc = trim($_POST['param_desc'] ?? '');
                if (!$pname) { $response['message'] = 'Nome obrigatório.'; break; }
                try {
                    $stmt = $pdo->prepare("
                        INSERT INTO field_parameters (name, unit, description, scope, user_id)
                        VALUES (?, ?, ?, 'user', ?)
                    ");
                    $stmt->execute([$pname, $punit, $pdesc, $currentUser['id']]);
                    $response['success'] = true;
                    $response['message'] = 'Parâmetro adicionado.';
                    $response['id']      = $pdo->lastInsertId();
                } catch (PDOException $e2) {
                    $response['message'] = str_contains($e2->getMessage(), 'Duplicate') || $e2->getCode() === '23000'
                        ? 'Já existe um parâmetro com esse nome.'
                        : 'Erro: ' . $e2->getMessage();
                }
                break;

            case 'delete_field_parameter':
                $pid = intval($_POST['param_id'] ?? 0);
                if (!$pid) { $response['message'] = 'ID inválido.'; break; }
                $stmt = $pdo->prepare("SELECT scope, user_id FROM field_parameters WHERE id = ?");
                $stmt->execute([$pid]);
                $param = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$param) { $response['message'] = 'Não encontrado.'; break; }
                if ($param['scope'] === 'global' && !$isAdmin) {
                    $response['message'] = 'Sem permissão para eliminar parâmetros globais.'; break;
                }
                if ($param['scope'] === 'user' && (int)$param['user_id'] !== (int)$currentUser['id'] && !$isAdmin) {
                    $response['message'] = 'Sem permissão.'; break;
                }
                $pdo->prepare("DELETE FROM field_parameters WHERE id = ?")->execute([$pid]);
                $response['success'] = true;
                $response['message'] = 'Parâmetro eliminado.';
                break;

            // ── Importação CSV ───────────────────────────────────────────────────
            case 'import_csv':
                $rows = json_decode($_POST['rows'] ?? '[]', true);
                if (!is_array($rows) || count($rows) === 0) {
                    $response['message'] = 'Sem dados para importar.'; break;
                }
                // Garantir tabela
                $pdo->exec("CREATE TABLE IF NOT EXISTS field_csv_imports (
                    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL,
                    import_id VARCHAR(36) NOT NULL, place VARCHAR(255) NOT NULL DEFAULT '',
                    latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL,
                    class_value TINYINT NULL, param_values TEXT NULL,
                    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_csv_import (import_id), INDEX idx_csv_user (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                $importId = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                    mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff),
                    mt_rand(0,0x0fff)|0x4000, mt_rand(0,0x3fff)|0x8000,
                    mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff));

                $stmt = $pdo->prepare("
                    INSERT INTO field_csv_imports (user_id, import_id, place, latitude, longitude, class_value, param_values)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ");
                $pdo->beginTransaction();
                $count = 0;
                try {
                    foreach ($rows as $row) {
                        $lat = isset($row['latitude'])  ? (float)$row['latitude']  : null;
                        $lon = isset($row['longitude']) ? (float)$row['longitude'] : null;
                        if ($lat === null || $lon === null) continue;
                        $place = $row['place'] ?? '';
                        $cls   = isset($row['class']) ? (int)$row['class'] : null;
                        $extra = [];
                        foreach ($row as $k => $v) {
                            $k = strtolower(trim((string)$k));
                            if (in_array($k, ['place','latitude','longitude','lat','lon','class'])) continue;
                            $extra[$k] = $v;
                        }
                        $stmt->execute([
                            $currentUser['id'], $importId, $place, $lat, $lon, $cls,
                            count($extra) > 0 ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null
                        ]);
                        $count++;
                    }
                    $pdo->commit();
                    $response['success']   = true;
                    $response['import_id'] = $importId;
                    $response['imported']  = $count;
                    $response['message']   = "{$count} linhas importadas com sucesso.";
                } catch (Exception $ex) {
                    $pdo->rollBack();
                    $response['message'] = 'Erro na importação: ' . $ex->getMessage();
                }
                break;

            case 'get_csv_imports':
                try {
                    $stmt = $pdo->prepare("
                        SELECT import_id, MIN(imported_at) AS imported_at, COUNT(*) AS row_count
                        FROM field_csv_imports WHERE user_id = ?
                        GROUP BY import_id ORDER BY MIN(imported_at) DESC LIMIT 50
                    ");
                    $stmt->execute([$currentUser['id']]);
                    $response['success'] = true;
                    $response['imports'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $e2) {
                    $response['success'] = true;
                    $response['imports'] = [];
                }
                break;

            case 'get_csv_import_data':
                $importId = $_POST['import_id'] ?? '';
                if (!$importId) { $response['message'] = 'import_id em falta.'; break; }
                try {
                    $stmt = $pdo->prepare("
                        SELECT place, latitude, longitude, class_value, param_values
                        FROM field_csv_imports WHERE user_id = ? AND import_id = ? ORDER BY id ASC
                    ");
                    $stmt->execute([$currentUser['id'], $importId]);
                    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
                    foreach ($rows as &$r) {
                        $r['params'] = $r['param_values'] ? json_decode($r['param_values'], true) : [];
                        unset($r['param_values']);
                    }
                    $response['success'] = true;
                    $response['rows']    = $rows;
                } catch (PDOException $e2) {
                    $response['message'] = 'Erro: ' . $e2->getMessage();
                }
                break;

            case 'delete_csv_import':
                $importId = $_POST['import_id'] ?? '';
                if (!$importId) { $response['message'] = 'import_id em falta.'; break; }
                try {
                    $stmt = $pdo->prepare("DELETE FROM field_csv_imports WHERE user_id = ? AND import_id = ?");
                    $stmt->execute([$currentUser['id'], $importId]);
                    $response['success'] = true;
                    $response['message'] = 'Importação eliminada.';
                } catch (PDOException $e2) {
                    $response['message'] = 'Erro: ' . $e2->getMessage();
                }
                break;

            case 'delete_raster':
                $id = intval($_POST['id'] ?? 0);
                try {
                    $stmt = $pdo->prepare("DELETE FROM raster_results WHERE id = ? AND user_id = ?");
                    $stmt->execute([$id, $currentUser['id']]);
                    $response['success'] = $stmt->rowCount() > 0;
                    $response['message'] = $response['success'] ? 'Eliminado.' : 'Não encontrado.';
                } catch (PDOException $e2) {
                    $response['message'] = 'Erro: ' . $e2->getMessage();
                }
                break;

            case 'get_raster_png':
                $id = intval($_POST['id'] ?? 0);
                try {
                    $stmt = $pdo->prepare("
                        SELECT png_data, min_lat, max_lat, min_lng, max_lng, name, raster_type
                        FROM raster_results
                        WHERE id = ? AND user_id = ? AND status = 'done'
                    ");
                    $stmt->execute([$id, $currentUser['id']]);
                    $row = $stmt->fetch(PDO::FETCH_ASSOC);
                    if (!$row || !$row['png_data']) { $response['message'] = 'Raster não encontrado.'; break; }
                    $response['success']     = true;
                    $response['png']         = 'data:image/png;base64,' . base64_encode($row['png_data']);
                    $response['min_lat']     = (float)$row['min_lat'];
                    $response['max_lat']     = (float)$row['max_lat'];
                    $response['min_lng']     = (float)$row['min_lng'];
                    $response['max_lng']     = (float)$row['max_lng'];
                    $response['name']        = $row['name'];
                    $response['raster_type'] = $row['raster_type'];
                } catch (PDOException $e2) {
                    $response['message'] = 'Erro: ' . $e2->getMessage();
                }
                break;
        }

    } catch (PDOException $e) {
        $msg = $e->getMessage();
        if (strpos($msg, "doesn't exist") !== false || $e->getCode() === '42S02') {
            // Extract table name from error for a helpful message
            preg_match("/Table '.*?\.(.*?)' doesn't exist/i", $msg, $m);
            $tbl = isset($m[1]) ? $m[1] : 'necessária';
            $response['message'] = "A tabela \"{$tbl}\" não existe. Vá ao Admin → Migrações e aplique as migrações em falta.";
        } else {
            $response['message'] = 'Erro na base de dados: ' . $msg;
        }
    }

    echo json_encode($response);
    exit;
}

// ── Pré-carregar filtros (GET) ───────────────────────────────────────────────
$filterTerrains = [];
$filterUsers    = [];
$tableExists    = false;

try {
    $pdo = getDBConnection();

    // Garantir tabela field_objects
    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS field_objects (
                id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, terrain_id INT,
                type VARCHAR(50) NOT NULL DEFAULT 'tree', species VARCHAR(100),
                label VARCHAR(255), lat DOUBLE, lng DOUBLE, altitude DOUBLE DEFAULT 0,
                notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_fo_user (user_id), INDEX idx_fo_terrain (terrain_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
    } catch (PDOException $e2) { /* silencioso */ }

    // Verificar se a tabela existe
    $chk = $pdo->query("SHOW TABLES LIKE 'field_measurements'");
    $tableExists = $chk->rowCount() > 0;

    if ($tableExists) {
        // Terrenos próprios + partilhados — igual para admin e utilizador normal
        if ($isAdmin) {
            $filterUsers = $pdo->query("SELECT id, username FROM users ORDER BY username")->fetchAll();
        }
        try {
            $stmt = $pdo->prepare("
                SELECT id, name, 0 AS is_shared, '' AS shared_by FROM terrains WHERE user_id = ?
                UNION ALL
                SELECT t.id, t.name, 1 AS is_shared, u.username AS shared_by
                FROM terrains t
                JOIN terrain_shares s ON s.terrain_id = t.id AND s.shared_with = ? AND s.status = 'accepted'
                JOIN users u ON u.id = t.user_id
                ORDER BY is_shared ASC, name ASC
            ");
            $stmt->execute([$currentUser['id'], $currentUser['id']]);
        } catch (PDOException $e) {
            $stmt = $pdo->prepare("SELECT id, name, 0 AS is_shared, '' AS shared_by FROM terrains WHERE user_id = ? ORDER BY name");
            $stmt->execute([$currentUser['id']]);
        }
        $filterTerrains = $stmt->fetchAll();
    }
} catch (PDOException $e) {
    // silencioso — tratado no JS
}
?>

<?php if (!$tableExists): ?>
<div class="section" style="text-align:center; padding:60px 20px;">
    <div style="font-size:56px; margin-bottom:16px;">🗄️</div>
    <h2 style="color:#1f2937; margin-bottom:8px;">Migração necessária</h2>
    <p style="color:#6b7280; margin-bottom:20px;">
        A tabela de medições de campo ainda não foi criada na base de dados.
    </p>
    <?php if ($isAdmin): ?>
        <a href="?tab=admin" class="btn btn-primary">⚙️ Ir ao Admin → Migrações</a>
    <?php else: ?>
        <p style="color:#9ca3af; font-size:13px;">Contacte o administrador do sistema.</p>
    <?php endif; ?>
</div>
<?php return; endif; ?>

<!-- Cabeçalho do tab -->
<div class="section-header">
    <h2>📊 Medições de Campo</h2>
    <p>Dados recolhidos pela aplicação SoilQI Field (PWA)</p>
</div>

<!-- Stats grid (preenchido pelo JS) -->
<div class="stats-grid" id="field-stats-grid">
    <div class="stat-card"><div class="stat-number" id="stat-total">–</div><div class="stat-label">🔬 Total de Medições</div></div>
    <div class="stat-card"><div class="stat-number" id="stat-ec">–</div><div class="stat-label">⚡ EC Médio (mS/cm)</div></div>
    <div class="stat-card"><div class="stat-number" id="stat-ph">–</div><div class="stat-label">🧪 pH Médio</div></div>
    <div class="stat-card"><div class="stat-number" id="stat-temp">–</div><div class="stat-label">🌡️ Temp. Média (°C)</div></div>
</div>

<!-- Filtros -->
<div class="section" style="padding:16px 20px;">
    <div class="field-filters">
        <div class="filter-group">
            <label>De</label>
            <input type="date" id="filter-date-from">
        </div>
        <div class="filter-group">
            <label>Até</label>
            <input type="date" id="filter-date-to">
        </div>
        <div class="filter-group">
            <label>Terreno</label>
            <select id="filter-terrain">
                <option value="">Todos</option>
                <?php foreach ($filterTerrains as $t): ?>
                    <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <?php if ($isAdmin): ?>
        <div class="filter-group">
            <label>Utilizador</label>
            <select id="filter-user">
                <option value="">Todos</option>
                <?php foreach ($filterUsers as $u): ?>
                    <option value="<?php echo $u['id']; ?>"><?php echo htmlspecialchars($u['username']); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <?php endif; ?>
        <div class="filter-group filter-actions">
            <button class="btn btn-primary btn-sm" onclick="applyFilters()">🔍 Filtrar</button>
            <button class="btn btn-secondary btn-sm" onclick="clearFilters()">✖ Limpar</button>
        </div>
    </div>
</div>

<!-- Mapa -->
<div class="section" style="padding:0; overflow:hidden; border-radius:12px; margin-bottom:20px; position:relative;">
    <div id="field-map" style="height:420px; width:100%;"></div>
</div>

<!-- Modal: Nova Medição por Clique no Mapa -->
<div id="quick-modal-backdrop" onclick="closeQuickModal()"
     style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9000;"></div>

<div id="quick-modal"
     style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
            z-index:9001; background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.3);
            width:min(480px,96vw); max-height:90dvh; overflow-y:auto;">

    <div style="padding:18px 20px 0; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="font-size:17px; color:#1f2937;">📍 Nova Medição</h3>
        <button onclick="closeQuickModal()"
                style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px;">✕</button>
    </div>

    <div style="padding:16px 20px;">
        <!-- Coordenadas -->
        <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; padding:12px; margin-bottom:14px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#0369a1; margin-bottom:8px;">
                📌 Coordenadas (clique no mapa)
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div>
                    <label style="font-size:11px; color:#6b7280; display:block; margin-bottom:3px;">Latitude</label>
                    <input id="qm-lat" type="number" step="0.0000001"
                           style="width:100%;padding:7px 9px;border:1.5px solid #e5e7eb;border-radius:7px;font-size:13px;font-family:monospace;">
                </div>
                <div>
                    <label style="font-size:11px; color:#6b7280; display:block; margin-bottom:3px;">Longitude</label>
                    <input id="qm-lng" type="number" step="0.0000001"
                           style="width:100%;padding:7px 9px;border:1.5px solid #e5e7eb;border-radius:7px;font-size:13px;font-family:monospace;">
                </div>
            </div>
            <div style="font-size:11px; color:#94a3b8; margin-top:5px;">📵 Sem precisão GPS (entrada manual)</div>
        </div>

        <!-- Parâmetros do solo -->
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#374151; margin-bottom:8px;">
            Parâmetros do Solo
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
            <div>
                <label style="font-size:12px; color:#6b7280; display:flex; justify-content:space-between; margin-bottom:4px;">
                    Condutividade EC <span style="color:#9ca3af">mS/cm</span>
                </label>
                <input id="qm-ec" type="number" step="0.01" min="0" placeholder="0.00" inputmode="decimal"
                       style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:15px;">
            </div>
            <div>
                <label style="font-size:12px; color:#6b7280; display:flex; justify-content:space-between; margin-bottom:4px;">
                    pH <span style="color:#9ca3af">0–14</span>
                </label>
                <input id="qm-ph" type="number" step="0.1" min="0" max="14" placeholder="7.0" inputmode="decimal"
                       style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:15px;">
            </div>
            <div>
                <label style="font-size:12px; color:#6b7280; display:flex; justify-content:space-between; margin-bottom:4px;">
                    Temperatura <span style="color:#9ca3af">°C</span>
                </label>
                <input id="qm-temp" type="number" step="0.1" placeholder="20.0" inputmode="decimal"
                       style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:15px;">
            </div>
            <div>
                <label style="font-size:12px; color:#6b7280; display:flex; justify-content:space-between; margin-bottom:4px;">
                    Humidade <span style="color:#9ca3af">%</span>
                </label>
                <input id="qm-moisture" type="number" step="0.1" min="0" max="100" placeholder="30.0" inputmode="decimal"
                       style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:15px;">
            </div>
        </div>

        <!-- Terreno e Notas -->
        <div style="margin-bottom:10px;">
            <label style="font-size:12px; color:#6b7280; display:block; margin-bottom:4px;">Terreno</label>
            <select id="qm-terrain"
                    style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;appearance:none;background:white;">
                <option value="">— Sem terreno associado —</option>
                <?php foreach ($filterTerrains as $t): ?>
                    <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div>
            <label style="font-size:12px; color:#6b7280; display:block; margin-bottom:4px;">Notas</label>
            <textarea id="qm-notes" rows="2" placeholder="Observações, profundidade, condições…"
                      style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;resize:vertical;"></textarea>
        </div>
    </div>

    <!-- Footer -->
    <div style="padding:12px 20px 18px; display:flex; gap:10px; border-top:1px solid #f3f4f6;">
        <button id="qm-submit" onclick="submitQuickMeasurement()"
                class="btn btn-primary" style="flex:1; padding:12px; font-size:15px;">
            💾 Guardar Medição
        </button>
        <button onclick="closeQuickModal()" class="btn btn-secondary" style="padding:12px 20px;">
            Cancelar
        </button>
    </div>
</div>

<!-- Modal: Adicionar Objecto de Campo (árvore / poste) -->
<div id="add-obj-backdrop" onclick="closeAddObjectModal()"
     style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9000;"></div>

<div id="add-obj-modal"
     style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
            z-index:9001; background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.3);
            width:min(500px,96vw); max-height:90dvh; overflow-y:auto;">

    <div style="padding:18px 20px 0; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="font-size:17px; color:#1f2937;" id="add-obj-title">🌿 Novo Objecto de Campo</h3>
        <button onclick="closeAddObjectModal()"
                style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px;">✕</button>
    </div>

    <div style="padding:16px 20px;">
        <!-- Tipo -->
        <div style="margin-bottom:12px;">
            <label style="font-size:12px; color:#6b7280; display:block; margin-bottom:4px; font-weight:600;">Tipo de Objecto</label>
            <div style="display:flex; gap:8px;">
                <label style="flex:1; cursor:pointer; padding:10px; border:2px solid #e5e7eb; border-radius:10px;
                              display:flex; align-items:center; gap:8px; font-size:14px;"
                       id="ao-type-tree-lbl">
                    <input type="radio" name="ao-type" value="tree" id="ao-type-tree" onchange="onAoTypeChange()" checked>
                    🌳 Árvore / Planta
                </label>
                <label style="flex:1; cursor:pointer; padding:10px; border:2px solid #e5e7eb; border-radius:10px;
                              display:flex; align-items:center; gap:8px; font-size:14px;"
                       id="ao-type-pole-lbl">
                    <input type="radio" name="ao-type" value="pole" id="ao-type-pole" onchange="onAoTypeChange()">
                    🪵 Poste
                </label>
            </div>
        </div>

        <!-- Espécie (só árvores) -->
        <div id="ao-species-row" style="margin-bottom:12px;">
            <label style="font-size:12px; color:#6b7280; display:block; margin-bottom:4px; font-weight:600;">Espécie</label>
            <select id="ao-species"
                    style="width:100%; padding:9px 10px; border:1.5px solid #e5e7eb; border-radius:8px; font-size:14px; appearance:none; background:#fff;">
                <option value="oliveira">🫒 Oliveira</option>
                <option value="videira">🍇 Videira</option>
                <option value="macieira">🍎 Macieira</option>
                <option value="macieira_2d">🍎 Macieira 2D (espaleira)</option>
                <option value="pereira">🍐 Pereira</option>
                <option value="outro">🌳 Outro</option>
            </select>
        </div>

        <!-- Modo de colocação -->
        <div style="margin-bottom:14px;">
            <label style="font-size:12px; color:#6b7280; font-weight:600; display:block; margin-bottom:6px;">Modo de colocação</label>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                <label id="ao-mode-pts-lbl"
                       style="cursor:pointer; padding:10px; border:2px solid #667eea; border-radius:9px;
                              background:#eef2ff; display:flex; align-items:center; gap:7px; font-size:13px;">
                    <input type="radio" name="ao-mode" value="points" onchange="onAoModeChange()" checked>
                    📍 Pontos avulso
                </label>
                <label id="ao-mode-line-lbl"
                       style="cursor:pointer; padding:10px; border:2px solid #e5e7eb; border-radius:9px;
                              display:flex; align-items:center; gap:7px; font-size:13px;">
                    <input type="radio" name="ao-mode" value="line" onchange="onAoModeChange()">
                    📏 Linha / Espaldeira
                </label>
            </div>
        </div>

        <!-- Prefixo / Etiqueta (pontos) ou só etiqueta (linha) -->
        <div id="ao-label-row" style="margin-bottom:12px;">
            <label id="ao-label-lbl" style="font-size:12px; color:#6b7280; display:block; margin-bottom:4px; font-weight:600;">
                Prefixo <span style="font-weight:400; color:#9ca3af;">(opcional — ex: T → T001, T002…)</span>
            </label>
            <input id="ao-label" type="text" placeholder="Ex: T, O, P…"
                   style="width:100%; padding:9px 10px; border:1.5px solid #e5e7eb; border-radius:8px; font-size:14px; box-sizing:border-box;">
        </div>

        <!-- ── SECÇÃO: Pontos avulso ── -->
        <div id="ao-section-points">
            <div style="margin-bottom:12px;">
                <button onclick="activateObjectPickMode()"
                        style="width:100%; padding:13px; font-size:15px; font-weight:700;
                               background:linear-gradient(135deg,#667eea,#764ba2); color:#fff;
                               border:none; border-radius:10px; cursor:pointer;
                               display:flex; align-items:center; justify-content:center; gap:8px;
                               box-shadow:0 2px 8px rgba(102,126,234,.4);">
                    🗺️ Marcar posições no mapa
                </button>
                <div style="font-size:11px; color:#9ca3af; text-align:center; margin-top:5px;">
                    Cada clique no mapa adiciona uma posição automaticamente.
                </div>
            </div>
            <details style="margin-bottom:12px;">
                <summary style="font-size:12px; color:#667eea; cursor:pointer; user-select:none;">
                    ✏️ Adicionar posição manualmente
                </summary>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-top:6px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr 0.6fr; gap:6px; margin-bottom:8px;">
                        <div>
                            <label style="font-size:11px; color:#6b7280; display:block; margin-bottom:3px;">Latitude</label>
                            <input id="ao-lat" type="number" step="0.0000001" placeholder="38.5180"
                                   style="width:100%; padding:6px 8px; border:1.5px solid #e5e7eb; border-radius:6px; font-size:12px; font-family:monospace; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:11px; color:#6b7280; display:block; margin-bottom:3px;">Longitude</label>
                            <input id="ao-lng" type="number" step="0.0000001" placeholder="-8.1270"
                                   style="width:100%; padding:6px 8px; border:1.5px solid #e5e7eb; border-radius:6px; font-size:12px; font-family:monospace; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:11px; color:#6b7280; display:block; margin-bottom:3px;">Alt. (m)</label>
                            <input id="ao-altitude" type="number" step="0.1" placeholder="0"
                                   style="width:100%; padding:6px 8px; border:1.5px solid #e5e7eb; border-radius:6px; font-size:12px; font-family:monospace; box-sizing:border-box;">
                        </div>
                    </div>
                    <button onclick="addToPositionsList()"
                            style="width:100%; padding:7px; font-size:13px; font-weight:600;
                                   background:#667eea; color:#fff; border:none; border-radius:7px; cursor:pointer;">
                        ➕ Adicionar esta posição
                    </button>
                </div>
            </details>
            <div id="ao-pick-hint" style="display:none;"></div>
            <div id="ao-positions-list"
                 style="display:none; background:#f0fdf4; border:1px solid #86efac;
                        border-radius:10px; padding:10px; margin-bottom:12px; max-height:180px; overflow-y:auto;">
            </div>
        </div>

        <!-- ── SECÇÃO: Linha / Espaldeira ── -->
        <div id="ao-section-line" style="display:none; margin-bottom:12px;">
            <button onclick="activateLineDrawMode()"
                    style="width:100%; padding:13px; font-size:15px; font-weight:700;
                           background:linear-gradient(135deg,#0ea5e9,#0369a1); color:#fff;
                           border:none; border-radius:10px; cursor:pointer;
                           display:flex; align-items:center; justify-content:center; gap:8px;
                           box-shadow:0 2px 8px rgba(14,165,233,.4);">
                🗺️ Desenhar linha no mapa
            </button>
            <div style="font-size:11px; color:#9ca3af; text-align:center; margin-top:5px;">
                Clique no mapa para definir o percurso. Cada ponto adiciona um vértice. Clique em <strong>Concluído</strong> quando terminar.
            </div>

            <!-- Config (aparece depois de desenhar) -->
            <div id="ao-line-config" style="display:none; margin-top:12px; background:#f0f9ff;
                 border:1px solid #bae6fd; border-radius:10px; padding:12px;">
                <div id="ao-line-length-label"
                     style="font-size:13px; font-weight:700; color:#0369a1; margin-bottom:10px;">
                    📏 —
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                    <div>
                        <label style="font-size:11px; color:#6b7280; font-weight:600; display:block; margin-bottom:3px;">
                            Espaçamento entre objectos (m)
                        </label>
                        <input id="ao-spacing" type="number" min="0.1" step="0.1" value="5"
                               oninput="previewLineObjects()"
                               style="width:100%; padding:8px 9px; border:1.5px solid #e5e7eb; border-radius:7px; font-size:15px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:11px; color:#6b7280; font-weight:600; display:block; margin-bottom:3px;">
                            ID da linha / fila
                        </label>
                        <input id="ao-row-id" type="text" placeholder="Linha A, Fila 1…"
                               style="width:100%; padding:8px 9px; border:1.5px solid #e5e7eb; border-radius:7px; font-size:14px; box-sizing:border-box;">
                    </div>
                </div>
                <div style="margin-bottom:8px;">
                    <label style="font-size:11px; color:#6b7280; font-weight:600; display:block; margin-bottom:3px;">
                        Offset do 1.º objecto desde o início da linha (m)
                    </label>
                    <input id="ao-line-offset" type="number" min="0" step="0.1" value="0"
                           oninput="previewLineObjects()"
                           style="width:110px; padding:8px 9px; border:1.5px solid #e5e7eb; border-radius:7px; font-size:14px;">
                </div>
                <div id="ao-line-preview"
                     style="font-size:13px; font-weight:700; color:#374151; padding:6px 0;"></div>
                <button onclick="activateLineDrawMode()"
                        style="width:100%; margin-top:6px; font-size:12px; color:#0369a1; background:#e0f2fe;
                               border:1px solid #bae6fd; border-radius:7px; padding:7px; cursor:pointer;">
                    🔄 Re-desenhar linha
                </button>
            </div>
        </div>

        <!-- Terreno + Notas (comuns a ambos os modos) -->
        <div style="margin-bottom:12px;">
            <label style="font-size:12px; color:#6b7280; display:block; margin-bottom:4px; font-weight:600;">Terreno associado</label>
            <select id="ao-terrain"
                    style="width:100%; padding:9px 10px; border:1.5px solid #e5e7eb; border-radius:8px; font-size:14px; appearance:none; background:#fff;">
                <option value="">— Sem terreno —</option>
                <?php foreach ($filterTerrains as $t): ?>
                    <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div>
            <label style="font-size:12px; color:#6b7280; display:block; margin-bottom:4px; font-weight:600;">Notas (opcional)</label>
            <textarea id="ao-notes" rows="2" placeholder="Estado, data de plantação, observações…"
                      style="width:100%; padding:9px 10px; border:1.5px solid #e5e7eb; border-radius:8px; font-size:14px; resize:vertical; box-sizing:border-box;"></textarea>
        </div>
    </div>

    <div style="padding:12px 20px 18px; display:flex; gap:10px; border-top:1px solid #f3f4f6; align-items:center;">
        <button id="ao-save-btn" onclick="saveObjects()" class="btn btn-primary" style="flex:1; padding:12px; font-size:15px;">
            💾 Guardar Objecto
        </button>
        <button onclick="closeAddObjectModal()" class="btn btn-secondary" style="padding:12px 20px;">
            Cancelar
        </button>
        <div id="ao-status" style="font-size:12px; color:#6b7280; min-width:80px;"></div>
    </div>
</div>

<!-- Painel de Interpolação Espacial -->
<div class="section interp-section">
    <div class="section-title" style="cursor:pointer; user-select:none;" onclick="toggleInterpPanel()">
        <h3>🎨 Interpolação Espacial</h3>
        <span id="interp-toggle-btn" class="btn btn-secondary btn-sm">▼ Expandir</span>
    </div>
    <div id="interp-panel" style="display:none; margin-top:16px;">
        <p style="color:#6b7280; font-size:13px; margin-bottom:14px;">
            Selecione um campo, um método e um parâmetro para gerar uma superfície interpolada visível sobre o terreno no mapa.
        </p>
        <div class="field-filters" style="flex-wrap:wrap;">

            <div class="filter-group">
                <label>Campo (terreno)</label>
                <select id="interp-terrain-sel" style="min-width:160px;">
                    <option value="">— Selecione —</option>
                    <?php foreach ($filterTerrains as $t): ?>
                        <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                    <?php endforeach; ?>
                </select>
            </div>

            <div class="filter-group">
                <label>Método</label>
                <select id="interp-method" onchange="onInterpMethodChange()">
                    <option value="idw">IDW — Distância Inversa</option>
                    <option value="kriging">Kriging Ordinária</option>
                    <option value="tps">Thin Plate Spline</option>
                    <option value="nn">Vizinho mais próximo</option>
                </select>
            </div>

            <!-- ── Parâmetros IDW ── -->
            <div id="ipar-idw" class="filter-group">
                <label>Potência p: <span id="interp-power-val">2</span></label>
                <input type="range" id="interp-power" min="1" max="5" step="0.5" value="2"
                       oninput="document.getElementById('interp-power-val').textContent=this.value"
                       style="min-width:100px; accent-color:#667eea;"
                       title="p=1 suave/global · p≥3 abrupto/local">
            </div>

            <!-- ── Parâmetros Kriging ── -->
            <div id="ipar-kriging" class="filter-group" style="display:none;">
                <label>Variograma</label>
                <select id="interp-variogram">
                    <option value="spherical">Esférico</option>
                    <option value="exponential">Exponencial</option>
                    <option value="gaussian">Gaussiano</option>
                </select>
            </div>
            <div id="ipar-kriging2" class="filter-group" style="display:none;">
                <label>Nugget: <span id="interp-nugget-val">0</span>%</label>
                <input type="range" id="interp-nugget" min="0" max="40" step="5" value="0"
                       oninput="document.getElementById('interp-nugget-val').textContent=this.value"
                       style="min-width:100px; accent-color:#667eea;"
                       title="Discontinuidade à origem (ruído de medição)">
            </div>

            <!-- ── Parâmetros TPS ── -->
            <div id="ipar-tps" class="filter-group" style="display:none;">
                <label>Suavização: <span id="interp-tps-smooth-val">0</span></label>
                <input type="range" id="interp-tps-smooth" min="0" max="50" value="0"
                       oninput="document.getElementById('interp-tps-smooth-val').textContent=this.value"
                       style="min-width:100px; accent-color:#667eea;"
                       title="0 = passa exactamente pelos pontos · 50 = superfície mais suave">
            </div>

            <div class="filter-group">
                <label>Parâmetro</label>
                <select id="interp-param">
                    <option value="conductivity">⚡ Condutividade EC (mS/cm)</option>
                    <option value="ph">🧪 pH</option>
                    <option value="temperature">🌡️ Temperatura (°C)</option>
                    <option value="moisture">💧 Humidade (%)</option>
                </select>
            </div>

            <div class="filter-group">
                <label>Escala de cores</label>
                <select id="interp-colormap">
                    <option value="ryg">🔴→🟡→🟢 Alto→Baixo</option>
                    <option value="gyr">🟢→🟡→🔴 Baixo→Alto</option>
                    <option value="plasma">🟣 Plasma</option>
                    <option value="blues">🔵 Azuis</option>
                    <option value="viridis">🌈 Viridis</option>
                </select>
            </div>

            <div class="filter-group">
                <label>Resolução</label>
                <select id="interp-res">
                    <option value="150">Rápida (150 px)</option>
                    <option value="250" selected>Normal (250 px)</option>
                    <option value="400">Alta (400 px)</option>
                </select>
            </div>

            <div class="filter-group">
                <label>Opacidade: <span id="interp-opacity-val">70</span>%</label>
                <input type="range" id="interp-opacity" min="10" max="100" value="70" style="min-width:120px;"
                    oninput="document.getElementById('interp-opacity-val').textContent=this.value; updateOverlayOpacity()">
            </div>

            <div class="filter-group filter-actions" style="gap:8px; flex-direction:row; align-items:flex-end;">
                <button class="btn btn-primary" onclick="generateInterpolation()">🎨 Gerar</button>
                <button class="btn btn-secondary" onclick="removeInterpolation()">🗑️ Remover</button>
            </div>
        </div>

        <div id="interp-status" style="margin-top:12px; font-size:13px; color:#6b7280; min-height:20px;"></div>

        <!-- Guardar interpolação -->
        <div id="interp-save-box" style="display:none; margin-top:14px; background:#f0fdf4;
             border:1px solid #86efac; border-radius:10px; padding:14px;">
            <div style="font-size:12px; font-weight:700; color:#166534; margin-bottom:8px;">
                💾 Guardar esta interpolação na base de dados
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <input id="interp-save-name" type="text"
                       placeholder="Nome (ex: EC Campo Norte — Jan 2026)"
                       style="flex:1; min-width:200px; padding:8px 10px;
                              border:1.5px solid #86efac; border-radius:7px; font-size:13px;">
                <button class="btn btn-primary btn-sm" onclick="saveInterpolation()"
                        style="white-space:nowrap; padding:8px 14px;">
                    💾 Guardar
                </button>
            </div>
            <div id="interp-save-status" style="font-size:12px; color:#6b7280; margin-top:6px; min-height:16px;"></div>
        </div>

        <!-- Legenda de cores -->
        <div id="interp-legend" style="display:none; margin-top:14px;">
            <div style="font-size:12px; font-weight:600; color:#374151; margin-bottom:4px;" id="interp-legend-title"></div>
            <canvas id="legend-canvas" width="320" height="24" style="border-radius:5px; width:100%; max-width:320px; display:block;"></canvas>
            <div style="display:flex; justify-content:space-between; font-size:11px; color:#9ca3af; max-width:320px; margin-top:3px;">
                <span id="legend-min"></span>
                <span id="legend-mid"></span>
                <span id="legend-max"></span>
            </div>
        </div>
    </div>
</div>

<!-- Interpolações Guardadas -->
<div class="section interp-section">
    <div class="section-title" style="cursor:pointer; user-select:none;" onclick="toggleSavedInterpPanel()">
        <h3>🗂️ Interpolações Guardadas</h3>
        <span id="saved-interp-toggle" class="btn btn-secondary btn-sm">▼ Expandir</span>
    </div>
    <div id="saved-interp-panel" style="display:none; margin-top:16px;">
        <p style="color:#6b7280; font-size:13px; margin-bottom:12px;">
            Interpolações guardadas podem ser adicionadas como layer ao mapa e descarregadas
            em PNG com ficheiro de georreferenciação (.pgw) compatível com QGIS e outros SIG.
        </p>
        <div id="saved-interp-list">
            <div style="text-align:center; padding:20px; color:#9ca3af;">A carregar…</div>
        </div>
    </div>
</div>

<!-- Camadas GeoJSON -->
<div class="section interp-section">
    <div class="section-title" style="cursor:pointer; user-select:none;" onclick="toggleGeoJSONPanel()">
        <h3>🗺️ Camadas Vectoriais</h3>
        <span id="geojson-toggle-btn" class="btn btn-secondary btn-sm">▼ Expandir</span>
    </div>
    <div id="geojson-panel" style="display:none; margin-top:16px;">
        <p style="color:#6b7280; font-size:13px; margin-bottom:14px;">
            Importe ficheiros <strong>.geojson</strong>, <strong>.json</strong>, <strong>.kmz</strong>,
            <strong>.kml</strong> ou <strong>.pos</strong> (RTKLIB/GNSS) para guardar camadas vectoriais
            (polígonos, linhas, pontos, trajectórias GNSS) na base de dados e visualizá-las sobrepostas ao mapa.
        </p>

        <!-- Formulário de importação -->
        <div style="background:#f8fafc; border:1.5px dashed #94a3b8; border-radius:12px; padding:16px; margin-bottom:16px;">
            <div style="font-size:12px; font-weight:700; color:#374151; text-transform:uppercase;
                        letter-spacing:.5px; margin-bottom:12px;">📂 Importar novo ficheiro</div>
            <div class="field-filters" style="flex-wrap:wrap; gap:10px;">
                <div class="filter-group" style="flex:1; min-width:180px;">
                    <label>Nome da camada *</label>
                    <input id="gj-name" type="text" placeholder="Ex: Parcelas Norte 2026"
                           style="width:100%;">
                </div>
                <div class="filter-group" style="flex:1; min-width:140px;">
                    <label>Terreno (opcional)</label>
                    <select id="gj-terrain" style="width:100%;">
                        <option value="">— Nenhum —</option>
                        <?php foreach ($filterTerrains as $t): ?>
                            <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="filter-group" style="flex:2; min-width:220px;">
                    <label>Descrição (opcional)</label>
                    <input id="gj-description" type="text" placeholder="Notas sobre esta camada"
                           style="width:100%;">
                </div>
            </div>
            <div style="margin-top:10px;">
                <label id="gj-file-label" style="
                    display:flex; align-items:center; gap:10px; cursor:pointer;
                    padding:12px 14px; border:2px dashed #cbd5e1; border-radius:10px;
                    background:#fff; transition:border-color .2s; font-size:13px; color:#64748b;">
                    📁 Clique para selecionar .geojson / .json / .kmz / .kml / .pos
                    <input id="gj-file" type="file"
                           accept="*/*"
                           style="display:none" onchange="onGeoJSONFileSelected(this)">
                </label>
                <div id="gj-file-info" style="font-size:12px; color:#6b7280; margin-top:6px; min-height:16px;"></div>
            </div>
            <div style="margin-top:12px; display:flex; gap:8px; align-items:center;">
                <button class="btn btn-primary btn-sm" onclick="saveGeoJSON()" id="gj-save-btn" disabled
                        style="padding:8px 18px;">
                    💾 Guardar na BD
                </button>
                <span id="gj-save-status" style="font-size:12px; color:#6b7280;"></span>
            </div>
        </div>

        <!-- Lista de camadas guardadas -->
        <div id="geojson-layers-list">
            <div style="text-align:center; padding:20px; color:#9ca3af;">A carregar…</div>
        </div>
    </div>
</div>

<!-- Objectos de Campo: Árvores, Plantas e Postes -->
<div class="section interp-section">
    <div class="section-title" style="cursor:pointer; user-select:none;" onclick="toggleObjectsPanel()">
        <h3>🌿 Objectos de Campo</h3>
        <span id="objects-toggle-btn" class="btn btn-secondary btn-sm">▼ Expandir</span>
    </div>
    <div id="objects-panel" style="display:none; margin-top:16px;">
        <p style="color:#6b7280; font-size:13px; margin-bottom:14px;">
            Registe a posição de árvores, plantas e postes ligados aos terrenos.
            Estes objectos podem ser usados para gerar mapas semânticos automaticamente no separador <strong>🤖 Mapa Semântico</strong>.
        </p>

        <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-bottom:14px;">
            <button class="btn btn-primary btn-sm" onclick="openAddObjectModal()" style="white-space:nowrap;">
                ➕ Adicionar objecto
            </button>
            <div class="filter-group">
                <label>Filtrar por terreno</label>
                <select id="obj-filter-terrain" onchange="loadFieldObjects()">
                    <option value="">Todos os terrenos</option>
                    <?php foreach ($filterTerrains as $t): ?>
                        <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="loadFieldObjects()">🔄 Actualizar</button>
        </div>

        <div id="objects-list">
            <div style="text-align:center; padding:20px; color:#9ca3af;">A carregar…</div>
        </div>
    </div>
</div>

<!-- ══ Imagens de Satélite (Sentinel Hub) ══════════════════════════════════ -->
<div class="section interp-section">
    <div class="section-title" style="cursor:pointer; user-select:none;" onclick="toggleRasterPanel()">
        <h3>🛰️ Imagens de Satélite</h3>
        <span id="raster-toggle-btn" class="btn btn-secondary btn-sm">▼ Expandir</span>
    </div>
    <div id="raster-panel" style="display:none; margin-top:16px;">

        <p style="color:#6b7280; font-size:13px; margin-bottom:16px;">
            Gera rasters de satélite (Sentinel-2 / Landsat) para os seus terrenos através do
            <strong>Sentinel Hub (Copernicus)</strong>. O pedido é enviado via MQTT ao serviço
            <code>Sentinel.py</code> que processa e devolve o resultado automaticamente.
        </p>

        <!-- Formulário de pedido -->
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:18px;">
            <div style="font-weight:700; font-size:14px; color:#1e293b; margin-bottom:14px;">
                📡 Novo pedido de raster
            </div>

            <div class="field-filters" style="margin-bottom:12px;">
                <!-- Terreno -->
                <div class="filter-group" style="flex:1.5; min-width:160px;">
                    <label>Terreno *</label>
                    <select id="raster-terrain">
                        <option value="">— Selecionar —</option>
                        <?php foreach ($filterTerrains as $t): ?>
                            <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <!-- Tipo -->
                <div class="filter-group" style="flex:2; min-width:180px;">
                    <label>Tipo de raster *</label>
                    <select id="raster-type" onchange="onRasterTypeChange()">
                        <optgroup label="🌿 Vegetação — Sentinel-2">
                            <option value="ndvi">NDVI — Vigor vegetal padrão</option>
                            <option value="evi">EVI — Vigor (vegetação densa)</option>
                            <option value="msavi">MSAVI — Vigor (correção de solo)</option>
                            <option value="gndvi">GNDVI — Clorofila e estado fisiológico</option>
                            <option value="ndre">NDRE — Red-Edge / stress avançado</option>
                            <option value="ndmi">NDMI — Humidade vegetativa</option>
                            <option value="ndwi">NDWI — Água superficial / zonas húmidas</option>
                            <option value="nbr">NBR — Áreas ardidas / severidade</option>
                            <option value="bsi">BSI — Solo exposto</option>
                        </optgroup>
                        <optgroup label="📊 Diferenças temporais — Sentinel-2">
                            <option value="ndvi_anomaly">NDVI Anomalia (vs. período referência)</option>
                            <option value="ndvi_diff">NDVI Diferença entre datas</option>
                        </optgroup>
                        <optgroup label="🌡️ Temperatura / Clima">
                            <option value="lst">LST — Temperatura superfície (Sentinel-3)</option>
                            <option value="chuva">Chuva — Precipitação acumulada (ERA5)</option>
                        </optgroup>
                        <optgroup label="📡 Radar SAR — Sentinel-1">
                            <option value="humidade_solo">Humidade do Solo (proxy SAR)</option>
                            <option value="sar_vv">VV — Estrutura superficial</option>
                            <option value="sar_vh">VH — Estrutura da vegetação</option>
                            <option value="sar_ratio">VV/VH — Relação de polarizações</option>
                            <option value="sar_rvi">RVI — Vegetação radar</option>
                            <option value="sar_agua">Água / Inundação SAR</option>
                        </optgroup>
                        <optgroup label="🗻 Topografia — DEM GLO-30">
                            <option value="altitude">Altitude</option>
                            <option value="declive">Declive</option>
                            <option value="aspect">Orientação da Encosta</option>
                        </optgroup>
                    </select>
                    <!-- Descrição dinâmica do índice selecionado -->
                    <div id="raster-desc-box" style="display:none; margin-top:8px; padding:10px 12px;
                         background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; font-size:12px; line-height:1.55;">
                        <div id="raster-desc-metric" style="font-weight:600; color:#0369a1; margin-bottom:3px;"></div>
                        <div id="raster-desc-use" style="color:#374151;"></div>
                    </div>
                </div>
            </div>

            <!-- Período principal -->
            <div class="field-filters" style="margin-bottom:8px;">
                <div class="filter-group">
                    <label id="raster-date-from-lbl">Data início *</label>
                    <input type="date" id="raster-date-from">
                </div>
                <div class="filter-group">
                    <label>Data fim *</label>
                    <input type="date" id="raster-date-to">
                </div>
            </div>

            <!-- Período de referência (ndvi_anomaly / ndvi_diff) -->
            <div id="raster-ref-period" style="display:none; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px; margin-bottom:10px;">
                <div style="font-size:12px; font-weight:600; color:#1d4ed8; margin-bottom:8px;">
                    📅 Período de referência
                </div>
                <div class="field-filters">
                    <div class="filter-group">
                        <label>Início referência *</label>
                        <input type="date" id="raster-date-from2">
                    </div>
                    <div class="filter-group">
                        <label>Fim referência *</label>
                        <input type="date" id="raster-date-to2">
                    </div>
                </div>
                <div id="raster-ref-hint" style="font-size:11px; color:#3b82f6; margin-top:4px;"></div>
            </div>

            <div style="display:flex; gap:10px; align-items:center;">
                <button id="raster-submit-btn" class="btn btn-primary" onclick="submitRasterRequest()"
                        style="padding:10px 20px; font-size:14px;">
                    🚀 Gerar Raster
                </button>
                <div id="raster-submit-status" style="font-size:13px; color:#6b7280;"></div>
            </div>
        </div>

        <!-- Progresso do pedido actual -->
        <div id="raster-progress-box" style="display:none; background:#fefce8; border:1px solid #fde047;
             border-radius:10px; padding:14px; margin-bottom:16px;">
            <div style="display:flex; align-items:center; gap:10px;">
                <span id="raster-progress-spinner" style="font-size:22px;">⏳</span>
                <div>
                    <div id="raster-progress-name" style="font-weight:700; font-size:13px; color:#713f12;"></div>
                    <div id="raster-progress-msg"  style="font-size:12px; color:#92400e; margin-top:2px;"></div>
                </div>
            </div>
        </div>

        <!-- Lista de rasters existentes -->
        <div style="font-weight:700; font-size:13px; color:#374151; margin-bottom:8px;">
            📋 Rasters gerados
            <button class="btn btn-secondary btn-sm" onclick="loadRastersList()" style="margin-left:8px;">🔄</button>
        </div>
        <div class="filter-group" style="max-width:280px; margin-bottom:10px;">
            <label>Filtrar por terreno</label>
            <select id="raster-list-terrain" onchange="loadRastersList()">
                <option value="">Todos os terrenos</option>
                <?php foreach ($filterTerrains as $t): ?>
                    <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div id="rasters-list">
            <div style="text-align:center; padding:20px; color:#9ca3af; font-size:13px;">
                Expanda para ver os rasters disponíveis.
            </div>
        </div>
    </div>
</div>

<!-- Importação GNSS .pos (RTKLIB) -->
<div class="section interp-section">
    <div class="section-title" style="cursor:pointer; user-select:none;" onclick="togglePosPanel()">
        <h3>📡 GNSS / Trajectória .pos</h3>
        <span id="pos-toggle-btn" class="btn btn-secondary btn-sm">▼ Expandir</span>
    </div>
    <div id="pos-panel" style="display:none; margin-top:16px;">
        <p style="color:#6b7280; font-size:13px; margin-bottom:14px;">
            Importe ficheiros <strong>.pos</strong> gerados pelo <strong>RTKLIB</strong> (RTKPost / RTKConv).
            Cada observação é guardada como um ponto vectorial associado ao terreno.
            No mapa, a cor representa a qualidade: <span style="color:#16a34a;font-weight:700;">● fix</span>,
            <span style="color:#ea580c;font-weight:700;">● float</span>,
            <span style="color:#6b7280;font-weight:700;">● outros</span>.
        </p>

        <!-- Formulário de importação -->
        <div style="background:#f8fafc; border:1.5px dashed #94a3b8; border-radius:12px; padding:16px; margin-bottom:16px;">
            <div style="font-size:12px; font-weight:700; color:#374151; text-transform:uppercase;
                        letter-spacing:.5px; margin-bottom:12px;">📂 Importar ficheiro .pos</div>
            <div class="field-filters" style="flex-wrap:wrap; gap:10px;">
                <div class="filter-group" style="flex:1; min-width:180px;">
                    <label>Nome da camada *</label>
                    <input id="pos-name" type="text" placeholder="Ex: Levantamento GNSS 2026-05-28"
                           style="width:100%;">
                </div>
                <div class="filter-group" style="flex:1; min-width:140px;">
                    <label>Terreno (opcional)</label>
                    <select id="pos-terrain" style="width:100%;">
                        <option value="">— Nenhum —</option>
                        <?php foreach ($filterTerrains as $t): ?>
                            <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); if (!empty($t['shared_by'])) echo ' 🤝 ' . htmlspecialchars($t['shared_by']); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
            </div>
            <div style="margin-top:10px;">
                <label id="pos-file-label" style="
                    display:flex; align-items:center; gap:10px; cursor:pointer;
                    padding:12px 14px; border:2px dashed #cbd5e1; border-radius:10px;
                    background:#fff; transition:border-color .2s; font-size:13px; color:#64748b;">
                    📡 Clique para selecionar ficheiro .pos (RTKLIB)
                    <input id="pos-file" type="file" accept=".pos"
                           style="display:none" onchange="onPosFileSelected(this)">
                </label>
                <div id="pos-file-info" style="font-size:12px; color:#6b7280; margin-top:6px; min-height:16px;"></div>
            </div>
            <div style="margin-top:12px; display:flex; gap:8px; align-items:center;">
                <button class="btn btn-primary btn-sm" onclick="savePosLayer()" id="pos-save-btn" disabled
                        style="padding:8px 18px;">
                    💾 Guardar na BD
                </button>
                <span id="pos-save-status" style="font-size:12px; color:#6b7280;"></span>
            </div>
        </div>

        <!-- Lista de importações .pos -->
        <div id="pos-layers-list">
            <div style="text-align:center; padding:20px; color:#9ca3af;">A carregar…</div>
        </div>
    </div>
</div>

<!-- Importação CSV -->
<div class="section csv-import-section">
    <div class="section-title" style="cursor:pointer; user-select:none;" onclick="toggleCsvPanel()">
        <h3>📥 Importar CSV</h3>
        <span id="csv-toggle-btn" class="btn btn-secondary btn-sm">▼ Expandir</span>
    </div>
    <div id="csv-panel" style="display:none; margin-top:16px;">

        <!-- Parâmetros configurados -->
        <div style="margin-bottom:20px;">
            <div style="font-size:13px; font-weight:700; color:#374151; margin-bottom:10px;">
                ⚙️ Parâmetros configurados
                <span style="font-size:11px; font-weight:400; color:#9ca3af; margin-left:6px;">
                    (os nomes das colunas do CSV devem coincidir)
                </span>
            </div>
            <div id="field-params-list" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
                <span style="color:#9ca3af; font-size:13px;">A carregar…</span>
            </div>
            <!-- Adicionar parâmetro personalizado -->
            <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
                <div class="filter-group">
                    <label>Novo parâmetro</label>
                    <input type="text" id="new-param-name" placeholder="ex: nitrogénio" style="min-width:140px;">
                </div>
                <div class="filter-group">
                    <label>Unidade</label>
                    <input type="text" id="new-param-unit" placeholder="ex: mg/kg" style="min-width:90px;">
                </div>
                <button class="btn btn-primary btn-sm" onclick="addFieldParameter()" style="margin-bottom:1px;">
                    + Adicionar
                </button>
            </div>
        </div>

        <!-- Zona de drop do CSV -->
        <div id="csv-drop-zone"
             style="border:2px dashed #d1d5db; border-radius:12px; padding:28px 20px; text-align:center;
                    cursor:pointer; transition:border-color .2s, background .2s; margin-bottom:12px;"
             onclick="document.getElementById('csv-file-input').click()">
            <div style="font-size:36px; margin-bottom:8px;">📄</div>
            <div style="font-size:14px; font-weight:600; color:#374151; margin-bottom:4px;">
                Arrastar ficheiro CSV aqui
            </div>
            <div style="font-size:12px; color:#9ca3af; margin-bottom:10px;">ou</div>
            <label class="btn btn-primary btn-sm" style="cursor:pointer;">
                Escolher ficheiro
                <input type="file" id="csv-file-input" accept=".csv" style="display:none;"
                       onchange="handleCsvFileSelect(this.files[0])">
            </label>
            <div style="font-size:11px; color:#9ca3af; margin-top:8px;">
                Colunas esperadas: <code>place, latitude, longitude, class</code> + colunas dos parâmetros configurados
            </div>
        </div>

        <div id="csv-import-status" style="margin-bottom:12px;"></div>

        <!-- Importações anteriores -->
        <div style="font-size:13px; font-weight:700; color:#374151; margin-bottom:8px;">
            📋 Importações anteriores
            <button class="btn btn-secondary btn-sm" onclick="loadCsvImportsList()" style="margin-left:8px;">🔄</button>
        </div>
        <div id="csv-imports-list">
            <div style="color:#9ca3af; font-size:13px; padding:10px 0;">
                Expanda para ver as importações disponíveis.
            </div>
        </div>
    </div>
</div>

<!-- Tabela (oculta por defeito — aparece ao clicar em Filtrar) -->
<div id="table-section" class="section" style="display:none">
    <div class="section-title">
        <h3>📋 Lista de Medições</h3>
        <div style="display:flex; gap:8px; align-items:center;">
            <span id="field-count" style="font-size:13px; color:#6b7280;"></span>
            <button class="btn btn-secondary btn-sm" onclick="applyFilters()">🔄 Atualizar</button>
        </div>
    </div>

    <div id="field-table-wrap" class="data-table"></div>
</div>

<style>
.field-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-end;
}
.filter-group { display: flex; flex-direction: column; gap: 4px; }
.filter-group label { font-size: 12px; font-weight: 600; color: #6b7280; }
.filter-group input,
.filter-group select {
    padding: 7px 10px;
    border: 1.5px solid #e5e7eb;
    border-radius: 7px;
    font-size: 13px;
    min-width: 130px;
}
.filter-group input:focus,
.filter-group select:focus { outline: none; border-color: #667eea; }
.filter-actions { flex-direction: row; align-items: center; padding-top: 2px; }

/* Tabela de medições */
#field-table-wrap table { font-size: 13px; }
#field-table-wrap th    { font-size: 12px; white-space: nowrap; }
#field-table-wrap td    { vertical-align: middle; }

.ec-chip {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 700;
    font-size: 12px;
}
.ec-low    { background:#dbeafe; color:#1e40af; }
.ec-mid    { background:#d1fae5; color:#065f46; }
.ec-high   { background:#fef3c7; color:#92400e; }
.ec-vhigh  { background:#fee2e2; color:#991b1b; }
.ec-none   { background:#f3f4f6; color:#6b7280; }

.coord-small { font-family: monospace; font-size: 11px; color: #9ca3af; }
.empty-field {
    text-align: center; padding: 60px 20px; color: #9ca3af;
}
.empty-field .empty-icon { font-size: 48px; margin-bottom: 12px; }
</style>
