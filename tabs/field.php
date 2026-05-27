<?php
/**
 * Tab: Medições de Campo
 * Visualização dos dados recolhidos pela PWA SoilQI Field
 */

if (!isset($isLoggedIn)) $isLoggedIn = false;
if (!isset($isAdmin))    $isAdmin    = false;
if (!isset($currentUser)) $currentUser = null;

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

                // Estatísticas do mesmo conjunto
                $sStmt = $pdo->prepare("
                    SELECT COUNT(*)            AS total,
                           AVG(conductivity)   AS avg_ec,
                           AVG(ph)             AS avg_ph,
                           AVG(temperature)    AS avg_temp
                    FROM   field_measurements m
                    LEFT JOIN terrains t ON m.terrain_id = t.id
                    LEFT JOIN users    u ON m.user_id    = u.id
                    $wc
                ");
                $sStmt->execute($params);
                $stats = $sStmt->fetch();

                $response['success']      = true;
                $response['measurements'] = $rows;
                $response['stats']        = $stats;
                break;

            case 'get_terrain_geom':
                $tid = intval($_POST['terrain_id'] ?? 0);
                if ($tid <= 0) { $response['message'] = 'ID inválido.'; break; }
                if ($isAdmin) {
                    $stmt = $pdo->prepare("SELECT id, name, coordinates FROM terrains WHERE id = ?");
                    $stmt->execute([$tid]);
                } else {
                    $stmt = $pdo->prepare("SELECT id, name, coordinates FROM terrains WHERE id = ? AND user_id = ?");
                    $stmt->execute([$tid, $currentUser['id']]);
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
                $min_lat    = floatval($_POST['min_lat']  ?? 0);
                $max_lat    = floatval($_POST['max_lat']  ?? 0);
                $min_lng    = floatval($_POST['min_lng']  ?? 0);
                $max_lng    = floatval($_POST['max_lng']  ?? 0);
                $min_val    = isset($_POST['min_val']) && $_POST['min_val'] !== '' ? floatval($_POST['min_val']) : null;
                $max_val    = isset($_POST['max_val']) && $_POST['max_val'] !== '' ? floatval($_POST['max_val']) : null;
                $png_b64    = $_POST['png_data'] ?? '';

                if (!$name)    { $response['message'] = 'Nome obrigatório.'; break; }
                if (!$png_b64) { $response['message'] = 'Dados PNG em falta.'; break; }

                // Strip data URL prefix and decode
                $png_b64    = preg_replace('#^data:image/\w+;base64,#', '', $png_b64);
                $png_binary = base64_decode($png_b64, true);
                if ($png_binary === false) { $response['message'] = 'PNG inválido (base64 corrompido).'; break; }

                $stmt = $pdo->prepare("
                    INSERT INTO field_interpolations
                        (user_id, terrain_id, name, param, colormap, resolution, power,
                         min_lat, max_lat, min_lng, max_lng, min_val, max_val, png_data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([
                    $currentUser['id'], $terrain_id, $name, $param, $colormap,
                    $resolution, $power,
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

    // Verificar se a tabela existe
    $chk = $pdo->query("SHOW TABLES LIKE 'field_measurements'");
    $tableExists = $chk->rowCount() > 0;

    if ($tableExists) {
        // Terrenos do utilizador (ou todos se admin)
        if ($isAdmin) {
            $filterTerrains = $pdo->query("SELECT id, name FROM terrains ORDER BY name")->fetchAll();
            $filterUsers    = $pdo->query("SELECT id, username FROM users ORDER BY username")->fetchAll();
        } else {
            $stmt = $pdo->prepare("SELECT id, name FROM terrains WHERE user_id = ? ORDER BY name");
            $stmt->execute([$currentUser['id']]);
            $filterTerrains = $stmt->fetchAll();
        }
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
            <input type="date" id="filter-date-from" onchange="applyFilters()">
        </div>
        <div class="filter-group">
            <label>Até</label>
            <input type="date" id="filter-date-to" onchange="applyFilters()">
        </div>
        <div class="filter-group">
            <label>Terreno</label>
            <select id="filter-terrain" onchange="applyFilters()">
                <option value="">Todos</option>
                <?php foreach ($filterTerrains as $t): ?>
                    <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <?php if ($isAdmin): ?>
        <div class="filter-group">
            <label>Utilizador</label>
            <select id="filter-user" onchange="applyFilters()">
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
                    <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); ?></option>
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

<!-- Painel de Interpolação Espacial -->
<div class="section interp-section">
    <div class="section-title" style="cursor:pointer; user-select:none;" onclick="toggleInterpPanel()">
        <h3>🎨 Interpolação Espacial IDW</h3>
        <span id="interp-toggle-btn" class="btn btn-secondary btn-sm">▼ Expandir</span>
    </div>
    <div id="interp-panel" style="display:none; margin-top:16px;">
        <p style="color:#6b7280; font-size:13px; margin-bottom:14px;">
            Selecione um campo e um parâmetro para gerar uma superfície interpolada (IDW) visível sobre o terreno no mapa.
        </p>
        <div class="field-filters" style="flex-wrap:wrap;">

            <div class="filter-group">
                <label>Campo (terreno)</label>
                <select id="interp-terrain-sel" style="min-width:160px;">
                    <option value="">— Selecione —</option>
                    <?php foreach ($filterTerrains as $t): ?>
                        <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); ?></option>
                    <?php endforeach; ?>
                </select>
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
            Importe ficheiros <strong>.geojson</strong>, <strong>.json</strong>, <strong>.kmz</strong>
            ou <strong>.kml</strong> para guardar camadas vectoriais (polígonos, linhas, pontos)
            na base de dados e visualizá-las sobrepostas ao mapa.
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
                            <option value="<?php echo $t['id']; ?>"><?php echo htmlspecialchars($t['name']); ?></option>
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
                    📁 Clique para selecionar .geojson / .json / .kmz / .kml
                    <input id="gj-file" type="file"
                           accept=".geojson,.json,.kmz,.kml,application/json,application/geo+json,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
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

<!-- Tabela -->
<div class="section">
    <div class="section-title">
        <h3>📋 Lista de Medições</h3>
        <div style="display:flex; gap:8px; align-items:center;">
            <span id="field-count" style="font-size:13px; color:#6b7280;"></span>
            <button class="btn btn-secondary btn-sm" onclick="applyFilters()">🔄 Atualizar</button>
        </div>
    </div>

    <div id="field-table-wrap" class="data-table">
        <div style="text-align:center; padding:40px; color:#6b7280;">A carregar…</div>
    </div>
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
