<?php
require_once 'config.php';

// Verificar se está logado
if (!isLoggedIn()) {
    redirect('login.php');
}

$currentUser = getCurrentUser();
$flashMessage = showFlashMessage();

// API endpoints para operações AJAX
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    
    $action = $_POST['action'] ?? '';
    $response = ['success' => false, 'message' => ''];
    
    try {
        $pdo = getDBConnection();
        
        switch ($action) {
            case 'save_terrain':
                $name = sanitizeInput($_POST['name']);
                $description = sanitizeInput($_POST['description'] ?? '');
                $coordinates = $_POST['coordinates']; // JSON string
                $area = floatval($_POST['area']);
                
                if (empty($name) || empty($coordinates)) {
                    $response['message'] = 'Dados obrigatórios em falta.';
                } else {
                    $stmt = $pdo->prepare("INSERT INTO terrains (user_id, name, description, coordinates, area) VALUES (?, ?, ?, ?, ?)");
                    $stmt->execute([$currentUser['id'], $name, $description, $coordinates, $area]);
                    
                    $response['success'] = true;
                    $response['message'] = 'Terreno guardado com sucesso!';
                    $response['terrain_id'] = $pdo->lastInsertId();
                }
                break;
                
            case 'delete_terrain':
                $terrain_id = intval($_POST['terrain_id']);
                
                $stmt = $pdo->prepare("DELETE FROM terrains WHERE id = ? AND user_id = ?");
                $stmt->execute([$terrain_id, $currentUser['id']]);
                
                if ($stmt->rowCount() > 0) {
                    $response['success'] = true;
                    $response['message'] = 'Terreno eliminado com sucesso!';
                } else {
                    $response['message'] = 'Terreno não encontrado.';
                }
                break;
                
            case 'get_terrains':
                $stmt = $pdo->prepare("SELECT * FROM terrains WHERE user_id = ? ORDER BY created_at DESC");
                $stmt->execute([$currentUser['id']]);
                $terrains = $stmt->fetchAll();
                
                $response['success'] = true;
                $response['terrains'] = $terrains;
                break;
                
            case 'get_terrain':
                $terrain_id = intval($_POST['terrain_id']);
                
                $stmt = $pdo->prepare("SELECT * FROM terrains WHERE id = ? AND user_id = ?");
                $stmt->execute([$terrain_id, $currentUser['id']]);
                $terrain = $stmt->fetch();
                
                if ($terrain) {
                    $response['success'] = true;
                    $response['terrain'] = $terrain;
                } else {
                    $response['message'] = 'Terreno não encontrado.';
                }
                break;
        }
    } catch (PDOException $e) {
        $response['message'] = 'Erro no sistema: ' . $e->getMessage();
    }
    
    echo json_encode($response);
    exit;
}

// Obter estatísticas do utilizador
try {
    $pdo = getDBConnection();
    $stmt = $pdo->prepare("SELECT COUNT(*) as total_terrains, COALESCE(SUM(area), 0) as total_area FROM terrains WHERE user_id = ?");
    $stmt->execute([$currentUser['id']]);
    $stats = $stmt->fetch();
} catch (PDOException $e) {
    $stats = ['total_terrains' => 0, 'total_area' => 0];
}
?>
<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo SITE_NAME; ?></title>
    
    <!-- Leaflet CSS -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" />
    <!-- Leaflet Draw CSS -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css" />
    
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8fafc;
            min-height: 100vh;
        }

        .header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 15px 0;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .header-left h1 {
            font-size: 24px;
            margin-bottom: 4px;
        }

        .header-left p {
            opacity: 0.9;
            font-size: 14px;
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 20px;
        }

        .user-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .user-avatar {
            width: 36px;
            height: 36px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
        }

        .logout-btn {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
        }

        .logout-btn:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
            text-align: center;
            border-left: 4px solid #667eea;
        }

        .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 8px;
        }

        .stat-label {
            color: #6b7280;
            font-size: 14px;
            font-weight: 500;
        }

        .main-grid {
            display: grid;
            grid-template-columns: 1fr 350px;
            gap: 30px;
        }

        .map-section {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
        }

        .controls {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .form-group {
            flex: 1;
            min-width: 200px;
        }

        .form-group label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            color: #374151;
            font-size: 14px;
        }

        .form-group input {
            width: 100%;
            padding: 10px 12px;
            border: 2px solid #e5e7eb;
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.2s;
        }

        .form-group input:focus {
            outline: none;
            border-color: #667eea;
        }

        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
            text-decoration: none;
            display: inline-block;
        }

        .btn-primary {
            background: #667eea;
            color: white;
        }

        .btn-primary:hover {
            background: #5a67d8;
            transform: translateY(-1px);
        }

        .btn-secondary {
            background: #e5e7eb;
            color: #374151;
        }

        .btn-secondary:hover {
            background: #d1d5db;
        }

        .btn-danger {
            background: #ef4444;
            color: white;
        }

        .btn-danger:hover {
            background: #dc2626;
        }

        .btn-sm {
            padding: 6px 12px;
            font-size: 12px;
        }

        #map {
            height: 500px;
            width: 100%;
            border-radius: 8px;
            border: 2px solid #e5e7eb;
        }

        .sidebar {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
            height: fit-content;
        }

        .sidebar h3 {
            color: #1f2937;
            margin-bottom: 20px;
            font-size: 18px;
        }

        .terrain-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .terrain-item {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 12px;
            transition: all 0.2s;
        }

        .terrain-item:hover {
            border-color: #667eea;
            transform: translateY(-1px);
        }

        .terrain-name {
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 5px;
        }

        .terrain-details {
            font-size: 13px;
            color: #6b7280;
            margin-bottom: 10px;
        }

        .terrain-actions {
            display: flex;
            gap: 8px;
        }

        .alert {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 14px;
            font-weight: 500;
        }

        .alert-success {
            background: #f0fdf4;
            color: #16a34a;
            border: 1px solid #bbf7d0;
        }

        .alert-error {
            background: #fef2f2;
            color: #dc2626;
            border: 1px solid #fecaca;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #6b7280;
        }

        .empty-state h4 {
            margin-bottom: 8px;
        }

        @media (max-width: 1024px) {
            .main-grid {
                grid-template-columns: 1fr;
            }
            
            .controls {
                flex-direction: column;
            }
            
            .form-group {
                min-width: auto;
            }
            
            .header-content {
                flex-direction: column;
                gap: 15px;
                text-align: center;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="header-left">
                <h1><?php echo SITE_NAME; ?></h1>
                <p>Gerencie os seus terrenos com facilidade</p>
            </div>
            <div class="header-right">
                <div class="user-info">
                    <div class="user-avatar">
                        <?php echo strtoupper(substr($currentUser['username'], 0, 1)); ?>
                    </div>
                    <div>
                        <div style="font-weight: 500;"><?php echo htmlspecialchars($currentUser['username']); ?></div>
                        <div style="font-size: 12px; opacity: 0.8;">
                            Membro desde <?php echo date('d/m/Y', strtotime($currentUser['created_at'])); ?>
                        </div>
                    </div>
                </div>
                <a href="logout.php" class="logout-btn">Sair</a>
            </div>
        </div>
    </div>

    <div class="container">
        <?php if ($flashMessage): ?>
            <div class="alert alert-<?php echo $flashMessage['type']; ?>">
                <?php echo $flashMessage['message']; ?>
            </div>
        <?php endif; ?>

        <div id="alert-container"></div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number" id="total-terrains"><?php echo $stats['total_terrains']; ?></div>
                <div class="stat-label">Total de Terrenos</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="total-area"><?php echo number_format($stats['total_area'], 1); ?></div>
                <div class="stat-label">Área Total (ha)</div>
            </div>
        </div>

        <div class="main-grid">
            <div class="map-section">
                <div class="controls">
                    <div class="form-group">
                        <label for="terrain-name">Nome do Terreno</label>
                        <input type="text" id="terrain-name" placeholder="Digite o nome do terreno">
                    </div>
                    <div class="form-group">
                        <label for="terrain-description">Descrição (opcional)</label>
                        <input type="text" id="terrain-description" placeholder="Descrição do terreno">
                    </div>
                    <div style="display: flex; gap: 10px; align-items: end;">
                        <button id="draw-btn" class="btn btn-primary" onclick="toggleDrawing()">
                            📍 Desenhar Terreno
                        </button>
                        <button class="btn btn-secondary" onclick="clearMap()">
                            🗑️ Limpar Mapa
                        </button>
                    </div>
                </div>

                <div id="map"></div>
            </div>

            <div class="sidebar">
                <h3>Meus Terrenos</h3>
                <div id="terrain-list" class="terrain-list">
                    <!-- Carregado via JavaScript -->
                </div>
            </div>
        </div>
    </div>

    <!-- Leaflet JS -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
    <!-- Leaflet Draw JS -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.min.js"></script>

    <script>
        let map = null;
        let drawnItems = new L.FeatureGroup();
        let drawControl = null;
        let isDrawing = false;

        // Inicializar aplicação
        document.addEventListener('DOMContentLoaded', function() {
            initializeMap();
            loadTerrains();
        });

        function initializeMap() {
            // Coordenadas centradas em Portugal
            map = L.map('map').setView([39.5, -8.0], 7);

            // Adicionar tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            // Adicionar layer para desenhos
            map.addLayer(drawnItems);

            // Configurar controlos de desenho
            drawControl = new L.Control.Draw({
                edit: {
                    featureGroup: drawnItems,
                    remove: true
                },
                draw: {
                    rectangle: false,
                    circle: false,
                    circlemarker: false,
                    marker: false,
                    polyline: false,
                    polygon: {
                        allowIntersection: false,
                        drawError: {
                            color: '#e1e100',
                            message: '<strong>Erro:</strong> As linhas não se podem cruzar!'
                        },
                        shapeOptions: {
                            color: '#667eea',
                            weight: 3,
                            opacity: 0.8,
                            fillOpacity: 0.4
                        }
                    }
                }
            });

            // Event listeners para desenho
            map.on(L.Draw.Event.CREATED, function (e) {
                const layer = e.layer;
                saveTerrain(layer);
            });

            map.on(L.Draw.Event.DELETED, function (e) {
                loadTerrains(); // Recarregar lista
                updateStats();
            });
        }

        function toggleDrawing() {
            const terrainName = document.getElementById('terrain-name').value.trim();
            if (!terrainName && !isDrawing) {
                showAlert('Por favor, insira um nome para o terreno antes de desenhar.', 'error');
                document.getElementById('terrain-name').focus();
                return;
            }

            const btn = document.getElementById('draw-btn');
            
            if (!isDrawing) {
                map.addControl(drawControl);
                isDrawing = true;
                btn.textContent = '⏹️ Parar Desenho';
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-secondary');
                showAlert('Clique no mapa para começar a desenhar o polígono do terreno.', 'success');
            } else {
                stopDrawing();
            }
        }

        function stopDrawing() {
            if (isDrawing) {
                map.removeControl(drawControl);
                isDrawing = false;
                const btn = document.getElementById('draw-btn');
                btn.textContent = '📍 Desenhar Terreno';
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-primary');
            }
        }

        function saveTerrain(layer) {
            const terrainName = document.getElementById('terrain-name').value.trim();
            const terrainDescription = document.getElementById('terrain-description').value.trim();
            
            if (!terrainName) {
                showAlert('Por favor, insira um nome para o terreno.', 'error');
                return;
            }

            // Calcular área em hectares
            const area = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]) / 10000;
            const coordinates = JSON.stringify(layer.getLatLngs()[0]);

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
                    drawnItems.addLayer(layer);
                    
                    // Adicionar popup
                    layer.bindPopup(`
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

        function displayTerrains(terrains) {
            const container = document.getElementById('terrain-list');
            
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
                        fillOpacity: 0.4
                    });

                    polygon.bindPopup(`
                        <strong>${terrain.name}</strong><br>
                        ${terrain.description ? terrain.description + '<br>' : ''}
                        Área: ${terrain.area} ha<br>
                        Criado: ${new Date(terrain.created_at).toLocaleDateString('pt-PT')}
                    `);

                    drawnItems.addLayer(polygon);
                } catch (error) {
                    console.error('Erro ao carregar terreno:', terrain.name, error);
                }
            });
        }

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

        function clearMap() {
            if (confirm('Tem a certeza que quer limpar todos os terrenos do mapa? (Não serão eliminados da base de dados)')) {
                drawnItems.clearLayers();
                showAlert('Mapa limpo.', 'success');
            }
        }

        function updateStats() {
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
                    
                    document.getElementById('total-terrains').textContent = totalTerrains;
                    document.getElementById('total-area').textContent = totalArea.toFixed(1);
                }
            })
            .catch(error => {
                console.error('Erro ao atualizar estatísticas:', error);
            });
        }

        function showAlert(message, type) {
            const container = document.getElementById('alert-container');
            const alert = document.createElement('div');
            alert.className = `alert alert-${type}`;
            alert.textContent = message;
            
            container.innerHTML = '';
            container.appendChild(alert);
            
            setTimeout(() => {
                alert.remove();
            }, 5000);
        }
    </script>
</body>
</html>