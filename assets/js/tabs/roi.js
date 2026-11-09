'use strict';
/**
 * assets/js/tabs/roi.js — Calculadora de Benefício / ROI: Robô vs. Convencional
 * ROI / benefit calculator: agricultural robot vs. conventional machinery (PT/EN)
 *
 * Modelo / Model (FCUP 2026/27 practical assignment guide + Pinheiro et al., 2026):
 *   Q  = A·N                      trabalho anual / annual work (ha·op/year)
 *   H  = Q / P                    horas de máquina / machine hours
 *   Cop = Cenergy + Clabour + Cmaintenance + Cinputs + Cservice + Cother
 *   Cunit = Cop / Q
 *   TCO = I0 + Σt (Cop + Rt)/(1+r)^t − Vr/(1+r)^T
 *   E   = H · EC · EF
 *   Break-even A*: TCOrobot(A*) − PV(benefits) = TCOconv(A*)
 */

(function () {

const LANG = (window.ROI_LANG === 'en') ? 'en' : 'pt';
const L = (pt, en) => (LANG === 'en' ? en : pt);
const LOCALE = L('pt-PT', 'en-GB');

const ROI_URL = 'index.php?tab=roi';
const DRAFT_KEY = 'soilqi_roi_draft_v1';
const C_CONV = '#b45309', C_ROBOT = '#4f46e5', C_GOOD = '#047857', C_BAD = '#b91c1c';

// ── Valores por defeito e exemplos / Defaults and examples ───────────────────
const BASE_OPTION = {
    name: '', mode: 'own', investment: 0, alloc_pct: 100, residual: 0, useful_life: 10,
    replacement_cost: 0, replacement_year: 0, service_fee: 0, service_fixed: 0,
    capacity: 1, hours_per_day: 8, energy_type: 'diesel', consumption: 0, energy_price: 0, ef: 2.68,
    labour_ratio: 1, labour_cost: 12, maintenance: 0, other: 0, input_cost: 0, input_waste: 0,
    extra_benefit: 0,
};
const BASE_SCENARIO = {
    crop: '', operation: '', area: 10, ops_per_year: 1, func_unit: L('ha tratado', 'ha treated'), window_days: 0,
    discount_rate: 5, horizon: 10, scale_units: 1, sources: '',
};

const ILLUSTRATIVE = L(
    'VALORES ILUSTRATIVOS (estimativas para fins didácticos) — substituir por dados de fabricantes, catálogos e literatura, indicando a fonte de cada valor e se é medido ou estimado.',
    'ILLUSTRATIVE VALUES (teaching estimates) — replace with manufacturer, catalogue and literature data, stating the source of each value and whether it is measured or estimated.');

const PRESETS = {
    vineyard: {
        name: L('Vinha — gestão de vegetação (exemplo)', 'Vineyard — vegetation management (example)'),
        scenario: { crop: L('Vinha', 'Vineyard'), operation: L('Corte de vegetação na entrelinha', 'Inter-row vegetation mowing'),
            area: 20, ops_per_year: 6, func_unit: L('ha tratado', 'ha treated'), window_days: 0, discount_rate: 5, horizon: 10,
            scale_units: 1, sources: ILLUSTRATIVE },
        conv: { name: L('Tractor vinhateiro 80 cv + destroçador', 'Vineyard tractor 80 hp + mulcher'), mode: 'own', investment: 70000,
            alloc_pct: 40, residual: 25000, useful_life: 15, capacity: 1.2, hours_per_day: 8, energy_type: 'diesel',
            consumption: 7, energy_price: 1.45, ef: 2.68, labour_ratio: 1, labour_cost: 12, maintenance: 2500, other: 600 },
        robot: { name: L('Robô eléctrico autónomo de corte', 'Autonomous electric mowing robot'), mode: 'own', investment: 55000,
            alloc_pct: 100, residual: 10000, useful_life: 10, replacement_cost: 7000, replacement_year: 5,
            service_fee: 90, capacity: 0.5, hours_per_day: 16, energy_type: 'electric', consumption: 2.5,
            energy_price: 0.20, ef: 0.20, labour_ratio: 0.2, labour_cost: 14, maintenance: 1500, other: 800 },
    },
    spraying: {
        name: L('Pomar — pulverização dirigida (exemplo)', 'Orchard — targeted spraying (example)'),
        scenario: { crop: L('Macieira', 'Apple'), operation: L('Pulverização fitossanitária', 'Crop protection spraying'),
            area: 30, ops_per_year: 12, func_unit: L('ha tratado', 'ha treated'), window_days: 0, discount_rate: 5, horizon: 10,
            scale_units: 1, sources: ILLUSTRATIVE },
        conv: { name: L('Tractor + atomizador convencional', 'Tractor + conventional airblast sprayer'), mode: 'own', investment: 90000,
            alloc_pct: 50, residual: 30000, useful_life: 15, capacity: 1.5, hours_per_day: 8, energy_type: 'diesel',
            consumption: 9, energy_price: 1.45, ef: 2.68, labour_ratio: 1, labour_cost: 12,
            maintenance: 3000, other: 800, input_cost: 120, input_waste: 30 },
        robot: { name: L('Robô pulverizador com aplicação dirigida', 'Robotic sprayer with targeted application'), mode: 'own',
            investment: 120000, alloc_pct: 100, residual: 25000, useful_life: 10, replacement_cost: 10000, replacement_year: 6,
            service_fee: 60, capacity: 1.0, hours_per_day: 18, energy_type: 'electric', consumption: 6, energy_price: 0.20,
            ef: 0.20, labour_ratio: 0.25, labour_cost: 14, maintenance: 3500, other: 1000, input_cost: 120, input_waste: 10 },
    },
    kiwi: {
        name: L('Kiwi — polinização robótica (Pinheiro et al., 2026)', 'Kiwifruit — robotic pollination (Pinheiro et al., 2026)'),
        scenario: { crop: L('Kiwi (Actinidia spp.)', 'Kiwifruit (Actinidia spp.)'),
            operation: L('Polinização assistida (1 aplicação/ano)', 'Assisted pollination (1 application/year)'),
            area: 5, ops_per_year: 1, func_unit: L('ha polinizado', 'ha pollinated'), window_days: 7, discount_rate: 5, horizon: 10,
            scale_units: 1,
            sources: L(
                'Pinheiro et al. (2026), Agricultural Systems 231, 104541: benchmark convencional 685 €/ha·aplicação (custo mínimo, MaP_HD); robô RS1 = 17 146 € (dimensionado para 5 ha); capacidade 1,0 ha/h; 17 h/dia; vida útil 10 anos; electricidade 0,30 €/kWh; pólen 3 000 €/kg; desperdício de pólen do robô 5 %; janela de polinização 7 dias.\nA PREENCHER (não indicados): consumo energético do robô, custo de pólen útil por ha, manutenção e supervisão.',
                'Pinheiro et al. (2026), Agricultural Systems 231, 104541: conventional benchmark 685 €/ha·application (lowest cost, MaP_HD); robot RS1 = €17,146 (sized for 5 ha); capacity 1.0 ha/h; 17 h/day; useful life 10 years; electricity 0.30 €/kWh; pollen 3,000 €/kg; robot pollen waste 5%; pollination window 7 days.\nTO BE FILLED IN (not given): robot energy consumption, useful pollen cost per ha, maintenance and supervision.') },
        conv: { name: L('Polinizador manual (benchmark MaP_HD)', 'Handheld pollinator (MaP_HD benchmark)'), mode: 'service',
            service_fee: 685, service_fixed: 0, capacity: 0, hours_per_day: 8, energy_type: 'electric', consumption: 0,
            energy_price: 0.30, ef: 0.20, labour_ratio: 0, labour_cost: 17 },
        robot: { name: L('Robô de polinização (RS1)', 'Pollination robot (RS1)'), mode: 'own', investment: 17146, alloc_pct: 100,
            residual: 0, useful_life: 10, service_fee: 685, capacity: 1.0, hours_per_day: 17, energy_type: 'electric',
            consumption: 0, energy_price: 0.30, ef: 0.20, labour_ratio: 0, labour_cost: 17, input_cost: 0, input_waste: 5 },
    },
};

function defaultInputs() {
    return {
        scenario: { ...BASE_SCENARIO },
        conv:  { ...BASE_OPTION, name: L('Máquina convencional', 'Conventional machine') },
        robot: { ...BASE_OPTION, name: L('Robô', 'Robot'), energy_type: 'electric', ef: 0.20, labour_ratio: 0.2 },
        recommendation: '',
    };
}
function presetInputs(key) {
    const p = PRESETS[key], d = defaultInputs();
    return {
        scenario: { ...d.scenario, ...p.scenario },
        conv:  { ...BASE_OPTION, ...p.conv },
        robot: { ...BASE_OPTION, ...p.robot },
        recommendation: '',
    };
}

// ── Estado / State ──────────────────────────────────────────────────────────
const S = {
    id: 0, dirty: false, inputs: defaultInputs(), res: null,
    charts: {}, saved: [], selected: new Set(), compareIds: [],
};

// ── Utilitários / Utilities ─────────────────────────────────────────────────
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fin = v => Number.isFinite(v);

const nf = (d) => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);
function fmt(v, d = 0) { if (!fin(v)) return '—'; return (d === 0 ? NF0 : d === 1 ? NF1 : d === 2 ? NF2 : nf(d)).format(v); }
function eur(v, d = 0) { return fin(v) ? fmt(v, d) + ' €' : '—'; }
function keur(v) { if (!fin(v)) return '—'; return Math.abs(v) >= 10000 ? fmt(v / 1000, 1) + ' k€' : fmt(v, 0) + ' €'; }
function sgn(v, f = eur) { if (!fin(v)) return '—'; return (v > 0 ? '+' : '') + f(v); }
function energyUnit(t) { return t === 'electric' ? 'kWh' : 'L'; }
const YRS = () => L('anos', 'years');
const modeLabel = m => m === 'service' ? L('serviço / RaaS', 'service / RaaS') : L('compra', 'purchase');

function post(action, data = {}) {
    const fd = new FormData();
    fd.append('action', action);
    Object.entries(data).forEach(([k, v]) => fd.append(k, v));
    return fetch(ROI_URL, { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(r => r.json())
        .catch(() => ({ success: false, message: L('Erro de rede.', 'Network error.') }));
}
function toast(msg, type = 'success') {
    if (typeof window.showAlert === 'function') { window.showAlert(msg, type); return; }
    const el = $('#roi-status'); if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 3500); }
}

// ══════════════════════════════════════════════════════════════════════════
//  MOTOR DE CÁLCULO / CALCULATION ENGINE
// ══════════════════════════════════════════════════════════════════════════

function calcOption(o, sc, area) {
    const T = Math.max(1, Math.round(num(sc.horizon) || 10));
    const r = num(sc.discount_rate) / 100;
    const N = Math.max(0, num(sc.ops_per_year));
    const A = Math.max(0, area);
    const svc = o.mode === 'service';
    const P = num(o.capacity);
    const Q = A * N;
    const H = P > 0 ? Q / P : 0;

    // Janela operacional → nº de unidades / Operational window → number of units
    const win = num(sc.window_days), hpd = num(o.hours_per_day);
    const maxAreaUnit = (win > 0 && hpd > 0 && P > 0) ? win * hpd * P : Infinity;
    const unitsNeeded = (fin(maxAreaUnit) && A > 0) ? Math.max(1, Math.ceil(A / maxAreaUnit - 1e-9)) : 1;
    const units = (!svc && num(sc.scale_units) === 1) ? unitsNeeded : 1;

    const alloc = svc ? 0 : num(o.alloc_pct) / 100;
    const I0 = svc ? 0 : num(o.investment) * alloc * units;
    const Vr = svc ? 0 : num(o.residual) * alloc * units;
    const R = svc ? 0 : num(o.replacement_cost) * alloc * units;
    const Ry = Math.round(num(o.replacement_year));
    const maint = svc ? 0 : num(o.maintenance) * alloc * units;

    const energyQty = H * num(o.consumption);
    const cEnergy = svc ? 0 : energyQty * num(o.energy_price);
    const labourH = H * num(o.labour_ratio);
    const cLabour = labourH * num(o.labour_cost);
    const waste = Math.min(num(o.input_waste), 95) / 100;
    const cInputs = Q * num(o.input_cost) / (1 - waste);
    const cService = svc ? num(o.service_fee) * Q + num(o.service_fixed) : 0;
    const cOther = num(o.other);
    const Cop = cEnergy + cLabour + maint + cInputs + cService + cOther;

    let pvOp = 0, pvR = 0, annuity = 0, discQ = 0;
    const cumulative = [I0], cashflow = [-I0];
    let cum = I0;
    for (let t = 1; t <= T; t++) {
        const df = Math.pow(1 + r, -t);
        const Rt = (Ry === t) ? R : 0;
        pvOp += Cop * df; pvR += Rt * df; annuity += df; discQ += Q * df;
        cum += (Cop + Rt) * df;
        let cf = -(Cop + Rt);
        if (t === T) { cum -= Vr * df; cf += Vr; }
        cumulative.push(cum); cashflow.push(cf);
    }
    const pvVr = Vr * Math.pow(1 + r, -T);
    const TCO = I0 + pvOp + pvR - pvVr;
    const capAnnual = annuity > 0 ? (I0 + pvR - pvVr) / annuity : 0;

    const E = energyQty * num(o.ef);
    return {
        T, r, Q, H, P, units, unitsNeeded, maxAreaUnit, svc,
        I0, Vr, R, Ry, maint, energyQty, cEnergy, labourH, cLabour, cInputs, cService, cOther, Cop,
        Cunit: Q > 0 ? Cop / Q : NaN,
        TCO, levelised: discQ > 0 ? TCO / discQ : NaN, annualEq: annuity > 0 ? TCO / annuity : NaN,
        capAnnual, annuity, discQ, cumulative, cashflow,
        E, Eunit: Q > 0 ? E / Q : NaN,
    };
}

function npvAt(inp, area) {
    const c = calcOption(inp.conv, inp.scenario, area);
    const b = calcOption(inp.robot, inp.scenario, area);
    return c.TCO - b.TCO + num(inp.robot.extra_benefit) * b.annuity;
}

function irr(cfs) {
    const f = rate => cfs.reduce((s, cf, t) => s + cf / Math.pow(1 + rate, t), 0);
    let lo = -0.99, hi = 10, flo = f(lo), fhi = f(hi);
    if (!fin(flo) || !fin(fhi) || flo * fhi > 0) return NaN;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if (Math.abs(fm) < 1e-7) return mid;
        if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
}

/** Área A* onde o VAL muda de sinal / Area A* where NPV changes sign (log grid + bisection). */
function breakEvenArea(inp) {
    const A0 = Math.max(num(inp.scenario.area), 0.1);
    const lo = 0.05, hi = Math.max(A0 * 50, 5000), steps = 240;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const a = lo * Math.pow(hi / lo, i / steps);
        pts.push([a, npvAt(inp, a)]);
    }
    const crossings = [];
    for (let i = 1; i < pts.length; i++) {
        const [a1, f1] = pts[i - 1], [a2, f2] = pts[i];
        if (f1 === 0) { crossings.push({ area: a1, dir: f2 > 0 ? 'up' : 'down' }); continue; }
        if (f1 * f2 < 0) {
            let x1 = a1, x2 = a2, y1 = f1;
            for (let k = 0; k < 60; k++) {
                const m = (x1 + x2) / 2, ym = npvAt(inp, m);
                if (y1 * ym <= 0) { x2 = m; } else { x1 = m; y1 = ym; }
            }
            crossings.push({ area: (x1 + x2) / 2, dir: f2 > f1 ? 'up' : 'down' });
        }
    }
    const first = crossings.find(c => c.dir === 'up') || crossings[0] || null;
    return {
        area: first ? first.area : NaN, dir: first ? first.dir : null, crossings,
        alwaysRobot: !crossings.length && pts[0][1] > 0,
        neverRobot: !crossings.length && pts[0][1] <= 0,
        searchMax: hi,
    };
}

function compute(inp) {
    const sc = inp.scenario, A = num(sc.area);
    const conv = calcOption(inp.conv, sc, A);
    const robot = calcOption(inp.robot, sc, A);
    const B = num(inp.robot.extra_benefit);
    const pvB = B * robot.annuity;
    const npv = conv.TCO - robot.TCO + pvB;

    const extraInv = robot.I0 - conv.I0;
    const annualSaving = conv.Cop - robot.Cop + B;
    const inc = robot.cashflow.map((cf, t) => cf - conv.cashflow[t] + (t > 0 ? B : 0));
    const irrV = irr(inc);
    let paybackDisc = NaN, cum = 0;
    const incCum = [];
    for (let t = 0; t < inc.length; t++) {
        cum += inc[t] / Math.pow(1 + conv.r, t);
        incCum.push(cum);
        if (!fin(paybackDisc) && cum >= 0 && (t > 0 || inc[0] >= 0)) paybackDisc = t;
    }
    if (fin(paybackDisc) && paybackDisc > 0) {
        const t = paybackDisc, prev = incCum[t - 1], cur = incCum[t];
        if (cur !== prev) paybackDisc = (t - 1) + (-prev) / (cur - prev);
    }
    const paybackSimple = (extraInv > 0 && annualSaving > 0) ? extraInv / annualSaving : NaN;
    const roiPct = extraInv > 0 ? npv / extraInv * 100 : NaN;

    const be = breakEvenArea(inp);
    const beHours = fin(be.area) && robot.P > 0 ? be.area * num(sc.ops_per_year) / robot.P : NaN;

    // Preço máximo do robô / Maximum competitive robot price
    const perEuro = (robot.svc ? 0 : num(inp.robot.alloc_pct) / 100 * robot.units);
    const maxRobotPrice = (!robot.svc && perEuro > 0) ? num(inp.robot.investment) + npv / perEuro : NaN;

    // Tarifa RaaS máxima / Maximum competitive RaaS fee (€/ha·op)
    const raasZero = calcOption({ ...inp.robot, mode: 'service', service_fee: 0 }, sc, A);
    const maxRaasFee = raasZero.discQ > 0 ? (conv.TCO - raasZero.TCO + B * raasZero.annuity) / raasZero.discQ : NaN;

    const co2Red = conv.E > 0 ? (conv.E - robot.E) / conv.E * 100 : NaN;

    const warnings = [];
    ['conv', 'robot'].forEach(k => {
        const o = inp[k], c = k === 'conv' ? conv : robot;
        const lbl = k === 'conv' ? L('Convencional', 'Conventional') : L('Robô', 'Robot');
        if (num(o.capacity) <= 0) warnings.push(`${lbl}: ` + L('capacidade efectiva não definida — horas, energia, mão-de-obra e emissões ficam a zero.',
            'effective capacity not set — hours, energy, labour and emissions are zero.'));
        if (c.unitsNeeded > 1) warnings.push(`${lbl}: ` + L(
            `uma unidade cobre no máx. ${fmt(c.maxAreaUnit, 1)} ha na janela de ${fmt(num(sc.window_days))} dias → são necessárias <b>${c.unitsNeeded} unidades</b>`,
            `one unit covers at most ${fmt(c.maxAreaUnit, 1)} ha within the ${fmt(num(sc.window_days))}-day window → <b>${c.unitsNeeded} units</b> are needed`) +
            (c.units > 1 ? L(' (custos de capital multiplicados)', ' (capital costs multiplied)') : (c.svc ? L(' (serviço)', ' (service)') : L(' (não escalado)', ' (not scaled)'))) + '.');
        if (!c.svc && num(o.useful_life) > 0 && num(o.useful_life) < c.T && !(num(o.replacement_cost) > 0))
            warnings.push(`${lbl}: ` + L(`vida útil (${fmt(num(o.useful_life))} anos) inferior ao horizonte (${c.T} anos) sem custo de substituição definido.`,
                `useful life (${fmt(num(o.useful_life))} years) is shorter than the horizon (${c.T} years) and no replacement cost is set.`));
        if (!c.svc && num(o.replacement_year) > c.T) warnings.push(`${lbl}: ` + L('ano de substituição fora do horizonte — ignorado.', 'replacement year beyond the horizon — ignored.'));
    });
    if (num(sc.area) <= 0 || num(sc.ops_per_year) <= 0) warnings.push(L('Defina a área e o nº de operações por ano.', 'Set the area and the number of operations per year.'));

    // Veredicto / Verdict
    let verdict, vclass;
    const fu = esc(sc.func_unit || 'ha·op');
    if (npv > 0) {
        vclass = 'good';
        verdict = L(`<b>O robô é economicamente vantajoso</b> neste cenário: poupança de <b>${eur(npv)}</b> em valor actual a ${conv.T} anos (TCO ${eur(robot.TCO)} vs ${eur(conv.TCO)}).`,
                    `<b>The robot is economically advantageous</b> in this scenario: savings of <b>${eur(npv)}</b> in present value over ${conv.T} years (TCO ${eur(robot.TCO)} vs ${eur(conv.TCO)}).`);
    } else {
        vclass = (Math.abs(npv) < 0.1 * conv.TCO) ? 'mid' : 'bad';
        verdict = L(`<b>A solução convencional é mais económica</b> neste cenário: o robô custa mais <b>${eur(-npv)}</b> em valor actual a ${conv.T} anos.`,
                    `<b>The conventional solution is cheaper</b> in this scenario: the robot costs <b>${eur(-npv)}</b> more in present value over ${conv.T} years.`);
    }
    if (fin(be.area)) verdict += ' ' + L(`Break-even em <b>${fmt(be.area, 1)} ha</b> (≈ ${fmt(beHours)} h/ano de robô)`, `Break-even at <b>${fmt(be.area, 1)} ha</b> (≈ ${fmt(beHours)} robot h/year)`) +
        (be.dir === 'up' ? L('; o robô compensa acima desta área.', '; the robot pays off above this area.') : L('; o robô compensa abaixo desta área.', '; the robot pays off below this area.'));
    else if (be.alwaysRobot) verdict += ' ' + L('O robô é vantajoso em todas as áreas analisadas.', 'The robot is advantageous at every area analysed.');
    else verdict += ' ' + L(`Sem break-even até ${fmt(be.searchMax)} ha — o robô não compensa por via da área (rever custos, produtividade ou modelo RaaS).`,
                            `No break-even up to ${fmt(be.searchMax)} ha — area alone does not make the robot pay off (review costs, productivity or a RaaS model).`);
    if (fin(co2Red)) verdict += ' ' + L('Emissões operacionais', 'Operational emissions') +
        ` ${co2Red >= 0 ? '−' : '+'}${fmt(Math.abs(co2Red), 0)} % (${fmt(robot.Eunit, 1)} vs ${fmt(conv.Eunit, 1)} kg CO₂e/${fu}).`;

    return { conv, robot, B, pvB, npv, extraInv, annualSaving, inc, incCum, irr: irrV, paybackDisc, paybackSimple,
             roiPct, be, beHours, maxRobotPrice, maxRaasFee, co2Red, warnings, verdict, vclass };
}

// ── Sensibilidade / Sensitivity ─────────────────────────────────────────────
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function mut(inp, fn) { const c = clone(inp); fn(c); return c; }

function guideScenarios(inp) {
    const list = [
        [L('Base', 'Base case'), i => i],
        [L('Área −50 %', 'Area −50%'), i => { i.scenario.area *= 0.5; }],
        [L('Área +50 %', 'Area +50%'), i => { i.scenario.area *= 1.5; }],
        [L('Mão-de-obra +30 %', 'Labour cost +30%'), i => { i.conv.labour_cost *= 1.3; i.robot.labour_cost *= 1.3; }],
        [L('Energia +30 %', 'Energy prices +30%'), i => { i.conv.energy_price *= 1.3; i.robot.energy_price *= 1.3; }],
        [L('Produtividade do robô −20 %', 'Robot productivity −20%'), i => { i.robot.capacity *= 0.8; }],
        [L('Custo de compra do robô −30 %', 'Robot purchase cost −30%'), i => { i.robot.investment *= 0.7; }],
    ];
    if (inp.robot.mode === 'own' && num(inp.robot.service_fee) > 0)
        list.push([L(`Robô em RaaS a ${fmt(num(inp.robot.service_fee))} €/ha·op`, `Robot as RaaS at ${fmt(num(inp.robot.service_fee))} €/ha·op`), i => { i.robot.mode = 'service'; }]);
    if (inp.robot.mode === 'service' && num(inp.robot.investment) > 0)
        list.push([L('Robô em compra (em vez de RaaS)', 'Robot purchased (instead of RaaS)'), i => { i.robot.mode = 'own'; }]);
    return list.map(([label, fn], idx) => {
        const m = mut(inp, fn);
        const sc = m.scenario, A = num(sc.area);
        const c = calcOption(m.conv, sc, A), b = calcOption(m.robot, sc, A);
        const npv = c.TCO - b.TCO + num(m.robot.extra_benefit) * b.annuity;
        return { label, base: idx === 0, area: A, convTCO: c.TCO, robotTCO: b.TCO, npv, convUnit: c.levelised, robotUnit: b.levelised };
    });
}

function tornado(inp, pct) {
    const p = pct / 100;
    const params = [
        [L('Área', 'Area'), i => i.scenario, 'area'],
        [L('Operações/ano', 'Operations/year'), i => i.scenario, 'ops_per_year'],
        [L('Investimento robô', 'Robot investment'), i => i.robot, 'investment'],
        [L('Capacidade robô', 'Robot capacity'), i => i.robot, 'capacity'],
        [L('Investimento conv.', 'Conv. investment'), i => i.conv, 'investment'],
        [L('Capacidade conv.', 'Conv. capacity'), i => i.conv, 'capacity'],
        [L('Custo mão-de-obra', 'Labour cost'), i => [i.conv, i.robot], 'labour_cost'],
        [L('Preço energia', 'Energy price'), i => [i.conv, i.robot], 'energy_price'],
        [L('Manutenção robô', 'Robot maintenance'), i => i.robot, 'maintenance'],
        [L('Supervisão robô', 'Robot supervision'), i => i.robot, 'labour_ratio'],
        [L('Taxa de desconto', 'Discount rate'), i => i.scenario, 'discount_rate'],
    ];
    if (inp.robot.mode === 'service') params.push([L('Tarifa RaaS robô', 'Robot RaaS fee'), i => i.robot, 'service_fee']);
    if (inp.conv.mode === 'service') params.push([L('Tarifa serviço conv.', 'Conv. service fee'), i => i.conv, 'service_fee']);
    if (num(inp.conv.input_cost) > 0 || num(inp.robot.input_cost) > 0)
        params.push([L('Custo consumíveis', 'Input cost'), i => [i.conv, i.robot], 'input_cost']);
    const base = npvAt(inp, num(inp.scenario.area));
    return params.map(([label, get, key]) => {
        const run = f => {
            const m = clone(inp);
            [].concat(get(m)).forEach(o => { o[key] = num(o[key]) * f; });
            return npvAt(m, num(m.scenario.area)) - base;
        };
        return { label, low: run(1 - p), high: run(1 + p) };
    }).filter(t => Math.abs(t.low) + Math.abs(t.high) > 0.5)
      .sort((a, b) => (Math.abs(b.high - b.low)) - (Math.abs(a.high - a.low)));
}

// ── Macro-dados guardados / Saved key indicators ────────────────────────────
function macro(inp, R) {
    const sc = inp.scenario, c = R.conv, b = R.robot;
    const r2 = v => fin(v) ? Math.round(v * 100) / 100 : null;
    return {
        v: 1, lang: LANG, computed_at: new Date().toISOString(),
        crop: sc.crop, operation: sc.operation, func_unit: sc.func_unit,
        area: r2(num(sc.area)), ops_per_year: r2(num(sc.ops_per_year)), work_q: r2(c.Q),
        discount_rate: r2(num(sc.discount_rate)), horizon: c.T,
        conv_name: inp.conv.name, robot_name: inp.robot.name,
        conv_mode: inp.conv.mode, robot_mode: inp.robot.mode,
        conv_capacity: r2(num(inp.conv.capacity)), robot_capacity: r2(num(inp.robot.capacity)),
        conv_hours: r2(c.H), robot_hours: r2(b.H), conv_units: c.units, robot_units: b.units,
        conv_labour_h: r2(c.labourH), robot_labour_h: r2(b.labourH),
        conv_investment: r2(c.I0), robot_investment: r2(b.I0),
        conv_cop: r2(c.Cop), robot_cop: r2(b.Cop), conv_cunit: r2(c.Cunit), robot_cunit: r2(b.Cunit),
        conv_tco: r2(c.TCO), robot_tco: r2(b.TCO), conv_levelised: r2(c.levelised), robot_levelised: r2(b.levelised),
        conv_energy: r2(c.energyQty), robot_energy: r2(b.energyQty),
        conv_energy_unit: energyUnit(inp.conv.energy_type), robot_energy_unit: energyUnit(inp.robot.energy_type),
        conv_co2: r2(c.E), robot_co2: r2(b.E), conv_co2_unit: r2(c.Eunit), robot_co2_unit: r2(b.Eunit),
        co2_reduction_pct: r2(R.co2Red),
        extra_benefit: r2(R.B), npv: r2(R.npv), annual_saving: r2(R.annualSaving), extra_investment: r2(R.extraInv),
        roi_pct: r2(R.roiPct), irr_pct: fin(R.irr) ? r2(R.irr * 100) : null,
        payback_simple: r2(R.paybackSimple), payback_disc: r2(R.paybackDisc),
        breakeven_area: r2(R.be.area), breakeven_hours: r2(R.beHours),
        max_robot_price: r2(R.maxRobotPrice), max_raas_fee: r2(R.maxRaasFee),
        winner: R.npv > 0 ? 'robot' : 'conv',
        sensitivity: guideScenarios(inp).map(s => ({ label: s.label, npv: r2(s.npv) })),
    };
}

const CSV_COLS = [
    ['name', 'Simulação', 'Simulation'], ['group_label', 'Grupo', 'Group'], ['updated_at', 'Actualizada', 'Updated'],
    ['crop', 'Cultura', 'Crop'], ['operation', 'Operação', 'Operation'], ['func_unit', 'Unidade funcional', 'Functional unit'],
    ['area', 'Área (ha)', 'Area (ha)'], ['ops_per_year', 'Operações/ano', 'Operations/year'], ['work_q', 'Trabalho Q (ha·op/ano)', 'Work Q (ha·op/year)'],
    ['discount_rate', 'Taxa desconto (%)', 'Discount rate (%)'], ['horizon', 'Horizonte (anos)', 'Horizon (years)'],
    ['conv_name', 'Convencional', 'Conventional'], ['robot_name', 'Robô', 'Robot'],
    ['conv_mode', 'Modelo conv.', 'Conv. model'], ['robot_mode', 'Modelo robô', 'Robot model'],
    ['conv_capacity', 'P conv. (ha/h)', 'Conv. P (ha/h)'], ['robot_capacity', 'P robô (ha/h)', 'Robot P (ha/h)'],
    ['conv_hours', 'H conv. (h/ano)', 'Conv. H (h/year)'], ['robot_hours', 'H robô (h/ano)', 'Robot H (h/year)'],
    ['conv_units', 'Unid. conv.', 'Conv. units'], ['robot_units', 'Unid. robô', 'Robot units'],
    ['conv_labour_h', 'Mão-de-obra conv. (h/ano)', 'Conv. labour (h/year)'], ['robot_labour_h', 'Mão-de-obra robô (h/ano)', 'Robot labour (h/year)'],
    ['conv_investment', 'I0 conv. imputado (€)', 'Conv. allocated I0 (€)'], ['robot_investment', 'I0 robô imputado (€)', 'Robot allocated I0 (€)'],
    ['conv_cop', 'Cop conv. (€/ano)', 'Conv. Cop (€/year)'], ['robot_cop', 'Cop robô (€/ano)', 'Robot Cop (€/year)'],
    ['conv_cunit', 'Cunit conv. (€/un)', 'Conv. Cunit (€/unit)'], ['robot_cunit', 'Cunit robô (€/un)', 'Robot Cunit (€/unit)'],
    ['conv_tco', 'TCO conv. (€)', 'Conv. TCO (€)'], ['robot_tco', 'TCO robô (€)', 'Robot TCO (€)'],
    ['conv_levelised', 'Custo nivelado conv. (€/un)', 'Conv. levelised cost (€/unit)'], ['robot_levelised', 'Custo nivelado robô (€/un)', 'Robot levelised cost (€/unit)'],
    ['conv_energy', 'Energia conv. (/ano)', 'Conv. energy (/year)'], ['conv_energy_unit', 'Unid. energia conv.', 'Conv. energy unit'],
    ['robot_energy', 'Energia robô (/ano)', 'Robot energy (/year)'], ['robot_energy_unit', 'Unid. energia robô', 'Robot energy unit'],
    ['conv_co2', 'CO2e conv. (kg/ano)', 'Conv. CO2e (kg/year)'], ['robot_co2', 'CO2e robô (kg/ano)', 'Robot CO2e (kg/year)'],
    ['conv_co2_unit', 'CO2e conv. (kg/un)', 'Conv. CO2e (kg/unit)'], ['robot_co2_unit', 'CO2e robô (kg/un)', 'Robot CO2e (kg/unit)'],
    ['co2_reduction_pct', 'Redução CO2e (%)', 'CO2e reduction (%)'],
    ['extra_benefit', 'Benefício adicional (€/ano)', 'Additional benefit (€/year)'], ['npv', 'VAL adopção robô (€)', 'NPV of robot adoption (€)'],
    ['annual_saving', 'Poupança anual (€/ano)', 'Annual saving (€/year)'], ['extra_investment', 'Investimento adicional (€)', 'Additional investment (€)'],
    ['roi_pct', 'ROI (%)', 'ROI (%)'], ['irr_pct', 'TIR (%)', 'IRR (%)'],
    ['payback_simple', 'Payback simples (anos)', 'Simple payback (years)'], ['payback_disc', 'Payback descontado (anos)', 'Discounted payback (years)'],
    ['breakeven_area', 'Break-even A* (ha)', 'Break-even A* (ha)'], ['breakeven_hours', 'Break-even U* (h/ano)', 'Break-even U* (h/year)'],
    ['max_robot_price', 'Preço máx. robô (€)', 'Max. robot price (€)'], ['max_raas_fee', 'Tarifa RaaS máx. (€/ha·op)', 'Max. RaaS fee (€/ha·op)'],
    ['winner', 'Melhor opção', 'Best option'],
];

// ══════════════════════════════════════════════════════════════════════════
//  FORMULÁRIO / FORM
// ══════════════════════════════════════════════════════════════════════════

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, val) {
    const ks = path.split('.'); let o = obj;
    ks.slice(0, -1).forEach(k => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
    o[ks[ks.length - 1]] = val;
}

function readForm() {
    const inp = clone(S.inputs);
    $$('#roi-form .roi-in').forEach(el => {
        const k = el.dataset.k;
        const v = el.type === 'number' ? num(el.value) : (k === 'scenario.scale_units' ? num(el.value) : el.value);
        setPath(inp, k, v);
    });
    const reco = $('#roi-reco'); if (reco) inp.recommendation = reco.value;
    return inp;
}

function writeForm(inp) {
    $$('#roi-form .roi-in').forEach(el => {
        const v = getPath(inp, el.dataset.k);
        el.value = (v === undefined || v === null) ? '' : v;
    });
    const reco = $('#roi-reco'); if (reco) reco.value = inp.recommendation || '';
    syncOptionUi();
}

function syncOptionUi() {
    ['conv', 'robot'].forEach(p => {
        const modeEl = $(`[data-k="${p}.mode"]`);
        const blk = modeEl && modeEl.closest('.roi-opt');
        if (blk) blk.classList.toggle('svc', modeEl.value === 'service');
        const et = $(`[data-k="${p}.energy_type"]`);
        if (blk && et) $$('.roi-eu', blk).forEach(s => { s.textContent = energyUnit(et.value); });
    });
}

function setDirty(d) {
    S.dirty = d;
    const st = $('#roi-status');
    if (st) st.innerHTML = S.id ? (d ? L('● alterações por guardar', '● unsaved changes') : L('✓ guardada', '✓ saved'))
                                : (d ? L('● nova (não guardada)', '● new (not saved)') : '');
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: S.id, dirty: d, name: $('#roi-name').value, group: $('#roi-group').value, inputs: S.inputs })); } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════
//  GRÁFICOS / CHARTS
// ══════════════════════════════════════════════════════════════════════════

const CHART_BASE = (extra = {}) => Object.assign({
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, locale: LOCALE,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
               tooltip: { callbacks: {} } },
}, extra);

const eurTick = v => keur(v);
const yearLbl = t => L('Ano ', 'Year ') + t;
const CONV = () => L('Convencional', 'Conventional');
const ROBOT = () => L('Robô', 'Robot');

function cfgBreakdown(inp, R) {
    const lbl = [L('Capital (anualizado)', 'Capital (annualised)'), L('Energia', 'Energy'), L('Mão-de-obra', 'Labour'),
                 L('Manutenção', 'Maintenance'), L('Consumíveis', 'Inputs'), L('Serviço', 'Service'), L('Outros', 'Other')];
    const val = c => [c.capAnnual, c.cEnergy, c.cLabour, c.maint, c.cInputs, c.cService, c.cOther];
    const cols = ['#6b7280', '#f59e0b', '#0ea5e9', '#a855f7', '#10b981', '#ec4899', '#94a3b8'];
    const cv = val(R.conv), rv = val(R.robot);
    const datasets = lbl.map((l, i) => ({ label: l, data: [cv[i], rv[i]], backgroundColor: cols[i], stack: 's' }))
        .filter(d => d.data.some(x => Math.abs(x) > 0.5));
    return { type: 'bar', data: { labels: [CONV(), ROBOT()], datasets },
        options: CHART_BASE({ scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: eurTick } } },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.raw)}${L('/ano', '/year')}` } } } }) };
}

function cfgCumulative(inp, R) {
    const labels = R.conv.cumulative.map((_, t) => yearLbl(t));
    const B = num(inp.robot.extra_benefit);
    return { type: 'line', data: { labels, datasets: [
        { label: CONV(), data: R.conv.cumulative, borderColor: C_CONV, backgroundColor: C_CONV, tension: .15, pointRadius: 2 },
        { label: B ? L('Robô (− benefícios)', 'Robot (− benefits)') : ROBOT(),
          data: R.robot.cumulative.map((v, t) => v - B * (t === 0 ? 0 : R.robot.cumulative.slice(1, t + 1).reduce((s, _, k) => s + Math.pow(1 + R.robot.r, -(k + 1)), 0))),
          borderColor: C_ROBOT, backgroundColor: C_ROBOT, tension: .15, pointRadius: 2 },
    ] }, options: CHART_BASE({ scales: { y: { ticks: { callback: eurTick } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.raw)}` } } } }) };
}

function cfgEmissions(inp, R) {
    const fu = inp.scenario.func_unit || L('un', 'unit');
    return { type: 'bar', data: { labels: [L('kg CO₂e / ano', 'kg CO₂e / year'), `kg CO₂e / ${fu}`], datasets: [
        { label: CONV(), data: [R.conv.E, R.conv.Eunit], backgroundColor: C_CONV },
        { label: ROBOT(), data: [R.robot.E, R.robot.Eunit], backgroundColor: C_ROBOT },
    ] }, options: CHART_BASE({ indexAxis: 'y', scales: { x: { type: 'logarithmic', ticks: { callback: v => fmt(v) } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)} kg CO₂e` } } } }) };
}

function cfgCashflow(inp, R) {
    const labels = R.inc.map((_, t) => yearLbl(t));
    return { type: 'bar', data: { labels, datasets: [
        { type: 'line', label: L('Acumulado descontado', 'Cumulative discounted'), data: R.incCum, borderColor: '#111827', backgroundColor: '#111827', pointRadius: 2, tension: .1 },
        { label: L('Fluxo anual (nominal)', 'Annual flow (nominal)'), data: R.inc, backgroundColor: R.inc.map(v => v >= 0 ? C_GOOD : C_BAD) },
    ] }, options: CHART_BASE({ scales: { y: { ticks: { callback: eurTick } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.raw)}` } } } }) };
}

function logTick(v) {
    const m = v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9));
    return [1, 2, 5].some(x => Math.abs(m - x) < 1e-6) ? fmt(v, v < 1 ? 1 : 0) : '';
}

function cfgArea(inp, R) {
    const A0 = Math.max(num(inp.scenario.area), 0.1);
    let hi = A0 * 4; if (fin(R.be.area)) hi = Math.max(hi, R.be.area * 2);
    const lo = Math.max(0.1, Math.min(A0, fin(R.be.area) ? R.be.area : A0) / 10);
    const pts = 60, cv = [], rv = [];
    for (let i = 0; i <= pts; i++) {
        const a = lo * Math.pow(hi / lo, i / pts);
        const c = calcOption(inp.conv, inp.scenario, a), b = calcOption(inp.robot, inp.scenario, a);
        const benefitUnit = b.discQ > 0 ? num(inp.robot.extra_benefit) * b.annuity / b.discQ : 0;
        cv.push({ x: a, y: c.levelised }); rv.push({ x: a, y: b.levelised - benefitUnit });
    }
    const ds = [
        { label: CONV(), data: cv, borderColor: C_CONV, backgroundColor: C_CONV, pointRadius: 0, tension: 0, showLine: true },
        { label: ROBOT(), data: rv, borderColor: C_ROBOT, backgroundColor: C_ROBOT, pointRadius: 0, tension: 0, showLine: true },
        { label: L('Área actual', 'Current area'), data: [{ x: A0, y: R.conv.levelised }, { x: A0, y: R.robot.levelised }], showLine: true,
          borderColor: '#9ca3af', borderDash: [4, 4], pointRadius: 3, backgroundColor: '#9ca3af' },
    ];
    if (fin(R.be.area)) {
        const c = calcOption(inp.conv, inp.scenario, R.be.area);
        ds.push({ label: `Break-even ${fmt(R.be.area, 1)} ha`, data: [{ x: R.be.area, y: c.levelised }], pointRadius: 7,
                  pointStyle: 'rectRot', backgroundColor: C_GOOD, borderColor: C_GOOD, showLine: false });
    }
    const all = cv.concat(rv).map(p => p.y).filter(fin).sort((a, b) => a - b);
    const yMax = all.length ? all[Math.floor(all.length * 0.9)] * 1.3 : undefined;
    return { type: 'scatter', data: { datasets: ds }, options: CHART_BASE({
        scales: { x: { type: 'logarithmic', title: { display: true, text: L('Área (ha)', 'Area (ha)') }, ticks: { callback: logTick } },
                  y: { min: 0, max: yMax, title: { display: true, text: `€ / ${inp.scenario.func_unit || 'ha·op'}` }, ticks: { callback: v => fmt(v) } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw.x, 1)} ha → ${eur(c.raw.y, 1)}` } } } }) };
}

function cfgTornado(inp, R, pct) {
    const t = tornado(inp, pct).slice(0, 10);
    return { type: 'bar', data: { labels: t.map(x => x.label), datasets: [
        { label: `−${pct} %`, data: t.map(x => x.low), backgroundColor: '#f97316' },
        { label: `+${pct} %`, data: t.map(x => x.high), backgroundColor: '#6366f1' },
    ] }, options: CHART_BASE({ indexAxis: 'y', scales: { x: { ticks: { callback: eurTick } }, y: { ticks: { autoSkip: false, font: { size: 10 } } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: Δ ${L('VAL', 'NPV')} ${sgn(c.raw)}` } } } }) };
}

function cfgCompare(rows) {
    return { type: 'bar', data: { labels: rows.map(r => r.name), datasets: [
        { label: L('TCO convencional', 'Conventional TCO'), data: rows.map(r => r.results.conv_tco), backgroundColor: C_CONV },
        { label: L('TCO robô', 'Robot TCO'), data: rows.map(r => r.results.robot_tco), backgroundColor: C_ROBOT },
        { label: L('VAL adopção', 'Adoption NPV'), data: rows.map(r => r.results.npv), backgroundColor: rows.map(r => (r.results.npv || 0) >= 0 ? C_GOOD : C_BAD) },
    ] }, options: CHART_BASE({ scales: { y: { ticks: { callback: eurTick } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.raw)}` } } } }) };
}

function drawChart(key, cfg) {
    if (typeof Chart === 'undefined') return;
    const cv = document.getElementById('roi-ch-' + key);
    if (!cv) return;
    if (S.charts[key]) { S.charts[key].destroy(); }
    S.charts[key] = new Chart(cv, cfg);
}

/** Gráfico fora do ecrã → PNG (diapositivos) / Off-screen chart → PNG (slides). */
function chartPng(cfg, w = 620, h = 350) {
    if (typeof Chart === 'undefined') return '';
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const data = clone(cfg.data);
    const opt = Object.assign({}, cfg.options, { responsive: false, animation: false, devicePixelRatio: 3 });
    const bg = { id: 'bg', beforeDraw: ch => { const x = ch.ctx; x.save(); x.fillStyle = '#fff'; x.fillRect(0, 0, ch.width, ch.height); x.restore(); } };
    const ch = new Chart(cv, { type: cfg.type, data, options: opt, plugins: [bg] });
    const url = ch.toBase64Image('image/png');
    ch.destroy();
    return url;
}

function downloadChart(key) {
    const ch = S.charts[key]; if (!ch) return;
    const src = ch.canvas;
    const out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
    const x = out.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, out.width, out.height); x.drawImage(src, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `roi_${key}_${slug($('#roi-name').value || 'simulation')}.png`;
    a.click();
}
function slug(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 50) || 'roi'; }

// ══════════════════════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════════════════════

function kpi(label, value, sub = '', cls = '') {
    return `<div class="roi-kpi ${cls}"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
}

function recalc() {
    S.inputs = readForm();
    S.res = compute(S.inputs);
    renderCalc();
    if (secVisible('sens')) renderSens();
    if (secVisible('pres')) renderPres();
}

function secVisible(name) { const s = $(`section[data-sec="${name}"]`); return s && s.style.display !== 'none'; }

function renderCalc() {
    const inp = S.inputs, R = S.res, c = R.conv, b = R.robot, sc = inp.scenario;
    const fu = esc(sc.func_unit || L('un', 'unit'));

    $('#roi-verdict').className = 'roi-verdict ' + R.vclass;
    $('#roi-verdict').innerHTML = R.verdict;
    $('#roi-warns').innerHTML = R.warnings.map(w => `<div class="roi-warn">⚠ ${w}</div>`).join('');

    const g = v => v > 0 ? 'good' : v < 0 ? 'bad' : '';
    $('#roi-kpis').innerHTML = [
        kpi(L(`VAL da adopção (${c.T} anos)`, `Adoption NPV (${c.T} years)`), eur(R.npv), L('TCO conv. − TCO robô + benefícios', 'Conv. TCO − robot TCO + benefits'), g(R.npv)),
        kpi(L('ROI sobre investimento adicional', 'ROI on additional investment'), fin(R.roiPct) ? fmt(R.roiPct, 0) + ' %' : '—',
            R.extraInv > 0 ? L(`Inv. adicional ${eur(R.extraInv)}`, `Additional inv. ${eur(R.extraInv)}`) : L('Sem investimento adicional', 'No additional investment'),
            fin(R.roiPct) ? g(R.roiPct) : ''),
        kpi(L('TIR incremental', 'Incremental IRR'), fin(R.irr) ? fmt(R.irr * 100, 1) + ' %' : '—',
            L(`vs. taxa de desconto ${fmt(num(sc.discount_rate), 1)} %`, `vs. discount rate ${fmt(num(sc.discount_rate), 1)}%`),
            fin(R.irr) ? (R.irr * 100 > num(sc.discount_rate) ? 'good' : 'bad') : ''),
        kpi(L('Payback descontado', 'Discounted payback'), fin(R.paybackDisc) ? fmt(R.paybackDisc, 1) + ' ' + YRS() : L('não recupera', 'not recovered'),
            fin(R.paybackSimple) ? L(`simples: ${fmt(R.paybackSimple, 1)} anos`, `simple: ${fmt(R.paybackSimple, 1)} years`) : '', fin(R.paybackDisc) ? 'good' : 'bad'),
        kpi(L('Poupança operacional anual', 'Annual operating saving'), eur(R.annualSaving), `Cop ${eur(c.Cop)} → ${eur(b.Cop)}`, g(R.annualSaving)),
        kpi('Break-even A*', fin(R.be.area) ? fmt(R.be.area, 1) + ' ha' : (R.be.alwaysRobot ? L('sempre robô', 'always robot') : L('sem break-even', 'no break-even')),
            fin(R.beHours) ? L(`U* ≈ ${fmt(R.beHours)} h/ano de robô`, `U* ≈ ${fmt(R.beHours)} robot h/year`) : '', ''),
        kpi(L('Custo nivelado', 'Levelised cost'), `${eur(c.levelised, 1)} → ${eur(b.levelised, 1)}`,
            L(`por ${fu} (TCO / trabalho descontado)`, `per ${fu} (TCO / discounted work)`), g(c.levelised - b.levelised)),
        kpi(L('Emissões operacionais', 'Operational emissions'), fin(R.co2Red) ? (R.co2Red >= 0 ? '−' : '+') + fmt(Math.abs(R.co2Red), 0) + ' %' : '—',
            `${fmt(c.E)} → ${fmt(b.E)} kg CO₂e${L('/ano', '/year')}`, fin(R.co2Red) ? g(R.co2Red) : ''),
    ].join('');

    const row = (label, cv, rv, f = v => fmt(v), better = 'low', bold = false) => {
        const d = (fin(cv) && fin(rv)) ? rv - cv : NaN;
        let cls = '';
        if (fin(d) && Math.abs(d) > 1e-9 && better) cls = ((better === 'low') === (d < 0)) ? 'roi-pos' : 'roi-neg';
        return `<tr${bold ? ' style="font-weight:700"' : ''}><td>${label}</td><td class="c">${f(cv)}</td><td class="r">${f(rv)}</td><td class="${cls}">${fin(d) ? (d > 0 ? '+' : '') + f(d) : '—'}</td></tr>`;
    };
    const eu = o => energyUnit(o.energy_type);
    const yr = L('/ano', '/year');
    $('#roi-table').innerHTML = `
        <thead><tr><th>${L('Indicador', 'Indicator')}</th><th>🚜 ${esc(inp.conv.name || CONV())}</th><th>🤖 ${esc(inp.robot.name || ROBOT())}</th><th>Δ ${L('robô − conv.', 'robot − conv.')}</th></tr></thead>
        <tbody>
        ${row(L('Capacidade efectiva P (ha/h)', 'Effective capacity P (ha/h)'), num(inp.conv.capacity), num(inp.robot.capacity), v => fmt(v, 2), 'high')}
        ${row(L('Horas de máquina H (h/ano)', 'Machine hours H (h/year)'), c.H, b.H, v => fmt(v, 0), null)}
        ${row(L('Unidades necessárias', 'Units required'), c.units, b.units, v => fmt(v, 0), 'low')}
        ${row(L('Mão-de-obra / supervisão (h/ano)', 'Labour / supervision (h/year)'), c.labourH, b.labourH, v => fmt(v, 0), 'low')}
        ${row(`${L('Energia', 'Energy')} (${eu(inp.conv)} | ${eu(inp.robot)} ${yr})`, c.energyQty, b.energyQty, v => fmt(v, 0), null)}
        ${row(L('Investimento imputado I₀', 'Allocated investment I₀'), c.I0, b.I0, v => eur(v), 'low')}
        ${row(L('Custo de energia', 'Energy cost') + ` (€${yr})`, c.cEnergy, b.cEnergy, v => eur(v), 'low')}
        ${row(L('Mão-de-obra', 'Labour') + ` (€${yr})`, c.cLabour, b.cLabour, v => eur(v), 'low')}
        ${row(L('Manutenção', 'Maintenance') + ` (€${yr})`, c.maint, b.maint, v => eur(v), 'low')}
        ${row(L('Consumíveis', 'Inputs') + ` (€${yr})`, c.cInputs, b.cInputs, v => eur(v), 'low')}
        ${row(L('Serviço contratado', 'Contracted service') + ` (€${yr})`, c.cService, b.cService, v => eur(v), 'low')}
        ${row(L('Outros', 'Other') + ` (€${yr})`, c.cOther, b.cOther, v => eur(v), 'low')}
        ${row(L('Custo operacional Cop', 'Operating cost Cop') + ` (€${yr})`, c.Cop, b.Cop, v => eur(v), 'low', true)}
        ${row(L(`Custo operacional por ${fu} (Cunit)`, `Operating cost per ${fu} (Cunit)`), c.Cunit, b.Cunit, v => eur(v, 2), 'low')}
        ${row(L(`TCO descontado ${c.T} anos`, `Discounted TCO, ${c.T} years`), c.TCO, b.TCO, v => eur(v), 'low', true)}
        ${row(L(`Custo nivelado (€/${fu})`, `Levelised cost (€/${fu})`), c.levelised, b.levelised, v => eur(v, 2), 'low')}
        ${row(`${L('Emissões', 'Emissions')} (kg CO₂e${yr})`, c.E, b.E, v => fmt(v, 0), 'low')}
        ${row(`${L('Emissões', 'Emissions')} (kg CO₂e/${fu})`, c.Eunit, b.Eunit, v => fmt(v, 2), 'low')}
        </tbody>`;

    drawChart('breakdown', cfgBreakdown(inp, R));
    drawChart('cumulative', cfgCumulative(inp, R));
    drawChart('emissions', cfgEmissions(inp, R));
    drawChart('cashflow', cfgCashflow(inp, R));
}

function sensPct() { return Math.max(1, num($('#roi-sens-pct').value) || 20); }

function renderSens() {
    const inp = S.inputs, R = S.res;
    $('#roi-be-kpis').innerHTML = [
        kpi(L('Break-even de área A*', 'Area break-even A*'), fin(R.be.area) ? fmt(R.be.area, 1) + ' ha' : (R.be.alwaysRobot ? L('sempre robô', 'always robot') : '—'),
            R.be.crossings.length > 1 ? L(`${R.be.crossings.length} cruzamentos (efeito de nº de unidades)`, `${R.be.crossings.length} crossings (number-of-units effect)`) : 'TCOrobot(A*) = TCOconv(A*)'),
        kpi(L('Break-even de utilização U*', 'Utilisation break-even U*'), fin(R.beHours) ? fmt(R.beHours) + L(' h/ano', ' h/year') : '—', L('horas de robô por ano', 'robot hours per year')),
        kpi(L('Preço máximo competitivo do robô', 'Maximum competitive robot price'), fin(R.maxRobotPrice) ? eur(R.maxRobotPrice) : '—',
            inp.robot.mode === 'own' ? L(`actual: ${eur(num(inp.robot.investment))}`, `current: ${eur(num(inp.robot.investment))}`) : L('robô em modo serviço', 'robot in service mode'),
            fin(R.maxRobotPrice) ? (R.maxRobotPrice >= num(inp.robot.investment) ? 'good' : 'bad') : ''),
        kpi(L('Tarifa RaaS máxima competitiva', 'Maximum competitive RaaS fee'), fin(R.maxRaasFee) ? eur(R.maxRaasFee, 0) + '/ha·op' : '—',
            L(`custo nivelado conv.: ${eur(R.conv.levelised, 0)}/ha·op`, `conv. levelised cost: ${eur(R.conv.levelised, 0)}/ha·op`)),
    ].join('');

    const rows = guideScenarios(inp);
    $('#roi-sens-table').innerHTML = `<thead><tr><th>${L('Cenário', 'Scenario')}</th><th>${L('Área (ha)', 'Area (ha)')}</th><th>${L('TCO conv.', 'Conv. TCO')}</th><th>${L('TCO robô', 'Robot TCO')}</th><th>${L('€/un conv.', 'Conv. €/unit')}</th><th>${L('€/un robô', 'Robot €/unit')}</th><th>${L('VAL adopção', 'Adoption NPV')}</th><th>${L('Melhor', 'Best')}</th></tr></thead><tbody>` +
        rows.map(s => `<tr${s.base ? ' style="font-weight:700;background:#f9fafb"' : ''}><td>${esc(s.label)}</td><td>${fmt(s.area, 1)}</td>
            <td class="c">${eur(s.convTCO)}</td><td class="r">${eur(s.robotTCO)}</td>
            <td class="c">${eur(s.convUnit, 1)}</td><td class="r">${eur(s.robotUnit, 1)}</td>
            <td class="${s.npv >= 0 ? 'roi-pos' : 'roi-neg'}">${sgn(s.npv)}</td>
            <td>${s.npv >= 0 ? `<span class="roi-pill g">${ROBOT()}</span>` : `<span class="roi-pill b">${CONV()}</span>`}</td></tr>`).join('') + '</tbody>';

    drawChart('area', cfgArea(inp, R));
    drawChart('tornado', cfgTornado(inp, R, sensPct()));
}

// ── Apresentação / Presentation (4 slides from the guide + optional comparison) ──
function renderPres() {
    const inp = S.inputs, R = S.res, sc = inp.scenario, c = R.conv, b = R.robot;
    const fu = esc(sc.func_unit || L('un', 'unit'));
    const title = esc($('#roi-name').value || L('Simulação ROI', 'ROI simulation'));
    const group = esc($('#roi-group').value || '');
    const foot = `<div class="foot">${title}${group ? ' · ' + group : ''} · SoilQI ${L('Calculadora ROI', 'ROI Calculator')} · ${L('Metodologia', 'Method')}: ${L('TCO descontado', 'discounted TCO')} (r = ${fmt(num(sc.discount_rate), 1)} %, ${c.T} ${YRS()}); Pinheiro et al. (2026) Agric. Syst. 231, 104541</div>`;
    const imgCum = chartPng(cfgCumulative(inp, R));
    const imgArea = chartPng(cfgArea(inp, R));
    const imgEm = chartPng(cfgEmissions(inp, R));
    const imgTor = chartPng(cfgTornado(inp, R, sensPct()));
    const sens = guideScenarios(inp).filter(s => !s.base);
    const winSens = sens.filter(s => s.npv > 0).map(s => s.label);
    const top = tornado(inp, 20)[0];
    const yr = L('/ano', '/year');

    let html = `
    <div class="roi-slide">
        <h4>1 · ${L('Tarefa &amp; Robô', 'Task &amp; Robot')}</h4><h2>${esc(sc.operation || L('Operação', 'Operation'))} — ${esc(sc.crop || L('Cultura', 'Crop'))}</h2>
        <div class="body">
            <ul>
                <li><b>${ROBOT()}:</b> ${esc(inp.robot.name)} (${modeLabel(inp.robot.mode)})</li>
                <li><b>${L('Referência convencional', 'Conventional baseline')}:</b> ${esc(inp.conv.name)} (${modeLabel(inp.conv.mode)})</li>
                <li><b>${L('Cenário', 'Scenario')}:</b> ${fmt(num(sc.area), 1)} ha × ${fmt(num(sc.ops_per_year))} ${L('operações/ano', 'operations/year')} = ${fmt(c.Q)} ${fu}${yr}</li>
                <li><b>${L('Unidade funcional', 'Functional unit')}:</b> 1 ${fu}</li>
                ${num(sc.window_days) > 0 ? `<li><b>${L('Janela operacional', 'Operational window')}:</b> ${fmt(num(sc.window_days))} ${L('dias por operação', 'days per operation')}</li>` : ''}
                <li><b>${L('Horizonte', 'Horizon')}:</b> ${c.T} ${YRS()}, ${L('taxa de desconto', 'discount rate')} ${fmt(num(sc.discount_rate), 1)} %</li>
            </ul>
            <div style="font-size:11px;color:#6b7280;white-space:pre-wrap;overflow:auto">${esc(sc.sources || '')}</div>
        </div>${foot}
    </div>
    <div class="roi-slide">
        <h4>2 · ${L('Técnico &amp; Económico', 'Technical &amp; Economic')}</h4><h2>TCO ${c.T} ${YRS()}: ${eur(b.TCO)} (${L('robô', 'robot')}) vs ${eur(c.TCO)} (conv.)</h2>
        <div class="body">
            <div>
                <table class="roi-t">
                    <thead><tr><th></th><th>Conv.</th><th>${ROBOT()}</th></tr></thead>
                    <tbody>
                    <tr><td>${L('Capacidade (ha/h)', 'Capacity (ha/h)')}</td><td>${fmt(num(inp.conv.capacity), 2)}</td><td>${fmt(num(inp.robot.capacity), 2)}</td></tr>
                    <tr><td>${L('Horas/ano', 'Hours/year')}</td><td>${fmt(c.H)}</td><td>${fmt(b.H)}</td></tr>
                    <tr><td>${L('Mão-de-obra (h/ano)', 'Labour (h/year)')}</td><td>${fmt(c.labourH)}</td><td>${fmt(b.labourH)}</td></tr>
                    <tr><td>Cop (€${yr})</td><td>${eur(c.Cop)}</td><td>${eur(b.Cop)}</td></tr>
                    <tr><td>Cunit (€/${fu})</td><td>${eur(c.Cunit, 2)}</td><td>${eur(b.Cunit, 2)}</td></tr>
                    <tr><td>${L('Custo nivelado', 'Levelised cost')} (€/${fu})</td><td>${eur(c.levelised, 2)}</td><td>${eur(b.levelised, 2)}</td></tr>
                    <tr><td><b>TCO</b></td><td><b>${eur(c.TCO)}</b></td><td><b>${eur(b.TCO)}</b></td></tr>
                    </tbody>
                </table>
                <p style="font-size:13px;margin:10px 0 0">${L('VAL da adopção', 'Adoption NPV')}: <b class="${R.npv >= 0 ? 'roi-pos' : 'roi-neg'}">${eur(R.npv)}</b>
                 · ROI ${fin(R.roiPct) ? fmt(R.roiPct, 0) + ' %' : '—'} · Payback ${fin(R.paybackDisc) ? fmt(R.paybackDisc, 1) + ' ' + YRS() : '—'}<br>
                 Break-even: <b>${fin(R.be.area) ? fmt(R.be.area, 1) + ' ha' : (R.be.alwaysRobot ? L('sempre robô', 'always robot') : L('não atingido', 'not reached'))}</b>${fin(R.beHours) ? ` (U* ≈ ${fmt(R.beHours)} h${yr})` : ''}</p>
            </div>
            <div class="imgbox"><img src="${imgArea || imgCum}" alt=""></div>
        </div>${foot}
    </div>
    <div class="roi-slide">
        <h4>3 · ${L('Ambiental', 'Environmental')}</h4><h2>${L('Emissões operacionais', 'Operational emissions')} ${fin(R.co2Red) ? (R.co2Red >= 0 ? '−' : '+') + fmt(Math.abs(R.co2Red), 0) + ' %' : ''}</h2>
        <div class="body">
            <div>
                <div class="big">${fmt(c.E)} → ${fmt(b.E)}</div><div style="color:#6b7280;margin-bottom:10px">kg CO₂e ${L('/ ano', '/ year')}</div>
                <ul>
                    <li>${L('Energia', 'Energy')}: ${fmt(c.energyQty)} ${energyUnit(inp.conv.energy_type)} vs ${fmt(b.energyQty)} ${energyUnit(inp.robot.energy_type)} ${L('por ano', 'per year')}</li>
                    <li>${L('Por unidade funcional', 'Per functional unit')}: ${fmt(c.Eunit, 2)} vs ${fmt(b.Eunit, 2)} kg CO₂e/${fu}</li>
                    <li>${L('Factores EF', 'EF factors')}: ${fmt(num(inp.conv.ef), 2)} ${L('e', 'and')} ${fmt(num(inp.robot.ef), 2)} ${L('kg CO₂e/unid. energia (não são ciclo de vida completo)', 'kg CO₂e/energy unit (not full life-cycle)')}</li>
                    ${(num(inp.conv.input_waste) !== num(inp.robot.input_waste)) ? `<li>${L('Desperdício de consumíveis', 'Input waste')}: ${fmt(num(inp.conv.input_waste))} % vs ${fmt(num(inp.robot.input_waste))} %</li>` : ''}
                    <li>${L('Considerar também: compactação do solo, ruído, baterias e fabrico.', 'Also consider: soil compaction, noise, batteries and manufacturing.')}</li>
                </ul>
            </div>
            <div class="imgbox"><img src="${imgEm}" alt=""></div>
        </div>${foot}
    </div>
    <div class="roi-slide">
        <h4>4 · ${L('Recomendação', 'Recommendation')}</h4><h2>${R.npv > 0 ? L('Recomenda-se a adopção do robô', 'Robot adoption is recommended') : L('Adopção do robô apenas sob condições', 'Robot adoption only under specific conditions')}</h2>
        <div class="body">
            <div>
                <ul>
                    <li>${R.verdict.replace(/<\/?b>/g, '')}</li>
                    ${fin(R.maxRobotPrice) ? `<li>${L('Preço máximo competitivo do robô', 'Maximum competitive robot price')}: <b>${eur(R.maxRobotPrice)}</b></li>` : ''}
                    ${fin(R.maxRaasFee) ? `<li>${L('Tarifa RaaS máxima competitiva', 'Maximum competitive RaaS fee')}: <b>${eur(R.maxRaasFee, 0)}/ha·op</b></li>` : ''}
                    ${top ? `<li>${L('Parâmetro mais sensível', 'Most sensitive parameter')}: <b>${esc(top.label)}</b> (±20 % → Δ ${L('VAL', 'NPV')} ${sgn(top.low)} / ${sgn(top.high)})</li>` : ''}
                    <li>${L('Cenários favoráveis ao robô', 'Scenarios favouring the robot')}: ${winSens.length ? esc(winSens.join('; ')) : L('nenhum dos cenários testados', 'none of the scenarios tested')}</li>
                </ul>
                ${inp.recommendation ? `<p style="margin-top:10px;padding:10px;background:#eef2ff;border-radius:8px;white-space:pre-wrap">${esc(inp.recommendation)}</p>` : ''}
            </div>
            <div class="imgbox"><img src="${imgTor}" alt=""></div>
        </div>${foot}
    </div>`;

    const cmp = S.saved.filter(s => S.compareIds.includes(s.id));
    if (cmp.length) {
        html += `<div class="roi-slide"><h4>${L('Anexo · Comparação de cenários', 'Annex · Scenario comparison')}</h4><h2>${cmp.length} ${L('simulações', 'simulations')}</h2>
            <div class="body">
            <div style="overflow:auto"><table class="roi-t"><thead><tr><th>${L('Simulação', 'Simulation')}</th><th>${L('Área', 'Area')}</th><th>${L('TCO conv.', 'Conv. TCO')}</th><th>${L('TCO robô', 'Robot TCO')}</th><th>${L('VAL', 'NPV')}</th><th>A*</th><th>CO₂e</th></tr></thead><tbody>
            ${cmp.map(s => { const m = s.results || {}; return `<tr><td>${esc(s.name)}</td><td>${fmt(m.area, 1)}</td><td>${keur(m.conv_tco)}</td><td>${keur(m.robot_tco)}</td>
                <td class="${(m.npv || 0) >= 0 ? 'roi-pos' : 'roi-neg'}">${keur(m.npv)}</td><td>${m.breakeven_area != null ? fmt(m.breakeven_area, 1) : '—'}</td>
                <td>${m.co2_reduction_pct != null ? fmt(-m.co2_reduction_pct, 0) + ' %' : '—'}</td></tr>`; }).join('')}
            </tbody></table></div>
            <div class="imgbox"><img src="${chartPng(cfgCompare(cmp))}" alt=""></div></div>${foot}</div>`;
    }
    $('#roi-pres-print').innerHTML = html;
}

function presMarkdown() {
    const inp = S.inputs, R = S.res, sc = inp.scenario, c = R.conv, b = R.robot, fu = sc.func_unit || L('un', 'unit');
    const out = [];
    out.push(`# ${$('#roi-name').value || L('Simulação ROI', 'ROI simulation')}`, '');
    out.push(`## 1. ${L('Tarefa & Robô', 'Task & Robot')}`,
        `- ${L('Operação', 'Operation')}: ${sc.operation} — ${sc.crop}`,
        `- ${ROBOT()}: ${inp.robot.name} (${modeLabel(inp.robot.mode)})`,
        `- ${CONV()}: ${inp.conv.name} (${modeLabel(inp.conv.mode)})`,
        `- ${L('Cenário', 'Scenario')}: ${fmt(num(sc.area), 1)} ha × ${fmt(num(sc.ops_per_year))} op${L('/ano', '/year')}; r = ${fmt(num(sc.discount_rate), 1)} %; ${c.T} ${YRS()}`, '');
    out.push(`## 2. ${L('Técnico & Económico', 'Technical & Economic')}`, `| ${L('Indicador', 'Indicator')} | ${CONV()} | ${ROBOT()} |`, '|---|---:|---:|',
        `| ${L('Capacidade (ha/h)', 'Capacity (ha/h)')} | ${fmt(num(inp.conv.capacity), 2)} | ${fmt(num(inp.robot.capacity), 2)} |`,
        `| ${L('Horas/ano', 'Hours/year')} | ${fmt(c.H)} | ${fmt(b.H)} |`,
        `| Cop (€${L('/ano', '/year')}) | ${fmt(c.Cop)} | ${fmt(b.Cop)} |`,
        `| Cunit (€/${fu}) | ${fmt(c.Cunit, 2)} | ${fmt(b.Cunit, 2)} |`,
        `| TCO (€) | ${fmt(c.TCO)} | ${fmt(b.TCO)} |`, '',
        `- ${L('VAL adopção', 'Adoption NPV')}: ${eur(R.npv)}; ROI: ${fin(R.roiPct) ? fmt(R.roiPct, 0) + ' %' : '—'}; ${L('TIR', 'IRR')}: ${fin(R.irr) ? fmt(R.irr * 100, 1) + ' %' : '—'}; ${L('payback descontado', 'discounted payback')}: ${fin(R.paybackDisc) ? fmt(R.paybackDisc, 1) + ' ' + YRS() : '—'}`,
        `- Break-even: ${fin(R.be.area) ? fmt(R.be.area, 1) + ' ha' : '—'} (U* ${fin(R.beHours) ? fmt(R.beHours) + L(' h/ano', ' h/year') : '—'})`, '');
    out.push(`## 3. ${L('Ambiental', 'Environmental')}`, `- ${L('Emissões', 'Emissions')}: ${fmt(c.E)} vs ${fmt(b.E)} kg CO₂e${L('/ano', '/year')} (${fmt(c.Eunit, 2)} vs ${fmt(b.Eunit, 2)} kg CO₂e/${fu})`, '');
    out.push(`## 4. ${L('Recomendação', 'Recommendation')}`, R.verdict.replace(/<\/?b>/g, ''), '', inp.recommendation || '', '');
    out.push(`### ${L('Sensibilidade', 'Sensitivity')}`, `| ${L('Cenário', 'Scenario')} | ${L('VAL adopção (€)', 'Adoption NPV (€)')} |`, '|---|---:|', ...guideScenarios(inp).map(s => `| ${s.label} | ${fmt(s.npv)} |`), '');
    if (sc.sources) out.push(`### ${L('Fontes e pressupostos', 'Sources and assumptions')}`, sc.sources);
    download(`roi_${slug($('#roi-name').value || 'simulation')}.md`, out.join('\n'), 'text/markdown');
}

function download(name, text, type) {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ══════════════════════════════════════════════════════════════════════════
//  SIMULAÇÕES GUARDADAS / SAVED SIMULATIONS
// ══════════════════════════════════════════════════════════════════════════

function loadList() {
    return post('roi_list').then(d => {
        if (!d.success) { toast(d.message || L('Erro a carregar simulações.', 'Error loading simulations.'), 'error'); return; }
        S.saved = d.simulations || [];
        const ids = new Set(S.saved.map(s => s.id));
        S.selected.forEach(id => { if (!ids.has(id)) S.selected.delete(id); });
        $('#roi-saved-count').textContent = S.saved.length;
        renderSaved();
    });
}

function renderSaved() {
    const q = ($('#roi-filter').value || '').toLowerCase();
    const rows = S.saved.filter(s => !q || (s.name + ' ' + (s.group_label || '')).toLowerCase().includes(q));
    const tbl = $('#roi-saved-table');
    if (!rows.length) {
        tbl.innerHTML = `<tbody><tr><td class="roi-empty">${S.saved.length ? L('Nenhuma simulação corresponde ao filtro.', 'No simulation matches the filter.')
            : L('Ainda não há simulações guardadas. Use 💾 Guardar na calculadora.', 'No saved simulations yet. Use 💾 Save in the calculator.')}</td></tr></tbody>`;
        renderCompare(); return;
    }
    tbl.innerHTML = `<thead><tr><th style="width:24px"></th><th>${L('Simulação', 'Simulation')}</th><th>${L('Grupo', 'Group')}</th><th>${L('Área', 'Area')}</th><th>${L('TCO conv.', 'Conv. TCO')}</th><th>${L('TCO robô', 'Robot TCO')}</th><th>${L('VAL', 'NPV')}</th><th>ROI</th><th>Break-even</th><th>Δ CO₂e</th><th>${L('Actualizada', 'Updated')}</th><th></th></tr></thead><tbody>` +
        rows.map(s => {
            const m = s.results || {};
            return `<tr${s.id === S.id ? ' style="background:#eef2ff"' : ''}>
                <td><input type="checkbox" data-sel="${s.id}" ${S.selected.has(s.id) ? 'checked' : ''}></td>
                <td><b>${esc(s.name)}</b><div style="font-size:10px;color:#9ca3af">${esc(m.operation || '')} ${m.crop ? '· ' + esc(m.crop) : ''}</div></td>
                <td>${esc(s.group_label || '')}</td><td>${m.area != null ? fmt(m.area, 1) + ' ha' : '—'}</td>
                <td class="c">${keur(m.conv_tco)}</td><td class="r">${keur(m.robot_tco)}</td>
                <td class="${(m.npv || 0) >= 0 ? 'roi-pos' : 'roi-neg'}">${keur(m.npv)}</td>
                <td>${m.roi_pct != null ? fmt(m.roi_pct, 0) + ' %' : '—'}</td>
                <td>${m.breakeven_area != null ? fmt(m.breakeven_area, 1) + ' ha' : '—'}</td>
                <td>${m.co2_reduction_pct != null ? (m.co2_reduction_pct >= 0 ? '−' : '+') + fmt(Math.abs(m.co2_reduction_pct), 0) + ' %' : '—'}</td>
                <td style="font-size:11px;color:#6b7280">${esc(s.updated_at)}</td>
                <td><button class="roi-btn" data-open="${s.id}">${L('Abrir', 'Open')}</button> <button class="roi-btn dan" data-del="${s.id}" title="${L('Eliminar', 'Delete')}">🗑</button></td>
            </tr>`;
        }).join('') + '</tbody>';
    renderCompare();
}

function renderCompare() {
    const rows = S.saved.filter(s => S.selected.has(s.id));
    const card = $('#roi-cmp-card');
    if (rows.length < 1) { card.style.display = 'none'; if (S.charts.compare) { S.charts.compare.destroy(); delete S.charts.compare; } return; }
    card.style.display = '';
    drawChart('compare', cfgCompare(rows));
}

function openSim(id) {
    if (S.dirty && !confirm(L('Há alterações por guardar na simulação actual. Continuar?', 'The current simulation has unsaved changes. Continue?'))) return;
    post('roi_get', { id }).then(d => {
        if (!d.success) { toast(d.message, 'error'); return; }
        const s = d.simulation, def = defaultInputs();
        S.id = s.id;
        S.inputs = { scenario: { ...def.scenario, ...(s.inputs.scenario || {}) }, conv: { ...BASE_OPTION, ...(s.inputs.conv || {}) },
                     robot: { ...BASE_OPTION, ...(s.inputs.robot || {}) }, recommendation: s.inputs.recommendation || '' };
        $('#roi-name').value = s.name; $('#roi-group').value = s.group_label || '';
        writeForm(S.inputs); recalc(); setDirty(false); showSec('calc'); renderSaved();
    });
}

function saveSim(asCopy) {
    const name = $('#roi-name').value.trim();
    if (!name) { toast(L('Indique um nome para a simulação.', 'Enter a name for the simulation.'), 'error'); $('#roi-name').focus(); return; }
    recalc();
    const id = asCopy ? 0 : S.id;
    const finalName = (asCopy && S.id && S.saved.some(s => s.name === name)) ? name + L(' (cópia)', ' (copy)') : name;
    $('#roi-save').disabled = true;
    post('roi_save', {
        id, name: finalName, group_label: $('#roi-group').value.trim(), notes: '',
        inputs: JSON.stringify(S.inputs), results: JSON.stringify(macro(S.inputs, S.res)),
    }).then(d => {
        $('#roi-save').disabled = false;
        if (!d.success) { toast(d.message || L('Erro ao guardar.', 'Error saving.'), 'error'); return; }
        S.id = d.id; $('#roi-name').value = finalName; setDirty(false);
        toast(asCopy ? L('Cópia guardada.', 'Copy saved.') : L('Simulação guardada.', 'Simulation saved.'), 'success');
        loadList();
    });
}

function deleteSim(id) {
    const s = S.saved.find(x => x.id === id);
    if (!confirm(L(`Eliminar definitivamente a simulação "${s ? s.name : id}"?`, `Permanently delete simulation "${s ? s.name : id}"?`))) return;
    post('roi_delete', { id }).then(d => {
        toast(d.success ? L('Simulação eliminada.', 'Simulation deleted.') : (d.message || L('Erro.', 'Error.')), d.success ? 'success' : 'error');
        if (d.success && S.id === id) { S.id = 0; setDirty(true); }
        S.selected.delete(id); loadList();
    });
}

function selectedOrAll() {
    const ids = S.selected.size ? Array.from(S.selected) : S.saved.map(s => s.id);
    return S.saved.filter(s => ids.includes(s.id));
}

function exportCsv() {
    const rows = selectedOrAll();
    if (!rows.length) { toast(L('Não há simulações para exportar.', 'No simulations to export.'), 'error'); return; }
    // PT: ';' + vírgula decimal (Excel PT) · EN: ',' + decimal point
    const SEP = L(';', ',');
    const cell = v => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'number') return LANG === 'pt' ? String(v).replace('.', ',') : String(v);
        if (v === 'robot' || v === 'conv') v = v === 'robot' ? ROBOT() : CONV();
        else if (v === 'own' || v === 'service') v = modeLabel(v);
        const s = String(v); return (s.includes(SEP) || /["\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [CSV_COLS.map(c => cell(L(c[1], c[2]))).join(SEP)];
    rows.forEach(s => {
        const m = Object.assign({}, s.results || {}, { name: s.name, group_label: s.group_label || '', updated_at: s.updated_at });
        lines.push(CSV_COLS.map(c => cell(m[c[0]])).join(SEP));
    });
    download(`soilqi_roi_${L('simulacoes', 'simulations')}_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}

function exportJson() {
    const rows = selectedOrAll();
    if (!rows.length) { toast(L('Não há simulações para exportar.', 'No simulations to export.'), 'error'); return; }
    post('roi_export', { ids: rows.map(r => r.id).join(',') }).then(d => {
        if (!d.success) { toast(d.message, 'error'); return; }
        download(`soilqi_roi_${L('simulacoes', 'simulations')}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d.simulations, null, 2), 'application/json');
    });
}

// ══════════════════════════════════════════════════════════════════════════
//  NAVEGAÇÃO E EVENTOS / NAVIGATION AND EVENTS
// ══════════════════════════════════════════════════════════════════════════

function showSec(name) {
    $$('#roi-app section[data-sec]').forEach(s => { s.style.display = s.dataset.sec === name ? '' : 'none'; });
    $$('#roi-app .roi-tab').forEach(b => b.classList.toggle('on', b.dataset.sec === name));
    try { localStorage.setItem('soilqi_roi_sec', name); } catch (e) { /* ignore */ }
    if (name === 'sens') renderSens();
    if (name === 'pres') renderPres();
    if (name === 'saved') loadList();
}

let _t = null;
function onInput() {
    syncOptionUi();
    S.inputs = readForm();
    setDirty(true);
    clearTimeout(_t); _t = setTimeout(recalc, 180);
}

function init() {
    if (!$('#roi-app')) return;

    // Memorizar idioma escolhido / Remember the chosen language
    try { document.cookie = `soilqi_lang=${LANG}; path=/; max-age=31536000; SameSite=Lax`; } catch (e) { /* ignore */ }

    // Restaurar rascunho local / Restore local draft (per-user convenience)
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
    if (draft && draft.inputs) {
        const def = defaultInputs();
        S.inputs = { scenario: { ...def.scenario, ...draft.inputs.scenario }, conv: { ...BASE_OPTION, ...draft.inputs.conv },
                     robot: { ...BASE_OPTION, ...draft.inputs.robot }, recommendation: draft.inputs.recommendation || '' };
        S.id = draft.id || 0;
        S.dirty = !!draft.dirty;
        $('#roi-name').value = draft.name || ''; $('#roi-group').value = draft.group || '';
    } else {
        S.inputs = presetInputs('vineyard');
        $('#roi-name').value = PRESETS.vineyard.name;
    }
    writeForm(S.inputs);

    $('#roi-form').addEventListener('input', onInput);
    $('#roi-form').addEventListener('change', onInput);
    $('#roi-reco').addEventListener('input', () => { S.inputs.recommendation = $('#roi-reco').value; setDirty(true); });
    $('#roi-reco').addEventListener('change', () => renderPres());
    ['#roi-name', '#roi-group'].forEach(s => $(s).addEventListener('input', () => setDirty(true)));

    $$('#roi-app .roi-tab').forEach(b => b.addEventListener('click', () => showSec(b.dataset.sec)));
    $('#roi-app').addEventListener('click', e => {
        const dl = e.target.closest('[data-chart]'); if (dl) { downloadChart(dl.dataset.chart); return; }
        const op = e.target.closest('[data-open]'); if (op) { openSim(+op.dataset.open); return; }
        const del = e.target.closest('[data-del]'); if (del) { deleteSim(+del.dataset.del); return; }
    });
    $('#roi-saved-table').addEventListener('change', e => {
        const cb = e.target.closest('[data-sel]'); if (!cb) return;
        const id = +cb.dataset.sel; cb.checked ? S.selected.add(id) : S.selected.delete(id);
        renderCompare();
    });

    $('#roi-preset').addEventListener('change', e => {
        const k = e.target.value; e.target.value = '';
        if (!k) return;
        if (S.dirty && !confirm(L('Carregar o exemplo substitui os valores actuais. Continuar?', 'Loading the example replaces the current values. Continue?'))) return;
        S.id = 0; S.inputs = presetInputs(k);
        $('#roi-name').value = PRESETS[k].name; writeForm(S.inputs); recalc(); setDirty(true);
    });
    $('#roi-new').addEventListener('click', () => {
        if (S.dirty && !confirm(L('Descartar as alterações actuais e começar uma nova simulação?', 'Discard current changes and start a new simulation?'))) return;
        S.id = 0; S.inputs = defaultInputs(); $('#roi-name').value = ''; $('#roi-group').value = '';
        writeForm(S.inputs); recalc(); setDirty(false); $('#roi-name').focus();
    });
    $('#roi-save').addEventListener('click', () => saveSim(false));
    $('#roi-saveas').addEventListener('click', () => saveSim(true));

    $('#roi-sens-pct').addEventListener('change', renderSens);
    $('#roi-filter').addEventListener('input', renderSaved);
    $('#roi-sel-all').addEventListener('click', () => {
        const all = S.saved.length && S.saved.every(s => S.selected.has(s.id));
        S.selected = all ? new Set() : new Set(S.saved.map(s => s.id));
        renderSaved();
    });
    $('#roi-exp-csv').addEventListener('click', exportCsv);
    $('#roi-exp-json').addEventListener('click', exportJson);
    $('#roi-cmp-pres').addEventListener('click', () => {
        if (!S.selected.size) { toast(L('Seleccione as simulações a comparar.', 'Select the simulations to compare.'), 'error'); return; }
        S.compareIds = Array.from(S.selected); showSec('pres');
    });
    $('#roi-pres-md').addEventListener('click', presMarkdown);
    $('#roi-pres-print-btn').addEventListener('click', () => { renderPres(); setTimeout(() => window.print(), 150); });

    window.addEventListener('beforeunload', e => { if (S.dirty && S.id) { e.preventDefault(); e.returnValue = ''; } });

    recalc();
    setDirty(S.dirty);
    loadList();
    let sec = 'calc'; try { sec = localStorage.getItem('soilqi_roi_sec') || 'calc'; } catch (e) { /* ignore */ }
    if (sec !== 'calc' && $(`section[data-sec="${sec}"]`)) showSec(sec);
}

// Exposto para testes na consola / Exposed for console testing
window.soilqiRoi = { compute, calcOption, breakEvenArea, guideScenarios, tornado, macro, presetInputs, defaultInputs, LANG };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
