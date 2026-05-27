<?php
/**
 * Tab: Medições de Campo
 * Visualização dos dados recolhidos pela PWA SoilQI Field
 */

if (!isset($isLoggedIn)) $isLoggedIn = false;
if (!isset($isAdmin))    $isAdmin    = false;
if (!isset($currentUser)) $currentUser = null;

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

                $stmt = $pdo->prepare("
                    SELECT m.id, m.latitude, m.longitude, m.gps_accuracy,
                           m.conductivity, m.ph, m.temperature, m.moisture,
                           m.notes, m.measured_at,
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
        }

    } catch (PDOException $e) {
        $msg = $e->getMessage();
        if (strpos($msg, "doesn't exist") !== false || $e->getCode() === '42S02') {
            $response['message'] = 'A tabela field_measurements não existe. Vá ao Admin → Migrações e aplique a migração 001_field_measurements.';
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
<div class="section" style="padding:0; overflow:hidden; border-radius:12px; margin-bottom:20px;">
    <div id="field-map" style="height:380px; width:100%;"></div>
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
