/**
 * Terrain Management System
 * Sistema de gestão de terrenos com Leaflet
 */

let map;
let drawnItems;
let drawControl;
let currentLayer = null;
const isLoggedIn = typeof userLoggedIn !== 'undefined' && userLoggedIn;

// ── Interpolações de campo no mapa principal ──────────────────────────────────
let mapLayersControl  = null;            // referência ao L.control.layers
let mapInterpOverlays = {};              // id → L.imageOverlay actualmente no mapa
let mapInterpData     = [];              // lista de itens carregada do servidor

// Inicializar mapa
function initMap() {
    // Criar mapa centrado em Portugal
    map = L.map('map').setView([39.5, -8.0], 7);

    // ── Camadas base ─────────────────────────────────────────────────────
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 19
    });
    const satLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri — Source: Esri, DigitalGlobe, GeoEye, Earthstar Geographics',
        maxZoom: 19
    });
    const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap contributors',
        maxZoom: 17
    });
    const labelsLayer = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
        attribution: '© Carto',
        maxZoom: 19,
        pane: 'shadowPane'
    });

    osmLayer.addTo(map);

    mapLayersControl = L.control.layers(
        { '🗺️ Mapa':     osmLayer,
          '🛰️ Satélite': satLayer,
          '🏔️ Relevo':   topoLayer },
        { '🏷️ Etiquetas (satélite)': labelsLayer },
        { position: 'topright', collapsed: false }
    ).addTo(map);

    // Criar layer group para terrenos desenhados
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Se estiver logado, adicionar controles de desenho
    if (isLoggedIn) {
        addDrawControls();
    }

    // Carregar terrenos existentes
    loadTerrains();
}

// Adicionar controles de desenho (apenas para utilizadores logados)
function addDrawControls() {
    drawControl = new L.Control.Draw({
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: true,
                metric: ['ha'],
                shapeOptions: {
                    color: '#667eea',
                    weight: 3,
                    opacity: 0.8,
                    fillOpacity: 0.4
                }
            },
            polyline: false,
            rectangle: false,
            circle: false,
            marker: false,
            circlemarker: false
        },
        edit: {
            featureGroup: drawnItems,
            remove: true
        }
    });

    map.addControl(drawControl);

    // Evento quando termina o desenho
    map.on(L.Draw.Event.CREATED, function(e) {
        currentLayer = e.layer;
        document.getElementById('save-form').style.display = 'block';
    });

    // Evento quando elimina shape
    map.on(L.Draw.Event.DELETED, function(e) {
        console.log('Shapes eliminados do mapa');
    });
}

// Iniciar desenho de polígono
function startDrawing() {
    if (!isLoggedIn) {
        showAlert('Por favor, faça login para desenhar terrenos.', 'info');
        return;
    }
    
    new L.Draw.Polygon(map, drawControl.options.draw.polygon).enable();
    showAlert('Clique no mapa para desenhar o terreno. Clique duplo para finalizar.', 'info');
}

// Parar desenho
function stopDrawing() {
    currentLayer = null;
    document.getElementById('save-form').style.display = 'none';
}

// Guardar terreno
function saveTerrain() {
    if (!currentLayer) {
        showAlert('Nenhum terreno para guardar.', 'error');
        return;
    }

    const terrainName = document.getElementById('terrain-name').value.trim();
    const terrainDescription = document.getElementById('terrain-description').value.trim();
    
    if (!terrainName) {
        showAlert('Por favor, insira um nome para o terreno.', 'error');
        return;
    }

    // Calcular área em hectares
    const area = L.GeometryUtil.geodesicArea(currentLayer.getLatLngs()[0]) / 10000;
    const coordinates = JSON.stringify(currentLayer.getLatLngs()[0]);

    // Enviar para servidor
    const formData = new FormData();
    formData.append('action', 'save_terrain');
    formData.append('name', terrainName);
    formData.append('description', terrainDescription);
    formData.append('coordinates', coordinates);
    formData.append('area', area.toFixed(2));

    fetch('index.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            drawnItems.addLayer(currentLayer);
            
            // Adicionar popup
            currentLayer.bindPopup(`
                <strong>${terrainName}</strong><br>
                ${terrainDescription ? terrainDescription + '<br>' : ''}
                Área: ${area.toFixed(2)} ha<br>
                Criado: ${new Date().toLocaleDateString('pt-PT')}
            `);
            
            // Limpar campos
            document.getElementById('terrain-name').value = '';
            document.getElementById('terrain-description').value = '';
            
            loadTerrains();
            updateStats();
            stopDrawing();
            showAlert(data.message, 'success');
        } else {
            showAlert(data.message, 'error');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao guardar terreno.', 'error');
    });
}

// Carregar terrenos do servidor
function loadTerrains() {
    const formData = new FormData();
    formData.append('action', 'get_terrains');

    fetch('index.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayTerrains(data.terrains);
            loadTerrainsOnMap(data.terrains);
        }
    })
    .catch(error => {
        console.error('Erro ao carregar terrenos:', error);
    });
}

// Exibir lista de terrenos
function displayTerrains(terrains) {
    const container = document.getElementById('terrain-list');
    
    if (!container) return; // Se não estiver logado, não existe o container
    
    // Actualizar selector de terrenos para layers de interpolação (sempre, mesmo com 0 terrenos)
    const interpSel = document.getElementById('map-interp-terrain');
    if (interpSel) {
        const prev = interpSel.value;
        interpSel.innerHTML = '<option value="">— Selecione um terreno —</option>' +
            terrains.map(t =>
                `<option value="${t.id}"${String(t.id) === prev ? ' selected' : ''}>${escMapHtml(t.name)}</option>`
            ).join('');
        if (prev && !terrains.find(t => String(t.id) === prev)) {
            loadMapInterpolations('');
        }
    }

    if (terrains.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h4>Nenhum terreno registado</h4>
                <p>Desenhe o seu primeiro terreno no mapa</p>
            </div>
        `;
        return;
    }

    container.innerHTML = terrains.map(terrain => `
        <div class="terrain-item">
            <div class="terrain-name">${escMapHtml(terrain.name)}</div>
            <div class="terrain-details">
                ${terrain.description ? escMapHtml(terrain.description) + ' • ' : ''}
                ${terrain.area} ha • ${new Date(terrain.created_at).toLocaleDateString('pt-PT')}
            </div>
            <div class="terrain-actions">
                <button class="btn btn-secondary btn-sm" onclick="zoomToTerrain(${terrain.id})" title="Centrar no mapa">
                    🔍
                </button>
                <button class="btn btn-danger btn-sm"
                        data-id="${terrain.id}"
                        data-name="${escMapHtml(terrain.name)}"
                        onclick="deleteTerrain(this.dataset.id, this.dataset.name)"
                        title="Eliminar">
                    🗑️
                </button>
            </div>
        </div>
    `).join('');
}

// Carregar terrenos no mapa
function loadTerrainsOnMap(terrains) {
    // Limpar terrenos existentes
    drawnItems.clearLayers();

    // Adicionar cada terreno ao mapa
    terrains.forEach(terrain => {
        try {
            const coordinates = JSON.parse(terrain.coordinates);
            const polygon = L.polygon(coordinates, {
                color: '#667eea',
                weight: 3,
                opacity: 0.8,
                fillOpacity: isLoggedIn ? 0.4 : 0.2 // Transparência maior para visitantes
            });

            // Popup com informação limitada para visitantes
            const popupContent = isLoggedIn ? 
                `<strong>${terrain.name}</strong><br>
                ${terrain.description ? terrain.description + '<br>' : ''}
                Área: ${terrain.area} ha<br>
                Criado: ${new Date(terrain.created_at).toLocaleDateString('pt-PT')}` :
                `<strong>Terreno</strong><br>
                Área: ${terrain.area} ha<br>
                <em>Faça login para ver detalhes</em>`;

            polygon.bindPopup(popupContent);
            drawnItems.addLayer(polygon);
        } catch (error) {
            console.error('Erro ao carregar terreno:', terrain.name, error);
        }
    });
}

// Centrar no terreno
function zoomToTerrain(terrainId) {
    const formData = new FormData();
    formData.append('action', 'get_terrain');
    formData.append('terrain_id', terrainId);

    fetch('index.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const coordinates = JSON.parse(data.terrain.coordinates);
            const bounds = L.latLngBounds(coordinates);
            map.fitBounds(bounds, { padding: [20, 20] });
            showAlert(`Centrado no terreno "${data.terrain.name}".`, 'success');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
    });
}

// Eliminar terreno
function deleteTerrain(terrainId, terrainName) {
    if (!confirm(`Tem a certeza que quer eliminar o terreno "${terrainName}"?`)) {
        return;
    }

    const formData = new FormData();
    formData.append('action', 'delete_terrain');
    formData.append('terrain_id', terrainId);

    fetch('index.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadTerrains();
            updateStats();
            showAlert(data.message, 'success');
        } else {
            showAlert(data.message, 'error');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao eliminar terreno.', 'error');
    });
}

// Limpar mapa
function clearMap() {
    if (confirm('Tem a certeza que quer limpar todos os terrenos do mapa? (Não serão eliminados da base de dados)')) {
        drawnItems.clearLayers();
        showAlert('Mapa limpo.', 'success');
    }
}

// Atualizar estatísticas
function updateStats() {
    if (!isLoggedIn) return;
    
    const formData = new FormData();
    formData.append('action', 'get_terrains');

    fetch('index.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const totalTerrains = data.terrains.length;
            const totalArea = data.terrains.reduce((sum, terrain) => sum + parseFloat(terrain.area), 0);
            
            const totalTerrainsEl = document.getElementById('total-terrains');
            const totalAreaEl = document.getElementById('total-area');
            
            if (totalTerrainsEl) totalTerrainsEl.textContent = totalTerrains;
            if (totalAreaEl) totalAreaEl.textContent = totalArea.toFixed(1);
        }
    })
    .catch(error => {
        console.error('Erro ao atualizar estatísticas:', error);
    });
}

// Mostrar alerta
function showAlert(message, type) {
    const container = document.getElementById('alert-container');
    if (!container) return;
    
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    
    container.innerHTML = '';
    container.appendChild(alert);
    
    setTimeout(() => {
        alert.remove();
    }, 5000);
}

// ── Interpolações de campo: carregar lista para um terreno ────────────────────
function loadMapInterpolations(terrainId) {
    const listEl = document.getElementById('map-interp-list');

    // Remover todos os overlays de interpolação actualmente no mapa
    Object.keys(mapInterpOverlays).forEach(function(id) {
        if (mapLayersControl) mapLayersControl.removeLayer(mapInterpOverlays[id]);
        map.removeLayer(mapInterpOverlays[id]);
    });
    mapInterpOverlays = {};
    mapInterpData     = [];

    if (!terrainId) {
        if (listEl) listEl.innerHTML =
            '<span style="color:#9ca3af;font-size:13px">Selecione um terreno para ver as interpolações guardadas.</span>';
        return;
    }

    if (listEl) listEl.innerHTML =
        '<span style="color:#9ca3af;font-size:13px">A carregar…</span>';

    const fd = new FormData();
    fd.append('action',     'get_terrain_interpolations');
    fd.append('terrain_id', terrainId);

    fetch('index.php', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                if (listEl) listEl.innerHTML =
                    '<span style="color:#ef4444;font-size:12px">❌ ' + escMapHtml(data.message || 'Erro.') + '</span>';
                return;
            }
            mapInterpData = data.interpolations || [];
            renderMapInterpolations(mapInterpData);
        })
        .catch(function() {
            if (listEl) listEl.innerHTML =
                '<span style="color:#ef4444;font-size:12px">❌ Erro de rede.</span>';
        });
}

// ── Renderizar lista de interpolações na sidebar ───────────────────────────────
function renderMapInterpolations(items) {
    const listEl = document.getElementById('map-interp-list');
    if (!listEl) return;

    if (!items.length) {
        listEl.innerHTML =
            '<div style="padding:10px 0; color:#9ca3af; font-size:13px; text-align:center;">' +
            '🎨 Sem interpolações guardadas para este terreno.<br>' +
            '<small>Gere e guarde em <strong>Medições de Campo → IDW</strong>.</small></div>';
        return;
    }

    const PARAM = {
        conductivity: '⚡ EC (mS/cm)', ph: '🧪 pH',
        temperature:  '🌡️ Temp (°C)',  moisture: '💧 Hum (%)'
    };

    listEl.innerHTML = items.map(function(item) {
        const dt      = new Date(item.created_at).toLocaleDateString('pt-PT');
        const param   = PARAM[item.param] || item.param;
        const loaded  = !!mapInterpOverlays[item.id];
        const minV    = item.min_val !== null ? parseFloat(item.min_val).toFixed(2) : '?';
        const maxV    = item.max_val !== null ? parseFloat(item.max_val).toFixed(2) : '?';
        return '<div style="padding:8px 0; border-bottom:1px solid #f3f4f6; display:flex;' +
                           'align-items:center; justify-content:space-between; gap:8px;">' +
            '<div style="min-width:0; flex:1;">' +
                '<div style="font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
                    escMapHtml(item.name) + '</div>' +
                '<div style="font-size:11px; color:#9ca3af;">' + param +
                    ' · ' + minV + '–' + maxV + ' · ' + dt + '</div>' +
            '</div>' +
            '<button id="map-iBtn-' + item.id + '" class="btn btn-secondary btn-sm" ' +
                    'onclick="toggleMapInterp(' + item.id + ')" ' +
                    'style="white-space:nowrap; font-size:12px; flex-shrink:0;' +
                    (loaded ? 'background:#667eea;color:#fff;border-color:#667eea;' : '') + '">' +
                (loaded ? '👁️ Visível' : '👁️ Mostrar') +
            '</button>' +
        '</div>';
    }).join('');
}

// ── Activar / desactivar overlay no mapa ──────────────────────────────────────
function toggleMapInterp(id) {
    if (mapInterpOverlays[id]) {
        // Já visível → remover
        if (mapLayersControl) mapLayersControl.removeLayer(mapInterpOverlays[id]);
        map.removeLayer(mapInterpOverlays[id]);
        delete mapInterpOverlays[id];
        _mapInterpBtnReset(id);
        return;
    }

    // Não visível → carregar PNG do servidor
    const btn = document.getElementById('map-iBtn-' + id);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const fd = new FormData();
    fd.append('action', 'get_interpolation_png');
    fd.append('id',     id);

    fetch('index.php', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                showAlert('❌ ' + (data.message || 'Erro ao carregar interpolação.'), 'error');
                _mapInterpBtnReset(id);
                return;
            }
            const bounds  = [[data.min_lat, data.min_lng], [data.max_lat, data.max_lng]];
            const overlay = L.imageOverlay(data.png, bounds, { opacity: 0.75 }).addTo(map);
            mapInterpOverlays[id] = overlay;
            if (mapLayersControl) mapLayersControl.addOverlay(overlay, '🎨 ' + data.name);
            map.fitBounds(bounds, { padding: [40, 40] });
            const b = document.getElementById('map-iBtn-' + id);
            if (b) {
                b.textContent       = '👁️ Visível';
                b.style.background  = '#667eea';
                b.style.color       = '#fff';
                b.style.borderColor = '#667eea';
                b.disabled          = false;
            }
        })
        .catch(function() {
            showAlert('Erro de rede ao carregar interpolação.', 'error');
            _mapInterpBtnReset(id);
        });
}

function _mapInterpBtnReset(id) {
    const btn = document.getElementById('map-iBtn-' + id);
    if (btn) {
        btn.textContent       = '👁️ Mostrar';
        btn.style.background  = '';
        btn.style.color       = '';
        btn.style.borderColor = '';
        btn.disabled          = false;
    }
}

// ── Camadas GeoJSON no mapa principal ────────────────────────────────────────
let mapGeoJSONOverlays = {};   // id → L.geoJSON layer no mapa
const MAP_GJ_COLORS = ['#3b82f6','#f59e0b','#ef4444','#8b5cf6','#10b981','#ec4899','#06b6d4','#84cc16'];
let   mapGjColorIdx  = 0;
const mapGjColorMap  = {};     // id → color

function loadMapGeoJSONLayers() {
    const list = document.getElementById('map-geojson-list');
    if (!list) return;

    const fd = new FormData();
    fd.append('action', 'get_geojson_layers');

    fetch('index.php', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                list.innerHTML = '<span style="color:#ef4444; font-size:12px;">Erro ao carregar camadas.</span>';
                return;
            }
            renderMapGeoJSONList(data.layers || []);
        })
        .catch(function() {
            list.innerHTML = '<span style="color:#ef4444; font-size:12px;">Erro de rede.</span>';
        });
}

function renderMapGeoJSONList(layers) {
    const list = document.getElementById('map-geojson-list');
    if (!layers.length) {
        list.innerHTML = '<span style="color:#9ca3af; font-size:12px;">Nenhuma camada GeoJSON importada ainda.<br>' +
                         'Importe no separador <strong>Medições de Campo</strong>.</span>';
        return;
    }

    list.innerHTML = layers.map(function(l) {
        const onMap = !!mapGeoJSONOverlays[l.id];
        const color = mapGjColorMap[l.id] || MAP_GJ_COLORS[mapGjColorIdx % MAP_GJ_COLORS.length];
        return '<div style="display:flex; align-items:center; gap:6px; padding:5px 0; ' +
               'border-bottom:1px solid #f3f4f6;">' +
               '<span style="display:inline-block; width:10px; height:10px; border-radius:50%; ' +
               'background:' + escMapHtml(color) + '; flex-shrink:0;"></span>' +
               '<div style="flex:1; min-width:0;">' +
               '<div style="font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; ' +
               'text-overflow:ellipsis;" title="' + escMapHtml(l.name) + '">' + escMapHtml(l.name) + '</div>' +
               '<div style="font-size:10px; color:#9ca3af;">' + (l.feature_count || 0) + ' features' +
               (l.terrain_name ? ' · ' + escMapHtml(l.terrain_name) : '') + '</div>' +
               '</div>' +
               '<button id="map-gjBtn-' + l.id + '" ' +
               'data-id="' + l.id + '" data-name="' + escMapHtml(l.name) + '" ' +
               'onclick="toggleMapGeoJSON(this.dataset.id, this.dataset.name)" ' +
               'style="font-size:11px; padding:3px 8px; border-radius:5px; cursor:pointer; ' +
               'border:1.5px solid ' + (onMap ? '#2d6a4f' : '#d1d5db') + '; ' +
               'background:' + (onMap ? '#2d6a4f' : '#fff') + '; ' +
               'color:' + (onMap ? '#fff' : '#374151') + '; white-space:nowrap;">' +
               (onMap ? '✓ Visível' : '👁️ Mostrar') +
               '</button></div>';
    }).join('');
}

function toggleMapGeoJSON(id, name) {
    id = String(id);

    if (mapGeoJSONOverlays[id]) {
        map.removeLayer(mapGeoJSONOverlays[id]);
        if (mapLayersControl) mapLayersControl.removeLayer(mapGeoJSONOverlays[id]);
        delete mapGeoJSONOverlays[id];
        _mapGjBtnReset(id, name);
        return;
    }

    const btn = document.getElementById('map-gjBtn-' + id);
    if (btn) btn.textContent = '⏳…';

    const fd = new FormData();
    fd.append('action', 'get_geojson_data');
    fd.append('id', id);

    fetch('index.php', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success || !data.geojson) {
                if (btn) { btn.textContent = '👁️ Mostrar'; _mapGjBtnReset(id, name); }
                return;
            }

            if (!mapGjColorMap[id]) {
                mapGjColorMap[id] = MAP_GJ_COLORS[mapGjColorIdx % MAP_GJ_COLORS.length];
                mapGjColorIdx++;
            }
            var color = mapGjColorMap[id];

            var gjData;
            try { gjData = JSON.parse(data.geojson); } catch(e) {
                _mapGjBtnReset(id, name); return;
            }

            var layer = L.geoJSON(gjData, {
                style: { color: color, weight: 2, opacity: 0.9, fillOpacity: 0.2, fillColor: color },
                pointToLayer: function(feature, latlng) {
                    return L.circleMarker(latlng, {
                        radius: 5, fillColor: color, color: '#fff',
                        weight: 1.5, opacity: 1, fillOpacity: 0.85
                    });
                },
                onEachFeature: function(feature, lyr) {
                    var props = feature.properties || {};
                    var keys  = Object.keys(props);
                    if (!keys.length) return;
                    var html  = keys.slice(0, 10).map(function(k) {
                        return '<tr><td style="color:#6b7280;padding-right:8px;font-size:11px;">' +
                               escMapHtml(k) + '</td><td style="font-size:12px;"><strong>' +
                               escMapHtml(String(props[k])) + '</strong></td></tr>';
                    }).join('');
                    lyr.bindPopup('<div style="max-height:200px;overflow:auto;">' +
                        '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">' +
                        escMapHtml(data.name) + '</div>' +
                        '<table>' + html + '</table></div>');
                }
            }).addTo(map);

            mapGeoJSONOverlays[id] = layer;
            if (mapLayersControl) mapLayersControl.addOverlay(layer, '🗺️ ' + escMapHtml(data.name));

            try { map.fitBounds(layer.getBounds(), { padding: [30, 30] }); } catch(e) {}

            if (btn) {
                btn.textContent   = '✓ Visível';
                btn.style.background  = '#2d6a4f';
                btn.style.color       = '#fff';
                btn.style.borderColor = '#2d6a4f';
            }
        })
        .catch(function() { _mapGjBtnReset(id, name); });
}

function _mapGjBtnReset(id, name) {
    var btn = document.getElementById('map-gjBtn-' + id);
    if (btn) {
        btn.textContent   = '👁️ Mostrar';
        btn.style.background  = '#fff';
        btn.style.color       = '#374151';
        btn.style.borderColor = '#d1d5db';
    }
}

// ── Utilitário de escape HTML (app.js) ───────────────────────────────────────
function escMapHtml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Inicializar quando o documento estiver pronto
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    loadMapGeoJSONLayers();
});