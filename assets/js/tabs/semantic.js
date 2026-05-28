/**
 * Semantic Map Tab — MapLibre GL JS
 * Visualização de mapas semânticos gerados por robôs.
 * Suporta: árvores (Bézier), elevação (PNG), ocupação (PNG).
 */

'use strict';

let semMap          = null;
let currentSemData  = null;   // mapa semântico actualmente carregado
const semActiveSrc  = new Set(); // source IDs adicionadas ao mapa

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    if (typeof activeTab === 'undefined' || activeTab !== 'semantic') return;
    initSemanticMap();
});

// ── Inicializar MapLibre ──────────────────────────────────────────────────────
function initSemanticMap() {
    semMap = new maplibregl.Map({
        container: 'semantic-map',
        style: {
            version: 8,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: {
                osm: {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>'
                },
                satellite: {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    attribution: '© Esri'
                }
            },
            layers: [
                { id: 'osm-layer', type: 'raster', source: 'osm' }
            ]
        },
        center: [-8.127, 38.518],
        zoom: 17
    });

    // Selector de camada base
    semMap.addControl(new maplibregl.NavigationControl(), 'top-right');
    semMap.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // Toggle OSM / Satélite
    const baseToggle = document.createElement('div');
    baseToggle.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    baseToggle.style.cssText = 'margin:10px;';
    baseToggle.innerHTML = `
        <button id="sem-base-osm" title="Mapa" onclick="setSemBase('osm')"
            style="padding:5px 9px;font-size:12px;cursor:pointer;
                   background:#667eea;color:#fff;border:none;border-radius:4px 0 0 4px;">🗺️</button>
        <button id="sem-base-sat" title="Satélite" onclick="setSemBase('satellite')"
            style="padding:5px 9px;font-size:12px;cursor:pointer;
                   background:#fff;border:1px solid #ccc;border-radius:0 4px 4px 0;">🛰️</button>`;
    semMap.getContainer().appendChild(baseToggle);
    Object.assign(baseToggle.style, { position:'absolute', top:'10px', left:'10px', zIndex:10 });

    semMap.on('load', function () {
        loadSemTerrains();
        setSemStatus('Mapa pronto. Carregue um exemplo ou importe um ficheiro JSON.');
    });
}

function setSemBase(base) {
    if (!semMap) return;
    semMap.setLayoutProperty('osm-layer',       'visibility', base === 'osm'       ? 'visible' : 'none');
    semMap.setLayoutProperty('satellite-layer',  'visibility', base === 'satellite'  ? 'visible' : 'none');
    // satellite-layer só existe após ser adicionada dinamicamente
    if (base === 'satellite' && !semMap.getLayer('satellite-layer')) {
        semMap.addLayer({ id: 'satellite-layer', type: 'raster', source: 'satellite' }, 'osm-layer');
        semMap.setLayoutProperty('osm-layer', 'visibility', 'none');
    }
    document.getElementById('sem-base-osm').style.background = base === 'osm' ? '#667eea' : '#fff';
    document.getElementById('sem-base-osm').style.color = base === 'osm' ? '#fff' : '#333';
    document.getElementById('sem-base-sat').style.background = base === 'satellite' ? '#667eea' : '#fff';
    document.getElementById('sem-base-sat').style.color = base === 'satellite' ? '#fff' : '#333';
}

// ── Utilitários de coordenadas ────────────────────────────────────────────────

/**
 * Converte coordenadas locais (metros) para GPS [lng, lat].
 * @param {number} x  - Este (metros)
 * @param {number} y  - Norte (metros)
 * @param {{lat,lng,rotation}} ref - referência GPS e rotação em graus
 */
function localToLngLat(x, y, ref) {
    const rot = ((ref.rotation || 0) * Math.PI) / 180;
    const xr  = x * Math.cos(rot) - y * Math.sin(rot);
    const yr  = x * Math.sin(rot) + y * Math.cos(rot);
    const lat = ref.lat + yr / 111320;
    const lng = ref.lng + xr / (111320 * Math.cos(ref.lat * Math.PI / 180));
    return [lng, lat];
}

/** Polígono-círculo em coords locais (n vértices) */
function circleLocalPts(cx, cy, r, n = 32) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * 2 * Math.PI;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
}

/** Amostra curva Bézier 2D (quadrática ou cúbica) em n pontos */
function sampleBezier2D(pts, n = 14) {
    const result = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        let x = 0, y = 0;
        if (pts.length === 2) {
            x = u * pts[0][0] + t * pts[1][0];
            y = u * pts[0][1] + t * pts[1][1];
        } else if (pts.length === 3) {
            x = u*u*pts[0][0] + 2*u*t*pts[1][0] + t*t*pts[2][0];
            y = u*u*pts[0][1] + 2*u*t*pts[1][1] + t*t*pts[2][1];
        } else {
            // Cúbica (4 pontos)
            x = u*u*u*pts[0][0] + 3*u*u*t*pts[1][0] + 3*u*t*t*pts[2][0] + t*t*t*pts[3][0];
            y = u*u*u*pts[0][1] + 3*u*u*t*pts[1][1] + 3*u*t*t*pts[2][1] + t*t*t*pts[3][1];
        }
        result.push([x, y]);
    }
    return result;
}

// ── Gestão de sources MapLibre ────────────────────────────────────────────────

function addSemSource(id, spec) {
    if (semMap.getSource(id)) semMap.removeSource(id);
    semMap.addSource(id, spec);
    semActiveSrc.add(id);
}

function addSemLayer(layerDef, beforeId) {
    if (semMap.getLayer(layerDef.id)) semMap.removeLayer(layerDef.id);
    semMap.addLayer(layerDef, beforeId);
}

// ── Limpar todas as camadas semânticas ───────────────────────────────────────
function clearSemanticMap() {
    // Remover layers e sources adicionadas pelo mapa semântico
    ['sem-canopy-fill','sem-canopy-line','sem-branches','sem-trunks',
     'sem-elev-layer','sem-occ-layer','sem-occ-line'].forEach(id => {
        if (semMap && semMap.getLayer(id)) semMap.removeLayer(id);
    });
    ['sem-canopies','sem-branches-src','sem-trunks-src',
     'sem-elev-img','sem-occ-img'].forEach(id => {
        if (semMap && semMap.getSource(id)) semMap.removeSource(id);
    });
    semActiveSrc.clear();
    currentSemData = null;
    document.getElementById('sem-layers-list').innerHTML =
        '<span style="color:#9ca3af;font-size:12px;">Nenhum mapa carregado.</span>';
    setSemStatus('Mapa limpo.');
}

// ── Renderizar mapa semântico ─────────────────────────────────────────────────
function renderSemanticMap(mapData) {
    clearSemanticMap();
    currentSemData = mapData;
    const ref = mapData.reference || { lat: 38.518, lng: -8.127, rotation: 0 };
    const layerItems = [];

    mapData.layers.forEach(layer => {
        try {
            if (layer.type === 'trees')     { renderTreeLayer(layer, ref);      layerItems.push({ type:'trees',     layer }); }
            if (layer.type === 'elevation') { renderElevationLayer(layer, ref); layerItems.push({ type:'elevation', layer }); }
            if (layer.type === 'occupancy') { renderOccupancyLayer(layer, ref); layerItems.push({ type:'occupancy', layer }); }
        } catch (e) {
            console.warn('[SoilQI Semantic] Erro ao renderizar camada', layer.type, e);
        }
    });

    updateSemLayerList(layerItems, mapData);

    // Zoom para a área coberta
    const ref2 = ref;
    const allLocalPts = [];
    mapData.layers.forEach(l => {
        if (l.type === 'trees' && l.data) l.data.forEach(t => allLocalPts.push(t.position));
        if ((l.type === 'elevation' || l.type === 'occupancy') && l.origin) {
            const w = (l.width  || 1) * (l.resolution || 1);
            const h = (l.height || 1) * (l.resolution || 1);
            allLocalPts.push(l.origin, [l.origin[0]+w, l.origin[1]], [l.origin[0], l.origin[1]+h]);
        }
    });
    if (allLocalPts.length) {
        const gps = allLocalPts.map(([x,y]) => localToLngLat(x, y, ref2));
        const lngs = gps.map(c=>c[0]), lats = gps.map(c=>c[1]);
        semMap.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 60, maxZoom: 21 }
        );
    }

    setSemStatus(`✅ Mapa "${mapData.name || 'sem nome'}" carregado — ${mapData.layers.length} camada(s).`);
}

// ── Layer: Árvores ────────────────────────────────────────────────────────────
function renderTreeLayer(layer, ref) {
    const canopyFeats  = [];
    const branchFeats  = [];
    const trunkFeats   = [];

    for (const tree of (layer.data || [])) {
        const [px, py] = tree.position || [0, 0];
        const cr       = tree.canopy_radius || 1.0;
        const health   = tree.health || 'good';
        const fillClr  = health === 'poor' ? '#f59e0b' : health === 'dead' ? '#6b7280' : '#22c55e';

        // Copa (círculo → polígono GPS)
        const capPts = circleLocalPts(px, py, cr).map(([x,y]) => localToLngLat(x, y, ref));
        canopyFeats.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [capPts] },
            properties: {
                id: tree.id || '?',
                species:      tree.species || '—',
                health:       health,
                height:       tree.trunk?.height || tree.height || '—',
                radius_base:  tree.trunk?.radius_base || '—',
                canopy_r:     cr.toFixed(2),
                fruit_load:   tree.fruit_load !== undefined ? (tree.fruit_load * 100).toFixed(0) + '%' : '—',
                last_meas:    tree.last_measurement || '—',
                fill_color:   fillClr
            }
        });

        // Tronco (ponto)
        const [tlng, tlat] = localToLngLat(px, py, ref);
        trunkFeats.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [tlng, tlat] },
            properties: { id: tree.id || '?', fill_color: fillClr }
        });

        // Ramos (curvas Bézier projetadas em 2D)
        for (const branch of (tree.branches || [])) {
            const pts2d = sampleBezier2D(branch.points || []);
            if (pts2d.length < 2) continue;
            const coords = pts2d.map(([x,y]) => localToLngLat(x, y, ref));
            branchFeats.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { tree_id: tree.id || '?' }
            });
        }
    }

    addSemSource('sem-canopies', { type:'geojson', data:{ type:'FeatureCollection', features: canopyFeats } });
    addSemSource('sem-branches-src', { type:'geojson', data:{ type:'FeatureCollection', features: branchFeats } });
    addSemSource('sem-trunks-src',   { type:'geojson', data:{ type:'FeatureCollection', features: trunkFeats } });

    addSemLayer({ id:'sem-canopy-fill', type:'fill', source:'sem-canopies',
        paint:{ 'fill-color':['get','fill_color'], 'fill-opacity':0.30 } });
    addSemLayer({ id:'sem-canopy-line', type:'line', source:'sem-canopies',
        paint:{ 'line-color':'#166534', 'line-width':1.2, 'line-opacity':0.7 } });
    addSemLayer({ id:'sem-branches', type:'line', source:'sem-branches-src',
        paint:{ 'line-color':'#7c3d0b', 'line-width':1.5, 'line-opacity':0.8 } });
    addSemLayer({ id:'sem-trunks', type:'circle', source:'sem-trunks-src',
        paint:{ 'circle-radius':4, 'circle-color':'#7c3d0b',
                'circle-stroke-color':'#fff', 'circle-stroke-width':1.5 } });

    // Popup ao clicar na copa
    semMap.on('click', 'sem-canopy-fill', e => {
        const p = e.features[0].properties;
        new maplibregl.Popup({ closeButton: true })
            .setLngLat(e.lngLat)
            .setHTML(`
                <strong>🌳 ${_esc(p.id)}</strong><br>
                <table style="margin-top:5px;">
                <tr><td>Espécie</td><td><em>${_esc(p.species)}</em></td></tr>
                <tr><td>Altura</td><td>${p.height} m</td></tr>
                <tr><td>Raio copa</td><td>${p.canopy_r} m</td></tr>
                <tr><td>Raio tronco</td><td>${p.radius_base} m</td></tr>
                <tr><td>Saúde</td><td>${p.health === 'good' ? '✅ Boa' : p.health === 'poor' ? '⚠️ Fraca' : '☠️ Morta'}</td></tr>
                <tr><td>Carga frutos</td><td>${p.fruit_load}</td></tr>
                <tr><td>Última medição</td><td>${p.last_meas}</td></tr>
                </table>`)
            .addTo(semMap);
    });
    semMap.on('mouseenter', 'sem-canopy-fill', () => { semMap.getCanvas().style.cursor = 'pointer'; });
    semMap.on('mouseleave', 'sem-canopy-fill', () => { semMap.getCanvas().style.cursor = ''; });
}

// ── Layer: Mapa de Elevação ───────────────────────────────────────────────────
function renderElevationLayer(layer, ref) {
    const ox  = layer.origin[0], oy = layer.origin[1];
    const res = layer.resolution || 1.0;
    const w   = (layer.width  || 1) * res;
    const h   = (layer.height || 1) * res;

    // 4 cantos: TL, TR, BR, BL (MapLibre: topo-esquerda, ..., no sentido horário)
    const tl = localToLngLat(ox,   oy+h, ref);
    const tr = localToLngLat(ox+w, oy+h, ref);
    const br = localToLngLat(ox+w, oy,   ref);
    const bl = localToLngLat(ox,   oy,   ref);

    addSemSource('sem-elev-img', {
        type: 'image',
        url: layer.data,
        coordinates: [tl, tr, br, bl]
    });
    addSemLayer({
        id: 'sem-elev-layer', type: 'raster', source: 'sem-elev-img',
        paint: { 'raster-opacity': 0.65 }
    });
}

// ── Layer: Mapa de Ocupação ───────────────────────────────────────────────────
function renderOccupancyLayer(layer, ref) {
    const ox  = layer.origin[0], oy = layer.origin[1];
    const res = layer.resolution || 0.1;
    const w   = (layer.width  || 1) * res;
    const h   = (layer.height || 1) * res;

    const tl = localToLngLat(ox,   oy+h, ref);
    const tr = localToLngLat(ox+w, oy+h, ref);
    const br = localToLngLat(ox+w, oy,   ref);
    const bl = localToLngLat(ox,   oy,   ref);

    addSemSource('sem-occ-img', {
        type: 'image',
        url: layer.data,
        coordinates: [tl, tr, br, bl]
    });
    addSemLayer({
        id: 'sem-occ-layer', type: 'raster', source: 'sem-occ-img',
        paint: { 'raster-opacity': 0.55 }
    });
}

// ── Terrenos da quinta ────────────────────────────────────────────────────────
function loadSemTerrains() {
    const fd = new FormData();
    fd.append('action', 'get_terrains_sem');
    fetch('?tab=semantic', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.terrains.length) return;
            const features = data.terrains.map(t => {
                try {
                    const coords = JSON.parse(t.coordinates);
                    const ring   = coords.map(c => [
                        c.lng !== undefined ? c.lng : c[1],
                        c.lat !== undefined ? c.lat : c[0]
                    ]);
                    ring.push(ring[0]);
                    return { type:'Feature', geometry:{ type:'Polygon', coordinates:[ring] },
                             properties:{ name: t.name, area: t.area } };
                } catch { return null; }
            }).filter(Boolean);

            addSemSource('sem-terrains', { type:'geojson', data:{ type:'FeatureCollection', features } });
            addSemLayer({ id:'sem-terrains-fill', type:'fill', source:'sem-terrains',
                paint:{ 'fill-color':'#667eea', 'fill-opacity':0.08 } });
            addSemLayer({ id:'sem-terrains-line', type:'line', source:'sem-terrains',
                paint:{ 'line-color':'#667eea', 'line-width':2, 'line-opacity':0.7 } });

            // Popup nos terrenos
            semMap.on('click', 'sem-terrains-fill', e => {
                const p = e.features[0].properties;
                new maplibregl.Popup()
                    .setLngLat(e.lngLat)
                    .setHTML(`<strong>🌿 ${_esc(p.name)}</strong><br>${parseFloat(p.area).toFixed(2)} ha`)
                    .addTo(semMap);
            });
        })
        .catch(() => {});
}

function toggleSemTerrains(show) {
    ['sem-terrains-fill','sem-terrains-line'].forEach(id => {
        if (semMap.getLayer(id))
            semMap.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
    });
}

// ── Actualizar lista de camadas no sidebar ────────────────────────────────────
function updateSemLayerList(items, mapData) {
    const el = document.getElementById('sem-layers-list');
    if (!el) return;

    const COLORS = { trees:'#22c55e', elevation:'#f59e0b', occupancy:'#6b7280' };
    const ICONS  = { trees:'🌳', elevation:'⛰️', occupancy:'🗺️' };

    let html = items.map(({ type, layer }) => {
        const n = type === 'trees' ? (layer.data?.length || 0) + ' árvores' :
                  type === 'elevation' ? `${layer.width}×${layer.height} px · ${layer.resolution}m/cel` :
                  `${layer.width}×${layer.height} px · ${layer.resolution}m/cel`;
        return `<div class="sem-layer-row">
            <div class="sem-dot" style="background:${COLORS[type]||'#9ca3af'};"></div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;">${ICONS[type]||'●'} ${_esc(layer.label||layer.id||type)}</div>
                <div style="font-size:10px;color:#9ca3af;">${n}</div>
            </div>
        </div>`;
    }).join('');

    if (mapData.reference) {
        const ref = mapData.reference;
        html += `<div style="margin-top:8px;font-size:10px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:6px;">
            📍 Ref: ${ref.lat.toFixed(5)}, ${ref.lng.toFixed(5)}
            ${ref.rotation ? ' · rot ' + ref.rotation + '°' : ''}
        </div>`;
    }

    el.innerHTML = html || '<span style="color:#9ca3af;font-size:12px;">Sem camadas.</span>';
}

// ── Gerar exemplo ─────────────────────────────────────────────────────────────
function loadExampleSemanticMap() {
    setSemStatus('⏳ A gerar mapa semântico de exemplo…');
    setTimeout(() => {
        try {
            const mapData = _generateExampleMap();
            renderSemanticMap(mapData);
            document.getElementById('sem-save-name').value = mapData.name;
        } catch (e) {
            setSemStatus('❌ Erro: ' + e.message);
        }
    }, 30);
}

function _generateExampleMap() {
    const rng = (a, b) => a + Math.random() * (b - a);
    const ref = { lat: 38.5180, lng: -8.1270, rotation: 12 };

    // ── Oliveiras: grelha 4×3 com perturbação ────────────────────────────────
    const trees = [];
    const rows = 3, cols = 4, spacingX = 4.5, spacingY = 5.0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = c * spacingX + rng(-0.2, 0.2);
            const y = r * spacingY + rng(-0.2, 0.2);
            const height    = rng(2.2, 4.5);
            const trunkR    = rng(0.07, 0.13);
            const canopyR   = rng(0.9, 1.7);
            const health    = Math.random() > 0.15 ? (Math.random() > 0.1 ? 'good' : 'poor') : 'poor';
            const nBranches = Math.floor(rng(4, 8));

            const branches = [];
            for (let b = 0; b < nBranches; b++) {
                const angle = (b / nBranches) * 2 * Math.PI + rng(-0.4, 0.4);
                const len   = rng(0.5, canopyR * 0.85);
                const midR  = rng(0.5, 0.8) * len;
                const midA  = angle + rng(-0.3, 0.3);
                branches.push({
                    type: 'bezier2',
                    points: [
                        [x, y],
                        [x + Math.cos(midA) * midR, y + Math.sin(midA) * midR],
                        [x + Math.cos(angle) * len,  y + Math.sin(angle) * len]
                    ],
                    radius: trunkR * rng(0.3, 0.5)
                });
            }

            trees.push({
                id: `T${String(r * cols + c + 1).padStart(3,'0')}`,
                species: 'olea_europaea',
                position: [x, y],
                trunk: { height: parseFloat(height.toFixed(2)), radius_base: parseFloat(trunkR.toFixed(3)), radius_apex: parseFloat((trunkR*0.5).toFixed(3)) },
                branches,
                canopy_radius: parseFloat(canopyR.toFixed(2)),
                health,
                fruit_load: health === 'good' ? parseFloat(rng(0.3, 1.0).toFixed(2)) : parseFloat(rng(0, 0.3).toFixed(2)),
                last_measurement: '2026-05-10'
            });
        }
    }

    // ── Mapa de elevação: 30×25 células, 1 m/célula ───────────────────────────
    const eW = 30, eH = 25;
    const eMin = 96.0, eMax = 112.0;
    const elevCanvas = document.createElement('canvas');
    elevCanvas.width = eW; elevCanvas.height = eH;
    const eCtx = elevCanvas.getContext('2d');
    const eImg = eCtx.createImageData(eW, eH);
    for (let py = 0; py < eH; py++) {
        for (let px = 0; px < eW; px++) {
            const e = eMin
                + (px / eW) * 9
                + (py / eH) * 4
                + Math.sin(px * 0.45) * 1.2
                + Math.cos(py * 0.38 + 0.5) * 0.8;
            const t = Math.max(0, Math.min(1, (e - eMin) / (eMax - eMin)));
            // Gradiente terreno: verde escuro → amarelo-verde → castanho claro
            let rv, gv, bv;
            if (t < 0.5) {
                rv = Math.round(34  + t*2*(160-34));
                gv = Math.round(110 + t*2*(190-110));
                bv = Math.round(34  + t*2*(60-34));
            } else {
                const u = (t-0.5)*2;
                rv = Math.round(160 + u*(139-160));
                gv = Math.round(190 + u*(115-190));
                bv = Math.round(60  + u*(85-60));
            }
            const i = (py * eW + px) * 4;
            eImg.data[i]=rv; eImg.data[i+1]=gv; eImg.data[i+2]=bv; eImg.data[i+3]=200;
        }
    }
    eCtx.putImageData(eImg, 0, 0);

    // ── Mapa de ocupação: 200×170 células, 0.1 m/célula ──────────────────────
    const oW = 200, oH = 170, oRes = 0.1;
    const oOx = -1.5, oOy = -1.5; // origem (metros)
    const occCanvas = document.createElement('canvas');
    occCanvas.width = oW; occCanvas.height = oH;
    const oCtx = occCanvas.getContext('2d');
    const oImg = oCtx.createImageData(oW, oH);
    for (let py = 0; py < oH; py++) {
        for (let px = 0; px < oW; px++) {
            const wx = oOx + px * oRes;
            const wy = oOy + (oH - 1 - py) * oRes; // Y invertido (imagem ↓, norte ↑)
            let occ = false;
            // Troncos das árvores como obstáculos
            for (const tree of trees) {
                const dx = wx - tree.position[0];
                const dy = wy - tree.position[1];
                if (Math.sqrt(dx*dx + dy*dy) < (tree.trunk.radius_base + 0.05)) { occ = true; break; }
            }
            // Valeta/muro de vedação perimetral
            const mapW = cols * spacingX + 2;
            const mapH = rows * spacingY + 2;
            if (wx < 0 || wy < 0 || wx > mapW || wy > mapH) occ = true; // fora da área
            const i = (py * oW + px) * 4;
            if (occ) {
                oImg.data[i]=20; oImg.data[i+1]=20; oImg.data[i+2]=20; oImg.data[i+3]=220;
            } else {
                oImg.data[i]=255; oImg.data[i+1]=255; oImg.data[i+2]=255; oImg.data[i+3]=0; // livre → transparente
            }
        }
    }
    oCtx.putImageData(oImg, 0, 0);

    return {
        type: 'semantic_map',
        version: '1.0',
        name: 'Olival de Exemplo — Quinta Norte',
        created: new Date().toISOString(),
        coordinate_system: 'local',
        reference: ref,
        layers: [
            {
                id: 'trees',
                type: 'trees',
                label: `Oliveiras (${trees.length})`,
                species_default: 'olea_europaea',
                data: trees
            },
            {
                id: 'elevation',
                type: 'elevation',
                label: 'Mapa de Elevação (DEM)',
                origin: [-1.5, -1.5],
                resolution: 1.0,
                width: eW, height: eH,
                min_elevation: eMin, max_elevation: eMax,
                encoding: 'png_base64',
                data: elevCanvas.toDataURL('image/png')
            },
            {
                id: 'occupancy',
                type: 'occupancy',
                label: 'Grelha de Ocupação (ROS)',
                origin: [oOx, oOy],
                resolution: oRes,
                width: oW, height: oH,
                free_threshold: 50,
                occupied_threshold: 65,
                encoding: 'png_base64',
                data: occCanvas.toDataURL('image/png')
            }
        ]
    };
}

// ── Import / Export ───────────────────────────────────────────────────────────
function importSemanticMapFile(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { setSemStatus('❌ Ficheiro demasiado grande (máx. 50 MB).'); return; }
    setSemStatus('⏳ A ler ficheiro…');
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.type !== 'semantic_map') throw new Error('Não é um semantic_map válido.');
            renderSemanticMap(data);
            if (data.name) document.getElementById('sem-save-name').value = data.name;
        } catch (err) {
            setSemStatus('❌ Ficheiro inválido: ' + err.message);
        }
    };
    reader.readAsText(file);
    input.value = ''; // reset para permitir re-import do mesmo ficheiro
}

function exportSemanticMap() {
    if (!currentSemData) { setSemStatus('⚠️ Nenhum mapa activo para exportar.'); return; }
    const json = JSON.stringify(currentSemData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = (currentSemData.name || 'semantic_map').replace(/[^\wÀ-ɏ \-]/g,'_') + '.semmap.json';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSemStatus('✅ Exportado.');
}

// ── Guardar / Carregar na BD ──────────────────────────────────────────────────
function saveCurrentSemanticMap() {
    if (!currentSemData) { setSemStatus('⚠️ Nenhum mapa activo.'); return; }
    const name = (document.getElementById('sem-save-name')?.value || '').trim();
    if (!name) { setSemStatus('⚠️ Insira um nome antes de guardar.'); return; }

    const ref = currentSemData.reference || {};
    const fd  = new FormData();
    fd.append('action',      'save_semantic_map');
    fd.append('name',        name);
    fd.append('map_data',    JSON.stringify(currentSemData));
    fd.append('ref_lat',     ref.lat || 0);
    fd.append('ref_lng',     ref.lng || 0);

    setSemStatus('⏳ A guardar…');
    fetch('?tab=semantic', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            setSemStatus(data.success ? `✅ Guardado (ID #${data.id})` : '❌ ' + data.message);
            if (data.success) location.reload(); // refresh lista sidebar
        })
        .catch(() => setSemStatus('❌ Erro de rede.'));
}

function loadSavedSemanticMap(id) {
    const fd = new FormData();
    fd.append('action', 'get_semantic_map');
    fd.append('id',     id);
    setSemStatus('⏳ A carregar mapa…');
    fetch('?tab=semantic', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) { setSemStatus('❌ ' + data.message); return; }
            const mapData = JSON.parse(data.map.map_data);
            renderSemanticMap(mapData);
            document.getElementById('sem-save-name').value = data.map.name;
        })
        .catch(() => setSemStatus('❌ Erro de rede.'));
}

function deleteSavedSemanticMap(id, name) {
    if (!confirm(`Eliminar "${name}"?`)) return;
    const fd = new FormData();
    fd.append('action', 'delete_semantic_map');
    fd.append('id',     id);
    fetch('?tab=semantic', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) location.reload();
            else setSemStatus('❌ ' + data.message);
        });
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function setSemStatus(msg) {
    const el = document.getElementById('sem-status');
    if (el) el.textContent = msg;
}

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
