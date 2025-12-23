/**
 * Terrain Management System
 * Sistema de gestão de terrenos com Leaflet
 */

let map;
let drawnItems;
let drawControl;
let currentLayer = null;
const isLoggedIn = typeof userLoggedIn !== 'undefined' && userLoggedIn;

// Inicializar mapa
function initMap() {
    // Criar mapa centrado em Portugal
    map = L.map('map').setView([39.5, -8.0], 7);

    // Adicionar tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

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
            <div class="terrain-name">${terrain.name}</div>
            <div class="terrain-details">
                ${terrain.description ? terrain.description + ' • ' : ''}
                ${terrain.area} ha • ${new Date(terrain.created_at).toLocaleDateString('pt-PT')}
            </div>
            <div class="terrain-actions">
                <button class="btn btn-secondary btn-sm" onclick="zoomToTerrain(${terrain.id})" title="Centrar no mapa">
                    🔍
                </button>
                <button class="btn btn-danger btn-sm" onclick="deleteTerrain(${terrain.id}, '${terrain.name}')" title="Eliminar">
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

// Inicializar quando o documento estiver pronto
document.addEventListener('DOMContentLoaded', function() {
    initMap();
});