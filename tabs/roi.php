<?php
/**
 * tabs/roi.php — Calculadora de Benefício e Retorno de Investimento
 * Robô agrícola vs. máquina convencional (TCO a 10 anos, break-even,
 * sensibilidade e emissões operacionais).
 *
 * Metodologia:
 *  - Guia "Agricultural Robotics vs. Conventional Machinery" (FCUP 2026/27):
 *      H = A·N/P ; Cop = Cenergia + Cmão-de-obra + Cmanutenção + Coutros ;
 *      Cunit = Cop/Q ; TCO = I0 + Σ (Cop,t + Rt)/(1+r)^t − Vr/(1+r)^10 ;
 *      E = H·EC·EF ; TCOrobô(x*) = TCOconv(x*)
 *  - Pinheiro et al. (2026) Agricultural Systems 231, 104541:
 *      custo por ha·aplicação vs. área, área mínima, valor máximo do robô,
 *      janela operacional, desperdício de consumíveis, modelo de serviço (RaaS).
 *
 * Os cálculos são feitos no cliente (assets/js/tabs/roi.js); o servidor
 * guarda os inputs e os macro-indicadores de cada simulação.
 */

if (!isset($isLoggedIn))  $isLoggedIn  = false;
if (!isset($currentUser)) $currentUser = null;

function _roi_init_table(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS roi_simulations (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT NOT NULL,
        name        VARCHAR(160) NOT NULL,
        group_label VARCHAR(120) NULL,
        notes       TEXT NULL,
        inputs      LONGTEXT NOT NULL,
        results     LONGTEXT NOT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_roi_user (user_id),
        INDEX idx_roi_group (user_id, group_label)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// ── AJAX ──────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    header('Content-Type: application/json');
    $resp   = ['success' => false, 'message' => ''];
    $userId = (int)($currentUser['id'] ?? ($_SESSION['user_id'] ?? 0));

    if (!$isLoggedIn || !$userId) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Autenticação necessária.']);
        exit;
    }

    try {
        $pdo = getDBConnection();
        _roi_init_table($pdo);

        switch ($_POST['action']) {

            case 'roi_list': {
                $st = $pdo->prepare("
                    SELECT id, name, group_label, notes, results,
                           DATE_FORMAT(updated_at,'%d/%m/%Y %H:%i') AS updated_at
                    FROM roi_simulations
                    WHERE user_id = ?
                    ORDER BY updated_at DESC, id DESC
                ");
                $st->execute([$userId]);
                $rows = $st->fetchAll(PDO::FETCH_ASSOC);
                foreach ($rows as &$r) {
                    $r['id']      = (int)$r['id'];
                    $r['results'] = json_decode($r['results'], true) ?: new stdClass();
                }
                unset($r);
                $resp['success']     = true;
                $resp['simulations'] = $rows;
                break;
            }

            case 'roi_get': {
                $id = (int)($_POST['id'] ?? 0);
                $st = $pdo->prepare("SELECT id, name, group_label, notes, inputs, results
                                     FROM roi_simulations WHERE id = ? AND user_id = ? LIMIT 1");
                $st->execute([$id, $userId]);
                $row = $st->fetch(PDO::FETCH_ASSOC);
                if (!$row) { $resp['message'] = 'Simulação não encontrada.'; break; }
                $row['id']      = (int)$row['id'];
                $row['inputs']  = json_decode($row['inputs'], true);
                $row['results'] = json_decode($row['results'], true);
                $resp['success']    = true;
                $resp['simulation'] = $row;
                break;
            }

            case 'roi_save': {
                $id      = (int)($_POST['id'] ?? 0);
                $name    = trim($_POST['name'] ?? '');
                $group   = trim($_POST['group_label'] ?? '');
                $notes   = trim($_POST['notes'] ?? '');
                $inputs  = $_POST['inputs']  ?? '';
                $results = $_POST['results'] ?? '';

                if ($name === '') { $resp['message'] = 'Indique um nome para a simulação.'; break; }
                $cut = function (string $s, int $n): string {
                    return function_exists('mb_substr') ? mb_substr($s, 0, $n, 'UTF-8')
                                                        : (preg_match('/^.{0,' . $n . '}/us', $s, $m) ? $m[0] : substr($s, 0, $n));
                };
                $name  = $cut($name, 160);
                $group = $cut($group, 120);

                $inArr  = json_decode($inputs, true);
                $resArr = json_decode($results, true);
                if (!is_array($inArr) || !is_array($resArr)) {
                    $resp['message'] = 'Dados da simulação inválidos.'; break;
                }
                if (strlen($inputs) > 500000 || strlen($results) > 500000) {
                    $resp['message'] = 'Simulação demasiado grande.'; break;
                }
                $inputs  = json_encode($inArr,  JSON_UNESCAPED_UNICODE);
                $results = json_encode($resArr, JSON_UNESCAPED_UNICODE);

                if ($id > 0) {
                    $st = $pdo->prepare("UPDATE roi_simulations
                        SET name = ?, group_label = ?, notes = ?, inputs = ?, results = ?
                        WHERE id = ? AND user_id = ?");
                    $st->execute([$name, $group ?: null, $notes ?: null, $inputs, $results, $id, $userId]);
                    $chk = $pdo->prepare("SELECT 1 FROM roi_simulations WHERE id = ? AND user_id = ?");
                    $chk->execute([$id, $userId]);
                    if (!$chk->fetchColumn()) { $resp['message'] = 'Simulação não encontrada.'; break; }
                } else {
                    $st = $pdo->prepare("INSERT INTO roi_simulations
                        (user_id, name, group_label, notes, inputs, results) VALUES (?, ?, ?, ?, ?, ?)");
                    $st->execute([$userId, $name, $group ?: null, $notes ?: null, $inputs, $results]);
                    $id = (int)$pdo->lastInsertId();
                }
                $resp['success'] = true;
                $resp['id']      = $id;
                $resp['message'] = 'Simulação guardada.';
                break;
            }

            case 'roi_delete': {
                $id = (int)($_POST['id'] ?? 0);
                $st = $pdo->prepare("DELETE FROM roi_simulations WHERE id = ? AND user_id = ?");
                $st->execute([$id, $userId]);
                $resp['success'] = $st->rowCount() > 0;
                $resp['message'] = $resp['success'] ? 'Simulação eliminada.' : 'Simulação não encontrada.';
                break;
            }

            case 'roi_export': {
                // Exporta inputs + resultados das simulações indicadas (JSON)
                $ids = array_filter(array_map('intval', explode(',', $_POST['ids'] ?? '')));
                if (!$ids) { $resp['message'] = 'Nenhuma simulação seleccionada.'; break; }
                $in = implode(',', array_fill(0, count($ids), '?'));
                $st = $pdo->prepare("SELECT id, name, group_label, notes, inputs, results,
                                            created_at, updated_at
                                     FROM roi_simulations WHERE user_id = ? AND id IN ($in)
                                     ORDER BY updated_at DESC");
                $st->execute(array_merge([$userId], $ids));
                $rows = $st->fetchAll(PDO::FETCH_ASSOC);
                foreach ($rows as &$r) {
                    $r['id']      = (int)$r['id'];
                    $r['inputs']  = json_decode($r['inputs'], true);
                    $r['results'] = json_decode($r['results'], true);
                }
                unset($r);
                $resp['success']     = true;
                $resp['simulations'] = $rows;
                break;
            }

            default:
                $resp['message'] = 'Acção desconhecida.';
        }
    } catch (Exception $e) {
        $resp['message'] = 'Erro: ' . $e->getMessage();
    }

    echo json_encode($resp);
    exit;
}

// ── Helper para campos numéricos ─────────────────────────────────────────────
function roiField(string $key, string $label, string $unit = '', string $hint = '', string $step = 'any'): string
{
    $h = $hint !== '' ? ' title="' . htmlspecialchars($hint) . '"' : '';
    return '<label class="roi-f"' . $h . '><span class="roi-f-l">' . $label
         . ($unit !== '' ? ' <em>' . $unit . '</em>' : '') . '</span>'
         . '<input type="number" step="' . $step . '" data-k="' . $key . '" class="roi-in"></label>';
}
function roiOptionBlock(string $p, string $title, string $color): string
{
    ob_start(); ?>
    <div class="roi-opt" style="--oc:<?= $color ?>">
        <div class="roi-opt-h"><?= $title ?></div>
        <label class="roi-f roi-f-wide"><span class="roi-f-l">Equipamento / solução</span>
            <input type="text" data-k="<?= $p ?>.name" class="roi-in"></label>
        <label class="roi-f roi-f-wide"><span class="roi-f-l">Modelo de aquisição</span>
            <select data-k="<?= $p ?>.mode" class="roi-in">
                <option value="own">Compra (propriedade)</option>
                <option value="service">Serviço contratado / RaaS (€/ha)</option>
            </select></label>

        <div class="roi-sub roi-own-only">Investimento</div>
        <div class="roi-grid roi-own-only">
            <?= roiField("$p.investment", 'Investimento I₀', '€') ?>
            <?= roiField("$p.alloc_pct", 'Imputação a esta operação', '%', 'Percentagem do custo de capital imputada a esta operação (ex.: o tractor também faz outras tarefas).') ?>
            <?= roiField("$p.residual", 'Valor residual ano final', '€') ?>
            <?= roiField("$p.useful_life", 'Vida útil', 'anos') ?>
            <?= roiField("$p.replacement_cost", 'Substituição Rₜ', '€', 'Ex.: baterias ou componentes do implemento.') ?>
            <?= roiField("$p.replacement_year", 'Ano da substituição', 'ano', 'Ano (1–horizonte) em que ocorre a substituição. 0 = nenhuma.', '1') ?>
        </div>

        <div class="roi-sub roi-svc-only">Serviço contratado</div>
        <div class="roi-grid roi-svc-only">
            <?= roiField("$p.service_fee", 'Tarifa de serviço', '€/ha·op', 'Preço por hectare e por operação (inclui máquina, energia e manutenção).') ?>
            <?= roiField("$p.service_fixed", 'Taxa fixa anual', '€/ano') ?>
        </div>

        <div class="roi-sub">Operação</div>
        <div class="roi-grid">
            <?= roiField("$p.capacity", 'Capacidade efectiva P', 'ha/h', 'Inclui viragens, carregamento, reabastecimento e paragens.') ?>
            <?= roiField("$p.hours_per_day", 'Horas úteis por dia', 'h/dia', 'Usado com a janela operacional para verificar se uma unidade chega.') ?>
            <label class="roi-f"><span class="roi-f-l">Fonte de energia</span>
                <select data-k="<?= $p ?>.energy_type" class="roi-in">
                    <option value="diesel">Gasóleo (L)</option>
                    <option value="electric">Electricidade (kWh)</option>
                    <option value="petrol">Gasolina (L)</option>
                </select></label>
            <?= roiField("$p.consumption", 'Consumo EC', '<span class="roi-eu"></span>/h') ?>
            <?= roiField("$p.energy_price", 'Preço energia', '€/<span class="roi-eu"></span>') ?>
            <?= roiField("$p.ef", 'Factor emissão EF', 'kgCO₂e/<span class="roi-eu"></span>', 'Gasóleo 2,68 kg CO₂/L; electricidade 0,20 kg CO₂e/kWh (valores ilustrativos do guia).') ?>
        </div>

        <div class="roi-sub">Mão-de-obra e custos anuais</div>
        <div class="roi-grid">
            <?= roiField("$p.labour_ratio", 'Mão-de-obra / supervisão', 'h op./h máq.', 'Horas de operador por hora de máquina. Tractor ≈ 1,0; robô com supervisão ≈ 0,1–0,3.') ?>
            <?= roiField("$p.labour_cost", 'Custo mão-de-obra', '€/h') ?>
            <?= roiField("$p.maintenance", 'Manutenção', '€/ano') ?>
            <?= roiField("$p.other", 'Outros (seguro, transporte…)', '€/ano') ?>
            <?= roiField("$p.input_cost", 'Consumíveis úteis', '€/ha·op', 'Custo do produto efectivamente necessário por ha (pólen, fitofármaco, adubo…).') ?>
            <?= roiField("$p.input_waste", 'Desperdício de consumíveis', '%', 'Custo real = consumíveis / (1 − desperdício). Cf. Pinheiro et al. (2026).') ?>
        </div>
    </div>
    <?php return ob_get_clean();
}
?>

<style>
.roi-wrap{max-width:1500px;margin:0 auto;font-size:13px;color:#1f2937}
.roi-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}
.roi-top h2{margin:0;font-size:20px}
.roi-top p{margin:2px 0 0;color:#6b7280;font-size:12px}
.roi-tabs{display:flex;gap:4px;border-bottom:2px solid #e5e7eb;margin-bottom:14px;flex-wrap:wrap}
.roi-tab{padding:8px 14px;border:none;background:none;cursor:pointer;font-weight:600;color:#6b7280;border-bottom:3px solid transparent;margin-bottom:-2px;font-size:13px}
.roi-tab.on{color:#4f46e5;border-bottom-color:#4f46e5}
.roi-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin-bottom:12px}
.roi-bar input[type=text]{padding:6px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
.roi-btn{padding:6px 12px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;color:#374151;white-space:nowrap}
.roi-btn:hover{background:#f3f4f6}
.roi-btn.pri{background:#4f46e5;border-color:#4f46e5;color:#fff}
.roi-btn.pri:hover{background:#4338ca}
.roi-btn.dan{color:#b91c1c;border-color:#fecaca}
.roi-btn:disabled{opacity:.5;cursor:default}
.roi-cols{display:grid;grid-template-columns:minmax(380px,520px) 1fr;gap:14px;align-items:start}
@media(max-width:1100px){.roi-cols{grid-template-columns:1fr}}
.roi-card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:12px}
.roi-card h3{margin:0 0 10px;font-size:14px;color:#111827}
.roi-inputs{max-height:calc(100vh - 220px);overflow:auto;padding-right:4px}
@media(max-width:1100px){.roi-inputs{max-height:none}}
.roi-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
.roi-f{display:flex;flex-direction:column;gap:2px;font-size:11px;color:#4b5563}
.roi-f-wide{grid-column:1/-1;margin-bottom:6px}
.roi-f-l em{font-style:normal;color:#9ca3af}
.roi-f input,.roi-f select,.roi-f textarea{padding:5px 7px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit}
.roi-f input:focus,.roi-f select:focus{outline:2px solid #c7d2fe;border-color:#818cf8}
.roi-opt{border-left:4px solid var(--oc);padding:8px 0 8px 10px;margin-bottom:12px}
.roi-opt-h{font-weight:700;font-size:13px;color:var(--oc);margin-bottom:6px}
.roi-sub{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;font-weight:700;margin:10px 0 4px}
.roi-opt.svc .roi-own-only{display:none}
.roi-opt:not(.svc) .roi-svc-only{display:none}
.roi-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:8px;margin-bottom:12px}
.roi-kpi{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px}
.roi-kpi .l{font-size:11px;color:#6b7280}
.roi-kpi .v{font-size:19px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
.roi-kpi .s{font-size:11px;color:#6b7280;margin-top:2px}
.roi-kpi.good .v{color:#047857}.roi-kpi.bad .v{color:#b91c1c}
.roi-verdict{border-radius:10px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.5}
.roi-verdict.good{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46}
.roi-verdict.bad{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.roi-verdict.mid{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.roi-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:10px}
.roi-charts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:900px){.roi-charts{grid-template-columns:1fr}}
.roi-chart-box{position:relative;height:260px}
.roi-card-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.roi-card-h h3{margin:0}
.roi-dl{border:none;background:none;cursor:pointer;font-size:11px;color:#4f46e5;font-weight:600}
table.roi-t{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
table.roi-t th,table.roi-t td{padding:5px 7px;border-bottom:1px solid #f3f4f6;text-align:right;white-space:nowrap}
table.roi-t th:first-child,table.roi-t td:first-child{text-align:left;white-space:normal}
#roi-saved-table th:nth-child(2),#roi-saved-table td:nth-child(2){text-align:left;white-space:normal}
table.roi-t thead th{background:#f9fafb;color:#6b7280;font-weight:600;font-size:11px}
table.roi-t td.c{color:#b45309}table.roi-t td.r{color:#4f46e5}
.roi-pos{color:#047857;font-weight:600}.roi-neg{color:#b91c1c;font-weight:600}
.roi-scroll{overflow-x:auto}
.roi-empty{color:#9ca3af;text-align:center;padding:24px}
.roi-pill{display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:700}
.roi-pill.g{background:#d1fae5;color:#065f46}.roi-pill.b{background:#fee2e2;color:#991b1b}.roi-pill.n{background:#f3f4f6;color:#4b5563}
/* Apresentação */
.roi-slides{display:grid;gap:16px}
.roi-slide{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px 26px;aspect-ratio:16/9;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box}
.roi-slide h4{margin:0 0 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6366f1}
.roi-slide h2{margin:0 0 12px;font-size:22px;color:#111827}
.roi-slide .body{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:18px;min-height:0}
.roi-slide .body.one{grid-template-columns:1fr}
.roi-slide .big{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums}
.roi-slide ul{margin:0;padding-left:18px;line-height:1.6;font-size:13px}
.roi-slide .imgbox{display:flex;align-items:center;justify-content:center;min-height:0}
.roi-slide .imgbox img{max-width:100%;max-height:100%;object-fit:contain}
.roi-slide .foot{font-size:10px;color:#9ca3af;margin-top:8px}
@media print{
  body *{visibility:hidden}
  #roi-pres-print,#roi-pres-print *{visibility:visible}
  #roi-pres-print{position:absolute;left:0;top:0;width:100%}
  .roi-slide{page-break-after:always;border:none;aspect-ratio:auto;height:95vh}
  .roi-noprint{display:none!important}
}
</style>

<div class="roi-wrap" id="roi-app">
    <div class="roi-top">
        <div>
            <h2>💶 Calculadora ROI — Robô vs. Máquina Convencional</h2>
            <p>TCO descontado, break-even, sensibilidade e emissões operacionais. Metodologia: guia prático FCUP 2026/27 e Pinheiro et al. (2026), <i>Agricultural Systems</i> 231, 104541.</p>
        </div>
    </div>

    <div class="roi-tabs roi-noprint">
        <button class="roi-tab on" data-sec="calc">🧮 Calculadora</button>
        <button class="roi-tab" data-sec="sens">📈 Break-even &amp; Sensibilidade</button>
        <button class="roi-tab" data-sec="saved">💾 Simulações guardadas <span id="roi-saved-count" class="roi-pill n">0</span></button>
        <button class="roi-tab" data-sec="pres">🎞️ Apresentação</button>
    </div>

    <!-- Barra de simulação -->
    <div class="roi-bar roi-noprint">
        <input type="text" id="roi-name" placeholder="Nome da simulação" style="flex:1;min-width:180px">
        <input type="text" id="roi-group" placeholder="Grupo / projecto (opcional)" style="width:190px">
        <span id="roi-status" style="font-size:11px;color:#6b7280"></span>
        <select id="roi-preset" class="roi-btn" title="Carregar exemplo">
            <option value="">📂 Exemplos…</option>
            <option value="vineyard">Gestão de vegetação em vinha</option>
            <option value="spraying">Pulverização em pomar</option>
            <option value="kiwi">Polinização de kiwi (Pinheiro et al., 2026)</option>
        </select>
        <button class="roi-btn" id="roi-new">＋ Nova</button>
        <button class="roi-btn" id="roi-saveas">⧉ Guardar cópia</button>
        <button class="roi-btn pri" id="roi-save">💾 Guardar</button>
    </div>

    <!-- ── Secção Calculadora ── -->
    <section data-sec="calc">
        <div class="roi-cols">
            <div class="roi-card roi-inputs" id="roi-form">
                <h3>1 · Cenário e pressupostos</h3>
                <div class="roi-grid">
                    <label class="roi-f"><span class="roi-f-l">Cultura</span><input type="text" data-k="scenario.crop" class="roi-in"></label>
                    <label class="roi-f"><span class="roi-f-l">Operação</span><input type="text" data-k="scenario.operation" class="roi-in"></label>
                    <?= roiField('scenario.area', 'Área A', 'ha') ?>
                    <?= roiField('scenario.ops_per_year', 'Operações por ano N', 'nº') ?>
                    <label class="roi-f"><span class="roi-f-l">Unidade funcional</span><input type="text" data-k="scenario.func_unit" class="roi-in" placeholder="ha tratado"></label>
                    <?= roiField('scenario.window_days', 'Janela operacional', 'dias/op.', 'Dias disponíveis para cada operação (0 = sem restrição). Ex.: polinização de kiwi = 7 dias.') ?>
                    <?= roiField('scenario.discount_rate', 'Taxa de desconto r', '%') ?>
                    <?= roiField('scenario.horizon', 'Horizonte', 'anos', '', '1') ?>
                    <?= roiField('robot.extra_benefit', 'Benefício adicional do robô', '€/ano', 'Ganhos não incluídos nos custos (produtividade, qualidade, menor compactação…). Entra no VAL/ROI, não no TCO.') ?>
                    <label class="roi-f" title="Se a janela operacional não chegar, multiplica o nº de unidades (investimento, manutenção, residual)."><span class="roi-f-l">Escalar nº de unidades</span>
                        <select data-k="scenario.scale_units" class="roi-in"><option value="1">Sim</option><option value="0">Não</option></select></label>
                    <label class="roi-f roi-f-wide"><span class="roi-f-l">Fontes e pressupostos (indique dados medidos vs. estimados)</span>
                        <textarea data-k="scenario.sources" class="roi-in" rows="3"></textarea></label>
                </div>

                <h3 style="margin-top:14px">2 · Alternativas</h3>
                <?= roiOptionBlock('conv',  '🚜 Convencional', '#b45309') ?>
                <?= roiOptionBlock('robot', '🤖 Robô',         '#4f46e5') ?>
            </div>

            <div>
                <div id="roi-verdict" class="roi-verdict mid">—</div>
                <div id="roi-warns"></div>
                <div class="roi-kpis" id="roi-kpis"></div>

                <div class="roi-card">
                    <div class="roi-card-h"><h3>Comparação técnica e económica (ano típico)</h3></div>
                    <div class="roi-scroll"><table class="roi-t" id="roi-table"></table></div>
                </div>

                <div class="roi-charts">
                    <div class="roi-card">
                        <div class="roi-card-h"><h3>Custo anual por componente</h3><button class="roi-dl" data-chart="breakdown">⬇ PNG</button></div>
                        <div class="roi-chart-box"><canvas id="roi-ch-breakdown"></canvas></div>
                    </div>
                    <div class="roi-card">
                        <div class="roi-card-h"><h3>Custo acumulado descontado (TCO)</h3><button class="roi-dl" data-chart="cumulative">⬇ PNG</button></div>
                        <div class="roi-chart-box"><canvas id="roi-ch-cumulative"></canvas></div>
                    </div>
                    <div class="roi-card">
                        <div class="roi-card-h"><h3>Emissões operacionais</h3><button class="roi-dl" data-chart="emissions">⬇ PNG</button></div>
                        <div class="roi-chart-box"><canvas id="roi-ch-emissions"></canvas></div>
                    </div>
                    <div class="roi-card">
                        <div class="roi-card-h"><h3>Fluxo incremental (robô − conv.)</h3><button class="roi-dl" data-chart="cashflow">⬇ PNG</button></div>
                        <div class="roi-chart-box"><canvas id="roi-ch-cashflow"></canvas></div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- ── Secção Break-even & Sensibilidade ── -->
    <section data-sec="sens" style="display:none">
        <div class="roi-kpis" id="roi-be-kpis"></div>
        <div class="roi-charts">
            <div class="roi-card">
                <div class="roi-card-h"><h3>Custo por unidade funcional vs. área</h3><button class="roi-dl" data-chart="area">⬇ PNG</button></div>
                <div class="roi-chart-box" style="height:320px"><canvas id="roi-ch-area"></canvas></div>
                <p style="font-size:11px;color:#6b7280;margin:6px 0 0">TCO descontado ÷ trabalho descontado (€/ha·op), como nas curvas de Pinheiro et al. (2026). O cruzamento é o break-even A*.</p>
            </div>
            <div class="roi-card">
                <div class="roi-card-h"><h3>Sensibilidade — Δ VAL da adopção do robô</h3><button class="roi-dl" data-chart="tornado">⬇ PNG</button></div>
                <div class="roi-chart-box" style="height:320px"><canvas id="roi-ch-tornado"></canvas></div>
                <p style="font-size:11px;color:#6b7280;margin:6px 0 0">VAL = TCO<sub>conv</sub> − TCO<sub>robô</sub> + benefícios descontados. Positivo favorece o robô.</p>
            </div>
        </div>
        <div class="roi-card">
            <div class="roi-card-h"><h3>Cenários de sensibilidade</h3>
                <span style="font-size:11px;color:#6b7280">Variação personalizada: <input type="number" id="roi-sens-pct" value="20" style="width:52px;padding:2px 4px"> %</span></div>
            <div class="roi-scroll"><table class="roi-t" id="roi-sens-table"></table></div>
        </div>
    </section>

    <!-- ── Secção Simulações guardadas ── -->
    <section data-sec="saved" style="display:none">
        <div class="roi-bar">
            <input type="text" id="roi-filter" placeholder="Filtrar por nome ou grupo…" style="flex:1;min-width:160px">
            <button class="roi-btn" id="roi-sel-all">☑ Seleccionar todas</button>
            <button class="roi-btn" id="roi-exp-csv">⬇ CSV (macro-dados)</button>
            <button class="roi-btn" id="roi-exp-json">⬇ JSON completo</button>
            <button class="roi-btn pri" id="roi-cmp-pres">🎞️ Comparar na apresentação</button>
        </div>
        <div class="roi-card">
            <div class="roi-scroll"><table class="roi-t" id="roi-saved-table"></table></div>
        </div>
        <div class="roi-card" id="roi-cmp-card" style="display:none">
            <div class="roi-card-h"><h3>Comparação de simulações seleccionadas</h3><button class="roi-dl" data-chart="compare">⬇ PNG</button></div>
            <div class="roi-chart-box" style="height:300px"><canvas id="roi-ch-compare"></canvas></div>
        </div>
    </section>

    <!-- ── Secção Apresentação ── -->
    <section data-sec="pres" style="display:none">
        <div class="roi-bar roi-noprint">
            <span style="font-size:12px;color:#4b5563">4 diapositivos (estrutura do guia: Tarefa &amp; Robô · Técnico &amp; Económico · Ambiental · Recomendação). Use <b>Imprimir / PDF</b> em formato paisagem.</span>
            <span style="flex:1"></span>
            <button class="roi-btn" id="roi-pres-md">⬇ Resumo (Markdown)</button>
            <button class="roi-btn pri" id="roi-pres-print-btn">🖨️ Imprimir / PDF</button>
        </div>
        <label class="roi-f roi-noprint" style="margin-bottom:10px"><span class="roi-f-l">Recomendação final (texto livre, aparece no diapositivo 4)</span>
            <textarea id="roi-reco" rows="3" placeholder="Ex.: Recomenda-se a adopção a partir de X ha, ou via RaaS…"></textarea></label>
        <div id="roi-pres-print" class="roi-slides"></div>
    </section>
</div>
