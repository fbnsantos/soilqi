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
                $stmt = $pdo->prepare("SELECT * FROM terrains WHERE user_id = ? ORDER BY created_at DESC");
                $stmt->execute([$currentUser['id']]);
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
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                if ($terrain_id <= 0) {
                    $response['success']        = true;
                    $response['interpolations'] = [];
                    break;
                }
                // Verify terrain belongs to user
                $chk = $pdo->prepare("SELECT id FROM terrains WHERE id = ? AND user_id = ?");
                $chk->execute([$terrain_id, $currentUser['id']]);
                if (!$chk->fetch()) {
                    $response['message'] = 'Terreno não encontrado.';
                    break;
                }
                try {
                    $stmt = $pdo->prepare("
                        SELECT id, name, param, colormap, resolution,
                               min_lat, max_lat, min_lng, max_lng,
                               min_val, max_val, created_at
                        FROM field_interpolations
                        WHERE terrain_id = ? AND user_id = ?
                        ORDER BY created_at DESC
                    ");
                    $stmt->execute([$terrain_id, $currentUser['id']]);
                    $response['success']        = true;
                    $response['interpolations'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $tableErr) {
                    // Tabela ainda não existe (migração 002 não aplicada) — devolver lista vazia
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
                try {
                    $stmt = $pdo->prepare("
                        SELECT g.id, g.name, g.description, g.feature_count,
                               g.bbox_min_lat, g.bbox_max_lat, g.bbox_min_lng, g.bbox_max_lng,
                               g.created_at, t.name AS terrain_name
                        FROM field_geojson g
                        LEFT JOIN terrains t ON t.id = g.terrain_id
                        WHERE g.user_id = ?
                        ORDER BY g.created_at DESC
                    ");
                    $stmt->execute([$currentUser['id']]);
                    $response['success'] = true;
                    $response['layers']  = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $tableErr) {
                    $response['success'] = true;
                    $response['layers']  = [];   // tabela ainda não existe — ignorar
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

<!-- Stats Grid (apenas para utilizadores logados) -->
<?php if ($isLoggedIn): ?>
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-number" id="total-terrains"><?php echo $stats['total_terrains']; ?></div>
            <div class="stat-label">Terrenos Registados</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="total-area"><?php echo number_format($stats['total_area'], 1); ?></div>
            <div class="stat-label">Área Total (ha)</div>
        </div>
    </div>
<?php endif; ?>

<!-- Main Grid -->
<div class="main-grid <?php echo !$isLoggedIn ? 'full-width' : ''; ?>">
    <!-- Map Section -->
    <div class="map-section">
        <?php if ($isLoggedIn): ?>
            <div class="controls">
                <button class="btn btn-primary" onclick="startDrawing()">✏️ Desenhar Terreno</button>
                <button class="btn btn-secondary" onclick="clearMap()">🗑️ Limpar Mapa</button>
            </div>
        <?php endif; ?>
        <div id="map"></div>
    </div>

    <!-- Sidebar (apenas para utilizadores logados) -->
    <?php if ($isLoggedIn): ?>
        <div class="sidebar">
            <!-- Formulário de guardar -->
            <div id="save-form" class="section" style="display: none;">
                <h3>Guardar Terreno</h3>
                <div class="form-group">
                    <label for="terrain-name">Nome *</label>
                    <input type="text" id="terrain-name" placeholder="Ex: Campo Norte">
                </div>
                <div class="form-group">
                    <label for="terrain-description">Descrição</label>
                    <textarea id="terrain-description" placeholder="Descrição opcional..."></textarea>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-primary" onclick="saveTerrain()">💾 Guardar</button>
                    <button class="btn btn-secondary" onclick="stopDrawing()">✖️ Cancelar</button>
                </div>
            </div>

            <!-- Lista de terrenos -->
            <div class="section">
                <h3>Meus Terrenos</h3>
                <div id="terrain-list" class="terrain-list">
                    <div class="empty-state">
                        <h4>A carregar...</h4>
                    </div>
                </div>
            </div>

            <!-- Interpolações de Campo como Layers -->
            <div class="section">
                <h3>🎨 Layers de Campo</h3>
                <p style="font-size:12px; color:#9ca3af; margin:-4px 0 10px;">
                    Interpolações IDW guardadas no separador Medições de Campo.
                </p>
                <div class="form-group" style="margin-bottom:10px;">
                    <label style="font-size:12px; font-weight:600; color:#6b7280;
                                  display:block; margin-bottom:4px;">Terreno</label>
                    <select id="map-interp-terrain" onchange="loadMapInterpolations(this.value)"
                            style="width:100%; padding:7px 10px; border:1.5px solid #e5e7eb;
                                   border-radius:7px; font-size:13px; background:#fff;">
                        <option value="">— Selecione um terreno —</option>
                        <?php foreach ($mapTerrains as $t): ?>
                            <option value="<?php echo (int)$t['id']; ?>">
                                <?php echo htmlspecialchars($t['name']); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div id="map-interp-list" style="color:#9ca3af; font-size:13px; padding:2px 0;">
                    Selecione um terreno para ver as interpolações guardadas.
                </div>
            </div>

            <!-- Camadas GeoJSON -->
            <div class="section">
                <h3>🗺️ Camadas GeoJSON</h3>
                <p style="font-size:12px; color:#9ca3af; margin:-4px 0 10px;">
                    Ficheiros GeoJSON importados no separador Medições de Campo.
                </p>
                <div id="map-geojson-list" style="font-size:13px; color:#9ca3af; padding:2px 0;">
                    <div style="text-align:center; padding:10px;">A carregar…</div>
                </div>
            </div>
        </div>
    <?php endif; ?>
</div>