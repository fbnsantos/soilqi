<?php
/**
 * tabs/operations.php — Planeamento de Operações de Campo
 * Permite planear operações agrícolas (pulverização, colheita, sementeira…),
 * desenhar trajectórias no mapa, estimar custos e gerir o calendário da época.
 */

if (!isset($isLoggedIn))  $isLoggedIn  = false;
if (!isset($isAdmin))     $isAdmin     = false;
if (!isset($currentUser)) $currentUser = null;

$userId = (int)($_SESSION['user_id'] ?? 0);

// ── Garantir tabela ───────────────────────────────────────────────────────────
function _ops_init_table(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS field_operations (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        user_id          INT NOT NULL,
        terrain_id       INT NOT NULL,
        prescription_id  INT NULL,
        type             VARCHAR(30)  NOT NULL DEFAULT 'outro',
        name             VARCHAR(200) NOT NULL,
        description      TEXT NULL,
        status           ENUM('planned','in_progress','done','cancelled') NOT NULL DEFAULT 'planned',
        scheduled_date   DATE NULL,
        completed_date   DATE NULL,
        season           VARCHAR(20) NULL,
        trajectory       MEDIUMTEXT NULL,
        trajectory_type  ENUM('line','area','point') NOT NULL DEFAULT 'line',
        area_ha          DECIMAL(10,4) NULL,
        cost_per_ha      DECIMAL(10,2) NOT NULL DEFAULT 0,
        fixed_cost       DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_cost       DECIMAL(10,2) NULL,
        notes            TEXT NULL,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_fo      (user_id, terrain_id),
        INDEX idx_fo_date (user_id, scheduled_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// ── AJAX ──────────────────────────────────────────────────────────────────────
if (isset($_POST['action'])) {
    header('Content-Type: application/json');
    $resp = ['success' => false, 'message' => ''];

    if (!$userId) {
        http_response_code(403);
        echo json_encode(['success'=>false,'message'=>'Autenticação necessária.']);
        exit;
    }

    try {
        $pdo = getDBConnection();
        _ops_init_table($pdo);

        switch ($_POST['action']) {

            // ── Guardar / actualizar operação ─────────────────────────────────
            case 'save_operation': {
                $opId    = intval($_POST['op_id']           ?? 0);
                $tid     = intval($_POST['terrain_id']      ?? 0);
                $type    = trim($_POST['type']              ?? 'outro');
                $name    = trim($_POST['name']              ?? '');
                $descr   = trim($_POST['description']       ?? '');
                $status  = trim($_POST['status']            ?? 'planned');
                $sDate   = trim($_POST['scheduled_date']    ?? '') ?: null;
                $season  = trim($_POST['season']            ?? '') ?: null;
                $prescId = intval($_POST['prescription_id'] ?? 0)  ?: null;
                $areaHa  = strlen(trim($_POST['area_ha']    ?? ''))
                           ? floatval($_POST['area_ha']) : null;
                $costPHa = floatval($_POST['cost_per_ha']   ?? 0);
                $fixCost = floatval($_POST['fixed_cost']    ?? 0);
                $total   = $areaHa !== null
                           ? round($areaHa * $costPHa + $fixCost, 2)
                           : round($fixCost, 2);
                $notes   = trim($_POST['notes']             ?? '');
                $trajJson= trim($_POST['trajectory']        ?? '') ?: null;
                $trajType= trim($_POST['trajectory_type']   ?? 'line');

                $validTypes  = ['pulverizacao','fertilizacao','monda','colheita','sementeira',
                                'coberto_vegetal','monitorizacao','correccao_solo','outro'];
                $validStatus = ['planned','in_progress','done','cancelled'];
                $validTraj   = ['line','area','point'];
                if (!in_array($type,     $validTypes,  true)) $type     = 'outro';
                if (!in_array($status,   $validStatus, true)) $status   = 'planned';
                if (!in_array($trajType, $validTraj,   true)) $trajType = 'line';

                if (!$tid || !$name) {
                    $resp['message'] = 'Terreno e nome são obrigatórios.';
                    echo json_encode($resp); exit;
                }
                $st = $pdo->prepare("SELECT id, area FROM terrains WHERE id=? AND user_id=? LIMIT 1");
                $st->execute([$tid, $userId]);
                if (!$st->fetch()) {
                    $resp['message'] = 'Terreno inválido.'; echo json_encode($resp); exit;
                }

                if ($opId > 0) {
                    $st = $pdo->prepare("UPDATE field_operations SET
                        type=?,name=?,description=?,status=?,scheduled_date=?,season=?,
                        prescription_id=?,area_ha=?,cost_per_ha=?,fixed_cost=?,total_cost=?,
                        notes=?,trajectory=?,trajectory_type=?
                        WHERE id=? AND user_id=?");
                    $st->execute([$type,$name,$descr,$status,$sDate,$season,$prescId,
                                  $areaHa,$costPHa,$fixCost,$total,$notes,$trajJson,$trajType,
                                  $opId,$userId]);
                    $resp['id'] = $opId;
                } else {
                    $st = $pdo->prepare("INSERT INTO field_operations
                        (user_id,terrain_id,prescription_id,type,name,description,status,
                         scheduled_date,season,area_ha,cost_per_ha,fixed_cost,total_cost,
                         notes,trajectory,trajectory_type)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
                    $st->execute([$userId,$tid,$prescId,$type,$name,$descr,$status,
                                  $sDate,$season,$areaHa,$costPHa,$fixCost,$total,
                                  $notes,$trajJson,$trajType]);
                    $resp['id'] = (int)$pdo->lastInsertId();
                }
                $resp['success'] = true; $resp['message'] = 'Guardado.';
                break;
            }

            // ── Listar operações ──────────────────────────────────────────────
            case 'get_operations': {
                $tid    = intval($_POST['terrain_id'] ?? 0);
                $status = trim($_POST['status']       ?? '');
                $month  = intval($_POST['month']      ?? 0);
                $year   = intval($_POST['year']       ?? 0);
                $params = [$userId]; $where = "user_id=?";
                if ($tid)    { $where .= " AND terrain_id=?"; $params[] = $tid; }
                if ($status && in_array($status, ['planned','in_progress','done','cancelled'], true)) {
                    $where .= " AND status=?"; $params[] = $status;
                }
                if ($month && $year) {
                    $where .= " AND MONTH(scheduled_date)=? AND YEAR(scheduled_date)=?";
                    $params[] = $month; $params[] = $year;
                } elseif ($year) {
                    $where .= " AND YEAR(scheduled_date)=?"; $params[] = $year;
                }
                $st = $pdo->prepare("SELECT id,terrain_id,prescription_id,type,name,description,
                    status,scheduled_date,completed_date,season,trajectory_type,
                    area_ha,cost_per_ha,fixed_cost,total_cost,notes,created_at
                    FROM field_operations WHERE $where
                    ORDER BY scheduled_date ASC, created_at DESC");
                $st->execute($params);
                $resp['success'] = true; $resp['items'] = $st->fetchAll(PDO::FETCH_ASSOC);
                break;
            }

            // ── Operação individual (com trajectory) ──────────────────────────
            case 'get_operation': {
                $opId = intval($_POST['id'] ?? 0);
                $st   = $pdo->prepare("SELECT * FROM field_operations WHERE id=? AND user_id=?");
                $st->execute([$opId, $userId]);
                $row  = $st->fetch(PDO::FETCH_ASSOC);
                if (!$row) { $resp['message'] = 'Não encontrado.'; echo json_encode($resp); exit; }
                $resp['success'] = true; $resp['operation'] = $row;
                break;
            }

            // ── Apagar ────────────────────────────────────────────────────────
            case 'delete_operation': {
                $opId = intval($_POST['id'] ?? 0);
                $st   = $pdo->prepare("DELETE FROM field_operations WHERE id=? AND user_id=?");
                $st->execute([$opId, $userId]);
                $resp['success'] = $st->rowCount() > 0;
                $resp['message'] = $resp['success'] ? 'Apagado.' : 'Não encontrado.';
                break;
            }

            // ── Mudar estado ──────────────────────────────────────────────────
            case 'update_op_status': {
                $opId   = intval($_POST['id']     ?? 0);
                $status = trim($_POST['status']   ?? '');
                if (!in_array($status, ['planned','in_progress','done','cancelled'], true)) {
                    $resp['message'] = 'Status inválido.'; echo json_encode($resp); exit;
                }
                $completed = $status === 'done' ? date('Y-m-d') : null;
                $st = $pdo->prepare("UPDATE field_operations SET status=?,completed_date=? WHERE id=? AND user_id=?");
                $st->execute([$status, $completed, $opId, $userId]);
                $resp['success'] = true; $resp['message'] = 'Estado actualizado.';
                break;
            }

            // ── Terrenos ──────────────────────────────────────────────────────
            case 'get_ops_terrains': {
                $st = $pdo->prepare("SELECT id,name,area,coordinates FROM terrains
                    WHERE user_id=? ORDER BY name ASC");
                $st->execute([$userId]);
                $resp['success']  = true;
                $resp['terrains'] = $st->fetchAll(PDO::FETCH_ASSOC);
                break;
            }

            // ── Prescrições do terreno ────────────────────────────────────────
            case 'get_ops_prescriptions': {
                $tid = intval($_POST['terrain_id'] ?? 0);
                try {
                    $st = $pdo->prepare("SELECT id,name,created_at FROM prescription_results
                        WHERE terrain_id=? AND user_id=? AND status='done' ORDER BY created_at DESC");
                    $st->execute([$tid, $userId]);
                    $resp['prescriptions'] = $st->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $e) {
                    $resp['prescriptions'] = []; // tabela pode não existir ainda
                }
                $resp['success'] = true;
                break;
            }

            default:
                http_response_code(400); $resp['message'] = 'Acção desconhecida.';
        }
    } catch (Throwable $e) {
        http_response_code(500);
        $resp['message'] = 'Erro interno: ' . $e->getMessage();
    }
    echo json_encode($resp);
    exit;
}

// ── HTML ──────────────────────────────────────────────────────────────────────
if (!$isLoggedIn): ?>
<div style="padding:60px 20px;text-align:center;">
    <p style="color:#6b7280;font-size:16px;">
        Precisa de fazer <a href="login.php" style="color:#667eea;font-weight:600;">login</a>
        para planear operações de campo.
    </p>
</div>
<?php return; endif; ?>

<style>
/* ── Operações: layout ── */
.ops-lbl {
    display:block; font-size:11px; font-weight:600; color:#6b7280;
    margin-bottom:3px; text-transform:uppercase; letter-spacing:.3px;
}
.ops-inp {
    width:100%; padding:6px 8px; border:1px solid #e5e7eb; border-radius:6px;
    font-size:12px; box-sizing:border-box; background:#fff; color:#1f2937;
}
.ops-inp:focus { outline:none; border-color:#667eea; }

/* Filtros de estado */
.ops-filter-btn {
    padding:3px 9px; border:1px solid #e5e7eb; border-radius:12px;
    font-size:10px; font-weight:600; cursor:pointer; background:#fff; color:#6b7280;
    transition:all .15s; white-space:nowrap;
}
.ops-filter-btn:hover { background:#f3f4f6; }
.ops-filter-btn.ops-filter-active { background:#667eea; color:#fff; border-color:#667eea; }

/* Calendário */
.ops-cal-wrap { font-size:11px; }
.ops-cal-table { width:100%; border-collapse:collapse; }
.ops-cal-table th { font-size:9px; font-weight:700; color:#9ca3af;
                    text-align:center; padding:3px 0; }
.ops-cal-table td { text-align:center; padding:2px 1px; vertical-align:top; }
.ops-cal-day {
    display:inline-flex; flex-direction:column; align-items:center;
    width:30px; min-height:30px; border-radius:6px; cursor:pointer;
    font-size:11px; font-weight:500; color:#374151; padding:3px 2px;
    transition:background .1s; line-height:1;
}
.ops-cal-day:hover  { background:#eff6ff; }
.ops-cal-day.today  { background:#eff6ff; color:#2563eb; font-weight:700; }
.ops-cal-day.has-ops{ font-weight:700; }
.ops-cal-day.sel    { background:#667eea; color:#fff; }
.ops-cal-dots { display:flex; gap:2px; margin-top:2px; justify-content:center; flex-wrap:wrap; }
.ops-cal-dot  { width:5px; height:5px; border-radius:50%; flex-shrink:0; }

/* Painel de custos */
.ops-cost-box {
    background:#f8fafc; border-radius:7px; padding:10px 11px; margin-bottom:10px;
}
.ops-cost-total-box {
    padding:5px 7px; background:#ecfdf5; border:1px solid #a7f3d0;
    border-radius:5px; font-size:13px; font-weight:700; color:#059669;
    text-align:right;
}

/* Trajectória */
.ops-traj-box {
    background:#f8fafc; border-radius:7px; padding:10px 11px; margin-bottom:10px;
}
.ops-traj-summary {
    font-size:11px; color:#059669; font-weight:600;
    padding:5px 8px; background:#ecfdf5; border-radius:5px; margin-top:5px;
}

/* Item de operação na lista */
.ops-item {
    background:#fff; border:1px solid #f1f5f9; border-radius:8px;
    padding:9px 10px; margin-bottom:5px;
}
.ops-item-hdr {
    display:flex; align-items:center; gap:6px; margin-bottom:4px;
}
.ops-item-icon  { font-size:15px; flex-shrink:0; }
.ops-item-name  {
    font-size:12px; font-weight:600; color:#1f2937; flex:1; min-width:0;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.ops-status-badge {
    font-size:9px; font-weight:700; border-radius:10px;
    padding:2px 7px; white-space:nowrap; flex-shrink:0;
}
.ops-item-meta {
    font-size:10px; color:#9ca3af;
    display:flex; gap:8px; flex-wrap:wrap; margin-bottom:6px;
}
.ops-item-actions { display:flex; gap:4px; flex-wrap:wrap; }
.ops-item-btn {
    font-size:10px; padding:3px 7px; border:none; border-radius:5px;
    cursor:pointer; font-weight:600; transition:all .15s;
}

/* Controles do mapa */
.ops-map-bar {
    display:flex; gap:6px; align-items:center; flex-wrap:wrap;
    padding:8px 10px; background:#f8fafc; border-radius:0 0 8px 8px;
    border:2px solid #e5e7eb; border-top:none;
}
.ops-draw-btn {
    padding:4px 10px; border:none; border-radius:6px;
    font-size:11px; font-weight:600; cursor:pointer;
    transition:all .15s; opacity:1;
}
.ops-draw-btn.active { box-shadow:0 0 0 2px #fff, 0 0 0 4px currentColor; }

/* Resumo custo no topo do mapa */
#ops-season-summary {
    font-size:11px; color:#6b7280; padding:6px 10px;
    background:#f8fafc; border-radius:7px; margin-bottom:8px;
    display:flex; gap:14px; flex-wrap:wrap; align-items:center;
}
.ops-sum-chip {
    display:inline-flex; align-items:center; gap:4px;
    font-weight:600; color:#374151;
}
</style>

<div class="main-grid">

    <!-- ══ MAPA ═══════════════════════════════════════════════════════════════ -->
    <div class="map-section" style="padding:12px;">

        <!-- Resumo da época -->
        <div id="ops-season-summary" style="display:none;">
            <span style="font-weight:700;color:#374151;">Resumo:</span>
            <span class="ops-sum-chip" id="ops-sum-total">💰 0,00 €</span>
            <span class="ops-sum-chip" id="ops-sum-count">📋 0 operações</span>
            <span class="ops-sum-chip" id="ops-sum-done">✅ 0 feitas</span>
            <span class="ops-sum-chip" id="ops-sum-next">📅 Próxima: —</span>
        </div>

        <div id="ops-map" style="height:590px; border-radius:8px 8px 0 0; border:2px solid #e5e7eb; border-bottom:none;"></div>

        <!-- Barra de controlo de desenho -->
        <div class="ops-map-bar">
            <span style="font-size:11px;font-weight:700;color:#6b7280;">Trajectória:</span>
            <button class="ops-draw-btn" id="ops-btn-line"  style="background:#667eea;color:#fff;"
                    onclick="opsDrawMode('line')">✏️ Percurso</button>
            <button class="ops-draw-btn" id="ops-btn-area"  style="background:#10b981;color:#fff;"
                    onclick="opsDrawMode('area')">🔷 Área</button>
            <button class="ops-draw-btn" id="ops-btn-point" style="background:#f59e0b;color:#fff;"
                    onclick="opsDrawMode('point')">📍 Pontos</button>
            <button class="ops-draw-btn" onclick="opsClearDraw()"
                    style="background:#f3f4f6;color:#6b7280;">🗑 Limpar</button>
            <span id="ops-draw-hint" style="font-size:10px;color:#9ca3af;flex:1;"></span>
        </div>
    </div>

    <!-- ══ SIDEBAR ════════════════════════════════════════════════════════════ -->
    <div class="sidebar">

        <!-- Selector de terreno -->
        <div class="section" style="padding:14px 16px;">
            <label class="ops-lbl" style="margin-bottom:6px;">Terreno</label>
            <select id="ops-terrain-sel" onchange="opsTerrainChange(this.value)"
                    class="ops-inp" style="font-size:13px;">
                <option value="">— Selecione um terreno —</option>
            </select>
        </div>

        <!-- ── CALENDÁRIO ── -->
        <div class="layer-group">
            <div class="layer-group-hdr" onclick="opsToggleGroup('calendar')">
                <span>📅 Calendário da Época</span>
                <span id="calendar-arrow">▶</span>
            </div>
            <div id="lg-calendar" class="layer-group-body" style="display:none;padding:12px 14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <button onclick="opsCalPrev()"
                            style="border:none;background:none;font-size:16px;cursor:pointer;color:#667eea;padding:2px 5px;">◀</button>
                    <span id="ops-cal-title" style="font-size:13px;font-weight:700;color:#1f2937;"></span>
                    <button onclick="opsCalNext()"
                            style="border:none;background:none;font-size:16px;cursor:pointer;color:#667eea;padding:2px 5px;">▶</button>
                </div>
                <div class="ops-cal-wrap">
                    <div id="ops-calendar"></div>
                </div>
                <div id="ops-cal-day-ops" style="margin-top:8px;min-height:10px;"></div>
            </div>
        </div>

        <!-- ── NOVA OPERAÇÃO ── -->
        <div class="layer-group">
            <div class="layer-group-hdr" onclick="opsToggleGroup('newop')">
                <span>➕ Nova Operação</span>
                <span id="newop-arrow">▼</span>
            </div>
            <div id="lg-newop" class="layer-group-body" style="padding:12px 14px;">
                <input type="hidden" id="ops-edit-id" value="">

                <!-- Tipo -->
                <div style="margin-bottom:9px;">
                    <label class="ops-lbl">Tipo de Operação</label>
                    <select id="ops-type" class="ops-inp" onchange="opsTypeChange(this.value)">
                        <option value="pulverizacao">💦 Pulverização (tratamentos)</option>
                        <option value="fertilizacao">🌱 Fertilização</option>
                        <option value="monda">✂️ Monda / Herbicida</option>
                        <option value="colheita">🌾 Colheita</option>
                        <option value="sementeira">🌰 Sementeira</option>
                        <option value="coberto_vegetal">🍃 Gestão Coberto Vegetal</option>
                        <option value="monitorizacao">📡 Monitorização</option>
                        <option value="correccao_solo">⛏️ Correcção de Solo</option>
                        <option value="outro">📋 Outro</option>
                    </select>
                </div>

                <!-- Nome -->
                <div style="margin-bottom:9px;">
                    <label class="ops-lbl">Nome *</label>
                    <input type="text" id="ops-name" class="ops-inp"
                           placeholder="Ex: Herbicida pré-emergência">
                </div>

                <!-- Data + Época -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:9px;">
                    <div>
                        <label class="ops-lbl">Data prevista</label>
                        <input type="date" id="ops-date" class="ops-inp">
                    </div>
                    <div>
                        <label class="ops-lbl">Época / Campanha</label>
                        <input type="text" id="ops-season" class="ops-inp" placeholder="2025/2026">
                    </div>
                </div>

                <!-- Estado -->
                <div style="margin-bottom:9px;">
                    <label class="ops-lbl">Estado</label>
                    <select id="ops-status" class="ops-inp">
                        <option value="planned">🔵 Planeada</option>
                        <option value="in_progress">🟡 Em progresso</option>
                        <option value="done">🟢 Concluída</option>
                        <option value="cancelled">⚫ Cancelada</option>
                    </select>
                </div>

                <!-- Prescrição base -->
                <div style="margin-bottom:9px;">
                    <label class="ops-lbl">Prescrição base <span style="font-weight:400;color:#9ca3af;">(opcional)</span></label>
                    <select id="ops-prescription" class="ops-inp">
                        <option value="">— Sem prescrição associada —</option>
                    </select>
                </div>

                <!-- Área e Custos -->
                <div class="ops-cost-box">
                    <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px;">Área &amp; Custos</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px;">
                        <div>
                            <label class="ops-lbl">Área (ha)</label>
                            <input type="number" id="ops-area" class="ops-inp"
                                   min="0" step="0.01" placeholder="auto" oninput="opsCalcCost()">
                        </div>
                        <div>
                            <label class="ops-lbl">€ / ha</label>
                            <input type="number" id="ops-cost-ha" class="ops-inp"
                                   min="0" step="0.01" value="0" oninput="opsCalcCost()">
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;align-items:end;">
                        <div>
                            <label class="ops-lbl">Custo fixo (€)</label>
                            <input type="number" id="ops-cost-fixed" class="ops-inp"
                                   min="0" step="0.01" value="0" oninput="opsCalcCost()">
                        </div>
                        <div>
                            <label class="ops-lbl" style="color:#059669;font-weight:700;">Total</label>
                            <div id="ops-cost-total" class="ops-cost-total-box">0,00 €</div>
                        </div>
                    </div>
                </div>

                <!-- Trajectória -->
                <div class="ops-traj-box">
                    <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Trajectória no mapa</div>
                    <div id="ops-traj-info" style="font-size:11px;color:#9ca3af;line-height:1.5;">
                        Use os botões <strong>✏️ Percurso</strong>, <strong>🔷 Área</strong>
                        ou <strong>📍 Pontos</strong> abaixo do mapa para definir o trajecto.
                    </div>
                    <div id="ops-traj-summary" class="ops-traj-summary" style="display:none;"></div>
                </div>

                <!-- Notas -->
                <div style="margin-bottom:11px;">
                    <label class="ops-lbl">Notas / Observações</label>
                    <textarea id="ops-notes" class="ops-inp" rows="2"
                              placeholder="Produto, dose, condições meteorológicas…"
                              style="resize:vertical;"></textarea>
                </div>

                <!-- Botões -->
                <div style="display:flex;gap:7px;">
                    <button onclick="opsSave()" id="ops-save-btn"
                            style="flex:1;padding:8px 0;background:linear-gradient(135deg,#667eea,#764ba2);
                                   color:#fff;border:none;border-radius:7px;font-size:12px;
                                   font-weight:600;cursor:pointer;">
                        💾 Guardar
                    </button>
                    <button onclick="opsFormReset()"
                            style="padding:8px 12px;background:#f3f4f6;color:#6b7280;
                                   border:none;border-radius:7px;font-size:12px;cursor:pointer;">
                        ✖ Limpar
                    </button>
                </div>
                <div id="ops-form-status" style="display:none;margin-top:8px;font-size:11px;
                     border-radius:5px;padding:7px 9px;"></div>
            </div>
        </div>

        <!-- ── LISTA DE OPERAÇÕES ── -->
        <div class="layer-group">
            <div class="layer-group-hdr" onclick="opsToggleGroup('oplist')">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span>📋 Operações</span>
                    <span id="ops-list-badge" class="layer-badge">0</span>
                </div>
                <span id="oplist-arrow">▶</span>
            </div>
            <div id="lg-oplist" class="layer-group-body" style="display:none;padding:10px 12px;">
                <!-- Filtros -->
                <div style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;">
                    <button class="ops-filter-btn ops-filter-active" onclick="opsFilter(this,'')">Todas</button>
                    <button class="ops-filter-btn" onclick="opsFilter(this,'planned')">🔵 Planeadas</button>
                    <button class="ops-filter-btn" onclick="opsFilter(this,'in_progress')">🟡 Progresso</button>
                    <button class="ops-filter-btn" onclick="opsFilter(this,'done')">🟢 Feitas</button>
                    <button class="ops-filter-btn" onclick="opsFilter(this,'cancelled')">⚫ Canceladas</button>
                </div>
                <div id="ops-list" class="layer-items">
                    <div class="layer-empty">Selecione um terreno.</div>
                </div>
            </div>
        </div>

    </div><!-- /sidebar -->
</div><!-- /main-grid -->

<script>
// Inicializar mapa de operações após DOM pronto
document.addEventListener('DOMContentLoaded', function () {
    // Mapa
    opsMap = L.map('ops-map', { center: [41.15, -8.61], zoom: 13 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(opsMap);

    // FeatureGroup para formas desenhadas
    opsDrawnItems = new L.FeatureGroup().addTo(opsMap);

    // Controlos Leaflet.Draw
    opsDrawControl = new L.Control.Draw({
        draw: {
            polyline:    { shapeOptions: { color: '#667eea', weight: 3 }, showLength: true },
            polygon:     { shapeOptions: { color: '#10b981', weight: 2, fillOpacity: 0.15 }, showArea: true },
            marker:      {},
            rectangle:   false,
            circle:      false,
            circlemarker:false,
        },
        edit: { featureGroup: opsDrawnItems, remove: true },
    });
    opsMap.addControl(opsDrawControl);

    opsMap.on(L.Draw.Event.CREATED, _opsOnDrawCreated);
    opsMap.on(L.Draw.Event.DELETED, function () {
        opsCurrentTrajectory = null;
        opsCurrentTrajType   = 'line';
        _opsUpdateTrajSummary();
    });

    // Carregar terrenos
    _opsLoadTerrains();

    // Calendário: mês actual
    opsCalYear  = new Date().getFullYear();
    opsCalMonth = new Date().getMonth() + 1;
    _opsRenderCalendar();

    // Defaults de formulário
    const now = new Date();
    document.getElementById('ops-date').value = now.toISOString().slice(0, 10);
    const y = now.getFullYear(), m = now.getMonth();
    document.getElementById('ops-season').value = m >= 8 ? y + '/' + (y + 1) : (y - 1) + '/' + y;
});
</script>
