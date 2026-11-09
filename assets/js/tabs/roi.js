'use strict';
/**
 * assets/js/tabs/roi.js — Calculadora de Benefício / ROI: Robô vs. Convencional
 *
 * Modelo (guia prático FCUP 2026/27 + Pinheiro et al., 2026):
 *   Q  = A·N                      trabalho anual (ha·op/ano)
 *   H  = Q / P                    horas anuais de máquina
 *   Cop = Cenergia + Cmão-de-obra + Cmanutenção + Cconsumíveis + Cserviço + Coutros
 *   Cunit = Cop / Q
 *   TCO = I0 + Σt (Cop + Rt)/(1+r)^t − Vr/(1+r)^T
 *   E   = H · EC · EF
 *   Break-even A*: TCOrobô(A*) − PV(benefícios) = TCOconv(A*)
 */

(function () {

const ROI_URL = 'index.php?tab=roi';
const DRAFT_KEY = 'soilqi_roi_draft_v1';
const C_CONV = '#b45309', C_ROBOT = '#4f46e5', C_GOOD = '#047857', C_BAD = '#b91c1c';

// ── Valores por defeito e exemplos ──────────────────────────────────────────
const BASE_OPTION = {
    name: '', mode: 'own', investment: 0, alloc_pct: 100, residual: 0, useful_life: 10,
    replacement_cost: 0, replacement_year: 0, service_fee: 0, service_fixed: 0,
    capacity: 1, hours_per_day: 8, energy_type: 'diesel', consumption: 0, energy_price: 0, ef: 2.68,
    labour_ratio: 1, labour_cost: 12, maintenance: 0, other: 0, input_cost: 0, input_waste: 0,
    extra_benefit: 0,
};
const BASE_SCENARIO = {
    crop: '', operation: '', area: 10, ops_per_year: 1, func_unit: 'ha tratado', window_days: 0,
    discount_rate: 5, horizon: 10, scale_units: 1, sources: '',
};

const PRESETS = {
    vineyard: {
        name: 'Vinha — gestão de vegetação (exemplo)',
        scenario: { crop: 'Vinha', operation: 'Corte de vegetação na entrelinha', area: 20, ops_per_year: 6,
            func_unit: 'ha tratado', window_days: 0, discount_rate: 5, horizon: 10, scale_units: 1,
            sources: 'VALORES ILUSTRATIVOS (estimativas para fins didácticos) — substituir por dados de fabricantes, catálogos e literatura, indicando a fonte de cada valor e se é medido ou estimado.' },
        conv: { name: 'Tractor vinhateiro 80 cv + destroçador', mode: 'own', investment: 70000, alloc_pct: 40,
            residual: 25000, useful_life: 15, capacity: 1.2, hours_per_day: 8, energy_type: 'diesel',
            consumption: 7, energy_price: 1.45, ef: 2.68, labour_ratio: 1, labour_cost: 12,
            maintenance: 2500, other: 600 },
        robot: { name: 'Robô eléctrico autónomo de corte', mode: 'own', investment: 55000, alloc_pct: 100,
            residual: 10000, useful_life: 10, replacement_cost: 7000, replacement_year: 5,
            service_fee: 90, capacity: 0.5, hours_per_day: 16, energy_type: 'electric', consumption: 2.5,
            energy_price: 0.20, ef: 0.20, labour_ratio: 0.2, labour_cost: 14, maintenance: 1500, other: 800 },
    },
    spraying: {
        name: 'Pomar — pulverização dirigida (exemplo)',
        scenario: { crop: 'Macieira', operation: 'Pulverização fitossanitária', area: 30, ops_per_year: 12,
            func_unit: 'ha tratado', window_days: 0, discount_rate: 5, horizon: 10, scale_units: 1,
            sources: 'VALORES ILUSTRATIVOS (estimativas para fins didácticos) — confirmar preços, capacidades, consumos e taxas de deriva/desperdício com fontes documentadas.' },
        conv: { name: 'Tractor + atomizador convencional', mode: 'own', investment: 90000, alloc_pct: 50,
            residual: 30000, useful_life: 15, capacity: 1.5, hours_per_day: 8, energy_type: 'diesel',
            consumption: 9, energy_price: 1.45, ef: 2.68, labour_ratio: 1, labour_cost: 12,
            maintenance: 3000, other: 800, input_cost: 120, input_waste: 30 },
        robot: { name: 'Robô pulverizador com aplicação dirigida', mode: 'own', investment: 120000, alloc_pct: 100,
            residual: 25000, useful_life: 10, replacement_cost: 10000, replacement_year: 6, service_fee: 60,
            capacity: 1.0, hours_per_day: 18, energy_type: 'electric', consumption: 6, energy_price: 0.20,
            ef: 0.20, labour_ratio: 0.25, labour_cost: 14, maintenance: 3500, other: 1000,
            input_cost: 120, input_waste: 10 },
    },
    kiwi: {
        name: 'Kiwi — polinização robótica (Pinheiro et al., 2026)',
        scenario: { crop: 'Kiwi (Actinidia spp.)', operation: 'Polinização assistida (1 aplicação/ano)', area: 5,
            ops_per_year: 1, func_unit: 'ha polinizado', window_days: 7, discount_rate: 5, horizon: 10, scale_units: 1,
            sources: 'Pinheiro et al. (2026), Agricultural Systems 231, 104541: benchmark convencional 685 €/ha·aplicação (custo mínimo, MaP_HD); robô RS1 = 17 146 € (dimensionado para 5 ha); capacidade 1,0 ha/h; 17 h/dia; vida útil 10 anos; electricidade 0,30 €/kWh; pólen 3 000 €/kg; desperdício de pólen do robô 5 %; janela de polinização 7 dias.\nA PREENCHER (não indicados): consumo energético do robô, custo de pólen útil por ha, manutenção e supervisão.' },
        conv: { name: 'Polinizador manual (benchmark MaP_HD)', mode: 'service', service_fee: 685, service_fixed: 0,
            capacity: 0, hours_per_day: 8, energy_type: 'electric', consumption: 0, energy_price: 0.30, ef: 0.20,
            labour_ratio: 0, labour_cost: 17 },
        robot: { name: 'Robô de polinização (RS1)', mode: 'own', investment: 17146, alloc_pct: 100, residual: 0,
            useful_life: 10, service_fee: 685, capacity: 1.0, hours_per_day: 17, energy_type: 'electric',
            consumption: 0, energy_price: 0.30, ef: 0.20, labour_ratio: 0, labour_cost: 17, input_cost: 0,
            input_waste: 5 },
    },
};

function defaultInputs() {
    return {
        scenario: { ...BASE_SCENARIO },
        conv:  { ...BASE_OPTION, name: 'Máquina convencional' },
        robot: { ...BASE_OPTION, name: 'Robô', energy_type: 'electric', ef: 0.20, labour_ratio: 0.2 },
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

// ── Estado ──────────────────────────────────────────────────────────────────
const S = {
    id: 0, dirty: false, inputs: defaultInputs(), res: null,
    charts: {}, saved: [], selected: new Set(), compareIds: [],
};

// ── Utilitários ─────────────────────────────────────────────────────────────
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fin = v => Number.isFinite(v);

const nf = (d) => new Intl.NumberFormat('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);
function fmt(v, d = 0) { if (!fin(v)) return '—'; return (d === 0 ? NF0 : d === 1 ? NF1 : d === 2 ? NF2 : nf(d)).format(v); }
function eur(v, d = 0) { return fin(v) ? fmt(v, d) + ' €' : '—'; }
function keur(v) { if (!fin(v)) return '—'; return Math.abs(v) >= 10000 ? fmt(v / 1000, 1) + ' k€' : fmt(v, 0) + ' €'; }
function sgn(v, f = eur) { if (!fin(v)) return '—'; return (v > 0 ? '+' : '') + f(v); }
function energyUnit(t) { return t === 'electric' ? 'kWh' : 'L'; }

function post(action, data = {}) {
    const fd = new FormData();
    fd.append('action', action);
    Object.entries(data).forEach(([k, v]) => fd.append(k, v));
    return fetch(ROI_URL, { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(r => r.json())
        .catch(() => ({ success: false, message: 'Erro de rede.' }));
}
function toast(msg, type = 'success') {
    if (typeof window.showAlert === 'function') { window.showAlert(msg, type); return; }
    const el = $('#roi-status'); if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 3500); }
}

// ══════════════════════════════════════════════════════════════════════════
//  MOTOR DE CÁLCULO
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

    // Janela operacional → nº de unidades necessárias
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

/** Procura a área A* em que o VAL da adopção muda de sinal (escala logarítmica + bissecção). */
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
    // Interpolação do ano de retorno descontado
    if (fin(paybackDisc) && paybackDisc > 0) {
        const t = paybackDisc, prev = incCum[t - 1], cur = incCum[t];
        if (cur !== prev) paybackDisc = (t - 1) + (-prev) / (cur - prev);
    }
    const paybackSimple = (extraInv > 0 && annualSaving > 0) ? extraInv / annualSaving : NaN;
    const roiPct = extraInv > 0 ? npv / extraInv * 100 : NaN;

    const be = breakEvenArea(inp);
    const beHours = fin(be.area) && robot.P > 0 ? be.area * num(sc.ops_per_year) / robot.P : NaN;

    // Preço máximo do robô (compra) para igualar TCO — "valor do robô" (Model 1)
    const perEuro = (robot.svc ? 0 : num(inp.robot.alloc_pct) / 100 * robot.units);
    const maxRobotPrice = (!robot.svc && perEuro > 0) ? num(inp.robot.investment) + npv / perEuro : NaN;

    // Tarifa máxima de serviço RaaS competitiva (€/ha·op) — benchmark tipo 685 €/ha (Model 2)
    const raasZero = calcOption({ ...inp.robot, mode: 'service', service_fee: 0 }, sc, A);
    const maxRaasFee = raasZero.discQ > 0 ? (conv.TCO - raasZero.TCO + B * raasZero.annuity) / raasZero.discQ : NaN;

    const co2Red = conv.E > 0 ? (conv.E - robot.E) / conv.E * 100 : NaN;

    const warnings = [];
    ['conv', 'robot'].forEach(k => {
        const o = inp[k], c = k === 'conv' ? conv : robot, lbl = k === 'conv' ? 'Convencional' : 'Robô';
        if (num(o.capacity) <= 0) warnings.push(`${lbl}: capacidade efectiva não definida — horas, energia, mão-de-obra e emissões ficam a zero.`);
        if (c.unitsNeeded > 1) warnings.push(`${lbl}: uma unidade cobre no máx. ${fmt(c.maxAreaUnit, 1)} ha na janela de ${fmt(num(sc.window_days))} dias → são necessárias <b>${c.unitsNeeded} unidades</b>${c.units > 1 ? ' (custos de capital multiplicados)' : (c.svc ? ' (serviço)' : ' (não escalado)')}.`);
        if (!c.svc && num(o.useful_life) > 0 && num(o.useful_life) < c.T && !(num(o.replacement_cost) > 0))
            warnings.push(`${lbl}: vida útil (${fmt(num(o.useful_life))} anos) inferior ao horizonte (${c.T} anos) sem custo de substituição definido.`);
        if (!c.svc && num(o.replacement_year) > c.T) warnings.push(`${lbl}: ano de substituição fora do horizonte — ignorado.`);
    });
    if (num(sc.area) <= 0 || num(sc.ops_per_year) <= 0) warnings.push('Defina a área e o nº de operações por ano.');

    // Veredicto
    let verdict, vclass;
    const fu = sc.func_unit || 'ha·op';
    if (npv > 0) {
        vclass = 'good';
        verdict = `<b>O robô é economicamente vantajoso</b> neste cenário: poupança de <b>${eur(npv)}</b> em valor actual a ${conv.T} anos (TCO ${eur(robot.TCO)} vs ${eur(conv.TCO)}).`;
    } else {
        vclass = (Math.abs(npv) < 0.1 * conv.TCO) ? 'mid' : 'bad';
        verdict = `<b>A solução convencional é mais económica</b> neste cenário: o robô custa mais <b>${eur(-npv)}</b> em valor actual a ${conv.T} anos.`;
    }
    if (fin(be.area)) verdict += ` Break-even em <b>${fmt(be.area, 1)} ha</b> (≈ ${fmt(beHours)} h/ano de robô)${be.dir === 'up' ? '; o robô compensa acima desta área' : '; o robô compensa abaixo desta área'}.`;
    else if (be.alwaysRobot) verdict += ' O robô é vantajoso em todas as áreas analisadas.';
    else verdict += ` Sem break-even até ${fmt(be.searchMax)} ha — o robô não compensa por via da área (rever custos, produtividade ou modelo RaaS).`;
    if (fin(co2Red)) verdict += ` Emissões operacionais ${co2Red >= 0 ? '−' : '+'}${fmt(Math.abs(co2Red), 0)} % (${fmt(robot.Eunit, 1)} vs ${fmt(conv.Eunit, 1)} kg CO₂e/${esc(fu)}).`;

    return { conv, robot, B, pvB, npv, extraInv, annualSaving, inc, incCum, irr: irrV, paybackDisc, paybackSimple,
             roiPct, be, beHours, maxRobotPrice, maxRaasFee, co2Red, warnings, verdict, vclass };
}

// ── Sensibilidade ───────────────────────────────────────────────────────────
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function mut(inp, fn) { const c = clone(inp); fn(c); return c; }

function guideScenarios(inp) {
    const list = [
        ['Base', i => i],
        ['Área −50 %', i => { i.scenario.area *= 0.5; }],
        ['Área +50 %', i => { i.scenario.area *= 1.5; }],
        ['Mão-de-obra +30 %', i => { i.conv.labour_cost *= 1.3; i.robot.labour_cost *= 1.3; }],
        ['Energia +30 %', i => { i.conv.energy_price *= 1.3; i.robot.energy_price *= 1.3; }],
        ['Produtividade do robô −20 %', i => { i.robot.capacity *= 0.8; }],
        ['Custo de compra do robô −30 %', i => { i.robot.investment *= 0.7; }],
    ];
    if (inp.robot.mode === 'own' && num(inp.robot.service_fee) > 0)
        list.push([`Robô em RaaS a ${fmt(num(inp.robot.service_fee))} €/ha·op`, i => { i.robot.mode = 'service'; }]);
    if (inp.robot.mode === 'service' && num(inp.robot.investment) > 0)
        list.push(['Robô em compra (em vez de RaaS)', i => { i.robot.mode = 'own'; }]);
    return list.map(([label, fn]) => {
        const m = mut(inp, fn);
        const sc = m.scenario, A = num(sc.area);
        const c = calcOption(m.conv, sc, A), b = calcOption(m.robot, sc, A);
        const npv = c.TCO - b.TCO + num(m.robot.extra_benefit) * b.annuity;
        return { label, area: A, convTCO: c.TCO, robotTCO: b.TCO, npv, convUnit: c.levelised, robotUnit: b.levelised };
    });
}

function tornado(inp, pct) {
    const p = pct / 100;
    const params = [
        ['Área', i => i.scenario, 'area'],
        ['Operações/ano', i => i.scenario, 'ops_per_year'],
        ['Investimento robô', i => i.robot, 'investment'],
        ['Capacidade robô', i => i.robot, 'capacity'],
        ['Investimento conv.', i => i.conv, 'investment'],
        ['Capacidade conv.', i => i.conv, 'capacity'],
        ['Custo mão-de-obra', i => [i.conv, i.robot], 'labour_cost'],
        ['Preço energia', i => [i.conv, i.robot], 'energy_price'],
        ['Manutenção robô', i => i.robot, 'maintenance'],
        ['Supervisão robô', i => i.robot, 'labour_ratio'],
        ['Taxa de desconto', i => i.scenario, 'discount_rate'],
    ];
    if (inp.robot.mode === 'service') params.push(['Tarifa RaaS robô', i => i.robot, 'service_fee']);
    if (inp.conv.mode === 'service') params.push(['Tarifa serviço conv.', i => i.conv, 'service_fee']);
    if (num(inp.conv.input_cost) > 0 || num(inp.robot.input_cost) > 0)
        params.push(['Custo consumíveis', i => [i.conv, i.robot], 'input_cost']);
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

// ── Macro-dados guardados (para CSV / apresentação) ─────────────────────────
function macro(inp, R) {
    const sc = inp.scenario, c = R.conv, b = R.robot;
    const r2 = v => fin(v) ? Math.round(v * 100) / 100 : null;
    return {
        v: 1, computed_at: new Date().toISOString(),
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
    ['name', 'Simulação'], ['group_label', 'Grupo'], ['updated_at', 'Actualizada'],
    ['crop', 'Cultura'], ['operation', 'Operação'], ['func_unit', 'Unidade funcional'],
    ['area', 'Área (ha)'], ['ops_per_year', 'Operações/ano'], ['work_q', 'Trabalho Q (ha·op/ano)'],
    ['discount_rate', 'Taxa desconto (%)'], ['horizon', 'Horizonte (anos)'],
    ['conv_name', 'Convencional'], ['robot_name', 'Robô'], ['conv_mode', 'Modelo conv.'], ['robot_mode', 'Modelo robô'],
    ['conv_capacity', 'P conv. (ha/h)'], ['robot_capacity', 'P robô (ha/h)'],
    ['conv_hours', 'H conv. (h/ano)'], ['robot_hours', 'H robô (h/ano)'], ['conv_units', 'Unid. conv.'], ['robot_units', 'Unid. robô'],
    ['conv_labour_h', 'Mão-de-obra conv. (h/ano)'], ['robot_labour_h', 'Mão-de-obra robô (h/ano)'],
    ['conv_investment', 'I0 conv. imputado (€)'], ['robot_investment', 'I0 robô imputado (€)'],
    ['conv_cop', 'Cop conv. (€/ano)'], ['robot_cop', 'Cop robô (€/ano)'],
    ['conv_cunit', 'Cunit conv. (€/un)'], ['robot_cunit', 'Cunit robô (€/un)'],
    ['conv_tco', 'TCO conv. (€)'], ['robot_tco', 'TCO robô (€)'],
    ['conv_levelised', 'Custo nivelado conv. (€/un)'], ['robot_levelised', 'Custo nivelado robô (€/un)'],
    ['conv_energy', 'Energia conv. (/ano)'], ['conv_energy_unit', 'Unid. energia conv.'],
    ['robot_energy', 'Energia robô (/ano)'], ['robot_energy_unit', 'Unid. energia robô'],
    ['conv_co2', 'CO2e conv. (kg/ano)'], ['robot_co2', 'CO2e robô (kg/ano)'],
    ['conv_co2_unit', 'CO2e conv. (kg/un)'], ['robot_co2_unit', 'CO2e robô (kg/un)'], ['co2_reduction_pct', 'Redução CO2e (%)'],
    ['extra_benefit', 'Benefício adicional (€/ano)'], ['npv', 'VAL adopção robô (€)'], ['annual_saving', 'Poupança anual (€/ano)'],
    ['extra_investment', 'Investimento adicional (€)'], ['roi_pct', 'ROI (%)'], ['irr_pct', 'TIR (%)'],
    ['payback_simple', 'Payback simples (anos)'], ['payback_disc', 'Payback descontado (anos)'],
    ['breakeven_area', 'Break-even A* (ha)'], ['breakeven_hours', 'Break-even U* (h/ano)'],
    ['max_robot_price', 'Preço máx. robô (€)'], ['max_raas_fee', 'Tarifa RaaS máx. (€/ha·op)'], ['winner', 'Melhor opção'],
];

// ══════════════════════════════════════════════════════════════════════════
//  FORMULÁRIO
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
    if (st) st.innerHTML = S.id ? (d ? '● alterações por guardar' : '✓ guardada') : (d ? '● nova (não guardada)' : '');
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: S.id, dirty: d, name: $('#roi-name').value, group: $('#roi-group').value, inputs: S.inputs })); } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════
//  GRÁFICOS
// ══════════════════════════════════════════════════════════════════════════

const CHART_BASE = (extra = {}) => Object.assign({
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
               tooltip: { callbacks: {} } },
}, extra);

const eurTick = v => keur(v);

function cfgBreakdown(inp, R) {
    const lbl = ['Capital (anualizado)', 'Energia', 'Mão-de-obra', 'Manutenção', 'Consumíveis', 'Serviço', 'Outros'];
    const val = c => [c.capAnnual, c.cEnergy, c.cLabour, c.maint, c.cInputs, c.cService, c.cOther];
    const cols = ['#6b7280', '#f59e0b', '#0ea5e9', '#a855f7', '#10b981', '#ec4899', '#94a3b8'];
    const cv = val(R.conv), rv = val(R.robot);
    const datasets = lbl.map((l, i) => ({ label: l, data: [cv[i], rv[i]], backgroundColor: cols[i], stack: 's' }))
        .filter(d => d.data.some(x => Math.abs(x) > 0.5));
    return { type: 'bar', data: { labels: ['Convencional', 'Robô'], datasets },
        options: CHART_BASE({ scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: eurTick } } },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.raw)}/ano` } } } }) };
}

function cfgCumulative(inp, R) {
    const labels = R.conv.cumulative.map((_, t) => 'Ano ' + t);
    return { type: 'line', data: { labels, datasets: [
        { label: 'Convencional', data: R.conv.cumulative, borderColor: C_CONV, backgroundColor: C_CONV, tension: .15, pointRadius: 2 },
        { label: num(inp.robot.extra_benefit) ? 'Robô (− benefícios)' : 'Robô', data: R.robot.cumulative.map((v, t) => v - num(inp.robot.extra_benefit) * (t === 0 ? 0 : R.robot.cumulative.slice(1, t + 1).reduce((s, _, k) => s + Math.pow(1 + R.robot.r, -(k + 1)), 0))),
          borderColor: C_ROBOT, backgroundColor: C_ROBOT, tension: .15, pointRadius: 2 },
    ] }, options: CHART_BASE({ scales: { y: { ticks: { callback: eurTick } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.raw)}` } } } }) };
}

function cfgEmissions(inp, R) {
    const fu = inp.scenario.func_unit || 'un';
    return { type: 'bar', data: { labels: ['kg CO₂e / ano', `kg CO₂e / ${fu}`], datasets: [
        { label: 'Convencional', data: [R.conv.E, R.conv.Eunit], backgroundColor: C_CONV, yAxisID: 'y' },
        { label: 'Robô', data: [R.robot.E, R.robot.Eunit], backgroundColor: C_ROBOT, yAxisID: 'y' },
    ] }, options: CHART_BASE({ indexAxis: 'y', scales: { x: { type: 'logarithmic', ticks: { callback: v => fmt(v) } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)} kg CO₂e` } } } }) };
}

function cfgCashflow(inp, R) {
    const labels = R.inc.map((_, t) => 'Ano ' + t);
    return { type: 'bar', data: { labels, datasets: [
        { type: 'line', label: 'Acumulado descontado', data: R.incCum, borderColor: '#111827', backgroundColor: '#111827', pointRadius: 2, tension: .1 },
        { label: 'Fluxo anual (nominal)', data: R.inc, backgroundColor: R.inc.map(v => v >= 0 ? C_GOOD : C_BAD) },
    ] }, options: CHART_BASE({ scales: { y: { ticks: { callback: eurTick } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.raw)}` } } } }) };
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
        { label: 'Convencional', data: cv, borderColor: C_CONV, backgroundColor: C_CONV, pointRadius: 0, tension: 0, showLine: true },
        { label: 'Robô', data: rv, borderColor: C_ROBOT, backgroundColor: C_ROBOT, pointRadius: 0, tension: 0, showLine: true },
        { label: 'Área actual', data: [{ x: A0, y: R.conv.levelised }, { x: A0, y: R.robot.levelised }], showLine: true,
          borderColor: '#9ca3af', borderDash: [4, 4], pointRadius: 3, backgroundColor: '#9ca3af' },
    ];
    if (fin(R.be.area)) {
        const c = calcOption(inp.conv, inp.scenario, R.be.area);
        ds.push({ label: `Break-even ${fmt(R.be.area, 1)} ha`, data: [{ x: R.be.area, y: c.levelised }], pointRadius: 7,
                  pointStyle: 'rectRot', backgroundColor: C_GOOD, borderColor: C_GOOD, showLine: false });
    }
    const all = cv.concat(rv).map(p => p.y).filter(fin).sort((a, b) => a - b);
    const yMax = all.length ? all[Math.floor(all.length * 0.9)] * 1.3 : undefined;
    return { type: 'scatter', data: { datasets: ds }, options: CHART_BASE({ showLine: true,
        scales: { x: { type: 'logarithmic', title: { display: true, text: 'Área (ha)' }, ticks: { callback: v => { const m = v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9)); return [1, 2, 5].some(x => Math.abs(m - x) < 1e-6) ? fmt(v, v < 1 ? 1 : 0) : ''; } } },
                  y: { min: 0, max: yMax, title: { display: true, text: `€ / ${inp.scenario.func_unit || 'ha·op'}` }, ticks: { callback: v => fmt(v) } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw.x, 1)} ha → ${eur(c.raw.y, 1)}` } } } }) };
}

function cfgTornado(inp, R, pct) {
    const t = tornado(inp, pct).slice(0, 10);
    return { type: 'bar', data: { labels: t.map(x => x.label), datasets: [
        { label: `−${pct} %`, data: t.map(x => x.low), backgroundColor: '#f97316' },
        { label: `+${pct} %`, data: t.map(x => x.high), backgroundColor: '#6366f1' },
    ] }, options: CHART_BASE({ indexAxis: 'y', scales: { x: { ticks: { callback: eurTick } }, y: { ticks: { autoSkip: false, font: { size: 10 } } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: Δ VAL ${sgn(c.raw)}` } } } }) };
}

function cfgCompare(rows) {
    return { type: 'bar', data: { labels: rows.map(r => r.name), datasets: [
        { label: 'TCO convencional', data: rows.map(r => r.results.conv_tco), backgroundColor: C_CONV },
        { label: 'TCO robô', data: rows.map(r => r.results.robot_tco), backgroundColor: C_ROBOT },
        { label: 'VAL adopção', data: rows.map(r => r.results.npv), backgroundColor: rows.map(r => (r.results.npv || 0) >= 0 ? C_GOOD : C_BAD) },
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

/** Renderiza um gráfico fora do ecrã e devolve PNG (para diapositivos). */
function chartPng(cfg, w = 620, h = 350) {
    if (typeof Chart === 'undefined') return '';
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c2 = clone({ ...cfg, options: undefined }); // dados
    const opt = Object.assign({}, cfg.options, { responsive: false, animation: false, devicePixelRatio: 3 });
    const bg = { id: 'bg', beforeDraw: ch => { const x = ch.ctx; x.save(); x.fillStyle = '#fff'; x.fillRect(0, 0, ch.width, ch.height); x.restore(); } };
    const ch = new Chart(cv, { type: cfg.type, data: c2.data, options: opt, plugins: [bg] });
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
    a.download = `roi_${key}_${slug($('#roi-name').value || 'simulacao')}.png`;
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
    const fu = esc(sc.func_unit || 'un');

    $('#roi-verdict').className = 'roi-verdict ' + R.vclass;
    $('#roi-verdict').innerHTML = R.verdict;
    $('#roi-warns').innerHTML = R.warnings.map(w => `<div class="roi-warn">⚠ ${w}</div>`).join('');

    const g = v => v > 0 ? 'good' : v < 0 ? 'bad' : '';
    $('#roi-kpis').innerHTML = [
        kpi(`VAL da adopção (${c.T} anos)`, eur(R.npv), 'TCO conv. − TCO robô + benefícios', g(R.npv)),
        kpi('ROI sobre investimento adicional', fin(R.roiPct) ? fmt(R.roiPct, 0) + ' %' : '—',
            R.extraInv > 0 ? `Inv. adicional ${eur(R.extraInv)}` : 'Sem investimento adicional', fin(R.roiPct) ? g(R.roiPct) : ''),
        kpi('TIR incremental', fin(R.irr) ? fmt(R.irr * 100, 1) + ' %' : '—', `vs. taxa de desconto ${fmt(num(sc.discount_rate), 1)} %`, fin(R.irr) ? (R.irr * 100 > num(sc.discount_rate) ? 'good' : 'bad') : ''),
        kpi('Payback descontado', fin(R.paybackDisc) ? fmt(R.paybackDisc, 1) + ' anos' : 'não recupera',
            fin(R.paybackSimple) ? `simples: ${fmt(R.paybackSimple, 1)} anos` : '', fin(R.paybackDisc) ? 'good' : 'bad'),
        kpi('Poupança operacional anual', eur(R.annualSaving), `Cop ${eur(c.Cop)} → ${eur(b.Cop)}`, g(R.annualSaving)),
        kpi('Break-even A*', fin(R.be.area) ? fmt(R.be.area, 1) + ' ha' : (R.be.alwaysRobot ? 'sempre robô' : 'sem break-even'),
            fin(R.beHours) ? `U* ≈ ${fmt(R.beHours)} h/ano de robô` : '', ''),
        kpi('Custo nivelado', `${eur(c.levelised, 1)} → ${eur(b.levelised, 1)}`, `por ${fu} (TCO / trabalho descontado)`, g(c.levelised - b.levelised)),
        kpi('Emissões operacionais', fin(R.co2Red) ? (R.co2Red >= 0 ? '−' : '+') + fmt(Math.abs(R.co2Red), 0) + ' %' : '—',
            `${fmt(c.E)} → ${fmt(b.E)} kg CO₂e/ano`, fin(R.co2Red) ? g(R.co2Red) : ''),
    ].join('');

    const row = (label, cv, rv, f = v => fmt(v), better = 'low') => {
        const d = (fin(cv) && fin(rv)) ? rv - cv : NaN;
        let cls = '';
        if (fin(d) && Math.abs(d) > 1e-9 && better) cls = ((better === 'low') === (d < 0)) ? 'roi-pos' : 'roi-neg';
        return `<tr><td>${label}</td><td class="c">${f(cv)}</td><td class="r">${f(rv)}</td><td class="${cls}">${fin(d) ? (d > 0 ? '+' : '') + f(d) : '—'}</td></tr>`;
    };
    const eu = (o) => energyUnit(o.energy_type);
    $('#roi-table').innerHTML = `
        <thead><tr><th>Indicador</th><th>🚜 ${esc(inp.conv.name || 'Convencional')}</th><th>🤖 ${esc(inp.robot.name || 'Robô')}</th><th>Δ robô − conv.</th></tr></thead>
        <tbody>
        ${row('Capacidade efectiva P (ha/h)', num(inp.conv.capacity), num(inp.robot.capacity), v => fmt(v, 2), 'high')}
        ${row('Horas de máquina H (h/ano)', c.H, b.H, v => fmt(v, 0), null)}
        ${row('Unidades necessárias', c.units, b.units, v => fmt(v, 0), 'low')}
        ${row('Mão-de-obra / supervisão (h/ano)', c.labourH, b.labourH, v => fmt(v, 0), 'low')}
        ${row(`Energia (${eu(inp.conv)} | ${eu(inp.robot)} /ano)`, c.energyQty, b.energyQty, v => fmt(v, 0), null)}
        ${row('Investimento imputado I₀', c.I0, b.I0, v => eur(v), 'low')}
        ${row('Custo de energia (€/ano)', c.cEnergy, b.cEnergy, v => eur(v), 'low')}
        ${row('Mão-de-obra (€/ano)', c.cLabour, b.cLabour, v => eur(v), 'low')}
        ${row('Manutenção (€/ano)', c.maint, b.maint, v => eur(v), 'low')}
        ${row('Consumíveis (€/ano)', c.cInputs, b.cInputs, v => eur(v), 'low')}
        ${row('Serviço contratado (€/ano)', c.cService, b.cService, v => eur(v), 'low')}
        ${row('Outros (€/ano)', c.cOther, b.cOther, v => eur(v), 'low')}
        <tr style="font-weight:700">${row('Custo operacional Cop (€/ano)', c.Cop, b.Cop, v => eur(v), 'low').slice(4, -5)}</tr>
        ${row(`Custo operacional por ${fu} (Cunit)`, c.Cunit, b.Cunit, v => eur(v, 2), 'low')}
        <tr style="font-weight:700">${row(`TCO descontado ${c.T} anos`, c.TCO, b.TCO, v => eur(v), 'low').slice(4, -5)}</tr>
        ${row(`Custo nivelado (€/${fu})`, c.levelised, b.levelised, v => eur(v, 2), 'low')}
        ${row('Emissões (kg CO₂e/ano)', c.E, b.E, v => fmt(v, 0), 'low')}
        ${row(`Emissões (kg CO₂e/${fu})`, c.Eunit, b.Eunit, v => fmt(v, 2), 'low')}
        </tbody>`;

    drawChart('breakdown', cfgBreakdown(inp, R));
    drawChart('cumulative', cfgCumulative(inp, R));
    drawChart('emissions', cfgEmissions(inp, R));
    drawChart('cashflow', cfgCashflow(inp, R));
}

function renderSens() {
    const inp = S.inputs, R = S.res;
    const pct = Math.max(1, num($('#roi-sens-pct').value) || 20);
    $('#roi-be-kpis').innerHTML = [
        kpi('Break-even de área A*', fin(R.be.area) ? fmt(R.be.area, 1) + ' ha' : (R.be.alwaysRobot ? 'sempre robô' : '—'),
            R.be.crossings.length > 1 ? `${R.be.crossings.length} cruzamentos (efeito de nº de unidades)` : 'TCOrobô(A*) = TCOconv(A*)'),
        kpi('Break-even de utilização U*', fin(R.beHours) ? fmt(R.beHours) + ' h/ano' : '—', 'horas de robô por ano'),
        kpi('Preço máximo competitivo do robô', fin(R.maxRobotPrice) ? eur(R.maxRobotPrice) : '—',
            inp.robot.mode === 'own' ? `actual: ${eur(num(inp.robot.investment))}` : 'robô em modo serviço',
            fin(R.maxRobotPrice) ? (R.maxRobotPrice >= num(inp.robot.investment) ? 'good' : 'bad') : ''),
        kpi('Tarifa RaaS máxima competitiva', fin(R.maxRaasFee) ? eur(R.maxRaasFee, 0) + '/ha·op' : '—',
            `custo nivelado conv.: ${eur(R.conv.levelised, 0)}/ha·op`),
    ].join('');

    const rows = guideScenarios(inp);
    $('#roi-sens-table').innerHTML = `<thead><tr><th>Cenário</th><th>Área (ha)</th><th>TCO conv.</th><th>TCO robô</th><th>€/un conv.</th><th>€/un robô</th><th>VAL adopção</th><th>Melhor</th></tr></thead><tbody>` +
        rows.map(s => `<tr${s.label === 'Base' ? ' style="font-weight:700;background:#f9fafb"' : ''}><td>${esc(s.label)}</td><td>${fmt(s.area, 1)}</td>
            <td class="c">${eur(s.convTCO)}</td><td class="r">${eur(s.robotTCO)}</td>
            <td class="c">${eur(s.convUnit, 1)}</td><td class="r">${eur(s.robotUnit, 1)}</td>
            <td class="${s.npv >= 0 ? 'roi-pos' : 'roi-neg'}">${sgn(s.npv)}</td>
            <td>${s.npv >= 0 ? '<span class="roi-pill g">Robô</span>' : '<span class="roi-pill b">Convencional</span>'}</td></tr>`).join('') + '</tbody>';

    drawChart('area', cfgArea(inp, R));
    drawChart('tornado', cfgTornado(inp, R, pct));
}

// ── Apresentação (4 diapositivos do guia + comparação opcional) ─────────────
function renderPres() {
    const inp = S.inputs, R = S.res, sc = inp.scenario, c = R.conv, b = R.robot;
    const fu = esc(sc.func_unit || 'un');
    const title = esc($('#roi-name').value || 'Simulação ROI');
    const group = esc($('#roi-group').value || '');
    const foot = `<div class="foot">${title}${group ? ' · ' + group : ''} · SoilQI Calculadora ROI · Metodologia: TCO descontado (r = ${fmt(num(sc.discount_rate), 1)} %, ${c.T} anos); Pinheiro et al. (2026) Agric. Syst. 231, 104541</div>`;
    const imgCum = chartPng(cfgCumulative(inp, R));
    const imgArea = chartPng(cfgArea(inp, R));
    const imgEm = chartPng(cfgEmissions(inp, R));
    const imgTor = chartPng(cfgTornado(inp, R, Math.max(1, num($('#roi-sens-pct').value) || 20)));
    const sens = guideScenarios(inp).slice(1);
    const winSens = sens.filter(s => s.npv > 0).map(s => s.label);
    const top = tornado(inp, 20)[0];

    let html = `
    <div class="roi-slide">
        <h4>1 · Tarefa &amp; Robô</h4><h2>${esc(sc.operation || 'Operação')} — ${esc(sc.crop || 'Cultura')}</h2>
        <div class="body">
            <ul>
                <li><b>Robô:</b> ${esc(inp.robot.name)} (${inp.robot.mode === 'service' ? 'serviço / RaaS' : 'compra'})</li>
                <li><b>Referência convencional:</b> ${esc(inp.conv.name)} (${inp.conv.mode === 'service' ? 'serviço' : 'compra'})</li>
                <li><b>Cenário:</b> ${fmt(num(sc.area), 1)} ha × ${fmt(num(sc.ops_per_year))} operações/ano = ${fmt(c.Q)} ${fu}/ano</li>
                <li><b>Unidade funcional:</b> 1 ${fu}</li>
                ${num(sc.window_days) > 0 ? `<li><b>Janela operacional:</b> ${fmt(num(sc.window_days))} dias por operação</li>` : ''}
                <li><b>Horizonte:</b> ${c.T} anos, taxa de desconto ${fmt(num(sc.discount_rate), 1)} %</li>
            </ul>
            <div style="font-size:11px;color:#6b7280;white-space:pre-wrap;overflow:auto">${esc(sc.sources || '')}</div>
        </div>${foot}
    </div>
    <div class="roi-slide">
        <h4>2 · Técnico &amp; Económico</h4><h2>TCO ${c.T} anos: ${eur(b.TCO)} (robô) vs ${eur(c.TCO)} (conv.)</h2>
        <div class="body">
            <div>
                <table class="roi-t">
                    <thead><tr><th></th><th>Conv.</th><th>Robô</th></tr></thead>
                    <tbody>
                    <tr><td>Capacidade (ha/h)</td><td>${fmt(num(inp.conv.capacity), 2)}</td><td>${fmt(num(inp.robot.capacity), 2)}</td></tr>
                    <tr><td>Horas/ano</td><td>${fmt(c.H)}</td><td>${fmt(b.H)}</td></tr>
                    <tr><td>Mão-de-obra (h/ano)</td><td>${fmt(c.labourH)}</td><td>${fmt(b.labourH)}</td></tr>
                    <tr><td>Cop (€/ano)</td><td>${eur(c.Cop)}</td><td>${eur(b.Cop)}</td></tr>
                    <tr><td>Cunit (€/${fu})</td><td>${eur(c.Cunit, 2)}</td><td>${eur(b.Cunit, 2)}</td></tr>
                    <tr><td>Custo nivelado (€/${fu})</td><td>${eur(c.levelised, 2)}</td><td>${eur(b.levelised, 2)}</td></tr>
                    <tr><td><b>TCO</b></td><td><b>${eur(c.TCO)}</b></td><td><b>${eur(b.TCO)}</b></td></tr>
                    </tbody>
                </table>
                <p style="font-size:13px;margin:10px 0 0">VAL da adopção: <b class="${R.npv >= 0 ? 'roi-pos' : 'roi-neg'}">${eur(R.npv)}</b>
                 · ROI ${fin(R.roiPct) ? fmt(R.roiPct, 0) + ' %' : '—'} · Payback ${fin(R.paybackDisc) ? fmt(R.paybackDisc, 1) + ' anos' : '—'}<br>
                 Break-even: <b>${fin(R.be.area) ? fmt(R.be.area, 1) + ' ha' : (R.be.alwaysRobot ? 'sempre robô' : 'não atingido')}</b>${fin(R.beHours) ? ` (U* ≈ ${fmt(R.beHours)} h/ano)` : ''}</p>
            </div>
            <div class="imgbox"><img src="${imgArea || imgCum}" alt=""></div>
        </div>${foot}
    </div>
    <div class="roi-slide">
        <h4>3 · Ambiental</h4><h2>Emissões operacionais ${fin(R.co2Red) ? (R.co2Red >= 0 ? '−' : '+') + fmt(Math.abs(R.co2Red), 0) + ' %' : ''}</h2>
        <div class="body">
            <div>
                <div class="big">${fmt(c.E)} → ${fmt(b.E)}</div><div style="color:#6b7280;margin-bottom:10px">kg CO₂e / ano</div>
                <ul>
                    <li>Energia: ${fmt(c.energyQty)} ${energyUnit(inp.conv.energy_type)} vs ${fmt(b.energyQty)} ${energyUnit(inp.robot.energy_type)} por ano</li>
                    <li>Por unidade funcional: ${fmt(c.Eunit, 2)} vs ${fmt(b.Eunit, 2)} kg CO₂e/${fu}</li>
                    <li>Factores EF: ${fmt(num(inp.conv.ef), 2)} e ${fmt(num(inp.robot.ef), 2)} kg CO₂e/unid. energia (não são ciclo de vida completo)</li>
                    ${(num(inp.conv.input_waste) !== num(inp.robot.input_waste)) ? `<li>Desperdício de consumíveis: ${fmt(num(inp.conv.input_waste))} % vs ${fmt(num(inp.robot.input_waste))} %</li>` : ''}
                    <li>Considerar também: compactação do solo, ruído, baterias e fabrico.</li>
                </ul>
            </div>
            <div class="imgbox"><img src="${imgEm}" alt=""></div>
        </div>${foot}
    </div>
    <div class="roi-slide">
        <h4>4 · Recomendação</h4><h2>${R.npv > 0 ? 'Recomenda-se a adopção do robô' : 'Adopção do robô apenas sob condições'}</h2>
        <div class="body">
            <div>
                <ul>
                    <li>${R.verdict.replace(/<\/?b>/g, '')}</li>
                    ${fin(R.maxRobotPrice) ? `<li>Preço máximo competitivo do robô: <b>${eur(R.maxRobotPrice)}</b></li>` : ''}
                    ${fin(R.maxRaasFee) ? `<li>Tarifa RaaS máxima competitiva: <b>${eur(R.maxRaasFee, 0)}/ha·op</b></li>` : ''}
                    ${top ? `<li>Parâmetro mais sensível: <b>${esc(top.label)}</b> (±20 % → Δ VAL ${sgn(top.low)} / ${sgn(top.high)})</li>` : ''}
                    <li>Cenários favoráveis ao robô: ${winSens.length ? esc(winSens.join('; ')) : 'nenhum dos cenários testados'}</li>
                </ul>
                ${inp.recommendation ? `<p style="margin-top:10px;padding:10px;background:#eef2ff;border-radius:8px;white-space:pre-wrap">${esc(inp.recommendation)}</p>` : ''}
            </div>
            <div class="imgbox"><img src="${imgTor}" alt=""></div>
        </div>${foot}
    </div>`;

    const cmp = S.saved.filter(s => S.compareIds.includes(s.id));
    if (cmp.length) {
        html += `<div class="roi-slide"><h4>Anexo · Comparação de cenários</h4><h2>${cmp.length} simulações</h2>
            <div class="body one" style="grid-template-columns:1fr 1fr">
            <div style="overflow:auto"><table class="roi-t"><thead><tr><th>Simulação</th><th>Área</th><th>TCO conv.</th><th>TCO robô</th><th>VAL</th><th>A*</th><th>CO₂e</th></tr></thead><tbody>
            ${cmp.map(s => { const m = s.results || {}; return `<tr><td>${esc(s.name)}</td><td>${fmt(m.area, 1)}</td><td>${keur(m.conv_tco)}</td><td>${keur(m.robot_tco)}</td>
                <td class="${(m.npv || 0) >= 0 ? 'roi-pos' : 'roi-neg'}">${keur(m.npv)}</td><td>${m.breakeven_area != null ? fmt(m.breakeven_area, 1) : '—'}</td>
                <td>${m.co2_reduction_pct != null ? fmt(-m.co2_reduction_pct, 0) + ' %' : '—'}</td></tr>`; }).join('')}
            </tbody></table></div>
            <div class="imgbox"><img src="${chartPng(cfgCompare(cmp))}" alt=""></div></div>${foot}</div>`;
    }
    $('#roi-pres-print').innerHTML = html;
}

function presMarkdown() {
    const inp = S.inputs, R = S.res, sc = inp.scenario, c = R.conv, b = R.robot, fu = sc.func_unit || 'un';
    const L = [];
    L.push(`# ${$('#roi-name').value || 'Simulação ROI'}`, '');
    L.push('## 1. Tarefa & Robô',
        `- Operação: ${sc.operation} — ${sc.crop}`, `- Robô: ${inp.robot.name} (${inp.robot.mode})`,
        `- Convencional: ${inp.conv.name} (${inp.conv.mode})`,
        `- Cenário: ${fmt(num(sc.area), 1)} ha × ${fmt(num(sc.ops_per_year))} op/ano; r = ${fmt(num(sc.discount_rate), 1)} %; ${c.T} anos`, '');
    L.push('## 2. Técnico & Económico', '| Indicador | Convencional | Robô |', '|---|---:|---:|',
        `| Capacidade (ha/h) | ${fmt(num(inp.conv.capacity), 2)} | ${fmt(num(inp.robot.capacity), 2)} |`,
        `| Horas/ano | ${fmt(c.H)} | ${fmt(b.H)} |`,
        `| Cop (€/ano) | ${fmt(c.Cop)} | ${fmt(b.Cop)} |`,
        `| Cunit (€/${fu}) | ${fmt(c.Cunit, 2)} | ${fmt(b.Cunit, 2)} |`,
        `| TCO (€) | ${fmt(c.TCO)} | ${fmt(b.TCO)} |`, '',
        `- VAL adopção: ${eur(R.npv)}; ROI: ${fin(R.roiPct) ? fmt(R.roiPct, 0) + ' %' : '—'}; TIR: ${fin(R.irr) ? fmt(R.irr * 100, 1) + ' %' : '—'}; payback descontado: ${fin(R.paybackDisc) ? fmt(R.paybackDisc, 1) + ' anos' : '—'}`,
        `- Break-even: ${fin(R.be.area) ? fmt(R.be.area, 1) + ' ha' : '—'} (U* ${fin(R.beHours) ? fmt(R.beHours) + ' h/ano' : '—'})`, '');
    L.push('## 3. Ambiental', `- Emissões: ${fmt(c.E)} vs ${fmt(b.E)} kg CO₂e/ano (${fmt(c.Eunit, 2)} vs ${fmt(b.Eunit, 2)} kg CO₂e/${fu})`, '');
    L.push('## 4. Recomendação', R.verdict.replace(/<\/?b>/g, ''), '', inp.recommendation || '', '');
    L.push('### Sensibilidade', '| Cenário | VAL adopção (€) |', '|---|---:|', ...guideScenarios(inp).map(s => `| ${s.label} | ${fmt(s.npv)} |`), '');
    if (sc.sources) L.push('### Fontes e pressupostos', sc.sources);
    download(`roi_${slug($('#roi-name').value || 'simulacao')}.md`, L.join('\n'), 'text/markdown');
}

function download(name, text, type) {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ══════════════════════════════════════════════════════════════════════════
//  SIMULAÇÕES GUARDADAS
// ══════════════════════════════════════════════════════════════════════════

function loadList() {
    return post('roi_list').then(d => {
        if (!d.success) { toast(d.message || 'Erro a carregar simulações.', 'error'); return; }
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
    if (!rows.length) { tbl.innerHTML = `<tbody><tr><td class="roi-empty">${S.saved.length ? 'Nenhuma simulação corresponde ao filtro.' : 'Ainda não há simulações guardadas. Use 💾 Guardar na calculadora.'}</td></tr></tbody>`; renderCompare(); return; }
    tbl.innerHTML = `<thead><tr><th style="width:24px"></th><th>Simulação</th><th>Grupo</th><th>Área</th><th>TCO conv.</th><th>TCO robô</th><th>VAL</th><th>ROI</th><th>Break-even</th><th>Δ CO₂e</th><th>Actualizada</th><th></th></tr></thead><tbody>` +
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
                <td><button class="roi-btn" data-open="${s.id}">Abrir</button> <button class="roi-btn dan" data-del="${s.id}" title="Eliminar">🗑</button></td>
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
    if (S.dirty && !confirm('Há alterações por guardar na simulação actual. Continuar?')) return;
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
    if (!name) { toast('Indique um nome para a simulação.', 'error'); $('#roi-name').focus(); return; }
    recalc();
    const id = asCopy ? 0 : S.id;
    const finalName = (asCopy && S.id && S.saved.some(s => s.name === name)) ? name + ' (cópia)' : name;
    $('#roi-save').disabled = true;
    post('roi_save', {
        id, name: finalName, group_label: $('#roi-group').value.trim(), notes: '',
        inputs: JSON.stringify(S.inputs), results: JSON.stringify(macro(S.inputs, S.res)),
    }).then(d => {
        $('#roi-save').disabled = false;
        if (!d.success) { toast(d.message || 'Erro ao guardar.', 'error'); return; }
        S.id = d.id; $('#roi-name').value = finalName; setDirty(false);
        toast(asCopy ? 'Cópia guardada.' : 'Simulação guardada.', 'success');
        loadList();
    });
}

function deleteSim(id) {
    const s = S.saved.find(x => x.id === id);
    if (!confirm(`Eliminar definitivamente a simulação "${s ? s.name : id}"?`)) return;
    post('roi_delete', { id }).then(d => {
        toast(d.message, d.success ? 'success' : 'error');
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
    if (!rows.length) { toast('Não há simulações para exportar.', 'error'); return; }
    const cell = v => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'number') return String(v).replace('.', ',');
        const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [CSV_COLS.map(c => c[1]).join(';')];
    rows.forEach(s => {
        const m = Object.assign({}, s.results || {}, { name: s.name, group_label: s.group_label || '', updated_at: s.updated_at });
        lines.push(CSV_COLS.map(c => cell(m[c[0]])).join(';'));
    });
    download(`soilqi_roi_simulacoes_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}

function exportJson() {
    const rows = selectedOrAll();
    if (!rows.length) { toast('Não há simulações para exportar.', 'error'); return; }
    post('roi_export', { ids: rows.map(r => r.id).join(',') }).then(d => {
        if (!d.success) { toast(d.message, 'error'); return; }
        download(`soilqi_roi_simulacoes_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d.simulations, null, 2), 'application/json');
    });
}

// ══════════════════════════════════════════════════════════════════════════
//  NAVEGAÇÃO E EVENTOS
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

    // Restaurar rascunho local (conveniência por utilizador)
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
        if (S.dirty && !confirm('Carregar o exemplo substitui os valores actuais. Continuar?')) return;
        S.id = 0; S.inputs = presetInputs(k);
        $('#roi-name').value = PRESETS[k].name; writeForm(S.inputs); recalc(); setDirty(true);
    });
    $('#roi-new').addEventListener('click', () => {
        if (S.dirty && !confirm('Descartar as alterações actuais e começar uma nova simulação?')) return;
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
        if (!S.selected.size) { toast('Seleccione as simulações a comparar.', 'error'); return; }
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

// Exposto para testes na consola
window.soilqiRoi = { compute, calcOption, breakEvenArea, guideScenarios, tornado, macro, presetInputs, defaultInputs };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
