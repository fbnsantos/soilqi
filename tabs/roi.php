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

// ── Idioma (PT/EN) ───────────────────────────────────────────────────────────
// Prioridade: ?lang= → cookie soilqi_lang (definido pelo JS) → Accept-Language
if (!defined('ROI_LANG')) {
    $roiLang = $_GET['lang'] ?? ($_COOKIE['soilqi_lang'] ?? '');
    if (!in_array($roiLang, ['pt', 'en'], true)) {
        $al = strtolower($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
        $roiLang = (strpos($al, 'en') === 0 || (strpos($al, 'en') !== false && strpos($al, 'pt') === false)) ? 'en' : 'pt';
    }
    define('ROI_LANG', $roiLang);
}
/** Texto bilingue: devolve PT ou EN conforme o idioma activo. */
function roiL(string $pt, string $en): string { return ROI_LANG === 'en' ? $en : $pt; }

// ── Helpers de formulário ────────────────────────────────────────────────────
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
        <label class="roi-f roi-f-wide"><span class="roi-f-l"><?= roiL('Equipamento / solução', 'Equipment / solution') ?></span>
            <input type="text" data-k="<?= $p ?>.name" class="roi-in"></label>
        <label class="roi-f roi-f-wide"><span class="roi-f-l"><?= roiL('Modelo de aquisição', 'Acquisition model') ?></span>
            <select data-k="<?= $p ?>.mode" class="roi-in">
                <option value="own"><?= roiL('Compra (propriedade)', 'Purchase (ownership)') ?></option>
                <option value="service"><?= roiL('Serviço contratado / RaaS (€/ha)', 'Contracted service / RaaS (€/ha)') ?></option>
            </select></label>

        <div class="roi-sub roi-own-only"><?= roiL('Investimento', 'Investment') ?></div>
        <div class="roi-grid roi-own-only">
            <?= roiField("$p.investment", roiL('Investimento I₀', 'Investment I₀'), '€') ?>
            <?= roiField("$p.alloc_pct", roiL('Imputação a esta operação', 'Share allocated to this operation'), '%',
                roiL('Percentagem do custo de capital imputada a esta operação (ex.: o tractor também faz outras tarefas).',
                     'Share of the capital cost allocated to this operation (e.g. the tractor also performs other tasks).')) ?>
            <?= roiField("$p.residual", roiL('Valor residual ano final', 'Residual value, final year'), '€') ?>
            <?= roiField("$p.useful_life", roiL('Vida útil', 'Useful life'), roiL('anos', 'years')) ?>
            <?= roiField("$p.replacement_cost", roiL('Substituição Rₜ', 'Replacement Rₜ'), '€',
                roiL('Ex.: baterias ou componentes do implemento.', 'E.g. batteries or implement components.')) ?>
            <?= roiField("$p.replacement_year", roiL('Ano da substituição', 'Replacement year'), roiL('ano', 'year'),
                roiL('Ano (1–horizonte) em que ocorre a substituição. 0 = nenhuma.', 'Year (1–horizon) of the replacement. 0 = none.'), '1') ?>
        </div>

        <div class="roi-sub roi-svc-only"><?= roiL('Serviço contratado', 'Contracted service') ?></div>
        <div class="roi-grid roi-svc-only">
            <?= roiField("$p.service_fee", roiL('Tarifa de serviço', 'Service fee'), '€/ha·op',
                roiL('Preço por hectare e por operação (inclui máquina, energia e manutenção).',
                     'Price per hectare and per operation (includes machine, energy and maintenance).')) ?>
            <?= roiField("$p.service_fixed", roiL('Taxa fixa anual', 'Fixed annual fee'), roiL('€/ano', '€/year')) ?>
        </div>

        <div class="roi-sub"><?= roiL('Operação', 'Operation') ?></div>
        <div class="roi-grid">
            <?= roiField("$p.capacity", roiL('Capacidade efectiva P', 'Effective capacity P'), 'ha/h',
                roiL('Inclui viragens, carregamento, reabastecimento e paragens.', 'Includes turning, charging, refilling and downtime.')) ?>
            <?= roiField("$p.hours_per_day", roiL('Horas úteis por dia', 'Working hours per day'), roiL('h/dia', 'h/day'),
                roiL('Usado com a janela operacional para verificar se uma unidade chega.',
                     'Used with the operational window to check whether one unit is enough.')) ?>
            <label class="roi-f"><span class="roi-f-l"><?= roiL('Fonte de energia', 'Energy source') ?></span>
                <select data-k="<?= $p ?>.energy_type" class="roi-in">
                    <option value="diesel"><?= roiL('Gasóleo (L)', 'Diesel (L)') ?></option>
                    <option value="electric"><?= roiL('Electricidade (kWh)', 'Electricity (kWh)') ?></option>
                    <option value="petrol"><?= roiL('Gasolina (L)', 'Petrol (L)') ?></option>
                </select></label>
            <?= roiField("$p.consumption", roiL('Consumo EC', 'Consumption EC'), '<span class="roi-eu"></span>/h') ?>
            <?= roiField("$p.energy_price", roiL('Preço energia', 'Energy price'), '€/<span class="roi-eu"></span>') ?>
            <?= roiField("$p.ef", roiL('Factor emissão EF', 'Emission factor EF'), 'kgCO₂e/<span class="roi-eu"></span>',
                roiL('Gasóleo 2,68 kg CO₂/L; electricidade 0,20 kg CO₂e/kWh (valores ilustrativos do guia).',
                     'Diesel 2.68 kg CO₂/L; electricity 0.20 kg CO₂e/kWh (illustrative values from the guide).')) ?>
        </div>

        <div class="roi-sub"><?= roiL('Mão-de-obra e custos anuais', 'Labour and annual costs') ?></div>
        <div class="roi-grid">
            <?= roiField("$p.labour_ratio", roiL('Mão-de-obra / supervisão', 'Labour / supervision'), roiL('h op./h máq.', 'op. h/machine h'),
                roiL('Horas de operador por hora de máquina. Tractor ≈ 1,0; robô com supervisão ≈ 0,1–0,3.',
                     'Operator hours per machine hour. Tractor ≈ 1.0; supervised robot ≈ 0.1–0.3.')) ?>
            <?= roiField("$p.labour_cost", roiL('Custo mão-de-obra', 'Labour cost'), '€/h') ?>
            <?= roiField("$p.maintenance", roiL('Manutenção', 'Maintenance'), roiL('€/ano', '€/year')) ?>
            <?= roiField("$p.other", roiL('Outros (seguro, transporte…)', 'Other (insurance, transport…)'), roiL('€/ano', '€/year')) ?>
            <?= roiField("$p.input_cost", roiL('Consumíveis úteis', 'Useful inputs'), '€/ha·op',
                roiL('Custo do produto efectivamente necessário por ha (pólen, fitofármaco, adubo…).',
                     'Cost of the input actually required per ha (pollen, pesticide, fertiliser…).')) ?>
            <?= roiField("$p.input_waste", roiL('Desperdício de consumíveis', 'Input waste'), '%',
                roiL('Custo real = consumíveis / (1 − desperdício). Cf. Pinheiro et al. (2026).',
                     'Actual cost = inputs / (1 − waste). Cf. Pinheiro et al. (2026).')) ?>
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
.roi-lang{display:inline-flex;border:1px solid #d1d5db;border-radius:8px;overflow:hidden}
.roi-lang a{padding:5px 11px;font-size:12px;font-weight:700;color:#4b5563;text-decoration:none;background:#fff}
.roi-lang a.on{background:#4f46e5;color:#fff}
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
.roi-help{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-left:4px;border-radius:50%;background:#e0e7ff;color:#4338ca;font-size:10px;font-weight:700;font-style:normal;line-height:1;cursor:help;vertical-align:1px;user-select:none}
.roi-help:hover,.roi-help:focus{background:#4338ca;color:#fff;outline:none}
.roi-tip{position:fixed;z-index:10000;max-width:300px;padding:8px 10px;border-radius:8px;background:#1f2937;color:#f9fafb;font-size:12px;line-height:1.4;box-shadow:0 6px 20px rgba(0,0,0,.25);pointer-events:none}
@media print{.roi-help,.roi-tip{display:none!important}}
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
/* Apresentação / Presentation */
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

<script>window.ROI_LANG = <?= json_encode(ROI_LANG) ?>;</script>

<div class="roi-wrap" id="roi-app" lang="<?= ROI_LANG ?>">
    <div class="roi-top">
        <div>
            <h2>💶 <?= roiL('Calculadora ROI — Robô vs. Máquina Convencional', 'ROI Calculator — Robot vs. Conventional Machinery') ?></h2>
            <p><?= roiL('TCO descontado, break-even, sensibilidade e emissões operacionais. Metodologia: guia prático FCUP 2026/27 e Pinheiro et al. (2026), <i>Agricultural Systems</i> 231, 104541.',
                        'Discounted TCO, break-even, sensitivity and operational emissions. Method: FCUP 2026/27 practical assignment guide and Pinheiro et al. (2026), <i>Agricultural Systems</i> 231, 104541.') ?></p>
        </div>
        <div class="roi-lang roi-noprint" title="<?= roiL('Idioma', 'Language') ?>">
            <a href="?tab=roi&amp;lang=pt" class="<?= ROI_LANG === 'pt' ? 'on' : '' ?>">PT</a>
            <a href="?tab=roi&amp;lang=en" class="<?= ROI_LANG === 'en' ? 'on' : '' ?>">EN</a>
        </div>
    </div>

    <div class="roi-tabs roi-noprint">
        <button class="roi-tab on" data-sec="calc">🧮 <?= roiL('Calculadora', 'Calculator') ?></button>
        <button class="roi-tab" data-sec="sens">📈 <?= roiL('Break-even &amp; Sensibilidade', 'Break-even &amp; Sensitivity') ?></button>
        <button class="roi-tab" data-sec="saved">💾 <?= roiL('Simulações guardadas', 'Saved simulations') ?> <span id="roi-saved-count" class="roi-pill n">0</span></button>
        <button class="roi-tab" data-sec="pres">🎞️ <?= roiL('Apresentação', 'Presentation') ?></button>
    </div>

    <!-- Barra de simulação / Simulation bar -->
    <div class="roi-bar roi-noprint">
        <input type="text" id="roi-name" placeholder="<?= roiL('Nome da simulação', 'Simulation name') ?>" style="flex:1;min-width:180px">
        <input type="text" id="roi-group" placeholder="<?= roiL('Grupo / projecto (opcional)', 'Group / project (optional)') ?>" style="width:190px">
        <span id="roi-status" style="font-size:11px;color:#6b7280"></span>
        <select id="roi-preset" class="roi-btn" title="<?= roiL('Carregar exemplo', 'Load example') ?>">
            <option value="">📂 <?= roiL('Exemplos…', 'Examples…') ?></option>
            <option value="vineyard"><?= roiL('Gestão de vegetação em vinha', 'Vineyard vegetation management') ?></option>
            <option value="spraying"><?= roiL('Pulverização em pomar', 'Orchard spraying') ?></option>
            <option value="kiwi"><?= roiL('Polinização de kiwi (Pinheiro et al., 2026)', 'Kiwifruit pollination (Pinheiro et al., 2026)') ?></option>
        </select>
        <button class="roi-btn" id="roi-new">＋ <?= roiL('Nova', 'New') ?></button>
        <button class="roi-btn" id="roi-saveas">⧉ <?= roiL('Guardar cópia', 'Save copy') ?></button>
        <button class="roi-btn pri" id="roi-save">💾 <?= roiL('Guardar', 'Save') ?></button>
    </div>

    <!-- ── Calculadora / Calculator ── -->
    <section data-sec="calc">
        <div class="roi-cols">
            <div class="roi-card roi-inputs" id="roi-form">
                <h3>1 · <?= roiL('Cenário e pressupostos', 'Scenario and assumptions') ?></h3>
                <div class="roi-grid">
                    <label class="roi-f"><span class="roi-f-l"><?= roiL('Cultura', 'Crop') ?></span><input type="text" data-k="scenario.crop" class="roi-in"></label>
                    <label class="roi-f"><span class="roi-f-l"><?= roiL('Operação', 'Operation') ?></span><input type="text" data-k="scenario.operation" class="roi-in"></label>
                    <?= roiField('scenario.area', roiL('Área A', 'Area A'), 'ha') ?>
                    <?= roiField('scenario.ops_per_year', roiL('Operações por ano N', 'Operations per year N'), roiL('nº', 'no.')) ?>
                    <label class="roi-f"><span class="roi-f-l"><?= roiL('Unidade funcional', 'Functional unit') ?></span><input type="text" data-k="scenario.func_unit" class="roi-in" placeholder="<?= roiL('ha tratado', 'ha treated') ?>"></label>
                    <?= roiField('scenario.window_days', roiL('Janela operacional', 'Operational window'), roiL('dias/op.', 'days/op.'),
                        roiL('Dias disponíveis para cada operação (0 = sem restrição). Ex.: polinização de kiwi = 7 dias.',
                             'Days available for each operation (0 = no constraint). E.g. kiwifruit pollination = 7 days.')) ?>
                    <?= roiField('scenario.discount_rate', roiL('Taxa de desconto r', 'Discount rate r'), '%') ?>
                    <?= roiField('scenario.horizon', roiL('Horizonte', 'Horizon'), roiL('anos', 'years'), '', '1') ?>
                    <?= roiField('robot.extra_benefit', roiL('Benefício adicional do robô', 'Additional robot benefit'), roiL('€/ano', '€/year'),
                        roiL('Ganhos não incluídos nos custos (produtividade, qualidade, menor compactação…). Entra no VAL/ROI, não no TCO.',
                             'Gains not captured in costs (yield, quality, less compaction…). Included in NPV/ROI, not in TCO.')) ?>
                    <label class="roi-f" title="<?= roiL('Se a janela operacional não chegar, multiplica o nº de unidades (investimento, manutenção, residual).', 'If the operational window is too short, multiplies the number of units (investment, maintenance, residual).') ?>"><span class="roi-f-l"><?= roiL('Escalar nº de unidades', 'Scale number of units') ?></span>
                        <select data-k="scenario.scale_units" class="roi-in"><option value="1"><?= roiL('Sim', 'Yes') ?></option><option value="0"><?= roiL('Não', 'No') ?></option></select></label>
                    <label class="roi-f roi-f-wide"><span class="roi-f-l"><?= roiL('Fontes e pressupostos (indique dados medidos vs. estimados)', 'Sources and assumptions (flag measured vs. estimated data)') ?></span>
                        <textarea data-k="scenario.sources" class="roi-in" rows="3"></textarea></label>
                </div>

                <h3 style="margin-top:14px">2 · <?= roiL('Alternativas', 'Alternatives') ?></h3>
                <?= roiOptionBlock('conv',  '🚜 ' . roiL('Convencional', 'Conventional'), '#b45309') ?>
                <?= roiOptionBlock('robot', '🤖 ' . roiL('Robô', 'Robot'), '#4f46e5') ?>
            </div>

            <div>
                <div id="roi-verdict" class="roi-verdict mid">—</div>
                <div id="roi-warns"></div>
                <div class="roi-kpis" id="roi-kpis"></div>

                <div class="roi-card">
                    <div class="roi-card-h"><h3><?= roiL('Comparação técnica e económica (ano típico)', 'Technical and economic comparison (typical year)') ?></h3></div>
                    <div class="roi-scroll"><table class="roi-t" id="roi-table"></table></div>
                </div>

                <div class="roi-charts">
                    <div class="roi-card">
                        <div class="roi-card-h"><h3><?= roiL('Custo anual por componente', 'Annual cost by component') ?></h3><button class="roi-dl" data-chart="breakdown">⬇ PNG</button></div>
                        <div class="roi-chart-box"><canvas id="roi-ch-breakdown"></canvas></div>
                    </div>
                    <div class="roi-card">
                        <div class="roi-card-h"><h3><?= roiL('Custo acumulado descontado (TCO)', 'Cumulative discounted cost (TCO)') ?></h3><button class="roi-dl" data-chart="cumulative">⬇ PNG</button></div>
                        <div class="roi-chart-box"><canvas id="roi-ch-cumulative"></canvas></div>
                    </div>
                    <div class="roi-card">
                        <div class="roi-card-h"><h3><?= roiL('Emissões operacionais', 'Operational emissions') ?></h3><button class="roi-dl" data-chart="emissions">⬇ PNG</button></div>
                        <div class="roi-chart-box"><canvas id="roi-ch-emissions"></canvas></div>
                    </div>
                    <div class="roi-card">
                        <div class="roi-card-h"><h3><?= roiL('Fluxo incremental (robô − conv.)', 'Incremental cash flow (robot − conv.)') ?></h3><button class="roi-dl" data-chart="cashflow">⬇ PNG</button></div>
                        <div class="roi-chart-box"><canvas id="roi-ch-cashflow"></canvas></div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- ── Break-even & Sensibilidade / Sensitivity ── -->
    <section data-sec="sens" style="display:none">
        <div class="roi-kpis" id="roi-be-kpis"></div>
        <div class="roi-charts">
            <div class="roi-card">
                <div class="roi-card-h"><h3><?= roiL('Custo por unidade funcional vs. área', 'Cost per functional unit vs. area') ?></h3><button class="roi-dl" data-chart="area">⬇ PNG</button></div>
                <div class="roi-chart-box" style="height:320px"><canvas id="roi-ch-area"></canvas></div>
                <p style="font-size:11px;color:#6b7280;margin:6px 0 0"><?= roiL('TCO descontado ÷ trabalho descontado (€/ha·op), como nas curvas de Pinheiro et al. (2026). O cruzamento é o break-even A*.',
                    'Discounted TCO ÷ discounted work (€/ha·op), as in the curves of Pinheiro et al. (2026). The crossing point is the break-even A*.') ?></p>
            </div>
            <div class="roi-card">
                <div class="roi-card-h"><h3><?= roiL('Sensibilidade — Δ VAL da adopção do robô', 'Sensitivity — Δ NPV of robot adoption') ?></h3><button class="roi-dl" data-chart="tornado">⬇ PNG</button></div>
                <div class="roi-chart-box" style="height:320px"><canvas id="roi-ch-tornado"></canvas></div>
                <p style="font-size:11px;color:#6b7280;margin:6px 0 0"><?= roiL('VAL = TCO<sub>conv</sub> − TCO<sub>robô</sub> + benefícios descontados. Positivo favorece o robô.',
                    'NPV = TCO<sub>conv</sub> − TCO<sub>robot</sub> + discounted benefits. Positive favours the robot.') ?></p>
            </div>
        </div>
        <div class="roi-card">
            <div class="roi-card-h"><h3><?= roiL('Cenários de sensibilidade', 'Sensitivity scenarios') ?></h3>
                <span style="font-size:11px;color:#6b7280"><?= roiL('Variação do tornado', 'Tornado variation') ?>: <input type="number" id="roi-sens-pct" value="20" style="width:52px;padding:2px 4px"> %</span></div>
            <div class="roi-scroll"><table class="roi-t" id="roi-sens-table"></table></div>
        </div>
    </section>

    <!-- ── Simulações guardadas / Saved simulations ── -->
    <section data-sec="saved" style="display:none">
        <div class="roi-bar">
            <input type="text" id="roi-filter" placeholder="<?= roiL('Filtrar por nome ou grupo…', 'Filter by name or group…') ?>" style="flex:1;min-width:160px">
            <button class="roi-btn" id="roi-sel-all">☑ <?= roiL('Seleccionar todas', 'Select all') ?></button>
            <button class="roi-btn" id="roi-exp-csv">⬇ <?= roiL('CSV (macro-dados)', 'CSV (key indicators)') ?></button>
            <button class="roi-btn" id="roi-exp-json">⬇ <?= roiL('JSON completo', 'Full JSON') ?></button>
            <button class="roi-btn pri" id="roi-cmp-pres">🎞️ <?= roiL('Comparar na apresentação', 'Compare in presentation') ?></button>
        </div>
        <div class="roi-card">
            <div class="roi-scroll"><table class="roi-t" id="roi-saved-table"></table></div>
        </div>
        <div class="roi-card" id="roi-cmp-card" style="display:none">
            <div class="roi-card-h"><h3><?= roiL('Comparação de simulações seleccionadas', 'Comparison of selected simulations') ?></h3><button class="roi-dl" data-chart="compare">⬇ PNG</button></div>
            <div class="roi-chart-box" style="height:300px"><canvas id="roi-ch-compare"></canvas></div>
        </div>
    </section>

    <!-- ── Apresentação / Presentation ── -->
    <section data-sec="pres" style="display:none">
        <div class="roi-bar roi-noprint">
            <span style="font-size:12px;color:#4b5563"><?= roiL('4 diapositivos (estrutura do guia: Tarefa &amp; Robô · Técnico &amp; Económico · Ambiental · Recomendação). Use <b>Imprimir / PDF</b> em formato paisagem.',
                '4 slides (guide structure: Task &amp; Robot · Technical &amp; Economic · Environmental · Recommendation). Use <b>Print / PDF</b> in landscape.') ?></span>
            <span style="flex:1"></span>
            <button class="roi-btn" id="roi-pres-md">⬇ <?= roiL('Resumo (Markdown)', 'Summary (Markdown)') ?></button>
            <button class="roi-btn pri" id="roi-pres-print-btn">🖨️ <?= roiL('Imprimir / PDF', 'Print / PDF') ?></button>
        </div>
        <label class="roi-f roi-noprint" style="margin-bottom:10px"><span class="roi-f-l"><?= roiL('Recomendação final (texto livre, aparece no diapositivo 4)', 'Final recommendation (free text, shown on slide 4)') ?></span>
            <textarea id="roi-reco" rows="3" placeholder="<?= roiL('Ex.: Recomenda-se a adopção a partir de X ha, ou via RaaS…', 'E.g. Adoption is recommended above X ha, or via RaaS…') ?>"></textarea></label>
        <div id="roi-pres-print" class="roi-slides"></div>
    </section>
</div>
