/**
 * Semantic Map Tab — MapLibre GL JS
 * Visualização de mapas semânticos gerados por robôs.
 * Suporta: árvores (Bézier), elevação (PNG), ocupação (PNG).
 */

'use strict';

let semMap          = null;
let currentSemData  = null;   // mapa semântico actualmente carregado
const semActiveSrc  = new Set(); // source IDs adicionadas ao mapa

function getTreesLayer(mapData) {
    return (mapData.layers || []).find(layer => layer.type === 'trees');
}

function ensurePruningAnnotations(tree) {
    if (!Array.isArray(tree.pruning_annotations)) {
        tree.pruning_annotations = [];
    }
    return tree.pruning_annotations;
}

function renderPruningAnnotationPanel(mapData) {
    const panel = document.getElementById('pruning-annotation-panel');
    if (!panel) return;

    const treesLayer = mapData ? getTreesLayer(mapData) : null;
    const trees = treesLayer?.data || [];

    if (!trees.length) {
        panel.innerHTML = '';
        return;
    }

    let html = '';

    for (const tree of trees) {
        const annotations = tree.pruning_annotations || [];
        const treeId = tree.id || 'sem_id';

        html += `
            <details style="margin-top:6px; border-top:1px solid #e5e7eb; padding-top:6px;">
                <summary style="cursor:pointer; font-weight:600; color:#374151;">
                    Videira ${treeId} (${annotations.length})
                </summary>
        `;

        if (!annotations.length) {
            html += `
                <div style="color:#9ca3af; padding:5px 0 2px 12px;">
                    Sem anotações.
                </div>
            `;
        }

        for (const annotation of annotations) {
            const actionLabel = annotation.action === 'remove_cane'
                ? 'Remover vara'
                : 'Podar aqui';

            const caneLabel = annotation.cane_id
                ? `Vara ${annotation.cane_id}`
                : 'Vara ?';

            const edgeLabel = annotation.edge
                ? `${annotation.edge.parent || '?'} - ${annotation.edge.child || '?'}`
                : 'sem edge';

            html += `
                <button type="button"
                        onclick="flashPruningAnnotation('${treeId}', '${annotation.id || ''}')"
                        style="display:block; width:100%; text-align:left; margin:4px 0 0 12px;
                               padding:5px 7px; border:1px solid #e5e7eb; border-radius:6px;
                               background:#fff; color:#374151; cursor:pointer; font-size:12px;">
                    ${actionLabel} ; ${caneLabel}${annotation.action === 'cut_here' ? ` ; ${edgeLabel}` : ''}
                </button>
            `;
        }

        html += '</details>';
    }

    panel.innerHTML = html;
}

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
        loadFieldObjectsForSem();
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

/** Amostra curva Bézier 2D (quadrática ou cúbica) em n pontos.
 *  Aceita pontos 2D [x,y] ou 3D [x,y,z] — neste caso ignora Z. */
function sampleBezier2D(pts, n = 14) {
    const p2 = pts.map(p => [p[0], p[1]]);   // projecção 2D
    const result = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        let x = 0, y = 0;
        if (p2.length === 2) {
            x = u*p2[0][0] + t*p2[1][0];
            y = u*p2[0][1] + t*p2[1][1];
        } else if (p2.length === 3) {
            x = u*u*p2[0][0] + 2*u*t*p2[1][0] + t*t*p2[2][0];
            y = u*u*p2[0][1] + 2*u*t*p2[1][1] + t*t*p2[2][1];
        } else {
            x = u*u*u*p2[0][0] + 3*u*u*t*p2[1][0] + 3*u*t*t*p2[2][0] + t*t*t*p2[3][0];
            y = u*u*u*p2[0][1] + 3*u*u*t*p2[1][1] + 3*u*t*t*p2[2][1] + t*t*t*p2[3][1];
        }
        result.push([x, y]);
    }
    return result;
}

/** Amostra curva Bézier 3D (linear, quadrática ou cúbica) em n pontos.
 *  Sistema local ROS: X=este, Y=norte, Z=cima (metros).
 *  Aceita pontos 2D [x,y] — nesse caso Z é inferido como 0. */
function sampleBezier3D(pts, n = 14) {
    const p3 = pts.map(p => [p[0], p[1], p[2] ?? 0]);  // garantir 3D
    const result = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        let x = 0, y = 0, z = 0;
        if (p3.length === 2) {
            x = u*p3[0][0] + t*p3[1][0];
            y = u*p3[0][1] + t*p3[1][1];
            z = u*p3[0][2] + t*p3[1][2];
        } else if (p3.length === 3) {
            x = u*u*p3[0][0] + 2*u*t*p3[1][0] + t*t*p3[2][0];
            y = u*u*p3[0][1] + 2*u*t*p3[1][1] + t*t*p3[2][1];
            z = u*u*p3[0][2] + 2*u*t*p3[1][2] + t*t*p3[2][2];
        } else {
            x = u*u*u*p3[0][0] + 3*u*u*t*p3[1][0] + 3*u*t*t*p3[2][0] + t*t*t*p3[3][0];
            y = u*u*u*p3[0][1] + 3*u*u*t*p3[1][1] + 3*u*t*t*p3[2][1] + t*t*t*p3[3][1];
            z = u*u*u*p3[0][2] + 3*u*u*t*p3[1][2] + 3*u*t*t*p3[2][2] + t*t*t*p3[3][2];
        }
        result.push([x, y, z]);
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
     'sem-elev-layer','sem-occ-layer','sem-occ-line',
     'sem-poles'].forEach(id => {
        if (semMap && semMap.getLayer(id)) semMap.removeLayer(id);
    });
    ['sem-canopies','sem-branches-src','sem-trunks-src',
     'sem-elev-img','sem-occ-img','sem-poles-src'].forEach(id => {
        if (semMap && semMap.getSource(id)) semMap.removeSource(id);
    });
    semActiveSrc.clear();
    currentSemData = null;
    document.getElementById('sem-layers-list').innerHTML =
        '<span style="color:#9ca3af;font-size:12px;">Nenhum mapa carregado.</span>';

    renderPruningAnnotationPanel(null);

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
            if (layer.type === 'poles')     { renderPoleLayer(layer, ref);      layerItems.push({ type:'poles',     layer }); }
        } catch (e) {
            console.warn('[SoilQI Semantic] Erro ao renderizar camada', layer.type, e);
        }
    });

    updateSemLayerList(layerItems, mapData);

    renderPruningAnnotationPanel(mapData);

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
        // for (const branch of (tree.branches || [])) {
        //     const pts2d = sampleBezier2D(branch.points || []);
        //     if (pts2d.length < 2) continue;
        //     const coords = pts2d.map(([x,y]) => localToLngLat(x, y, ref));
        //     branchFeats.push({
        //         type: 'Feature',
        //         geometry: { type: 'LineString', coordinates: coords },
        //         properties: { tree_id: tree.id || '?' }
        //     });
        // }

        // Modificação para polylines nas varas

        for (const branch of (tree.branches || [])) {
            const rawPts = branch.points || [];
            const pts2d = branch.type === 'polyline3'
                ? rawPts.map(p => [p[0], p[1]])
                : sampleBezier2D(rawPts);

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

// ── Layer: Postes ─────────────────────────────────────────────────────────────
function renderPoleLayer(layer, ref) {
    const features = (layer.data || []).map(pole => {
        const [px, py] = pole.position || [0, 0];
        const [lng, lat] = localToLngLat(px, py, ref);
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
                id:       pole.id    || '?',
                height:   pole.height   || 2.5,
                shape:    pole.shape    || 'cylinder',
                diameter: pole.diameter || 0.10,
                color:    pole.color    || '#8B6914',
                label:    pole.label    || pole.id || 'poste'
            }
        };
    });
    addSemSource('sem-poles-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features }
    });
    addSemLayer({
        id: 'sem-poles', type: 'circle', source: 'sem-poles-src',
        paint: {
            'circle-radius':       6,
            'circle-color':        ['get', 'color'],
            'circle-stroke-color': '#333',
            'circle-stroke-width': 1.5,
            'circle-opacity':      0.9
        }
    });
    semMap.on('click', 'sem-poles', e => {
        const p = e.features[0].properties;
        new maplibregl.Popup({ closeButton: true })
            .setLngLat(e.lngLat)
            .setHTML(`<strong>🪵 ${_esc(p.id)}</strong><br>
                <table style="margin-top:4px;">
                <tr><td>Forma</td><td>${_esc(p.shape)}</td></tr>
                <tr><td>Diâmetro</td><td>${parseFloat(p.diameter).toFixed(3)} m</td></tr>
                <tr><td>Altura</td><td>${parseFloat(p.height).toFixed(2)} m</td></tr>
                </table>`)
            .addTo(semMap);
    });
    semMap.on('mouseenter', 'sem-poles', () => { semMap.getCanvas().style.cursor = 'pointer'; });
    semMap.on('mouseleave', 'sem-poles', () => { semMap.getCanvas().style.cursor = ''; });
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

    const COLORS = { trees:'#22c55e', elevation:'#f59e0b', occupancy:'#6b7280', poles:'#92400e' };
    const ICONS  = { trees:'🌳', elevation:'⛰️', occupancy:'🗺️', poles:'🪵' };

    let html = items.map(({ type, layer }) => {
        const n = type === 'trees'     ? (layer.data?.length || 0) + ' árvores' :
                  type === 'poles'     ? (layer.data?.length || 0) + ' postes' :
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

    // ── Parâmetros do DEM — definidos primeiro para poder amostrar nos troncos ─
    const eW = 30, eH = 25;
    const eMin = 100.0, eMax = 105.0;
    const eOx = -1.5, eOy = -1.5, eRes = 1.0;
    const _elevPx = (epx, epy) => eMin
        + (epx / eW) * 2.5 + (epy / eH) * 1.5
        + Math.sin(epx * 0.45) * 0.60 + Math.cos(epy * 0.38 + 0.5) * 0.35;
    const elevAtWorld = (wx, wy) => _elevPx(
        Math.max(0, Math.min(eW - 1, (wx - eOx) / eRes)),
        Math.max(0, Math.min(eH - 1, eH - 1 - (wy - eOy) / eRes))
    );

    // ── Oliveiras: grelha 4×3 com perturbação ────────────────────────────────
    const trees = [];
    const rows = 3, cols = 4, spacingX = 4.5, spacingY = 5.0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = c * spacingX + rng(-0.2, 0.2);
            const y = r * spacingY + rng(-0.2, 0.2);
            const zBase = elevAtWorld(x, y);   // altitude real do terreno nessa posição
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

                // Z absoluto: o ramo nasce no tronco (zBase + fracção da altura)
                // e estende-se para fora com ligeira variação vertical real
                const zStart = zBase + height * rng(0.38, 0.55);        // junção ao tronco
                const zMid   = zStart + len * rng(0.06, 0.28);          // controlo — arco suave
                const zEnd   = zStart + len * rng(-0.10, 0.32);         // ponta — pode baixar ou subir

                const brMaxDiam = trunkR * rng(0.55, 0.85);  // ramo mais fino que o tronco
                branches.push({
                    type: 'bezier3',
                    points: [
                        [x,                           y,                           zStart],
                        [x + Math.cos(midA) * midR,   y + Math.sin(midA) * midR,   zMid  ],
                        [x + Math.cos(angle) * len,    y + Math.sin(angle) * len,    zEnd  ]
                    ],
                    // Taper do ramo: d(t) = max − a·t
                    taper: {
                        max: parseFloat((brMaxDiam * 2).toFixed(3)),
                        a:   parseFloat((brMaxDiam * 2 * 0.80).toFixed(3))  // afila 80%
                    }
                });
            }

            trees.push({
                id: `T${String(r * cols + c + 1).padStart(3,'0')}`,
                species: 'olea_europaea',
                position: [x, y, zBase],
                trunk: {
                    height: parseFloat(height.toFixed(2)),
                    // Função de taper: d(t) = max − a·t
                    taper: {
                        max: parseFloat((trunkR * 2).toFixed(3)),          // diâmetro na base
                        a:   parseFloat((trunkR * 2 * 0.75).toFixed(3))    // afilamento: topo ≈ 25% da base
                    }
                },
                branches,
                canopy_radius: parseFloat(canopyR.toFixed(2)),
                health,
                fruit_load: health === 'good' ? parseFloat(rng(0.3, 1.0).toFixed(2)) : parseFloat(rng(0, 0.3).toFixed(2)),
                fruit_spec: { color: '#3B5A1A', radius: 0.055 },   // azeitona
                last_measurement: '2026-05-10'
            });
        }
    }

    // ── Mapa de elevação: 30×25 células, 1 m/célula ───────────────────────────
    // (eW, eH, eMin, eMax, _elevPx, elevAtWorld foram definidos acima)
    const elevCanvas = document.createElement('canvas');
    elevCanvas.width = eW; elevCanvas.height = eH;
    const eCtx = elevCanvas.getContext('2d');
    const eImg = eCtx.createImageData(eW, eH);
    for (let py = 0; py < eH; py++) {
        for (let px = 0; px < eW; px++) {
            const e = _elevPx(px, py);
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

    // ── Postes de vedação perimetral ─────────────────────────────────────────
    const groveW = (cols - 1) * spacingX;
    const groveH = (rows - 1) * spacingY;
    const poleH  = 1.6;
    const poles  = [];
    // 3 postes ao longo da borda norte (y=groveH), sul (y=0), este (x=groveW)
    for (let i = 0; i <= 3; i++) {
        const t  = i / 3;
        const pz = elevAtWorld(t * groveW, 0);
        poles.push({ id:`P${String(poles.length+1).padStart(3,'0')}`,
            position: [t * groveW, 0, pz],
            height: poleH, shape: 'cylinder',
            taper: { max: 0.080, a: 0.030 },
            color: '#7B4F2E', label: 'Poste de vedação' });
    }
    for (let i = 0; i <= 3; i++) {
        const t  = i / 3;
        const pz = elevAtWorld(t * groveW, groveH);
        poles.push({ id:`P${String(poles.length+1).padStart(3,'0')}`,
            position: [t * groveW, groveH, pz],
            height: poleH, shape: 'cylinder',
            taper: { max: 0.080, a: 0.030 },
            color: '#7B4F2E', label: 'Poste de vedação' });
    }
    // Dois postes de irrigação (quadrado, metálico) junto a árvores centrais
    [trees[5], trees[6]].forEach((tree, i) => {
        const [tx, ty, tz] = tree.position;
        poles.push({ id:`PI${i+1}`, position: [tx + 0.7, ty, tz],
            height: 1.2, shape: 'square',
            diameter: 0.04, color: '#888888', label: 'Poste de irrigação' });
    });

    return {
        type: 'semantic_map',
        version: '1.0',
        name: 'Olival de Exemplo — Quinta Norte',
        created: new Date().toISOString(),
        coordinate_system: 'local',
        reference: ref,
        layers: [
            {
                id: 'poles',
                type: 'poles',
                label: `Postes (${poles.length})`,
                data: poles
            },
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


// Função de teste da anotação para pruning --------------------

// function addTestPruningAnnotation() {
//     if (!currentSemData) {
//         setSemStatus('Nenhum mapa carregado');
//         return;
//     }

//     const treesLayer = getTreesLayer(currentSemData);
//     const tree = treesLayer?.data?.[0];

//     if (!tree) {
//         setSemStatus('Nenhuma videira encontrada');
//         return;
//     }

//     const branch = (tree.branches || [])[0];
//     const segment = branch?.segments?.[0];

//     const actionMode = document.getElementById('pruning-action-mode')?.value || 'cut_here';

//     if (!branch || !segment) {
//         setSemStatus('Nenhum segmento de vara encontrada');
//         return;
//     }

//     const start = branch.points[segment.point_start_index];
//     const end = branch.points[segment.point_end_index];

//     if (!start || !end) {
//         setSemStatus('Segmento inválido');
//         return;
//     }

//     const position = [
//         (start[0] + end[0]) / 2,
//         (start[1] + end[1]) / 2,
//         (start[2] + end[2]) / 2
//     ];

//     // Cut test
//     // ensurePruningAnnotations(tree).push({
//     //     id: `pa_${Date.now()}`,
//     //     action: 'cut_here',
//     //     tree_id: tree.id,
//     //     edge: {
//     //         parent: segment.parent,
//     //         child: segment.child,
//     //         t:0.5
//     //     },
//     //     position,
//     //     source: 'expert'
//     // });

//     //Remove test
//     // ensurePruningAnnotations(tree).push({
//     //     id: `pa_${Date.now()}`,
//     //     action: 'remove_cane',
//     //     tree_id: tree.id,
//     //     cane_id: segment.cane_id || branch.cane_id || '',
//     //     base_node: '',
//     //     edge: {
//     //         parent: segment.parent,
//     //         child: segment.child,
//     //         t: 0.0
//     //     },
//     //     position,
//     //     source: 'expert'
//     // });

//     const annotation = {
//         id: `pa_${new Date().toISOString().replace(/[:.]/g, '-')}`,
//         action: actionMode,
//         tree_id: tree.id,
//         position,
//         source: 'expert'
//     };

//     if (actionMode === 'cut_here') {
//         annotation.edge = {
//             parent: segment.parent,
//             child: segment.child,
//             t: 0.5
//         };
//     }

//     if (actionMode === 'remove_cane') {
//         annotation.cane_id = segment.cane_id || branch.cane_id || '';
//         annotation.edge = {
//             parent: segment.parent,
//             child: segment.child,
//             t: 0.0
//         };
//     }

//     ensurePruningAnnotations(tree).push(annotation);

//     setSemStatus(
//         actionMode === 'remove_cane'
//             ? `Vara ${annotation.cane_id || '?'} marcada para remover.`
//             : 'Anotação de corte adicionada.'
//     );

//     if (_3d.active) _render3DMap(currentSemData, {preserveCamera: true});
// }


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


// Teste de função para piscar anotações quando clickadas no dropdown
function flashPruningAnnotation(treeId, annotationId) {
    if (!currentSemData) {
        setSemStatus('Nenhum mapa ativo.');
        return;
    }

    if (!_3d.active) {
        setSemStatus('Abra mapa 3D para ver anotação.');
        return;
    }

    const treesLayer = getTreesLayer(currentSemData);
    const tree = (treesLayer?.data || []).find(t => String(t.id || '') === String(treeId));
    const annotation = (tree?.pruning_annotations || []).find(a => String(a.id || '') === String(annotationId));

    if (!tree || !annotation || !annotation.position) {
        setSemStatus('Anotação não encontrada.');
        return;
    }

    const [px, py, pz = 0] = annotation.position;

    const elevLayer = (currentSemData.layers || []).find(layer => layer.type === 'elevation');
    const minE = elevLayer?.min_elevation || 0;

    const flashGeo = new THREE.SphereGeometry(0.04,18,12);
    const flashMat = new THREE.MeshBasicMaterial({
        color: annotation.action === 'remove_cane' ? 0xef4444 : 0xfacc15,
        transparent: true,
        opacity: 1
    });

    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.position.set(px, pz - minE, -py);
    flashMesh.userData.sem = true;
    flashMesh.userData.kind = 'annotation_flash';

    _3d.scene.add(flashMesh);

    let ticks = 0;
    const timer = setInterval(() => {
        ticks += 1;

        const visible = ticks % 2 === 0;
        flashMesh.visible = visible;
        flashMesh.scale.setScalar(visible ? 1.4 : 0.8);

        if (ticks >= 10) {
            clearInterval(timer);
            _3d.scene.remove(flashMesh);
            flashGeo.dispose();
            flashMat.dispose();
        }
    },120);

    setSemStatus(
        annotation.action === 'remove_cane'
            ? `Anotação de remoção na vara ${annotation.cane_id || '?'}`
            : `Anotação de corte na vara ${annotation.cane_id || '?'}`
    );

}

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
    raycaster: null, mouse: null, branchMeshes: [], pointerDown: null,
    annotationMode: false, animId: null, active: false
};


function togglePruningAnnotationMode() {
    _3d.annotationMode = !_3d.annotationMode;

    const btn = document.getElementById('pruning-mode-toggle');
    if (btn) {
        btn.classList.toggle('btn-primary', _3d.annotationMode);
        btn.classList.toggle('btn-secondary', !_3d.annotationMode);
        btn.textContent = _3d.annotationMode ? 'Pruning On' : 'Pruning mode';
    }

    setSemStatus(
        _3d.annotationMode
            ? 'Modo de anotação activo'
            : 'Modo de anotação desligado'
    );
}


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
        else _start3DAnimation();

        _on3DResize();
        
        if (currentSemData) _render3DMap(currentSemData);
        else setSemStatus('Carregue um mapa semântico para ver em 3D.');
    } else {
        if (_3d.animId) { cancelAnimationFrame(_3d.animId); _3d.animId = null; }
    }
}

/** Helper function to stop the crash between toggle of 2D to 3D */

function _start3DAnimation() {
    if (_3d.animId || !_3d.renderer || !_3d.scene || !_3d.camera) return;

    const animate = () => {
        _3d.animId = requestAnimationFrame(animate);
        if (_3d.controls) _3d.controls.update();
        _3d.renderer.render(_3d.scene, _3d.camera);
    };

    animate();
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

    _3d.raycaster = new THREE.Raycaster();
    _3d.mouse = new THREE.Vector2();

    _3d.renderer.domElement.addEventListener('pointerdown', _on3DPointerDown);
    _3d.renderer.domElement.addEventListener('pointerup', _on3DPointerUp);


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
    // const animate = () => {
    //     _3d.animId = requestAnimationFrame(animate);
    //     if (_3d.controls) _3d.controls.update();
    //     _3d.renderer.render(_3d.scene, _3d.camera);
    // };
    // animate();

    _start3DAnimation();
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
function _render3DMap(mapData, options = {}) {
    if (!_3d.scene) _init3D();
    if (!_3d.scene) return;
    _clear3DObjects();

    _3d.branchMeshes = [];

    const layers = mapData.layers || [];
    let hasElev  = false;

    // Recolher contexto de elevação — necessário para alinhar bases dos troncos
    const elevCtx = { minE: 0, maxE: 0 };
    layers.forEach(l => {
        if (l.type === 'elevation') {
            elevCtx.minE = l.min_elevation || 0;
            elevCtx.maxE = l.max_elevation || 0;
        }
    });

    layers.forEach(layer => {
        try {
            if (layer.type === 'elevation') { _render3DElev(layer);              hasElev = true; }
            if (layer.type === 'occupancy') { _render3DOcc(layer);                              }
            if (layer.type === 'trees')     { _render3DTrees(layer, elevCtx);                   }
            if (layer.type === 'poles')     { _render3DPoles(layer, elevCtx);                   }
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

   if (!options.preserveCamera) {
      _fit3DCamera(mapData, elevCtx);
   }
}

/** Posicionar câmara para ver a área completa */
// function _fit3DCamera(mapData, elevCtx) {
//     let maxW = 15, cx = 0, cz = 0;
//     (mapData.layers || []).forEach(l => {
//         if (l.origin && l.width && l.resolution) {
//             const w = l.width  * l.resolution;
//             const h = l.height * l.resolution;
//             maxW = Math.max(maxW, w, h);
//             cx   = l.origin[0] + w / 2;
//             cz   = -(l.origin[1] + h / 2);
//         }
//     });
//     const d    = maxW * 0.85;
//     // Apontar para o centro médio do terreno (metade da amplitude de elevação)
//     const midH = elevCtx ? (elevCtx.maxE - elevCtx.minE) / 2 : 0;
//     _3d.camera.position.set(cx + d * 0.65, d * 0.55 + midH, cz + d * 0.65);
//     const target = new THREE.Vector3(cx, midH, cz);
//     _3d.camera.lookAt(target);
//     if (_3d.controls) { _3d.controls.target.copy(target); _3d.controls.update(); }
// }


// Change to camera vew on the 3D view to consider objects outside of the predefined map
function _fit3DCamera(mapData, elevCtx) {
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    const includePoint = (x, z) => {
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    };

    (mapData.layers || []).forEach(l => {
        if (l.origin && l.width && l.height && l.resolution) {
            const w = l.width * l.resolution;
            const h = l.height * l.resolution;

            includePoint(l.origin[0], -(l.origin[1]));
            includePoint(l.origin[0] + w, -(l.origin[1] + h));
        }

        if (l.type === 'trees' && Array.isArray(l.data)) {
            for (const tree of l.data) {
                const [x, y] = tree.position || [0, 0];
                includePoint(x, -y);

                const addShapePoints = shapes => {
                    for (const shape of (shapes || [])) {
                        for (const pt of (shape.points || [])) {
                            includePoint(pt[0], -pt[1]);
                        }
                    }
                };

                addShapePoints(tree.trunk?.shapes);
                addShapePoints(tree.cordons);
                addShapePoints(tree.spurs);

                for (const br of (tree.branches || [])) {
                    for (const pt of (br.points || [])) {
                        includePoint(pt[0], -pt[1]);
                    }
                }

                for (const node of (tree.nodes || [])) {
                    const pt = node.position;
                    if (pt) includePoint(pt[0], -pt[1]);
                }
            }
        }

        if (l.type === 'poles' && Array.isArray(l.data)) {
            for (const pole of l.data) {
                const [x, y] = pole.position || [0, 0];
                includePoint(x, -y);
            }
        }
    });

    if (!Number.isFinite(minX)) {
        minX = -7.5;
        maxX = 7.5;
        minZ = -7.5;
        maxZ = 7.5;
    }

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    const spanX = Math.max(maxX - minX, 1);
    const spanZ = Math.max(maxZ - minZ, 1);
    const maxW = Math.max(spanX, spanZ, 15);

    const d = maxW * 0.85;
    const midH = elevCtx ? (elevCtx.maxE - elevCtx.minE) / 2 : 0;

    _3d.camera.position.set(
        cx + d * 0.65,
        d * 0.55 + midH,
        cz + d * 0.65
    );

    const target = new THREE.Vector3(cx, midH, cz);
    _3d.camera.lookAt(target);

    if (_3d.controls) {
        _3d.controls.target.copy(target);
        _3d.controls.update();
    }
}


function _on3DPointerDown(event) {
    _3d.pointerDown = {
        x: event.clientX,
        y: event.clientY
    };
}

function _on3DPointerUp(event) {
    if (!_3d.annotationMode || !_3d.pointerDown) {
        _3d.pointerDown = null;
        return;
    }

    const dx = event.clientX - _3d.pointerDown.x;
    const dy = event.clientY - _3d.pointerDown.y;
    const moved = Math.sqrt(dx * dx + dy * dy);

    _3d.pointerDown = null;

    if (moved > 4) return;

    _on3DCanvasPick(event);
}


function _closestPointOnSegment(point, start, end) {
    const segmentVector = end.clone().sub(start);
    const lengthSq = segmentVector.lengthSq();

    if (lengthSq === 0) {
        return {
            point: start.clone(),
            t: 0,
            distanceSq: point.distanceToSquared(start)
        };
    }

    const t = Math.max(
        0,
        Math.min(1, point.clone().sub(start).dot(segmentVector) / lengthSq)
    );

    const closest = start.clone().add(segmentVector.multiplyScalar(t));

    return {
        point: closest,
        t,
        distanceSq: point.distanceToSquared(closest)
    };
}


function _findClickedBranchSegment(localPoint, points3d, branch) {
    let best = null;

    for(let i=0; i < points3d.length - 1; i++) {
        const candidate = _closestPointOnSegment(
            localPoint,
            points3d[i],
            points3d[i + 1]
        );

        if (!best || candidate.distanceSq < best.distanceSq) {
            best = {
                pointIndex: i,
                localT: candidate.t,
                distanceSq: candidate.distanceSq,
                point: candidate.point
            };
        }
    }

    if (!best) return null;

    const graphSegment = (branch.segments || []).find(segment =>
        best.pointIndex >= segment.point_start_index &&
        best.pointIndex < segment.point_end_index
    );

    if (!graphSegment) return null;
    
    const span = graphSegment.point_end_index - graphSegment.point_start_index;
    const edgeT = span > 0
        ? (best.pointIndex + best.localT - graphSegment.point_start_index) / span
        : 0;

    return {
        segment: graphSegment,
        t: Math.max(0, Math.min(1, edgeT)),
        point: best.point
    };
}

function eraseNearestPruningAnnotation(tree, branch, segment, localPoint) {
    const annotations = tree.pruning_annotations || [];

    const clickedCaneId = segment.cane_id || branch.cane_id || '';

    const removeIndex = annotations.findIndex(annotation =>
        annotation.action === 'remove_cane' &&
        annotation.cane_id &&
        String(annotation.cane_id) === String(clickedCaneId)
    );

    if (removeIndex >= 0) {
        annotations.splice(removeIndex, 1);
        setSemStatus(`Remoção da anotação na vara ${clickedCaneId}`);
        return true;
    }

    let bestIndex = -1;
    let bestDistanceSq = Infinity;

    for (let i = 0; i < annotations.length; i++) {
        const annotation = annotations[i];
        if (annotation.action !== 'cut_here' || !annotation.position) continue;

        const [px, py, pz] = annotation.position;

        const annotationLocal = new THREE.Vector3(
            px - tree.position[0],
            pz - tree.position[2],
            -(py - tree.position[1])
        );

        const distanceSq = annotationLocal.distanceToSquared(localPoint);

        if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            bestIndex = i;
        }
    }

    const eraseRadius = 0.08;

    if (bestIndex >= 0 && bestDistanceSq <= eraseRadius * eraseRadius) {
        annotations.splice(bestIndex, 1);
        setSemStatus('Anotação apagada');
        return true;
    }

    setSemStatus('Nenhuma anotação próxima para apagar');
    return false;
}


function _on3DCanvasPick(event) {
    if (!_3d.active || !_3d.camera || !_3d.renderer || !_3d.raycaster) return;
    if (!_3d.branchMeshes.length) return;

    const rect = _3d.renderer.domElement.getBoundingClientRect();

    _3d.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    _3d.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    _3d.raycaster.setFromCamera(_3d.mouse, _3d.camera);

    const hits = _3d.raycaster.intersectObjects(_3d.branchMeshes, false);

    if (!hits.length) return;

    const hit = hits[0];
    const mesh = hit.object;

    const tree = mesh.userData.tree;
    const branch = mesh.userData.branch;
    const points3d = mesh.userData.points3d || [];

    const localPoint = mesh.parent.worldToLocal(hit.point.clone());
    const match = _findClickedBranchSegment(localPoint, points3d, branch);

    if (!tree || !branch || !match) {
        setSemStatus('Sem segmento associado');
        return;
    }

    const actionMode = document.getElementById('pruning-action-mode')?.value || 'cut_here';
    const segment = match.segment;

    const clickedCaneId = segment.cane_id || branch.cane_id || '';

    if (actionMode !== 'erase') {
        const existing = (tree.pruning_annotations || []).find(annotation =>
            annotation.cane_id &&
            clickedCaneId &&
            String(annotation.cane_id) === String(clickedCaneId)
        );

        if (existing) {
            setSemStatus(
                existing.action === 'remove_cane'
                    ? `A vara ${clickedCaneId} já está marcada para remoção`
                    : `A vara ${clickedCaneId} já tem um corte de poda marcado`
            );
            return;
        }
    }

    const treePosition = tree.position || [0,0,0];
    const worldPosition = [
        treePosition[0] + match.point.x,
        treePosition[1] - match.point.z,
        treePosition[2] + match.point.y
    ];

    const annotation = {
        id: `pa_${new Date().toISOString().replace(/[:.]/g, '-')}`,
        action: actionMode,
        tree_id: tree.id,
        position: worldPosition,
        source: 'expert'
    };

    if (actionMode === 'cut_here') {
        annotation.cane_id = clickedCaneId;
        annotation.edge = {
            parent: segment.parent,
            child: segment.child,
            t: match.t
        };
    }

    if (actionMode === 'remove_cane') {
        annotation.cane_id = clickedCaneId;
        annotation.edge = {
            parent: segment.parent,
            child: segment.child,
            t: match.t
        };
    }

    if (actionMode === 'erase') {
        eraseNearestPruningAnnotation(tree, branch, segment, match.point);
        renderPruningAnnotationPanel(currentSemData);
        _render3DMap(currentSemData, {preserveCamera: true});
        return;
    }

    ensurePruningAnnotations(tree).push(annotation);

    renderPruningAnnotationPanel(currentSemData);

    setSemStatus(
        actionMode === 'remove_cane'
            ? `Vara ${annotation.cane_id || '?'} marcada para remoção`
            : `Corte marcado na vara ${annotation.cane_id || '?'}`
    );

    _render3DMap(currentSemData, { preserveCamera: true });
}




// ── 3D: Helper — tubo cónico ao longo de uma curva ───────────────────────────
// Cria um BufferGeometry para um tubo com raio que varia de rStart a rEnd.
// Usa as Frenet frames da curva para orientação correcta.
function _taperTube(curve, tubSegs, rStart, rEnd, radSegs) {
    tubSegs  = Math.max(tubSegs,  4);
    radSegs  = Math.max(radSegs,  4);
    rStart   = Math.max(rStart, 0.005);
    rEnd     = Math.max(rEnd,   0.003);

    const frames    = curve.computeFrenetFrames(tubSegs, false);
    const pts       = curve.getPoints(tubSegs);
    const nVerts    = (tubSegs + 1) * (radSegs + 1);
    const positions = new Float32Array(nVerts * 3);
    const normals   = new Float32Array(nVerts * 3);
    const uvs       = new Float32Array(nVerts * 2);
    let pi = 0, ni = 0, ui = 0;

    for (let i = 0; i <= tubSegs; i++) {
        const t  = i / tubSegs;
        const r  = rStart + (rEnd - rStart) * t;
        const c  = pts[i];
        const N  = frames.normals[i];
        const B  = frames.binormals[i];

        for (let j = 0; j <= radSegs; j++) {
            const ang = (j / radSegs) * Math.PI * 2;
            const cos = Math.cos(ang), sin = Math.sin(ang);
            const nx  = cos * N.x + sin * B.x;
            const ny  = cos * N.y + sin * B.y;
            const nz  = cos * N.z + sin * B.z;
            positions[pi++] = c.x + r * nx;
            positions[pi++] = c.y + r * ny;
            positions[pi++] = c.z + r * nz;
            normals[ni++] = nx; normals[ni++] = ny; normals[ni++] = nz;
            uvs[ui++] = j / radSegs; uvs[ui++] = t;
        }
    }

    const idx = [];
    for (let i = 0; i < tubSegs; i++) {
        for (let j = 0; j < radSegs; j++) {
            const a = (radSegs + 1) * i + j;
            const b = (radSegs + 1) * (i + 1) + j;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
    geo.setIndex(idx);
    return geo;
}

// ── 3D: Árvores ───────────────────────────────────────────────────────────────
// Sistema local ROS → Three.js:  local(x, y, z)  →  Three.js(x, z−minE, −y)

// Função de helper para adicionar contornos
function addContourShapesToGroup(shapes, grp, lx, ly, lz, material, depth = 0.06) {
    let drewAny = false;

    for (const shape of (shapes || [])) {
        const pts = shape.points || [];
        if (shape.type !== 'contour3' || pts.length < 3) continue;

        const shape2d = new THREE.Shape();

        for (let i=0; i < pts.length; i++) {
            const [px, py, pz = lz] = pts[i];

            const sx = px - lx;
            const sy = pz - lz;

            if (i === 0) {
                shape2d.moveTo(sx, sy);
            } else {
                shape2d.lineTo(sx, sy);
            }
        }

        shape2d.closePath();

        // With edges
        //const geo = new THREE.ExtrudeGeometry(shape2d, {depth, bevelEnabled: false, });

        // Soft edges/round
        const geo = new THREE.ExtrudeGeometry(shape2d, {
            depth, 
            bevelEnabled: true,
            bevelThickness: depth * 0.2,
            bevelSize: depth * 0.2,
            bevelSegment: 4,
        });

        const mesh = new THREE.Mesh(geo, material);
        mesh.position.z = -depth / 2;
        mesh.castShadow = mesh.receiveShadow = true;
        grp.add(mesh);

        drewAny = true;
    }

    return drewAny;
}





function _render3DTrees(layer, elevCtx) {
    const minE = elevCtx?.minE ?? 0;

    const MAT_TRUNK  = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
    const MAT_BRANCH = new THREE.MeshLambertMaterial({ color: 0x7B4F2E });

    const MAT_CORDON = new THREE.MeshLambertMaterial({color: 0x6B3F1F});
    const MAT_SPUR = new THREE.MeshLambertMaterial({color: 0x9A6A3A});

    const MAT_BRANCH_REMOVE = new THREE.MeshLambertMaterial({
        color: 0xdc2626,
        emissive: 0x4a0000,
        emissiveIntensity: 0.2
    });

    const MAT_PRUNING_CUT = new THREE.MeshLambertMaterial({
        color: 0xfacc15,
        emissive: 0x7c5c00,
        emissiveIntensity: 0.25
    });

    // const MAT_PRUNING_REMOVE = new THREE.MeshLambertMaterial({
    //     color: 0xdc2626,
    //     emissive: 0x4a0000,
    //     emissiveIntensity: 0.25
    // });

    for (const tree of (layer.data || [])) {
        const [lx, ly, lz = 0] = tree.position || [0, 0, 0];

        const trunk = tree.trunk || {};
        const tH    = trunk.height || 2.5;

        // ── Raio do tronco com função de taper d = max − a·t ────────────────
        // Se taper definido: rBase = max/2, rTop = (max−a)/2
        // Caso contrário: usa radius_base / radius_apex do formato antigo
        let rBase, rTop;
        if (trunk.taper) {
            rBase = (trunk.taper.max) / 2;
            rTop  = Math.max(0.005, (trunk.taper.max - trunk.taper.a) / 2);
        } else {
            rBase = trunk.radius_base || 0.10;
            rTop  = trunk.radius_apex != null
                ? trunk.radius_apex
                : Math.max(0.025, rBase * 0.50);
        }

        const grp = new THREE.Group();
        grp.position.set(lx, lz - minE, -ly);
        grp.userData.sem = true;

        const removedCaneIds = new Set(
            (tree.pruning_annotations || [])
                .filter(annotation => annotation.action === 'remove_cane' && annotation.cane_id)
                .map(annotation => String(annotation.cane_id))
        );

        // Tronco (cilindro cónico — taper linear entre rBase e rTop)
        // const tGeo  = new THREE.CylinderGeometry(rTop, rBase, tH, 8);
        // const tMesh = new THREE.Mesh(tGeo, MAT_TRUNK);
        // tMesh.position.y = tH / 2;
        // tMesh.castShadow = tMesh.receiveShadow = true;
        // grp.add(tMesh);


        // Tronco: fazer contorno se for passado uma shape, caso contrário faz como estava
        
        // Versão funcional sem cordão e talão, apenas tronco
        // const trunkShapes = Array.isArray(trunk.shapes) ? trunk.shapes : [];
        // let drewTrunkShape = false;

        // for (const shape of trunkShapes) {
        //     const pts = shape.points || [];
        //     if (shape.type !== 'contour3' || pts.length < 3) continue;

        //     const shape2d = new THREE.Shape();

        //     for (let i=0; i < pts.length; i++) {
        //         const [px, py, pz = lz] = pts[i];

        //         const sx = px - lx;
        //         const sy = pz - lz;

        //         if (i === 0) {
        //             shape2d.moveTo(sx, sy);
        //         } else {
        //             shape2d.lineTo(sx, sy);
        //         }    
        //     }

        //     shape2d.closePath();

        //     const trunkDepth = 0.06;
        //     const tGeo = new THREE.ExtrudeGeometry(shape2d, {
        //         depth: trunkDepth,
        //         bevelEnabled: false
        //     });

        //     const tMesh = new THREE.Mesh(tGeo, MAT_TRUNK);

        //     tMesh.position.z = -trunkDepth / 2;

        //     tMesh.castShadow = tMesh.receiveShadow = true;
        //     grp.add(tMesh);
        //     drewTrunkShape = true;

        // }


        // if (!drewTrunkShape) {
        //     const tGeo = new THREE.CylinderGeometry(rTop, rBase, tH, 8);
        //     const tMesh = new THREE.Mesh(tGeo, MAT_TRUNK);
        //     tMesh.position.y = tH / 2;
        //     tMesh.castShadow = tMesh.receiveShadow = true;
        //     grp.add(tMesh);
        // }

        // Versão a usar a função helper para gerar contornos variados
        
        const trunkShapes = Array.isArray(trunk.shapes) ? trunk.shapes : [];
        const drewTrunkShape = addContourShapesToGroup(
            trunkShapes,
            grp,
            lx,
            ly,
            lz,
            MAT_TRUNK,
            0.06
        );

        if (!drewTrunkShape) {
            const tGeo = new THREE.CylinderGeometry(rTop, rBase, tH, 8);
            const tMesh = new THREE.Mesh(tGeo, MAT_TRUNK);
            tMesh.position.y = tH / 2;
            tMesh.castShadow = tMesh.receiveShadow = true;
            grp.add(tMesh);
        }

        addContourShapesToGroup(tree.cordons, grp, lx, ly, lz, MAT_CORDON, 0.05);
        addContourShapesToGroup(tree.spurs, grp, lx, ly, lz, MAT_SPUR, 0.04);


        // ── Ramos com taper ──────────────────────────────────────────────────
        for (const br of (tree.branches || [])) {
            const brPts = br.points || [];
            if (brPts.length < 2) continue;

            // Raio inicial e final com função d = max − a·t
            let brStart, brEnd;
            if (br.taper) {
                brStart = Math.max(0.005, br.taper.max / 2);
                brEnd   = Math.max(0.002, (br.taper.max - br.taper.a) / 2);
            } else {
                const r = Math.max(br.radius || 0.04, 0.015);
                brStart = r;
                brEnd   = r * 0.35;   // taper padrão: afila para ~35% no final
            }

            // const is3D  = brPts[0].length >= 3;
            // let pts3d;
            // if (is3D) {
            //     pts3d = sampleBezier3D(brPts, 16).map(([bx, by, bz]) =>
            //         new THREE.Vector3(bx - lx, bz - lz, -(by - ly))
            //     );
            // } else {
            //     pts3d = sampleBezier2D(brPts, 16).map(([bx, by]) => {
            //         const rx = bx - lx, rz = -(by - ly);
            //         const d  = Math.sqrt(rx*rx + rz*rz);
            //         return new THREE.Vector3(rx, Math.max(tH*0.40 + d*0.38 - d*d*0.045, tH*0.22), rz);
            //     });
            // }

            // Modificação para polylines nas varas

            const isPolyline = br.type === 'polyline3';
            const is3D = brPts[0].length >= 3;
            let pts3d;

            if (isPolyline) {
                pts3d = brPts.map(([bx, by, bz = lz]) =>
                    new THREE.Vector3(bx - lx, bz - lz, -(by - ly))
                );
            } else if (is3D) {
                pts3d = sampleBezier3D(brPts, 16).map(([bx, by, bz]) =>
                    new THREE.Vector3(bx - lx, bz - lz, -(by - ly))
                );
            } else {
                pts3d = sampleBezier2D(brPts, 16).map(([bx, by]) => {
                    const rx = bx - lx, rz = -(by - ly);
                    const d  = Math.sqrt(rx*rx + rz*rz);
                    return new THREE.Vector3(rx, Math.max(tH*0.40 + d*0.38 - d*d*0.045, tH*0.22), rz);
                });
            }

            pts3d = pts3d
                .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
                .filter((p, idx, arr) => idx === 0 || p.distanceToSquared(arr[idx - 1]) > 1e-10);

            if (pts3d.length < 2) continue;

            try {
                const curve  = new THREE.CatmullRomCurve3(pts3d, false, 'catmullrom', 0.5);
                const tubeSegments = Math.max(10, pts3d.length - 1);
                const brGeo  = _taperTube(curve, tubeSegments, brStart, brEnd, 5);
                
                const branchMaterial = removedCaneIds.has(String(br.cane_id))
                    ? MAT_BRANCH_REMOVE
                    : MAT_BRANCH;
                const brMesh = new THREE.Mesh(brGeo, branchMaterial);
                brMesh.castShadow = true;
                brMesh.userData.sem = true;
                brMesh.userData.kind = 'branch';
                brMesh.userData.tree = tree;
                brMesh.userData.branch = br;
                brMesh.userData.points3d = pts3d;

                _3d.branchMeshes.push(brMesh);

                grp.add(brMesh);
            } catch (error) {
                console.warn('Could not render semantic branch', br, error);
            }
        }

        // Nós da Videira

        for (const node of (tree.nodes || [])) {
            const [nx, ny, nz = lz] = node.position || [lx, ly, lz];

            let sx = 0.02;
            let sy = 0.02;
            let sz = 0.02;

            if (Array.isArray(node.size)) {
                sx = node.size[0] ?? sx;
                sy = node.size[1] ?? sy;
                sz = node.size[2] ?? sz;
            } 
            else if (node.size != null) {
                sx = sy = sz = node.size;
            }

            const colorInt = node.color
                ? parseInt(String(node.color).replace('#', ''), 16)
                : 0xef4444;

            //const nodeGeo = new THREE.BoxGeometry(sx, sz, sy);
            const isSphere = node.shape === 'sphere' || node.type === 'Midpoint';
            const radius = Math.max(sx, sy, sz) / 2;

            const nodeGeo = isSphere
                ? new THREE.SphereGeometry(radius, 16, 12)
                : new THREE.BoxGeometry(sx, sz, sy);


            const nodeMat = new THREE.MeshLambertMaterial({ color:colorInt});
            const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);

            nodeMesh.position.set(nx - lx, nz - lz, -(ny - ly));
            nodeMesh.castShadow = nodeMesh.receiveShadow = true;
            nodeMesh.userData.sem = true;
            nodeMesh.userData.nodeId = node.id || '';

            grp.add(nodeMesh);
        }

        // Pruning annotations markers

        for (const annotation of (tree.pruning_annotations || [])) {
            //if (annotation.action !== 'cut_here') continue;
            if (annotation.action !== 'cut_here') continue;

            const [px, py, pz = lz] = annotation.position || [];
            if (![px, py, pz].every(Number.isFinite)) continue;

            const markerMaterial = annotation.action === 'remove_cane'
                ? MAT_PRUNING_REMOVE
                : MAT_PRUNING_CUT;

            const cutGeo = new THREE.SphereGeometry(0.018, 18, 12);
            const cutMesh = new THREE.Mesh(cutGeo, markerMaterial);

            cutMesh.position.set(px - lx, pz - lz, -(py - ly));
            cutMesh.castShadow = cutMesh.receiveShadow = true;
            cutMesh.userData.sem = true;
            cutMesh.userData.kind = 'pruning_annotation';
            cutMesh.userData.annotationId = annotation.id || '';

            grp.add(cutMesh);
        }



        // ── Copa ─────────────────────────────────────────────────────────────
        const canopyR   = tree.canopy_radius || 1.5;
        const health    = tree.health || 'good';
        const fruitLoad = tree.fruit_load || 0;
        const hue       = health === 'good' ? 0.32 : health === 'fair' ? 0.25 : 0.14;
        const cColor    = new THREE.Color().setHSL(hue, 0.55 + fruitLoad * 0.18, 0.28 + fruitLoad * 0.06);

        const cGeo  = new THREE.SphereGeometry(canopyR, 14, 10);
        const cMat  = new THREE.MeshLambertMaterial({ color: cColor, transparent: true, opacity: 0.88 });
        const cMesh = new THREE.Mesh(cGeo, cMat);
        cMesh.position.y = tH + canopyR * 0.60;
        cMesh.castShadow = cMesh.receiveShadow = true;
        grp.add(cMesh);

        // ── Fruta ─────────────────────────────────────────────────────────────
        // Explícita: tree.fruits = [{position,radius,color}, ...]
        if (tree.fruits && tree.fruits.length) {
            for (const fr of tree.fruits) {
                const [fx, fy, fz = lz] = fr.position || [lx, ly, lz];
                const fR  = fr.radius || 0.06;
                const fC  = fr.color  ? parseInt(fr.color.replace('#',''), 16) : 0x2E4A1A;
                const fGeo  = new THREE.SphereGeometry(fR, 6, 5);
                const fMat  = new THREE.MeshLambertMaterial({ color: fC });
                const fMesh = new THREE.Mesh(fGeo, fMat);
                // posição em espaço de grupo
                fMesh.position.set(fx - lx, fz - lz, -(fy - ly));
                fMesh.userData.sem = true;
                grp.add(fMesh);
            }
        } else if (fruitLoad > 0.3) {
            // Paramétrica: distribuição de Fibonacci na copa com fruit_spec
            const spec    = tree.fruit_spec || {};
            const fR      = spec.radius || 0.06;
            const fC      = spec.color
                ? parseInt(spec.color.replace('#',''), 16) : 0x2E4A1A;
            const nFruits = Math.round(fruitLoad * 10);
            const fGeo    = new THREE.SphereGeometry(fR, 6, 5);
            const fMat    = new THREE.MeshLambertMaterial({ color: fC });
            const cY      = tH + canopyR * 0.60;

            for (let f = 0; f < nFruits; f++) {
                const phi   = Math.acos(1 - 2 * (f + 0.5) / nFruits);
                const theta = Math.PI * (1 + Math.sqrt(5)) * f;
                const fr    = canopyR * 0.82;
                const fMesh = new THREE.Mesh(fGeo, fMat);
                fMesh.position.set(
                    fr * Math.sin(phi) * Math.cos(theta),
                    cY + fr * Math.cos(phi),
                    fr * Math.sin(phi) * Math.sin(theta)
                );
                grp.add(fMesh);
            }
        }

        _3d.scene.add(grp);
    }
}

// ── 3D: Postes ────────────────────────────────────────────────────────────────
function _render3DPoles(layer, elevCtx) {
    const minE = elevCtx?.minE ?? 0;

    for (const pole of (layer.data || [])) {
        const [px, py, pz = 0] = pole.position || [0, 0, 0];
        const h     = pole.height   || 2.5;
        const diam  = pole.diameter || 0.10;
        const shape = pole.shape    || 'cylinder';

        // Cor hexadecimal string → inteiro
        const colorInt = pole.color
            ? parseInt(String(pole.color).replace('#',''), 16)
            : 0x8B6914;

        // Taper opcional: d = max − a·t (se definido, base mais larga)
        let geo;
        if (shape === 'square') {
            if (pole.taper) {
                // Caixa com altura total; taper aproximado via ScaleY não trivial
                // Usa BoxGeometry base com tamanho médio (simplificação)
                const d0 = pole.taper.max;
                const d1 = Math.max(0.01, pole.taper.max - pole.taper.a);
                // Aproximação: cria dois cubos empilhados
                geo = new THREE.BoxGeometry((d0 + d1) / 2, h, (d0 + d1) / 2);
            } else {
                geo = new THREE.BoxGeometry(diam, h, diam);
            }
        } else {
            // Cilindro — taper directo com CylinderGeometry
            let rBase = diam / 2, rTop = diam / 2;
            if (pole.taper) {
                rBase = pole.taper.max / 2;
                rTop  = Math.max(0.003, (pole.taper.max - pole.taper.a) / 2);
            }
            geo = new THREE.CylinderGeometry(rTop, rBase, h, 8);
        }

        const mat  = new THREE.MeshLambertMaterial({ color: colorInt });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, pz - minE + h / 2, -py);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.sem = true;
        _3d.scene.add(mesh);
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
        const VSCALE = 1.0;     // escala real — sem exageração vertical

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

// ── Gerar Mapa Semântico a partir de Objectos de Campo ───────────────────────

let _semFieldData = null;  // { terrains: [...], objects: [...] }

/** Carrega terrenos + objectos de campo do servidor */
function loadFieldObjectsForSem() {
    const el = document.getElementById('sem-field-terrains');
    if (el) el.innerHTML = '<div style="color:#9ca3af;font-size:12px;text-align:center;padding:4px;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_field_objects_for_sem');
    fetch('?tab=semantic', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                if (el) el.innerHTML = '<div style="color:#6b7280;font-size:12px;">Sem dados de campo.</div>';
                return;
            }
            _semFieldData = data;
            _renderSemFieldTerrains(data);
        })
        .catch(() => {
            if (el) el.innerHTML = '<div style="color:#6b7280;font-size:12px;">Sem dados disponíveis.</div>';
        });
}

/** Renderiza a lista de terrenos no painel lateral */
function _renderSemFieldTerrains(data) {
    const el = document.getElementById('sem-field-terrains');
    if (!el) return;
    const terrains = data.terrains || [];
    if (!terrains.length) {
        el.innerHTML = '<div style="color:#9ca3af;font-size:12px;text-align:center;">Sem terrenos definidos.</div>';
        return;
    }
    el.innerHTML = terrains.map(t => {
        const cnt   = parseInt(t.object_count) || 0;
        const trees = parseInt(t.tree_count)   || 0;
        const poles = parseInt(t.pole_count)   || 0;
        return `
            <div style="padding:6px 0; border-bottom:1px solid #f3f4f6;">
                <div style="font-size:12px; font-weight:600; color:#374151;
                            white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
                     title="${_esc(t.name)}">${_esc(t.name)}</div>
                <div style="font-size:11px; color:#6b7280; margin-top:2px;">
                    🌳 ${trees} árv. &nbsp; 🪵 ${poles} postes
                </div>
                ${cnt > 0 ? `
                <button class="btn btn-primary btn-sm"
                        onclick="generateSemFromField(${t.id})"
                        style="margin-top:5px; width:100%; font-size:11px; padding:4px 8px;">
                    🤖 Gerar Mapa Semântico
                </button>` : `
                <div style="font-size:11px; color:#9ca3af; margin-top:4px; font-style:italic;">
                    Sem objectos registados
                </div>`}
            </div>`;
    }).join('');
}

/**
 * Converte GPS (lat, lng) para coordenadas locais (metros) relativas
 * a um ponto de referência (refLat, refLng).
 * Retorna [x_este_m, y_norte_m].
 */
function _gpsToLocal(lat, lng, refLat, refLng) {
    const R    = 6371000;
    const dLat = (lat - refLat) * Math.PI / 180;
    const dLng = (lng - refLng) * Math.PI / 180;
    const y    = dLat * R;
    const x    = dLng * R * Math.cos(refLat * Math.PI / 180);
    return [x, y];
}

/** Parâmetros por espécie: tronco, ramos, copa, frutos */
const _SPECIES_DEFAULTS = {
    oliveira:    { trunkH: 2.5, trunkR: 0.14, canopyR: 1.8, fruitColor: '#3B5A1A', fruitR: 0.018 },
    videira:     { trunkH: 0.7, trunkR: 0.03, canopyR: 0.5, fruitColor: '#6B2FA0', fruitR: 0.012 },
    macieira:    { trunkH: 2.0, trunkR: 0.10, canopyR: 1.5, fruitColor: '#c0392b', fruitR: 0.040 },
    macieira_2d: { trunkH: 2.0, trunkR: 0.08, canopyR: 1.2, fruitColor: '#c0392b', fruitR: 0.035 },
    pereira:     { trunkH: 2.5, trunkR: 0.09, canopyR: 1.4, fruitColor: '#d4a017', fruitR: 0.038 },
    outro:       { trunkH: 2.0, trunkR: 0.10, canopyR: 1.4, fruitColor: '#2ecc71', fruitR: 0.020 }
};

/**
 * Gera e carrega um mapa semântico a partir dos objectos de campo
 * registados para o terreno com o id dado.
 */
function generateSemFromField(terrainId) {
    if (!_semFieldData) { loadFieldObjectsForSem(); return; }

    const terrain = (_semFieldData.terrains || []).find(t => String(t.id) === String(terrainId));
    if (!terrain) { setSemStatus('❌ Terreno não encontrado.'); return; }

    const objects = (_semFieldData.objects || []).filter(o => String(o.terrain_id) === String(terrainId));
    if (!objects.length) { setSemStatus('⚠️ Sem objectos registados neste terreno.'); return; }

    // Ponto de referência: centróide do polígono do terreno (ou 1.º objecto)
    let refLat, refLng;
    if (terrain.coordinates) {
        try {
            const coords = JSON.parse(terrain.coordinates);
            if (Array.isArray(coords) && coords.length) {
                refLat = coords.reduce((s, c) => s + (c.lat !== undefined ? c.lat : c[0]), 0) / coords.length;
                refLng = coords.reduce((s, c) => s + (c.lng !== undefined ? c.lng : c[1]), 0) / coords.length;
            }
        } catch (e) { /* ignorar */ }
    }
    if (!refLat) {
        refLat = parseFloat(objects[0].lat);
        refLng = parseFloat(objects[0].lng);
    }

    const treeObjs = objects.filter(o => o.type === 'tree');
    const poleObjs = objects.filter(o => o.type === 'pole');
    const layers   = [];

    // ── Camada de árvores ──────────────────────────────────────────────────────
    if (treeObjs.length) {
        const treesData = treeObjs.map(obj => {
            const [lx, ly] = _gpsToLocal(parseFloat(obj.lat), parseFloat(obj.lng), refLat, refLng);
            const alt  = parseFloat(obj.altitude) || 0;
            const sp   = obj.species || 'outro';
            const def  = _SPECIES_DEFAULTS[sp] || _SPECIES_DEFAULTS.outro;
            const h    = def.trunkH;
            const r    = def.trunkR;
            const cr   = def.canopyR;

            // 3 ramos simples distribuídos a 120°
            const branchStartH = h * 0.65;
            const branches = [0, 120, 240].map(deg => {
                const rad = deg * Math.PI / 180;
                const bz0 = alt + branchStartH;
                const bx1 = lx + cr * 0.5 * Math.cos(rad);
                const by1 = ly + cr * 0.5 * Math.sin(rad);
                const bz1 = alt + branchStartH + h * 0.12;
                const bx2 = lx + cr * Math.cos(rad);
                const by2 = ly + cr * Math.sin(rad);
                const bz2 = alt + branchStartH - h * 0.04;
                return {
                    type:   'bezier3',
                    points: [[lx, ly, bz0], [bx1, by1, bz1], [bx2, by2, bz2]],
                    taper:  { max: r * 1.4, a: r * 1.1 }
                };
            });

            return {
                id:            obj.label || String(obj.id),
                position:      [lx, ly, alt],
                species:       sp,
                trunk:         { height: h, taper: { max: r * 2, a: r * 2 * 0.75 } },
                branches,
                canopy_radius: cr,
                health:        'good',
                fruit_spec:    { color: def.fruitColor, radius: def.fruitR }
            };
        });
        layers.push({ type: 'trees', data: treesData });
    }

    // ── Camada de postes ───────────────────────────────────────────────────────
    if (poleObjs.length) {
        const polesData = poleObjs.map(obj => {
            const [lx, ly] = _gpsToLocal(parseFloat(obj.lat), parseFloat(obj.lng), refLat, refLng);
            const alt = parseFloat(obj.altitude) || 0;
            return {
                id:       obj.label || String(obj.id),
                position: [lx, ly, alt],
                height:   2.0,
                shape:    'cylinder',
                diameter: 0.12,
                taper:    { max: 0.12, a: 0.04 },
                color:    '#7B4F2E'
            };
        });
        layers.push({ type: 'poles', data: polesData });
    }

    const mapData = {
        type:      'semantic_map',
        version:   '1.0',
        name:      `Campo — ${terrain.name}`,
        reference: { lat: refLat, lng: refLng, rotation: 0 },
        layers
    };

    // Carregar no visualizador
    currentSemData = mapData;
    renderSemanticMap(mapData);
    setSemStatus(`✅ Gerado: ${treeObjs.length} árv., ${poleObjs.length} postes — "${terrain.name}"`);

    // Pré-preencher campo de gravação
    const nameEl = document.getElementById('sem-save-name');
    if (nameEl && !nameEl.value) nameEl.value = `Mapa Semântico — ${terrain.name}`;
}
