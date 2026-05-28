<?php
/**
 * Tab: Mapa Semântico
 * Visualização de mapas semânticos gerados por robôs com MapLibre GL JS.
 * Suporta: árvores (curvas Bézier), mapas de elevação (PNG), mapas de ocupação.
 */

if (!isset($isLoggedIn)) $isLoggedIn = false;
if (!isset($currentUser)) $currentUser = null;

// ── API AJAX ──────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isLoggedIn) {
    header('Content-Type: application/json');
    $action   = $_POST['action'] ?? '';
    $response = ['success' => false, 'message' => ''];

    try {
        $pdo = getDBConnection();

        // Auto-migração: tabela de mapas semânticos
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS semantic_maps (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                user_id     INT NOT NULL,
                name        VARCHAR(255) NOT NULL,
                description TEXT,
                map_data    LONGTEXT NOT NULL,
                ref_lat     DOUBLE DEFAULT 0,
                ref_lng     DOUBLE DEFAULT 0,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_sem_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");

        switch ($action) {

            case 'save_semantic_map':
                $name = sanitizeInput($_POST['name'] ?? '');
                $desc = sanitizeInput($_POST['description'] ?? '');
                $data = $_POST['map_data'] ?? '';
                $lat  = floatval($_POST['ref_lat'] ?? 0);
                $lng  = floatval($_POST['ref_lng'] ?? 0);
                if (!$name || !$data) { $response['message'] = 'Nome e dados obrigatórios.'; break; }
                $stmt = $pdo->prepare("
                    INSERT INTO semantic_maps (user_id, name, description, map_data, ref_lat, ref_lng)
                    VALUES (?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([$currentUser['id'], $name, $desc, $data, $lat, $lng]);
                $response['success'] = true;
                $response['id']      = (int)$pdo->lastInsertId();
                $response['message'] = 'Mapa guardado.';
                break;

            case 'get_semantic_maps':
                $stmt = $pdo->prepare("
                    SELECT id, name, description, ref_lat, ref_lng, created_at
                    FROM semantic_maps WHERE user_id = ? ORDER BY created_at DESC
                ");
                $stmt->execute([$currentUser['id']]);
                $response['success'] = true;
                $response['maps']    = $stmt->fetchAll(PDO::FETCH_ASSOC);
                break;

            case 'get_semantic_map':
                $id   = intval($_POST['id'] ?? 0);
                $stmt = $pdo->prepare("SELECT * FROM semantic_maps WHERE id = ? AND user_id = ?");
                $stmt->execute([$id, $currentUser['id']]);
                $row  = $stmt->fetch(PDO::FETCH_ASSOC);
                if ($row) { $response['success'] = true; $response['map'] = $row; }
                else      { $response['message'] = 'Mapa não encontrado.'; }
                break;

            case 'delete_semantic_map':
                $id   = intval($_POST['id'] ?? 0);
                $stmt = $pdo->prepare("DELETE FROM semantic_maps WHERE id = ? AND user_id = ?");
                $stmt->execute([$id, $currentUser['id']]);
                $response['success'] = $stmt->rowCount() > 0;
                $response['message'] = $response['success'] ? 'Eliminado.' : 'Não encontrado.';
                break;

            case 'get_terrains_sem':
                $stmt = $pdo->prepare("SELECT id, name, coordinates, area FROM terrains WHERE user_id = ? ORDER BY name");
                $stmt->execute([$currentUser['id']]);
                $response['success']  = true;
                $response['terrains'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                break;
        }
    } catch (PDOException $e) {
        $response['message'] = 'Erro BD: ' . $e->getMessage();
    }

    echo json_encode($response);
    exit;
}

// ── Carregar lista de mapas guardados ─────────────────────────────────────────
$savedSemMaps = [];
if ($isLoggedIn) {
    try {
        $pdo = getDBConnection();
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS semantic_maps (
                id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL,
                name VARCHAR(255) NOT NULL, description TEXT, map_data LONGTEXT NOT NULL,
                ref_lat DOUBLE DEFAULT 0, ref_lng DOUBLE DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_sem_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
        $stmt = $pdo->prepare("
            SELECT id, name, description, ref_lat, ref_lng, created_at
            FROM semantic_maps WHERE user_id = ? ORDER BY created_at DESC LIMIT 30
        ");
        $stmt->execute([$currentUser['id']]);
        $savedSemMaps = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) { /* silencioso */ }
}
?>

<!-- MapLibre GL JS -->
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<!-- Three.js r128 + OrbitControls (vista 3D) -->
<script src="https://unpkg.com/three@0.128.0/build/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js"></script>

<style>
#semantic-map  { width:100%; height:620px; border-radius:10px; }
#semantic-3d   { display:none; width:100%; height:620px; border-radius:10px;
                 overflow:hidden; position:relative; background:#87CEEB; }
#semantic-3d canvas { width:100% !important; height:100% !important; display:block; }
#sem-3d-hint   { position:absolute; bottom:8px; left:50%; transform:translateX(-50%);
                 font-size:11px; color:rgba(255,255,255,.85); background:rgba(0,0,0,.35);
                 padding:3px 10px; border-radius:10px; pointer-events:none; white-space:nowrap; }
.sem-panel { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:14px; margin-bottom:12px; }
.sem-panel h4 { margin:0 0 10px; font-size:13px; font-weight:700; color:#374151; }
.sem-layer-row {
    display:flex; align-items:center; gap:7px; padding:5px 0;
    border-bottom:1px solid #f3f4f6; font-size:12px;
}
.sem-layer-row:last-child { border-bottom:none; }
.sem-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
.sem-badge { font-size:10px; background:#f3f4f6; color:#6b7280; padding:1px 5px; border-radius:8px; }
.maplibregl-popup-content { font-size:12px; padding:10px 12px; max-width:230px; }
.maplibregl-popup-content table td { padding:2px 5px; vertical-align:top; }
.maplibregl-popup-content table td:first-child { color:#6b7280; font-size:11px; white-space:nowrap; }
.sem-toggle { cursor:pointer; font-size:11px; color:#667eea; border:none; background:none;
              padding:0; text-decoration:underline; }
</style>

<!-- Controls -->
<div class="controls" style="flex-wrap:wrap; gap:8px; margin-bottom:12px;">
    <button class="btn btn-primary" onclick="loadExampleSemanticMap()">🤖 Carregar Exemplo</button>
    <label class="btn btn-secondary" style="cursor:pointer; margin:0;">
        📂 Importar JSON
        <input type="file" id="sem-import-file" accept=".json,.semmap"
               style="display:none" onchange="importSemanticMapFile(this)">
    </label>
    <button class="btn btn-secondary" onclick="exportSemanticMap()">⬇️ Exportar JSON</button>
    <button class="btn btn-secondary" onclick="clearSemanticMap()">🗑️ Limpar</button>
    <button class="btn btn-secondary" id="sem-btn-3d" onclick="toggle3DView()">🧊 Vista 3D</button>
</div>

<div class="main-grid">
    <!-- Mapa -->
    <div class="map-section">
        <div id="semantic-map"></div>
        <!-- Vista 3D Three.js -->
        <div id="semantic-3d">
            <canvas id="semantic-3d-canvas"></canvas>
            <div id="sem-3d-hint">🖱️ arrastar: rodar &nbsp;|&nbsp; scroll: zoom &nbsp;|&nbsp; Shift+arrastar: deslocar</div>
        </div>
        <div id="sem-status" style="font-size:12px; color:#6b7280; padding:6px 2px; min-height:18px;"></div>
    </div>

    <!-- Sidebar -->
    <?php if ($isLoggedIn): ?>
    <div class="sidebar">

        <!-- Guardar mapa -->
        <div class="sem-panel">
            <h4>💾 Guardar Mapa</h4>
            <input type="text" id="sem-save-name" placeholder="Nome do mapa semântico"
                   style="width:100%; box-sizing:border-box; margin-bottom:8px;
                          padding:7px 10px; border:1.5px solid #e5e7eb; border-radius:7px; font-size:13px;">
            <button class="btn btn-primary btn-sm" onclick="saveCurrentSemanticMap()" style="width:100%;">
                💾 Guardar na base de dados
            </button>
            <div id="sem-save-status" style="font-size:11px; color:#6b7280; margin-top:5px; min-height:14px;"></div>
        </div>

        <!-- Mapas guardados -->
        <div class="sem-panel">
            <h4>📋 Mapas Guardados</h4>
            <div id="sem-saved-list">
            <?php if (empty($savedSemMaps)): ?>
                <div style="color:#9ca3af; font-size:12px; text-align:center; padding:8px 0;">
                    Nenhum mapa guardado ainda.
                </div>
            <?php else: ?>
                <?php foreach ($savedSemMaps as $sm): ?>
                <div class="sem-layer-row">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; font-size:12px; white-space:nowrap;
                                    overflow:hidden; text-overflow:ellipsis;"
                             title="<?= htmlspecialchars($sm['name']) ?>">
                            <?= htmlspecialchars($sm['name']) ?>
                        </div>
                        <div style="font-size:10px; color:#9ca3af;">
                            <?= date('d/m/Y H:i', strtotime($sm['created_at'])) ?>
                        </div>
                    </div>
                    <button class="btn btn-secondary btn-sm"
                            onclick="loadSavedSemanticMap(<?= $sm['id'] ?>)"
                            style="padding:2px 7px; font-size:11px;" title="Carregar">🗺️</button>
                    <button class="btn btn-danger btn-sm"
                            onclick="deleteSavedSemanticMap(<?= $sm['id'] ?>, '<?= htmlspecialchars(addslashes($sm['name'])) ?>')"
                            style="padding:2px 7px; font-size:11px;" title="Eliminar">🗑️</button>
                </div>
                <?php endforeach; ?>
            <?php endif; ?>
            </div>
        </div>

        <!-- Camadas activas -->
        <div class="sem-panel">
            <h4>🗂️ Camadas Activas</h4>
            <div id="sem-layers-list" style="color:#9ca3af; font-size:12px; padding:4px 0;">
                Nenhum mapa carregado.
            </div>
        </div>

        <!-- Terrenos -->
        <div class="sem-panel">
            <h4>🌿 Terrenos da Quinta</h4>
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;">
                <input type="checkbox" id="sem-show-terrains" onchange="toggleSemTerrains(this.checked)" checked>
                Mostrar polígonos de terreno
            </label>
        </div>

        <!-- Formato do ficheiro -->
        <div class="sem-panel">
            <h4>📄 Formato JSON</h4>
            <details style="font-size:11px; color:#6b7280; line-height:1.6;">
                <summary style="cursor:pointer; color:#667eea; font-size:12px;">Ver esquema</summary>
                <pre style="margin-top:8px; background:#f9fafb; padding:8px; border-radius:6px;
                            overflow:auto; font-size:10px; color:#374151;">{
  "type": "semantic_map",
  "version": "1.0",
  "reference": {
    "lat": 38.518,
    "lng": -8.127,
    "rotation": 0
  },
  "layers": [
    {
      "type": "trees",
      "data": [{
        "id": "t001",
        "position": [x, y],
        "species": "olea_europaea",
        "trunk": { "height": 3.0,
          "radius_base": 0.10 },
        "branches": [{
          "points": [[x0,y0],[x1,y1],[x2,y2]],
          "radius": 0.04
        }],
        "canopy_radius": 1.5,
        "health": "good",
        "fruit_load": 0.8
      }]
    },
    {
      "type": "elevation",
      "origin": [ox, oy],
      "resolution": 1.0,
      "width": 25, "height": 20,
      "min_elevation": 95.0,
      "max_elevation": 110.0,
      "encoding": "png_base64",
      "data": "data:image/png;base64,..."
    },
    {
      "type": "occupancy",
      "origin": [ox, oy],
      "resolution": 0.1,
      "width": 240, "height": 200,
      "encoding": "png_base64",
      "data": "data:image/png;base64,..."
    }
  ]
}</pre>
            </details>
        </div>

    </div>
    <?php endif; ?>
</div>
