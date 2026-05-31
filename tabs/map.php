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
                // Mostra TODAS as interpolações do utilizador.
                // Se terrain_id for fornecido, as do terreno selecionado aparecem primeiro.
                $terrain_id = intval($_POST['terrain_id'] ?? 0);
                try {
                    if ($terrain_id > 0) {
                        $stmt = $pdo->prepare("
                            SELECT id, name, param, colormap, resolution,
                                   min_lat, max_lat, min_lng, max_lng,
                                   min_val, max_val, created_at, terrain_id
                            FROM field_interpolations
                            WHERE user_id = ?
                            ORDER BY (terrain_id = ?) DESC, created_at DESC
                        ");
                        $stmt->execute([$currentUser['id'], $terrain_id]);
                    } else {
                        $stmt = $pdo->prepare("
                            SELECT id, name, param, colormap, resolution,
                                   min_lat, max_lat, min_lng, max_lng,
                                   min_val, max_val, created_at, terrain_id
                            FROM field_interpolations
                            WHERE user_id = ?
                            ORDER BY created_at DESC
                        ");
                        $stmt->execute([$currentUser['id']]);
                    }
                    $response['success']        = true;
                    $response['interpolations'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $tableErr) {
                    // Tabela ainda não existe (migração 002 não aplicada)
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
</style>