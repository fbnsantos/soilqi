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

    // Se a vista 3D já está activa, actualizar a cena imediatamente
    if (_3d.active) _render3DMap(mapData);
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

// ── Vista 3D (Three.js) ───────────────────────────────────────────────────────

const _3d = {
    scene: null, renderer: null, camera: null, controls: null,
    animId: null, active: false
};

/** Alterna entre vista 2D (MapLibre) e 3D (Three.js) */
function toggle3DView() {
    _3d.active = !_3d.active;

    const map2d = document.getElementById('semantic-map');
    const map3d = document.getElementById('semantic-3d');
    const btn   = document.getElementById('sem-btn-3d');

    if (map2d) map2d.style.display = _3d.active ? 'none'  : 'block';
    if (map3d) map3d.style.display = _3d.active ? 'block' : 'none';
    if (btn)   btn.textContent     = _3d.active ? '🗺️ Vista 2D' : '🧊 Vista 3D';

    if (_3d.active) {
        if (!_3d.scene) _init3D();
        if (currentSemData) _render3DMap(currentSemData);
        else setSemStatus('Carregue um mapa semântico para ver em 3D.');
    } else {
        if (_3d.animId) { cancelAnimationFrame(_3d.animId); _3d.animId = null; }
    }
}

/** Inicializar cena Three.js */
function _init3D() {
    if (!window.THREE) { setSemStatus('❌ Three.js não disponível.'); return; }

    const container = document.getElementById('semantic-3d');
    const canvas    = document.getElementById('semantic-3d-canvas');
    const W = container.clientWidth  || 800;
    const H = container.clientHeight || 620;

    // Cena
    _3d.scene = new THREE.Scene();
    _3d.scene.background = new THREE.Color(0x87CEEB);
    _3d.scene.fog = new THREE.FogExp2(0x87CEEB, 0.005);

    // Câmara
    _3d.camera = new THREE.PerspectiveCamera(55, W / H, 0.05, 2000);
    _3d.camera.position.set(18, 14, 24);
    _3d.camera.lookAt(8, 0, -5);

    // Renderer WebGL
    _3d.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _3d.renderer.setSize(W, H);
    _3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    _3d.renderer.shadowMap.enabled = true;
    _3d.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Orbit Controls
    if (THREE.OrbitControls) {
        _3d.controls = new THREE.OrbitControls(_3d.camera, _3d.renderer.domElement);
        _3d.controls.enableDamping = true;
        _3d.controls.dampingFactor = 0.05;
        _3d.controls.minDistance   = 0.5;
        _3d.controls.maxDistance   = 500;
        _3d.controls.maxPolarAngle = Math.PI / 2.02;
    }

    // Luz ambiente
    _3d.scene.add(new THREE.AmbientLight(0xfff4e0, 0.55));

    // Sol (directional com sombras)
    const sun = new THREE.DirectionalLight(0xfff8dc, 1.1);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 0.5;
    sun.shadow.camera.far    = 300;
    sun.shadow.camera.left   = sun.shadow.camera.bottom = -70;
    sun.shadow.camera.right  = sun.shadow.camera.top    =  70;
    _3d.scene.add(sun);

    // Luz de céu + solo
    _3d.scene.add(new THREE.HemisphereLight(0x87CEEB, 0x8B9B6A, 0.35));

    // Chão
    const groundMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500),
        new THREE.MeshLambertMaterial({ color: 0x8B9B6A })
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    _3d.scene.add(groundMesh);

    // Resize
    window.addEventListener('resize', _on3DResize);

    // Loop de animação
    const animate = () => {
        _3d.animId = requestAnimationFrame(animate);
        if (_3d.controls) _3d.controls.update();
        _3d.renderer.render(_3d.scene, _3d.camera);
    };
    animate();
}

function _on3DResize() {
    if (!_3d.active || !_3d.renderer || !_3d.camera) return;
    const c = document.getElementById('semantic-3d');
    if (!c) return;
    _3d.camera.aspect = c.clientWidth / c.clientHeight;
    _3d.camera.updateProjectionMatrix();
    _3d.renderer.setSize(c.clientWidth, c.clientHeight);
}

/** Remove todos os objectos semânticos da cena (mantém luzes e chão) */
function _clear3DObjects() {
    if (!_3d.scene) return;
    const rem = [];
    _3d.scene.traverse(o => { if (o.userData.sem) rem.push(o); });
    rem.forEach(o => {
        _3d.scene.remove(o);
        if (o.geometry) o.geometry.dispose();
        // materiais: não dispor se partilhados; GC trata do resto
    });
}

/** Renderizar mapa semântico completo em 3D */
function _render3DMap(mapData) {
    if (!_3d.scene) _init3D();
    if (!_3d.scene) return;
    _clear3DObjects();

    const layers  = mapData.layers || [];
    let   hasElev = false;

    layers.forEach(layer => {
        try {
            if (layer.type === 'elevation') { _render3DElev(layer);  hasElev = true; }
            if (layer.type === 'occupancy') { _render3DOcc(layer);  }
            if (layer.type === 'trees')     { _render3DTrees(layer); }
        } catch (e) { console.warn('[3D] Erro na camada', layer.type, e); }
    });

    if (!hasElev) {
        const grid = new THREE.GridHelper(100, 40, 0x777777, 0x444444);
        grid.position.y = 0.01;
        grid.userData.sem = true;
        _3d.scene.add(grid);
    }

    // Eixos de origem
    const ax = new THREE.AxesHelper(2.5);
    ax.position.y = 0.03;
    ax.userData.sem = true;
    _3d.scene.add(ax);

    _fit3DCamera(mapData);
}

/** Posicionar câmara para ver a área completa */
function _fit3DCamera(mapData) {
    let maxW = 15, cx = 0, cz = 0;
    (mapData.layers || []).forEach(l => {
        if (l.origin && l.width && l.resolution) {
            const w = l.width  * l.resolution;
            const h = l.height * l.resolution;
            maxW = Math.max(maxW, w, h);
            cx   = l.origin[0] + w / 2;
            cz   = -(l.origin[1] + h / 2);
        }
    });
    const d = maxW * 0.85;
    _3d.camera.position.set(cx + d * 0.65, d * 0.55, cz + d * 0.65);
    const target = new THREE.Vector3(cx, 0, cz);
    _3d.camera.lookAt(target);
    if (_3d.controls) { _3d.controls.target.copy(target); _3d.controls.update(); }
}

// ── 3D: Árvores ───────────────────────────────────────────────────────────────
function _render3DTrees(layer) {
    const MAT_TRUNK  = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
    const MAT_BRANCH = new THREE.MeshLambertMaterial({ color: 0x7B4F2E });

    for (const tree of (layer.data || [])) {
        const [lx, ly] = tree.position || [0, 0];
        // coord local (x,y) → Three.js: X=x, Z=-y  (Y=cima)
        const tx = lx, tz = -ly;

        const trunk  = tree.trunk || {};
        const tH     = trunk.height      || 2.5;
        const rBase  = trunk.radius_base || 0.10;
        const rTop   = Math.max(0.025, rBase * 0.50);

        const grp = new THREE.Group();
        grp.position.set(tx, 0, tz);
        grp.userData.sem = true;

        // Tronco (cilindro cónico)
        const tGeo  = new THREE.CylinderGeometry(rTop, rBase, tH, 8);
        const tMesh = new THREE.Mesh(tGeo, MAT_TRUNK);
        tMesh.position.y = tH / 2;
        tMesh.castShadow = tMesh.receiveShadow = true;
        grp.add(tMesh);

        // Ramos (TubeGeometry ao longo da curva de Bézier, com arco de altura)
        for (const br of (tree.branches || [])) {
            const pts2d = sampleBezier2D(br.points || [], 16);
            if (pts2d.length < 2) continue;
            const brR = Math.max(br.radius || 0.04, 0.018);

            const pts3d = pts2d.map(([bx, by]) => {
                const relX = bx - lx;
                const relZ = -(by - ly);
                const dist = Math.sqrt(relX * relX + relZ * relZ);
                // Arco: começa a ~40% da altura do tronco, sobe ligeiramente com a distância
                const arcY = tH * 0.40 + dist * 0.38 - dist * dist * 0.045;
                return new THREE.Vector3(relX, Math.max(arcY, tH * 0.22), relZ);
            });

            try {
                const curve   = new THREE.CatmullRomCurve3(pts3d, false, 'catmullrom', 0.5);
                const tubeGeo = new THREE.TubeGeometry(curve, 10, brR, 5, false);
                const tMsh    = new THREE.Mesh(tubeGeo, MAT_BRANCH);
                tMsh.castShadow = true;
                grp.add(tMsh);
            } catch (_) { /* Bézier degenerada */ }
        }

        // Copa (esfera — cor baseada em saúde + carga de fruto)
        const canopyR   = tree.canopy_radius || 1.5;
        const health    = tree.health  || 'good';
        const fruitLoad = tree.fruit_load || 0;
        const hue       = health === 'good' ? 0.32 : health === 'fair' ? 0.25 : 0.14;
        const cColor    = new THREE.Color().setHSL(hue, 0.55 + fruitLoad * 0.18, 0.28 + fruitLoad * 0.06);

        const cGeo  = new THREE.SphereGeometry(canopyR, 14, 10);
        const cMat  = new THREE.MeshLambertMaterial({ color: cColor, transparent: true, opacity: 0.88 });
        const cMesh = new THREE.Mesh(cGeo, cMat);
        cMesh.position.y = tH + canopyR * 0.60;
        cMesh.castShadow = cMesh.receiveShadow = true;
        grp.add(cMesh);

        // Azeitonas (esferas pequenas na copa se fruitLoad > 0.3)
        if (fruitLoad > 0.3) {
            const nFruits = Math.round(fruitLoad * 10);
            const fGeo    = new THREE.SphereGeometry(0.075, 5, 4);
            const fMat    = new THREE.MeshLambertMaterial({ color: 0x2E4A1A });
            for (let f = 0; f < nFruits; f++) {
                // distribuição de Fibonacci na esfera
                const phi   = Math.acos(1 - 2 * (f + 0.5) / nFruits);
                const theta = Math.PI * (1 + Math.sqrt(5)) * f;
                const fr    = canopyR * 0.82;
                const fMesh = new THREE.Mesh(fGeo, fMat);
                fMesh.position.set(
                    fr * Math.sin(phi) * Math.cos(theta),
                    tH + canopyR * 0.60 + fr * Math.cos(phi),
                    fr * Math.sin(phi) * Math.sin(theta)
                );
                grp.add(fMesh);
            }
        }

        _3d.scene.add(grp);
    }
}

// ── 3D: Mapa de Elevação (heightmap com cores de vértice) ────────────────────
function _render3DElev(layer) {
    const img = new Image();
    img.onload = () => {
        if (!_3d.scene) return;
        const W    = layer.width  || 25;
        const H    = layer.height || 20;
        const res  = layer.resolution || 1.0;
        const [ox, oy] = layer.origin || [0, 0];
        const minE = layer.min_elevation || 0;
        const maxE = layer.max_elevation || 15;
        const VSCALE = 0.30;    // exageração vertical (ajustar ao gosto)

        // Ler pixels da imagem
        const cvs = document.createElement('canvas');
        cvs.width = W; cvs.height = H;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, H).data;

        // PlaneGeometry W×H vértices → W-1 × H-1 segmentos, depois rodar para o chão
        const geo = new THREE.PlaneGeometry(W * res, H * res, W - 1, H - 1);
        geo.rotateX(-Math.PI / 2);

        const pos  = geo.attributes.position;
        const cols = [];

        for (let i = 0; i < pos.count; i++) {
            const row = Math.floor(i / W);
            const col = i % W;
            const idx = (row * W + col) * 4;
            // Canal azul é monotónico no gradiente de exemplo (34→60→85)
            const bv = px[idx + 2];
            const t  = Math.max(0, Math.min(1, (bv - 34) / 51));
            pos.setY(i, t * (maxE - minE) * VSCALE);

            // Cor de vértice: verde escuro → castanho claro
            const r = 0.13 + t * 0.40;
            const g = 0.43 - t * 0.05;
            const b = 0.10 + t * 0.14;
            cols.push(r, g, b);
        }

        geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        geo.computeVertexNormals();

        const mat  = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        // centrar o plano na área (origem = canto SW)
        mesh.position.set(ox + (W * res) / 2, 0, -(oy + (H * res) / 2));
        mesh.receiveShadow = true;
        mesh.userData.sem  = true;
        _3d.scene.add(mesh);
    };
    img.src = layer.data || '';
}

// ── 3D: Mapa de Ocupação (caixas InstancedMesh para obstáculos) ──────────────
function _render3DOcc(layer) {
    const img = new Image();
    img.onload = () => {
        if (!_3d.scene) return;
        const W    = layer.width  || 200;
        const H    = layer.height || 170;
        const res  = layer.resolution || 0.1;
        const [ox, oy] = layer.origin || [0, 0];
        const OBH  = 0.25;  // altura dos obstáculos em metros

        const cvs = document.createElement('canvas');
        cvs.width = W; cvs.height = H;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, H).data;

        // Células ocupadas (brilho R < 50 → pixel escuro)
        const occ = [];
        for (let r = 0; r < H; r++) {
            for (let c = 0; c < W; c++) {
                if (px[(r * W + c) * 4] < 50) {
                    // coord mundo: imagem linha 0 = norte (y alto), linha H-1 = sul (y baixo)
                    occ.push(
                        ox + (c + 0.5) * res,          // X
                        -(oy + (H - 1 - r) * res)       // Z  (Y invertido → -Z)
                    );
                }
            }
        }
        if (!occ.length) return;

        // Cap para não bloquear a GPU: subamostrar se necessário
        const MAX_INST = 10000;
        const nPairs   = occ.length / 2;
        const nInst    = Math.min(nPairs, MAX_INST);
        const step     = Math.ceil(nPairs / nInst);

        const boxGeo   = new THREE.BoxGeometry(res * 0.88, OBH, res * 0.88);
        const boxMat   = new THREE.MeshLambertMaterial({ color: 0xCC3322 });
        const instMesh = new THREE.InstancedMesh(boxGeo, boxMat, nInst);
        instMesh.castShadow = instMesh.receiveShadow = true;
        instMesh.userData.sem = true;

        const mtx   = new THREE.Matrix4();
        let   count = 0;
        for (let i = 0; i < nPairs && count < nInst; i += step, count++) {
            mtx.setPosition(occ[i * 2], OBH / 2, occ[i * 2 + 1]);
            instMesh.setMatrixAt(count, mtx);
        }
        instMesh.count = count;
        instMesh.instanceMatrix.needsUpdate = true;
        _3d.scene.add(instMesh);
    };
    img.src = layer.data || '';
}
