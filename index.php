<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Registo de Terrenos</title>
    
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
        }

        .login-section {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 15px;
        }

        .user-info {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .login-form {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        input[type="text"], input[type="password"] {
            padding: 8px 12px;
            border: 2px solid #e1e5e9;
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.2s;
        }

        input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: #667eea;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
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
            background: #e2e8f0;
            color: #4a5568;
        }

        .btn-secondary:hover {
            background: #cbd5e0;
        }

        .btn-danger {
            background: #f56565;
            color: white;
        }

        .btn-danger:hover {
            background: #e53e3e;
        }

        .main-content {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            display: none;
        }

        .main-content.active {
            display: block;
        }

        .controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 15px;
        }

        .terrain-form {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        #map {
            height: 500px;
            width: 100%;
            border-radius: 8px;
            border: 2px solid #e1e5e9;
        }

        .terrains-list {
            margin-top: 20px;
        }

        .terrain-item {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .terrain-info h4 {
            color: #2d3748;
            margin-bottom: 5px;
        }

        .terrain-info p {
            color: #718096;
            font-size: 14px;
        }

        .terrain-actions {
            display: flex;
            gap: 8px;
        }

        .status-message {
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 15px;
            font-weight: 500;
        }

        .status-success {
            background: #c6f6d5;
            color: #22543d;
            border: 1px solid #9ae6b4;
        }

        .status-error {
            background: #fed7d7;
            color: #742a2a;
            border: 1px solid #fc8181;
        }

        .welcome-message {
            text-align: center;
            padding: 40px;
            color: #4a5568;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }

        .stat-card {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }

        .stat-number {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
        }

        .stat-label {
            font-size: 12px;
            opacity: 0.9;
        }

        @media (max-width: 768px) {
            .login-section {
                flex-direction: column;
                align-items: stretch;
            }

            .controls {
                flex-direction: column;
                align-items: stretch;
            }

            .terrain-item {
                flex-direction: column;
                align-items: stretch;
                gap: 10px;
            }

            .terrain-actions {
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="login-section">
                <div id="loginForm" class="login-form">
                    <input type="text" id="username" placeholder="Utilizador" required>
                    <input type="password" id="password" placeholder="Palavra-passe" required>
                    <button class="btn btn-primary" onclick="login()">Entrar</button>
                    <button class="btn btn-secondary" onclick="register()">Registar</button>
                </div>
                <div id="userInfo" class="user-info" style="display: none;">
                    <span>Bem-vindo, <strong id="currentUser"></strong></span>
                    <button class="btn btn-danger" onclick="logout()">Sair</button>
                </div>
            </div>
        </div>

        <div id="welcomeScreen" class="main-content">
            <div class="welcome-message">
                <h2>Sistema de Registo de Terrenos</h2>
                <p>Faça login ou registe-se para começar a mapear os seus terrenos.</p>
            </div>
        </div>

        <div id="mainApp" class="main-content">
            <div id="statusMessage"></div>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number" id="totalTerrains">0</div>
                    <div class="stat-label">Total de Terrenos</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="totalArea">0</div>
                    <div class="stat-label">Área Total (ha)</div>
                </div>
            </div>

            <div class="controls">
                <div class="terrain-form">
                    <input type="text" id="terrainName" placeholder="Nome do terreno" required>
                    <input type="text" id="terrainDescription" placeholder="Descrição (opcional)">
                    <button class="btn btn-primary" onclick="startDrawing()" id="drawBtn">📍 Desenhar Terreno</button>
                </div>
                <button class="btn btn-secondary" onclick="clearAll()">🗑️ Limpar Mapa</button>
            </div>

            <div id="map"></div>

            <div class="terrains-list">
                <h3>Meus Terrenos</h3>
                <div id="terrainsList"></div>
            </div>
        </div>
    </div>

    <!-- Leaflet JS -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
    <!-- Leaflet Draw JS -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.min.js"></script>

    <script>
        // Simulação de base de dados em memória (em produção usar localStorage ou base de dados real)
        let users = {
            'admin': 'admin123',
            'demo': 'demo123'
        };
        let currentUser = null;
        let userTerrains = {};
        let map = null;
        let drawnItems = new L.FeatureGroup();
        let drawControl = null;
        let isDrawing = false;

        // Inicialização
        document.addEventListener('DOMContentLoaded', function() {
            showWelcomeScreen();
            
            // Event listeners para Enter nos campos de login
            document.getElementById('username').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') login();
            });
            
            document.getElementById('password').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') login();
            });
        });

        function showWelcomeScreen() {
            document.getElementById('welcomeScreen').classList.add('active');
            document.getElementById('mainApp').classList.remove('active');
        }

        function showMainApp() {
            document.getElementById('welcomeScreen').classList.remove('active');
            document.getElementById('mainApp').classList.add('active');
            initializeMap();
        }

        function login() {
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();

            if (!username || !password) {
                showStatus('Por favor, preencha todos os campos.', 'error');
                return;
            }

            if (users[username] && users[username] === password) {
                currentUser = username;
                document.getElementById('currentUser').textContent = username;
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('userInfo').style.display = 'flex';
                
                showMainApp();
                loadUserTerrains();
                showStatus(`Bem-vindo, ${username}!`, 'success');
                
                // Limpar campos de login
                document.getElementById('username').value = '';
                document.getElementById('password').value = '';
            } else {
                showStatus('Credenciais inválidas.', 'error');
            }
        }

        function register() {
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();

            if (!username || !password) {
                showStatus('Por favor, preencha todos os campos.', 'error');
                return;
            }

            if (users[username]) {
                showStatus('Utilizador já existe.', 'error');
                return;
            }

            if (password.length < 6) {
                showStatus('A palavra-passe deve ter pelo menos 6 caracteres.', 'error');
                return;
            }

            users[username] = password;
            userTerrains[username] = [];
            showStatus(`Conta criada com sucesso! Pode agora fazer login.`, 'success');
            
            // Limpar campos
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
        }

        function logout() {
            currentUser = null;
            document.getElementById('loginForm').style.display = 'flex';
            document.getElementById('userInfo').style.display = 'none';
            showWelcomeScreen();
            if (map) {
                map.remove();
                map = null;
            }
        }

        function initializeMap() {
            if (map) return;

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
                const area = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]) / 10000; // converter para hectares
                
                const terrainName = document.getElementById('terrainName').value.trim();
                const terrainDescription = document.getElementById('terrainDescription').value.trim();

                if (!terrainName) {
                    showStatus('Por favor, insira um nome para o terreno.', 'error');
                    return;
                }

                // Criar objeto terreno
                const terrain = {
                    id: Date.now().toString(),
                    name: terrainName,
                    description: terrainDescription,
                    area: area.toFixed(2),
                    coordinates: layer.getLatLngs()[0],
                    created: new Date().toLocaleDateString('pt-PT')
                };

                // Adicionar popup ao polígono
                layer.bindPopup(`
                    <strong>${terrain.name}</strong><br>
                    ${terrain.description ? terrain.description + '<br>' : ''}
                    Área: ${terrain.area} ha<br>
                    Criado: ${terrain.created}
                `);

                // Guardar terreno
                if (!userTerrains[currentUser]) {
                    userTerrains[currentUser] = [];
                }
                userTerrains[currentUser].push(terrain);

                drawnItems.addLayer(layer);
                
                // Limpar campos
                document.getElementById('terrainName').value = '';
                document.getElementById('terrainDescription').value = '';
                
                updateTerrainsList();
                updateStats();
                stopDrawing();
                
                showStatus(`Terreno "${terrain.name}" registado com sucesso!`, 'success');
            });

            map.on(L.Draw.Event.DELETED, function (e) {
                // Aqui poderia implementar lógica para remover terrenos da lista
                updateStats();
                showStatus('Terrenos removidos do mapa.', 'success');
            });
        }

        function startDrawing() {
            const terrainName = document.getElementById('terrainName').value.trim();
            if (!terrainName) {
                showStatus('Por favor, insira um nome para o terreno antes de desenhar.', 'error');
                document.getElementById('terrainName').focus();
                return;
            }

            if (!isDrawing) {
                map.addControl(drawControl);
                isDrawing = true;
                document.getElementById('drawBtn').textContent = '⏹️ Parar Desenho';
                document.getElementById('drawBtn').classList.remove('btn-primary');
                document.getElementById('drawBtn').classList.add('btn-secondary');
                showStatus('Clique no mapa para começar a desenhar o polígono do terreno.', 'success');
            } else {
                stopDrawing();
            }
        }

        function stopDrawing() {
            if (isDrawing) {
                map.removeControl(drawControl);
                isDrawing = false;
                document.getElementById('drawBtn').textContent = '📍 Desenhar Terreno';
                document.getElementById('drawBtn').classList.remove('btn-secondary');
                document.getElementById('drawBtn').classList.add('btn-primary');
            }
        }

        function clearAll() {
            if (confirm('Tem a certeza que quer limpar todos os terrenos do mapa?')) {
                drawnItems.clearLayers();
                showStatus('Mapa limpo.', 'success');
            }
        }

        function loadUserTerrains() {
            if (!userTerrains[currentUser]) {
                userTerrains[currentUser] = [];
            }
            updateTerrainsList();
            updateStats();
        }

        function updateTerrainsList() {
            const terrainsList = document.getElementById('terrainsList');
            const terrains = userTerrains[currentUser] || [];

            if (terrains.length === 0) {
                terrainsList.innerHTML = '<p style="color: #718096; text-align: center; padding: 20px;">Ainda não tem terrenos registados.</p>';
                return;
            }

            terrainsList.innerHTML = terrains.map(terrain => `
                <div class="terrain-item">
                    <div class="terrain-info">
                        <h4>${terrain.name}</h4>
                        <p>${terrain.description ? terrain.description + ' • ' : ''}${terrain.area} ha • ${terrain.created}</p>
                    </div>
                    <div class="terrain-actions">
                        <button class="btn btn-secondary" onclick="zoomToTerrain('${terrain.id}')" title="Centrar no mapa">🔍</button>
                        <button class="btn btn-danger" onclick="deleteTerrain('${terrain.id}')" title="Eliminar">🗑️</button>
                    </div>
                </div>
            `).join('');
        }

        function updateStats() {
            const terrains = userTerrains[currentUser] || [];
            const totalTerrains = terrains.length;
            const totalArea = terrains.reduce((sum, terrain) => sum + parseFloat(terrain.area), 0);

            document.getElementById('totalTerrains').textContent = totalTerrains;
            document.getElementById('totalArea').textContent = totalArea.toFixed(1);
        }

        function zoomToTerrain(terrainId) {
            const terrain = userTerrains[currentUser].find(t => t.id === terrainId);
            if (terrain && terrain.coordinates) {
                const bounds = L.latLngBounds(terrain.coordinates);
                map.fitBounds(bounds, { padding: [20, 20] });
                showStatus(`Centrado no terreno "${terrain.name}".`, 'success');
            }
        }

        function deleteTerrain(terrainId) {
            const terrain = userTerrains[currentUser].find(t => t.id === terrainId);
            if (terrain && confirm(`Tem a certeza que quer eliminar o terreno "${terrain.name}"?`)) {
                userTerrains[currentUser] = userTerrains[currentUser].filter(t => t.id !== terrainId);
                updateTerrainsList();
                updateStats();
                showStatus(`Terreno "${terrain.name}" eliminado.`, 'success');
            }
        }

        function showStatus(message, type) {
            const statusDiv = document.getElementById('statusMessage');
            statusDiv.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 5000);
        }
    </script>
</body>
</html>