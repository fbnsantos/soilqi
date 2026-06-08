<?php
/**
 * Tab: Mapa
 * Gestão de terrenos com visualização em mapa
 */

// Este ficheiro é incluído pelo index.php
// Variáveis disponíveis: $isLoggedIn, $currentUser, $activeTab

// API endpoints para operações AJAX (apenas para utilizadores logados)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isLoggedIn) {
    header('Content-Type: application/json');
    
    $action = $_POST['action'] ?? '';
    $response = ['success' => false, 'message' => ''];
    
    try {
        $pdo = getDBConnection();
        
        switch ($action) {
            case 'save_terrain':
                $name = sanitizeInput($_POST['name']);
                $description = sanitizeInput($_POST['description'] ?? '');
                $coordinates = $_POST['coordinates']; // JSON string
                $area = floatval($_POST['area']);
                
                if (empty($name) || empty($coordinates)) {
                    $response['message'] = 'Dados obrigatórios em falta.';
                } else {
                    $stmt = $pdo->prepare("INSERT INTO terrains (user_id, name, description, coordinates, area) VALUES (?, ?, ?, ?, ?)");
                    $stmt->execute([$currentUser['id'], $name, $description, $coordinates, $area]);
                    
                    $response['success'] = true;
                    $response['message'] = 'Terreno guardado com sucesso!';
                    $response['terrain_id'] = $pdo->lastInsertId();
                }
                break;
                
            case 'delete_terrain':
                $terrain_id = intval($_POST['terrain_id']);
                
                $stmt = $pdo->prepare("DELETE FROM terrains WHERE id = ? AND user_id = ?");
                $stmt->execute([$terrain_id, $currentUser['id']]);
                
                if ($stmt->rowCount() > 0) {
                    $response['success'] = true;
                    $response['message'] = 'Terreno eliminado com sucesso!';
                } else {
                    $response['message'] = 'Terreno não encontrado.';
                }
                break;
                
            case 'get_terrains':
                // Terrenos próprios + terrenos partilhados comigo (aceites)
                try {
                    $stmt = $pdo->prepare("
                        SELECT t.*, 0 AS is_shared, '' AS shared_by, 'edit' AS share_perm
                        FROM terrains t WHERE t.user_id = ?
                        UNION ALL
                        SELECT t.*, 1 AS is_shared, u.username AS shared_by, s.permission AS share_perm
                        FROM terrains t
                        JOIN terrain_shares s ON s.terrain_id = t.id
                            AND s.shared_with = ? AND s.status = 'accepted'
                        JOIN users u ON u.id = t.user_id
                        ORDER BY is_shared ASC, name ASC
                    ");
                    $stmt->execute([$currentUser['id'], $currentUser['id']]);
                } catch (PDOException $shareEx) {
                    // terrain_shares ainda não existe — fallback
                    $stmt = $pdo->prepare("SELECT *, 0 AS is_shared, '' AS shared_by, 'edit' AS share_perm
                        FROM terrains WHERE user_id = ? ORDER BY created_at DESC");
                    $stmt->execute([$currentUser['id']]);
                }
                $terrains = $stmt->fetchAll();
                
                $response['success'] = true;
                $response['terrains'] = $terrains;
                break;
                
            case 'get_terrain':
                $terrain_id = intval($_POST['terrain_id']);

                $stmt = $pdo->prepare("SELECT * FROM terrains WHERE id = ? AND user_id = ?");
                $stmt->execute([$terrain_id, $currentUser['id']]);
                $terrain = $stmt->fetch();

                if ($terrain) {
                    $response['success'] = true;
                    $response['terrain'] = $terrain;
                } else {
                    $response['message'] = 'Terreno não encontrado.';
                }
                break;

            // ── Interpolações de campo guardadas ───────────────────────────────

            case 'get_terrain_interpolations':
                // Filtra ESTRITAMENTE pelo terreno seleccionado.
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                try {
                    if ($terrain_id > 0) {
                        $stmt = $pdo->prepare("
                            SELECT id, name, param, colormap, resolution,
                                   min_lat, max_lat, min_lng, max_lng,
                                   min_val, max_val, created_at, terrain_id
                            FROM field_interpolations
                            WHERE user_id = ? AND terrain_id = ?
                            ORDER BY created_at DESC
                        ");
                        $stmt->execute([$currentUser['id'], $terrain_id]);
                    } else {
                        // Sem terreno selecionado → lista vazia
                        $response['success']        = true;
                        $response['interpolations'] = [];
                        break;
                    }
                    $response['success']        = true;
                    $response['interpolations'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $tableErr) {
                    $response['success']        = true;
                    $response['interpolations'] = [];
                }
                break;

            case 'get_interpolation_png':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }
                try {
                    $stmt = $pdo->prepare("
                        SELECT png_data, min_lat, max_lat, min_lng, max_lng, name
                        FROM field_interpolations
                        WHERE id = ? AND user_id = ?
                    ");
                    $stmt->execute([$id, $currentUser['id']]);
                    $row = $stmt->fetch(PDO::FETCH_ASSOC);
                    if (!$row) { $response['message'] = 'Interpolação não encontrada.'; break; }
                    $response['success'] = true;
                    $response['png']     = 'data:image/png;base64,' . base64_encode($row['png_data']);
                    $response['min_lat'] = (float)$row['min_lat'];
                    $response['max_lat'] = (float)$row['max_lat'];
                    $response['min_lng'] = (float)$row['min_lng'];
                    $response['max_lng'] = (float)$row['max_lng'];
                    $response['name']    = $row['name'];
                } catch (PDOException $tableErr) {
                    $response['message'] = 'Tabela de interpolações não existe. Aplique a migração 002 em Admin → Migrações.';
                }
                break;

            // ── Camadas GeoJSON ────────────────────────────────────────────────

            case 'get_geojson_layers':
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                try {
                    if ($terrain_id > 0) {
                        $stmt = $pdo->prepare("
                            SELECT g.id, g.name, g.description, g.feature_count,
                                   g.bbox_min_lat, g.bbox_max_lat, g.bbox_min_lng, g.bbox_max_lng,
                                   g.created_at, t.name AS terrain_name
                            FROM field_geojson g
                            LEFT JOIN terrains t ON t.id = g.terrain_id
                            WHERE g.user_id = ? AND g.terrain_id = ?
                            ORDER BY g.created_at DESC
                        ");
                        $stmt->execute([$currentUser['id'], $terrain_id]);
                    } else {
                        // Sem terreno selecionado → lista vazia
                        $response['success'] = true;
                        $response['layers']  = [];
                        break;
                    }
                    $response['success'] = true;
                    $response['layers']  = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $tableErr) {
                    $response['success'] = true;
                    $response['layers']  = [];
                }
                break;

            case 'get_geojson_data':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }
                try {
                    $stmt = $pdo->prepare("
                        SELECT id, name, geojson_data,
                               bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng
                        FROM field_geojson
                        WHERE id = ? AND user_id = ?
                    ");
                    $stmt->execute([$id, $currentUser['id']]);
                    $row = $stmt->fetch(PDO::FETCH_ASSOC);
                    if (!$row) { $response['message'] = 'Camada não encontrada.'; break; }
                    $response['success'] = true;
                    $response['id']      = (int)$row['id'];
                    $response['name']    = $row['name'];
                    $response['geojson'] = $row['geojson_data'];
                } catch (PDOException $tableErr) {
                    $response['message'] = 'Tabela não existe. Aplique a migração 005 em Admin → Migrações.';
                }
                break;

            // ── Rasters de satélite ────────────────────────────────────────────

            case 'get_raster_layers':
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                try {
                    if ($terrain_id > 0) {
                        $stmt = $pdo->prepare("
                            SELECT id, name, raster_type, date_from, date_to,
                                   min_lat, max_lat, min_lng, max_lng, created_at
                            FROM raster_results
                            WHERE user_id = ? AND terrain_id = ? AND status = 'done'
                            ORDER BY created_at DESC
                        ");
                        $stmt->execute([$currentUser['id'], $terrain_id]);
                    } else {
                        $stmt = $pdo->prepare("
                            SELECT r.id, r.name, r.raster_type, r.date_from, r.date_to,
                                   r.min_lat, r.max_lat, r.min_lng, r.max_lng, r.created_at,
                                   t.name AS terrain_name
                            FROM raster_results r
                            LEFT JOIN terrains t ON t.id = r.terrain_id
                            WHERE r.user_id = ? AND r.status = 'done'
                            ORDER BY r.created_at DESC LIMIT 60
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

            case 'get_raster_png':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }
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

            // ── Notas de relatório ─────────────────────────────────────────────
            case 'save_map_note':
                $content    = trim($_POST['content'] ?? '');
                $terrain_id = intval($_POST['terrain_id'] ?? 0) ?: null;
                if ($content === '') { $response['message'] = 'Nota vazia.'; break; }
                $pdo->exec("CREATE TABLE IF NOT EXISTS map_notes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    terrain_id INT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_mn_user (user_id),
                    INDEX idx_mn_terrain (terrain_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                $st = $pdo->prepare("INSERT INTO map_notes (user_id, terrain_id, content) VALUES (?,?,?)");
                $st->execute([$currentUser['id'], $terrain_id, $content]);
                $response['success'] = true;
                $response['id']      = (int)$pdo->lastInsertId();
                $response['created_at'] = date('Y-m-d H:i:s');
                break;

            case 'get_map_notes':
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                try {
                    if ($terrain_id > 0) {
                        $st = $pdo->prepare("SELECT id, content, terrain_id, created_at
                            FROM map_notes WHERE user_id=? AND (terrain_id=? OR terrain_id IS NULL)
                            ORDER BY created_at DESC LIMIT 100");
                        $st->execute([$currentUser['id'], $terrain_id]);
                    } else {
                        $st = $pdo->prepare("SELECT id, content, terrain_id, created_at
                            FROM map_notes WHERE user_id=? ORDER BY created_at DESC LIMIT 100");
                        $st->execute([$currentUser['id']]);
                    }
                    $response['success'] = true;
                    $response['notes']   = $st->fetchAll();
                } catch (PDOException $e2) {
                    $response['success'] = true; $response['notes'] = [];
                }
                break;

            case 'delete_map_note':
                $note_id = intval($_POST['note_id'] ?? 0);
                $st = $pdo->prepare("DELETE FROM map_notes WHERE id=? AND user_id=?");
                $st->execute([$note_id, $currentUser['id']]);
                $response['success'] = ($st->rowCount() > 0);
                if (!$response['success']) $response['message'] = 'Nota não encontrada.';
                break;

            // ── Zonagem ────────────────────────────────────────────────────────

            case 'generate_zonation':
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                $method     = trim($_POST['method'] ?? '');
                $params     = json_decode(trim($_POST['params'] ?? '{}'), true) ?: [];
                $raster_ids = json_decode(trim($_POST['raster_ids'] ?? '[]'), true) ?: [];
                $interp_ids = json_decode(trim($_POST['interp_ids'] ?? '[]'), true) ?: [];

                $allowed_methods = ['quantiles','weighted','kmeans','fcm','gmm'];
                if (!$terrain_id || !in_array($method, $allowed_methods, true)) {
                    $response['message'] = 'Parâmetros inválidos.';
                    break;
                }
                if (empty($raster_ids) && empty($interp_ids)) {
                    $response['message'] = 'Selecione pelo menos uma camada de entrada.';
                    break;
                }

                // Validar rasters de satélite
                $valid_raster_ids = [];
                foreach ($raster_ids as $rid) {
                    $rid = intval($rid);
                    $st  = $pdo->prepare("SELECT id FROM raster_results
                                          WHERE id=? AND user_id=? AND terrain_id=? AND status='done'");
                    $st->execute([$rid, $currentUser['id'], $terrain_id]);
                    if ($st->fetch()) { $valid_raster_ids[] = $rid; }
                }

                // Validar interpolações de campo
                $valid_interp_ids = [];
                try {
                    foreach ($interp_ids as $iid) {
                        $iid = intval($iid);
                        $st  = $pdo->prepare("SELECT id FROM field_interpolations
                                              WHERE id=? AND user_id=? AND terrain_id=?");
                        $st->execute([$iid, $currentUser['id'], $terrain_id]);
                        if ($st->fetch()) { $valid_interp_ids[] = $iid; }
                    }
                } catch (PDOException $ignored) {}

                if (empty($valid_raster_ids) && empty($valid_interp_ids)) {
                    $response['message'] = 'Nenhuma camada válida encontrada para este terreno.';
                    break;
                }

                // Auto-criar/migrar tabela com suporte assíncrono e interpolações de campo
                $pdo->exec("CREATE TABLE IF NOT EXISTS zonation_results (
                    id               INT AUTO_INCREMENT PRIMARY KEY,
                    user_id          INT NOT NULL,
                    terrain_id       INT NOT NULL,
                    request_id       VARCHAR(36) NULL,
                    status           ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
                    method           VARCHAR(20) NOT NULL,
                    params           JSON NULL,
                    name             VARCHAR(200) NOT NULL,
                    input_raster_ids JSON NULL,
                    input_interp_ids JSON NULL,
                    png_data         MEDIUMBLOB NULL,
                    min_lat DOUBLE NULL, max_lat DOUBLE NULL,
                    min_lng DOUBLE NULL, max_lng DOUBLE NULL,
                    legend           JSON NULL,
                    error_msg        TEXT NULL,
                    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uidx_zr_req (request_id),
                    INDEX idx_zr (user_id, terrain_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                // Migração silenciosa: adicionar colunas se ainda não existirem
                foreach ([
                    "ALTER TABLE zonation_results ADD COLUMN request_id VARCHAR(36) NULL AFTER terrain_id",
                    "ALTER TABLE zonation_results ADD COLUMN status ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending' AFTER request_id",
                    "ALTER TABLE zonation_results ADD COLUMN input_raster_ids JSON NULL AFTER name",
                    "ALTER TABLE zonation_results ADD COLUMN input_interp_ids JSON NULL AFTER input_raster_ids",
                    "ALTER TABLE zonation_results ADD COLUMN error_msg TEXT NULL AFTER legend",
                    "ALTER TABLE zonation_results MODIFY COLUMN png_data MEDIUMBLOB NULL",
                    "ALTER TABLE zonation_results ADD UNIQUE KEY uidx_zr_req (request_id)",
                ] as $alter) {
                    try { $pdo->exec($alter); } catch (PDOException $ignored) {}
                }

                // Gerar UUID
                $requestId = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                    mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff),
                    mt_rand(0,0x0fff)|0x4000, mt_rand(0,0x3fff)|0x8000,
                    mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff));

                $method_labels = [
                    'quantiles' => 'Quantis',
                    'weighted'  => 'Índice Composto',
                    'kmeans'    => 'K-means',
                    'fcm'       => 'FCM',
                    'gmm'       => 'GMM',
                ];
                $name = ($method_labels[$method] ?? $method) . ' — ' . date('Y-m-d H:i');

                // Inserir registo pendente
                $ins = $pdo->prepare("INSERT INTO zonation_results
                    (user_id, terrain_id, request_id, status, method, params, name,
                     input_raster_ids, input_interp_ids)
                    VALUES (?,?,?,?,?,?,?,?,?)");
                $ins->execute([
                    $currentUser['id'], $terrain_id, $requestId, 'pending',
                    $method, json_encode($params), $name,
                    json_encode($valid_raster_ids), json_encode($valid_interp_ids),
                ]);
                $newId = (int)$pdo->lastInsertId();

                // Publicar via MQTT
                $mqttError = null;
                $zonationTopic = defined('ZONATION_TOPIC') ? ZONATION_TOPIC : '/soilqi/zonation';
                $siteUrl = defined('SITE_URL') ? rtrim(SITE_URL, '/') : '';

                if (defined('MQTT_HOST') && MQTT_HOST !== '' && MQTT_HOST !== '{{MQTT_HOST}}') {
                    try {
                        require_once __DIR__ . '/../lib/MqttPublisher.php';
                        $mqtt = new MqttPublisher(
                            MQTT_HOST,
                            defined('MQTT_PORT') ? (int)MQTT_PORT : 1883,
                            'soilqi_zon_' . substr($requestId, 0, 8),
                            defined('MQTT_USER') ? MQTT_USER : '',
                            defined('MQTT_PASS') ? MQTT_PASS : ''
                        );
                        $payload = json_encode([
                            'request_id'   => $requestId,
                            'method'       => $method,
                            'params'       => $params,
                            'data_url'     => $siteUrl . '/api/zonation_data.php',
                            'callback_url' => $siteUrl . '/api/zonation_result.php',
                            'api_key'      => defined('RASTER_API_KEY') ? RASTER_API_KEY : '',
                        ]);
                        $mqtt->publish($zonationTopic, $payload, 1, false);
                        $mqtt->disconnect();
                    } catch (Throwable $mqttEx) {
                        $mqttError = $mqttEx->getMessage();
                    }
                } else {
                    $mqttError = 'MQTT não configurado — verifique config.php.';
                }

                $response['success']    = true;
                $response['id']         = $newId;
                $response['request_id'] = $requestId;
                $response['name']       = $name;
                if ($mqttError) {
                    $response['mqtt_warning'] = $mqttError;
                }
                break;

            case 'get_zonation_status':
                $requestId = trim($_POST['request_id'] ?? '');
                if (!$requestId) { $response['message'] = 'request_id em falta.'; break; }
                try {
                    $st = $pdo->prepare("
                        SELECT id, status, error_msg,
                               png_data, min_lat, max_lat, min_lng, max_lng,
                               name, method, legend
                        FROM zonation_results
                        WHERE request_id = ? AND user_id = ?
                    ");
                    $st->execute([$requestId, $currentUser['id']]);
                    $row = $st->fetch(PDO::FETCH_ASSOC);

                    if (!$row) { $response['message'] = 'Pedido não encontrado.'; break; }

                    $response['success'] = true;
                    $response['status']  = $row['status'];
                    $response['id']      = (int)$row['id'];
                    $response['name']    = $row['name'];

                    if ($row['status'] === 'error') {
                        $response['message'] = $row['error_msg'] ?: 'Erro desconhecido na zonagem.';
                    } elseif ($row['status'] === 'done') {
                        $response['png']     = 'data:image/png;base64,' . base64_encode($row['png_data']);
                        $response['min_lat'] = (float)$row['min_lat'];
                        $response['max_lat'] = (float)$row['max_lat'];
                        $response['min_lng'] = (float)$row['min_lng'];
                        $response['max_lng'] = (float)$row['max_lng'];
                        $response['legend']  = json_decode($row['legend'] ?? '[]', true) ?: [];
                        $response['bounds']  = [
                            'min_lat' => (float)$row['min_lat'],
                            'max_lat' => (float)$row['max_lat'],
                            'min_lng' => (float)$row['min_lng'],
                            'max_lng' => (float)$row['max_lng'],
                        ];
                    }
                    // pending / processing: só devolver status, o JS continua a fazer polling
                } catch (PDOException $e2) {
                    $response['message'] = $e2->getMessage();
                }
                break;

            case 'get_zonation_list':
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                try {
                    if ($terrain_id <= 0) { $response['success'] = true; $response['items'] = []; break; }
                    $st = $pdo->prepare("SELECT id, name, method, legend, created_at,
                                                min_lat, max_lat, min_lng, max_lng
                                         FROM zonation_results
                                         WHERE user_id=? AND terrain_id=? AND status='done'
                                         ORDER BY created_at DESC LIMIT 20");
                    $st->execute([$currentUser['id'], $terrain_id]);
                    $response['success'] = true;
                    $response['items']   = $st->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $e2) {
                    $response['success'] = true; $response['items'] = [];
                }
                break;

            case 'get_zonation_png':
                $id = intval($_POST['id'] ?? 0);
                if ($id <= 0) { $response['message'] = 'ID inválido.'; break; }
                try {
                    $st = $pdo->prepare("SELECT png_data, min_lat, max_lat, min_lng, max_lng,
                                                name, method, legend
                                         FROM zonation_results WHERE id=? AND user_id=? AND status='done'");
                    $st->execute([$id, $currentUser['id']]);
                    $row = $st->fetch(PDO::FETCH_ASSOC);
                    if (!$row || !$row['png_data']) { $response['message'] = 'Zonagem não encontrada.'; break; }
                    $response['success'] = true;
                    $response['png']     = 'data:image/png;base64,' . base64_encode($row['png_data']);
                    $response['min_lat'] = (float)$row['min_lat'];
                    $response['max_lat'] = (float)$row['max_lat'];
                    $response['min_lng'] = (float)$row['min_lng'];
                    $response['max_lng'] = (float)$row['max_lng'];
                    $response['name']    = $row['name'];
                    $response['legend']  = json_decode($row['legend'] ?? '[]', true) ?: [];
                } catch (PDOException $e2) { $response['message'] = $e2->getMessage(); }
                break;

            case 'delete_zonation':
                $id = intval($_POST['id'] ?? 0);
                try {
                    $st = $pdo->prepare("DELETE FROM zonation_results WHERE id=? AND user_id=?");
                    $st->execute([$id, $currentUser['id']]);
                    $response['success'] = ($st->rowCount() > 0);
                    if (!$response['success']) $response['message'] = 'Zonagem não encontrada.';
                } catch (PDOException $e2) { $response['message'] = $e2->getMessage(); }
                break;

            // ── Prescrição / ShapeFile VRA ─────────────────────────────────────

            case 'generate_prescription':
                $terrain_id    = intval($_POST['terrain_id']    ?? 0);
                $zonation_id   = intval($_POST['zonation_id']   ?? 0);
                $name          = trim($_POST['name']            ?? '');
                $prescriptions = json_decode($_POST['prescriptions'] ?? '[]', true) ?: [];

                if (!$terrain_id || !$zonation_id || !$name || empty($prescriptions)) {
                    $response['message'] = 'Parâmetros em falta.';
                    break;
                }

                // Verificar que a zonagem existe e pertence ao utilizador/terreno
                $stZ = $pdo->prepare("SELECT id FROM zonation_results
                                      WHERE id=? AND user_id=? AND terrain_id=? AND status='done'");
                $stZ->execute([$zonation_id, $currentUser['id'], $terrain_id]);
                if (!$stZ->fetch()) {
                    $response['message'] = 'Zonagem não encontrada ou não concluída.';
                    break;
                }

                // Auto-criar tabela
                $pdo->exec("CREATE TABLE IF NOT EXISTS prescription_results (
                    id               INT AUTO_INCREMENT PRIMARY KEY,
                    user_id          INT NOT NULL,
                    terrain_id       INT NOT NULL,
                    zonation_id      INT NOT NULL,
                    request_id       VARCHAR(36) NULL,
                    status           ENUM('pending','processing','done','error') NOT NULL DEFAULT 'pending',
                    name             VARCHAR(200) NOT NULL,
                    zone_prescriptions JSON NULL,
                    shapefile_zip    MEDIUMBLOB NULL,
                    png_data         MEDIUMBLOB NULL,
                    error_msg        TEXT NULL,
                    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uidx_pr_req (request_id),
                    INDEX idx_pr (user_id, terrain_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                // Migração silenciosa: adicionar png_data se ainda não existir
                try { $pdo->exec("ALTER TABLE prescription_results ADD COLUMN png_data MEDIUMBLOB NULL"); } catch (PDOException $ignored) {}

                // Gerar UUID
                $requestId = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                    mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff),
                    mt_rand(0,0x0fff)|0x4000, mt_rand(0,0x3fff)|0x8000,
                    mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff));

                $ins = $pdo->prepare("INSERT INTO prescription_results
                    (user_id, terrain_id, zonation_id, request_id, status, name, zone_prescriptions)
                    VALUES (?,?,?,?,?,?,?)");
                $ins->execute([
                    $currentUser['id'], $terrain_id, $zonation_id,
                    $requestId, 'pending', $name, json_encode($prescriptions),
                ]);
                $newId = (int)$pdo->lastInsertId();

                // Publicar via MQTT
                $mqttError = null;
                $prescTopic = defined('PRESCRIPTION_TOPIC') ? PRESCRIPTION_TOPIC : '/soilqi/prescription';
                $siteUrl    = defined('SITE_URL') ? rtrim(SITE_URL, '/') : '';

                if (defined('MQTT_HOST') && MQTT_HOST !== '' && MQTT_HOST !== '{{MQTT_HOST}}') {
                    try {
                        require_once __DIR__ . '/../lib/MqttPublisher.php';
                        $mqtt = new MqttPublisher(
                            MQTT_HOST,
                            defined('MQTT_PORT') ? (int)MQTT_PORT : 1883,
                            'soilqi_presc_' . substr($requestId, 0, 8),
                            defined('MQTT_USER') ? MQTT_USER : '',
                            defined('MQTT_PASS') ? MQTT_PASS : ''
                        );
                        $mqtt->publish($prescTopic, json_encode([
                            'request_id'   => $requestId,
                            'data_url'     => $siteUrl . '/api/prescription_data.php',
                            'callback_url' => $siteUrl . '/api/prescription_result.php',
                            'api_key'      => defined('RASTER_API_KEY') ? RASTER_API_KEY : '',
                        ]), 1, false);
                        $mqtt->disconnect();
                    } catch (Throwable $mqttEx) {
                        $mqttError = $mqttEx->getMessage();
                    }
                } else {
                    $mqttError = 'MQTT não configurado.';
                }

                $response['success']    = true;
                $response['id']         = $newId;
                $response['request_id'] = $requestId;
                $response['name']       = $name;
                if ($mqttError) $response['mqtt_warning'] = $mqttError;
                break;

            case 'get_prescription_status':
                $requestId = trim($_POST['request_id'] ?? '');
                if (!$requestId) { $response['message'] = 'request_id em falta.'; break; }
                try {
                    $st = $pdo->prepare("SELECT id, status, error_msg, name
                                         FROM prescription_results
                                         WHERE request_id=? AND user_id=?");
                    $st->execute([$requestId, $currentUser['id']]);
                    $row = $st->fetch(PDO::FETCH_ASSOC);
                    if (!$row) { $response['message'] = 'Pedido não encontrado.'; break; }
                    $response['success'] = true;
                    $response['status']  = $row['status'];
                    $response['id']      = (int)$row['id'];
                    $response['name']    = $row['name'];
                    if ($row['status'] === 'error') {
                        $response['message'] = $row['error_msg'] ?: 'Erro desconhecido.';
                    }
                } catch (PDOException $e2) { $response['message'] = $e2->getMessage(); }
                break;

            case 'get_prescription_list':
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                try {
                    if ($terrain_id <= 0) { $response['success']=true; $response['items']=[]; break; }
                    $st = $pdo->prepare("SELECT id, name, created_at, zonation_id
                                         FROM prescription_results
                                         WHERE user_id=? AND terrain_id=? AND status='done'
                                         ORDER BY created_at DESC LIMIT 30");
                    $st->execute([$currentUser['id'], $terrain_id]);
                    $response['success'] = true;
                    $response['items']   = $st->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $e2) { $response['success']=true; $response['items']=[]; }
                break;

            case 'delete_prescription':
                $id = intval($_POST['id'] ?? 0);
                try {
                    $st = $pdo->prepare("DELETE FROM prescription_results WHERE id=? AND user_id=?");
                    $st->execute([$id, $currentUser['id']]);
                    $response['success'] = ($st->rowCount() > 0);
                    if (!$response['success']) $response['message'] = 'Prescrição não encontrada.';
                } catch (PDOException $e2) { $response['message'] = $e2->getMessage(); }
                break;
        }
    } catch (PDOException $e) {
        $response['message'] = 'Erro no sistema: ' . $e->getMessage();
    }
    
    echo json_encode($response);
    exit;
}

// Obter estatísticas e lista de terrenos (apenas se logado)
$stats       = ['total_terrains' => 0, 'total_area' => 0];
$mapTerrains = [];
if ($isLoggedIn) {
    try {
        $pdo  = getDBConnection();
        $stmt = $pdo->prepare("SELECT COUNT(*) as total_terrains, COALESCE(SUM(area), 0) as total_area FROM terrains WHERE user_id = ?");
        $stmt->execute([$currentUser['id']]);
        $stats = $stmt->fetch();

        $stmtT = $pdo->prepare("SELECT id, name FROM terrains WHERE user_id = ? ORDER BY name ASC");
        $stmtT->execute([$currentUser['id']]);
        $mapTerrains = $stmtT->fetchAll();
    } catch (PDOException $e) {
        $stats = ['total_terrains' => 0, 'total_area' => 0];
    }
}
?>

<!-- Banner para visitantes -->
<?php if (!$isLoggedIn): ?>
<div class="guest-banner">
    👋 Está a visualizar o mapa como visitante.
    <a href="login.php">Faça login</a> para desenhar e guardar os seus próprios terrenos.
</div>
<?php endif; ?>

<!-- Main Grid: mapa + sidebar unificada -->
<div class="main-grid <?php echo !$isLoggedIn ? 'full-width' : ''; ?>">

    <!-- Mapa -->
    <div class="map-section">
        <?php if ($isLoggedIn): ?>
        <div class="controls" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="startDrawing()">✏️ Desenhar</button>
            <button class="btn btn-secondary btn-sm" onclick="clearMap()">🗑️ Limpar</button>
        </div>
        <!-- Formulário de guardar terreno (aparece ao desenhar) -->
        <div id="save-form" class="section" style="display:none; margin:8px 0; padding:12px;">
            <h3 style="margin:0 0 10px;">Guardar Terreno</h3>
            <div class="form-group"><label>Nome *</label>
                <input type="text" id="terrain-name" placeholder="Ex: Campo Norte"></div>
            <div class="form-group"><label>Descrição</label>
                <textarea id="terrain-description" placeholder="Opcional…" rows="2"></textarea></div>
            <div style="display:flex; gap:8px;">
                <button class="btn btn-primary btn-sm" onclick="saveTerrain()">💾 Guardar</button>
                <button class="btn btn-secondary btn-sm" onclick="stopDrawing()">✖ Cancelar</button>
            </div>
        </div>
        <?php endif; ?>
        <div id="map"></div>
    </div>

    <?php if ($isLoggedIn): ?>
    <!-- Sidebar unificada -->
    <div class="sidebar" style="display:flex; flex-direction:column; gap:0;">

        <!-- ── Selector de terreno (controla tudo) ─── -->
        <div class="section" style="padding:14px 16px;">
            <h3 style="margin:0 0 10px; font-size:14px; color:#1f2937;">📄 Relatório de Terreno</h3>
            <select id="report-terrain"
                    onchange="onReportTerrainChange(this.value)"
                    style="width:100%; padding:8px 10px; border:1.5px solid #e5e7eb;
                           border-radius:8px; font-size:13px; background:#fff; cursor:pointer;">
                <option value="">— Selecione um terreno —</option>
                <?php foreach ($mapTerrains as $t): ?>
                    <option value="<?php echo (int)$t['id']; ?>">
                        <?php echo htmlspecialchars($t['name']); ?>
                    </option>
                <?php endforeach; ?>
            </select>
            <!-- Opacidade global dos layers -->
            <div id="opacity-ctrl" style="display:none; margin-top:10px;">
                <label style="font-size:11px; font-weight:600; color:#6b7280;
                               display:flex; justify-content:space-between;">
                    <span>Opacidade layers</span>
                    <span id="global-opacity-val">80%</span>
                </label>
                <input type="range" id="global-opacity" min="0" max="100" value="80"
                       oninput="setGlobalOpacity(this.value)"
                       style="width:100%; accent-color:#667eea; height:4px; cursor:pointer; margin-top:4px;">
            </div>
        </div>

        <!-- ── Grupos de layers (mostrados após selecionar terreno) ── -->
        <div id="report-layers" style="display:none; flex:1; overflow-y:auto;">

            <!-- 🎨 Layers de Campo -->
            <div class="layer-group">
                <div class="layer-group-hdr" onclick="toggleLayerGroup('interp')">
                    <span>🎨 Layers de Campo</span>
                    <span style="display:flex; align-items:center; gap:6px;">
                        <span id="interp-badge" class="layer-badge">0</span>
                        <span id="interp-arrow">▶</span>
                    </span>
                </div>
                <div id="lg-interp" class="layer-group-body" style="display:none;">
                    <div id="report-interp-list" class="layer-items">
                        <div class="layer-empty">A carregar…</div>
                    </div>
                </div>
            </div>

            <!-- 🗺️ Camadas GeoJSON -->
            <div class="layer-group">
                <div class="layer-group-hdr" onclick="toggleLayerGroup('geojson')">
                    <span>🗺️ Camadas GeoJSON</span>
                    <span style="display:flex; align-items:center; gap:6px;">
                        <span id="geojson-badge" class="layer-badge">0</span>
                        <span id="geojson-arrow">▶</span>
                    </span>
                </div>
                <div id="lg-geojson" class="layer-group-body" style="display:none;">
                    <div id="report-geojson-list" class="layer-items">
                        <div class="layer-empty">A carregar…</div>
                    </div>
                </div>
            </div>

            <!-- 🛰️ Imagens de Satélite -->
            <div class="layer-group">
                <div class="layer-group-hdr" onclick="toggleLayerGroup('raster')">
                    <span>🛰️ Imagens de Satélite</span>
                    <span style="display:flex; align-items:center; gap:6px;">
                        <span id="raster-badge" class="layer-badge">0</span>
                        <span id="raster-arrow">▶</span>
                    </span>
                </div>
                <div id="lg-raster" class="layer-group-body" style="display:none;">
                    <div id="report-raster-list" class="layer-items">
                        <div class="layer-empty">A carregar…</div>
                    </div>
                </div>
            </div>

            <!-- 📍 Meus Terrenos (lista compacta) -->
            <div class="layer-group">
                <div class="layer-group-hdr" onclick="toggleLayerGroup('terrains')">
                    <span>📍 Meus Terrenos</span>
                    <span id="terrains-arrow">▶</span>
                </div>
                <div id="lg-terrains" class="layer-group-body" style="display:none;">
                    <div id="terrain-list" class="terrain-list" style="max-height:220px; overflow-y:auto;">
                        <div class="layer-empty">A carregar…</div>
                    </div>
                </div>
            </div>

            <!-- 🗺️ Mapa de Zonagem -->
            <div class="layer-group">
                <div class="layer-group-hdr" onclick="toggleLayerGroup('zonation')">
                    <span>🗺️ Mapa de Zonagem</span>
                    <span style="display:flex;align-items:center;gap:6px;">
                        <span id="zonation-badge" class="layer-badge">0</span>
                        <span id="zonation-arrow">▶</span>
                    </span>
                </div>
                <div id="lg-zonation" class="layer-group-body" style="display:none;">

                    <!-- Método -->
                    <div style="margin-bottom:10px;">
                        <label class="zn-lbl">Método de classificação</label>
                        <select id="zonation-method" onchange="onZonationMethodChange(this.value)"
                                style="width:100%;padding:6px 8px;border:1.5px solid #e5e7eb;
                                       border-radius:6px;font-size:12px;margin-top:3px;background:#fff;">
                            <option value="kmeans">K-means</option>
                            <option value="fcm">Fuzzy C-means (FCM)</option>
                            <option value="gmm">Gaussian Mixture (GMM)</option>
                            <option value="quantiles">Quantis</option>
                            <option value="weighted">Índice Composto Ponderado</option>
                        </select>
                    </div>

                    <!-- Camadas de entrada -->
                    <div style="margin-bottom:10px;">
                        <label class="zn-lbl">Camadas de entrada
                            <span style="font-weight:400;color:#9ca3af;">(selecione ≥1)</span>
                        </label>
                        <div id="zonation-layer-list"
                             style="margin-top:4px;max-height:170px;overflow-y:auto;
                                    border:1px solid #f1f5f9;border-radius:6px;padding:4px;">
                            <div class="layer-empty">Selecione um terreno primeiro.</div>
                        </div>
                    </div>

                    <!-- ── Parâmetros K-means ── -->
                    <div id="params-kmeans" class="zn-params">
                        <label class="zn-lbl">Parâmetros K-means</label>
                        <div class="zn-grid3">
                            <div><label class="zn-sub">Nº Zonas (K)</label>
                                <input type="number" id="km-n_clusters" value="4" min="2" max="8" class="zn-inp"></div>
                            <div><label class="zn-sub">Nº Inits</label>
                                <input type="number" id="km-n_init" value="10" min="1" max="20" class="zn-inp"></div>
                            <div><label class="zn-sub">Max Iter.</label>
                                <input type="number" id="km-max_iter" value="300" min="50" max="500" class="zn-inp"></div>
                        </div>
                    </div>

                    <!-- ── Parâmetros FCM ── -->
                    <div id="params-fcm" class="zn-params" style="display:none;">
                        <label class="zn-lbl">Parâmetros FCM</label>
                        <div class="zn-grid3">
                            <div><label class="zn-sub">Nº Zonas (C)</label>
                                <input type="number" id="fcm-n_clusters" value="4" min="2" max="8" class="zn-inp"></div>
                            <div><label class="zn-sub">Fuzziness (m)</label>
                                <input type="number" id="fcm-m" value="2.0" min="1.1" max="5.0" step="0.1" class="zn-inp"></div>
                            <div><label class="zn-sub">Max Iter.</label>
                                <input type="number" id="fcm-maxiter" value="1000" min="50" max="2000" class="zn-inp"></div>
                        </div>
                        <div style="margin-top:5px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                            <div><label class="zn-sub">Erro (conv.)</label>
                                <input type="number" id="fcm-error" value="0.005" min="0.0001" max="0.1" step="0.001" class="zn-inp"></div>
                        </div>
                    </div>

                    <!-- ── Parâmetros GMM ── -->
                    <div id="params-gmm" class="zn-params" style="display:none;">
                        <label class="zn-lbl">Parâmetros GMM</label>
                        <div class="zn-grid3">
                            <div><label class="zn-sub">Nº Comp.</label>
                                <input type="number" id="gmm-n_components" value="4" min="2" max="8" class="zn-inp"></div>
                            <div><label class="zn-sub">Covariância</label>
                                <select id="gmm-covariance_type" class="zn-inp" style="padding:4px 5px;">
                                    <option value="full">Full</option>
                                    <option value="tied">Tied</option>
                                    <option value="diag">Diag</option>
                                    <option value="spherical">Spherical</option>
                                </select></div>
                            <div><label class="zn-sub">Nº Inits</label>
                                <input type="number" id="gmm-n_init" value="3" min="1" max="10" class="zn-inp"></div>
                        </div>
                    </div>

                    <!-- ── Parâmetros Quantis ── -->
                    <div id="params-quantiles" class="zn-params" style="display:none;">
                        <label class="zn-lbl">Parâmetros Quantis</label>
                        <div style="margin-top:4px;display:grid;grid-template-columns:1fr;gap:6px;">
                            <div><label class="zn-sub">Nº Zonas</label>
                                <input type="number" id="qt-n_zones" value="3" min="2" max="8" class="zn-inp"></div>
                        </div>
                        <div id="qt-weights-panel" style="margin-top:8px;"></div>
                    </div>

                    <!-- ── Parâmetros Índice Composto ── -->
                    <div id="params-weighted" class="zn-params" style="display:none;">
                        <label class="zn-lbl">Parâmetros Índice Composto</label>
                        <div style="margin-top:4px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                            <div><label class="zn-sub">Nº Zonas</label>
                                <input type="number" id="wt-n_zones" value="3" min="2" max="8" class="zn-inp"></div>
                            <div><label class="zn-sub">Classificar por</label>
                                <select id="wt-classify_by" class="zn-inp" style="padding:4px 5px;">
                                    <option value="quantile">Quantil</option>
                                    <option value="equal">Intervalo igual</option>
                                </select></div>
                        </div>
                        <div id="wt-weights-panel" style="margin-top:8px;"></div>
                    </div>

                    <!-- Botão gerar -->
                    <button id="zonation-generate-btn" onclick="generateZonation()"
                            style="width:100%;margin-top:10px;padding:9px;border:none;cursor:pointer;
                                   background:linear-gradient(135deg,#667eea,#764ba2);
                                   color:#fff;font-size:12px;font-weight:700;border-radius:8px;
                                   transition:opacity .15s;">
                        🗺️ Gerar Zonagem
                    </button>

                    <!-- Painel de estado (feedback assíncrono) -->
                    <div id="zonation-status" style="display:none;"></div>

                    <!-- Legenda do resultado -->
                    <div id="zonation-legend" style="display:none;margin-top:10px;"></div>

                    <!-- Historial -->
                    <div style="margin-top:12px;border-top:1px solid #f1f5f9;padding-top:8px;">
                        <div class="zn-lbl" style="margin-bottom:4px;">📚 Historial</div>
                        <div id="zonation-history-list">
                            <div class="layer-empty">Nenhuma zonagem guardada.</div>
                        </div>
                    </div>

                </div><!-- #lg-zonation -->
            </div>

            <!-- 📋 Prescrição / ShapeFile VRA ─────────────────────────────── -->
            <div class="layer-group">
                <div class="layer-group-hdr" onclick="toggleLayerGroup('prescription')">
                    <span>📋 Prescrição / ShapeFile</span>
                    <span style="display:flex;align-items:center;gap:6px;">
                        <span id="prescription-badge" class="layer-badge">0</span>
                        <span id="prescription-arrow">▶</span>
                    </span>
                </div>
                <div id="lg-prescription" class="layer-group-body" style="display:none;">

                    <!-- Zonagem base -->
                    <div style="margin-bottom:8px;">
                        <label class="zn-lbl">Zonagem base</label>
                        <select id="presc-zonation-select"
                                onchange="onPrescZonationChange(this.value)"
                                style="width:100%;padding:6px 8px;border:1.5px solid #e5e7eb;
                                       border-radius:6px;font-size:12px;margin-top:3px;background:#fff;">
                            <option value="">— Selecione uma zonagem —</option>
                        </select>
                    </div>

                    <!-- Nome -->
                    <div style="margin-bottom:8px;">
                        <label class="zn-lbl">Nome da prescrição</label>
                        <input type="text" id="presc-name"
                               placeholder="Ex: Fertilização Azoto Maio 2026"
                               style="width:100%;padding:6px 8px;border:1.5px solid #e5e7eb;
                                      border-radius:6px;font-size:12px;margin-top:3px;
                                      box-sizing:border-box;">
                    </div>

                    <!-- Tabela de prescrições por zona (renderizada por JS) -->
                    <div id="presc-zone-inputs" style="margin-bottom:8px;"></div>

                    <!-- Botão gerar -->
                    <button id="presc-generate-btn" onclick="generatePrescription()"
                            style="width:100%;padding:9px;border:none;cursor:pointer;
                                   background:linear-gradient(135deg,#059669,#0d9488);
                                   color:#fff;font-size:12px;font-weight:700;
                                   border-radius:8px;transition:opacity .15s;">
                        📋 Gerar ShapeFile
                    </button>

                    <!-- Feedback assíncrono -->
                    <div id="presc-status" style="display:none;"></div>

                    <!-- Historial de prescrições -->
                    <div style="margin-top:12px;border-top:1px solid #f1f5f9;padding-top:8px;">
                        <div class="zn-lbl" style="margin-bottom:4px;">
                            📥 Prescrições guardadas
                        </div>
                        <div id="presc-history-list">
                            <div class="layer-empty">Nenhuma prescrição guardada.</div>
                        </div>
                    </div>

                </div><!-- #lg-prescription -->
            </div>

        </div><!-- #report-layers -->
    </div><!-- .sidebar -->
    <?php endif; ?>

</div><!-- .main-grid -->

<?php if ($isLoggedIn): ?>
<!-- ── Secção de Notas e Relatório PDF (abaixo do mapa) ── -->
<div class="section" id="notes-section"
     style="margin:16px 0; padding:20px; background:#fff;
            border:1px solid #e5e7eb; border-radius:12px;">
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
        <h3 style="margin:0; font-size:15px; color:#1f2937;">📝 Notas do Relatório</h3>
        <button class="btn btn-primary btn-sm"
                onclick="generateMapReport()"
                style="background:linear-gradient(135deg,#7c3aed,#4f46e5);">
            📄 Gerar PDF
        </button>
    </div>

    <!-- Editor de nota -->
    <div style="display:flex; gap:10px; align-items:flex-end; margin-bottom:14px;">
        <textarea id="note-content" rows="3"
                  placeholder="Escreva uma observação sobre o terreno ou os layers activos…"
                  style="flex:1; padding:10px; border:1.5px solid #e5e7eb; border-radius:8px;
                         font-size:13px; resize:vertical; font-family:inherit; line-height:1.5;">
        </textarea>
        <button class="btn btn-primary btn-sm" onclick="saveMapNote()"
                style="white-space:nowrap; align-self:flex-end;">
            💾 Guardar
        </button>
    </div>

    <!-- Banco de notas guardadas -->
    <div style="border-top:1px solid #f1f5f9; padding-top:12px;">
        <div style="font-size:12px; font-weight:600; color:#6b7280; margin-bottom:8px;">
            📖 Banco de Notas
        </div>
        <div id="notes-list">
            <div style="text-align:center; padding:10px; color:#9ca3af; font-size:13px;">A carregar…</div>
        </div>
    </div>
</div>
<?php endif; ?>

<!-- jsPDF CDN (apenas para este tab) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
        integrity="sha512-qZvrmS2ekKPF2mSznTQsxqPgnpkI4DNTlrdUmTzrDgektczlKNRRhy5X5AAOnx5S09ydFYWWNSfYEqbZHed/g=="
        crossorigin="anonymous" referrerpolicy="no-referrer"></script>

<style>
/* ── Grupos de layers na sidebar ── */
.layer-group { border-bottom: 1px solid #f1f5f9; }
.layer-group-hdr {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 16px; font-size: 13px; font-weight: 600; color: #374151;
    cursor: pointer; user-select: none; transition: background .15s;
}
.layer-group-hdr:hover { background: #f9fafb; }
.layer-group-body { padding: 8px 12px 10px; background: #fafafa; }
.layer-badge {
    font-size: 10px; font-weight: 700; color: #fff;
    background: #6b7280; border-radius: 10px; padding: 1px 6px;
}
.layer-badge.has-items { background: #667eea; }
.layer-items { display: flex; flex-direction: column; gap: 4px; }
.layer-empty { font-size: 12px; color: #9ca3af; padding: 4px 2px; }

/* Linha de layer individual */
.layer-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; border-radius: 7px; font-size: 12px;
    background: #fff; border: 1px solid #f1f5f9;
}
.layer-row-info { flex: 1; min-width: 0; }
.layer-row-name { font-weight: 600; color: #1f2937;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.layer-row-meta { font-size: 10px; color: #9ca3af; margin-top:1px; }
.layer-toggle-btn {
    font-size: 11px; padding: 3px 7px; border-radius: 5px; white-space: nowrap;
    cursor: pointer; border: none; font-weight: 600; transition: all .15s;
}
.layer-toggle-off { background: #f3f4f6; color: #6b7280; }
.layer-toggle-off:hover { background: #e5e7eb; }
.layer-toggle-on  { background: #ede9fe; color: #7c3aed; }

/* Nota individual */
.note-item {
    display: flex; gap: 8px; align-items: flex-start;
    padding: 9px 12px; border-radius: 8px; background: #f8fafc;
    border: 1px solid #e5e7eb; margin-bottom: 6px; font-size: 13px;
}
.note-item-text { flex: 1; color: #374151; line-height: 1.5; white-space: pre-wrap; }
.note-item-date { font-size: 10px; color: #9ca3af; white-space: nowrap; }
.note-delete-btn {
    background: none; border: none; cursor: pointer;
    color: #d1d5db; font-size: 14px; padding: 0 2px; line-height: 1;
    transition: color .15s;
}
.note-delete-btn:hover { color: #ef4444; }

/* ── Zonagem ── */
.zn-lbl  { font-size:11px; font-weight:600; color:#6b7280; display:block; }
.zn-sub  { font-size:10px; color:#9ca3af; display:block; margin-bottom:2px; }
.zn-inp  { width:100%; padding:5px 6px; border:1px solid #e5e7eb; border-radius:5px;
           font-size:12px; box-sizing:border-box; }
.zn-params { margin-bottom:10px; }
.zn-grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:4px; }

/* Linha de peso por layer */
.zn-weight-row {
    display:flex; align-items:center; gap:6px; padding:5px 0;
    border-bottom:1px solid #f8fafc; font-size:11px;
}
.zn-weight-row span { flex:1; color:#374151; white-space:nowrap;
                      overflow:hidden; text-overflow:ellipsis; }
.zn-weight-row input[type=range] { width:70px; accent-color:#667eea; height:3px; cursor:pointer; }
.zn-weight-val { min-width:24px; text-align:right; color:#667eea; font-weight:600; font-size:11px; }

/* Legenda de zonas */
.zn-legend-row {
    display:flex; align-items:center; gap:7px; padding:4px 2px;
    font-size:11px; color:#374151;
}
.zn-legend-swatch { width:14px; height:14px; border-radius:3px; flex-shrink:0; }
.zn-legend-pct { margin-left:auto; color:#9ca3af; font-size:10px; }

/* Linha de historial */
.zn-hist-row {
    display:flex; align-items:center; gap:6px; padding:5px 6px;
    border-radius:6px; font-size:11px; background:#fff; border:1px solid #f1f5f9;
    margin-bottom:4px;
}
.zn-hist-info { flex:1; min-width:0; }
.zn-hist-name { font-weight:600; color:#1f2937; white-space:nowrap;
                overflow:hidden; text-overflow:ellipsis; }
.zn-hist-date { font-size:10px; color:#9ca3af; }
</style>