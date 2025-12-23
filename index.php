<?php
require_once 'config.php';

// Verificar se está logado
$isLoggedIn = isLoggedIn();
$currentUser = $isLoggedIn ? getCurrentUser() : null;
$flashMessage = showFlashMessage();

// API endpoints para operações AJAX (apenas para utilizadores logados)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isLoggedIn) {
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

// Obter estatísticas do utilizador (apenas se logado)
$stats = ['total_terrains' => 0, 'total_area' => 0];
if ($isLoggedIn) {
    try {
        $pdo = getDBConnection();
        $stmt = $pdo->prepare("SELECT COUNT(*) as total_terrains, COALESCE(SUM(area), 0) as total_area FROM terrains WHERE user_id = ?");
        $stmt->execute([$currentUser['id']]);
        $stats = $stmt->fetch();
    } catch (PDOException $e) {
        $stats = ['total_terrains' => 0, 'total_area' => 0];
    }
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
    <!-- Custom CSS -->
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <!-- Header -->
    <div class="header">
        <div class="header-content">
            <div class="header-left">
                <h1><?php echo SITE_NAME; ?></h1>
                <p>Sistema de Gestão de Terrenos</p>
            </div>
            <div class="header-right">
                <?php if ($isLoggedIn): ?>
                    <div class="user-info">
                        <div class="user-avatar">
                            <?php echo strtoupper(substr($currentUser['username'], 0, 1)); ?>
                        </div>
                        <span><?php echo htmlspecialchars($currentUser['username']); ?></span>
                    </div>
                    <a href="logout.php" class="logout-btn">Sair</a>
                <?php else: ?>
                    <a href="login.php" class="login-btn">Entrar / Registar</a>
                <?php endif; ?>
            </div>
        </div>
    </div>

    <!-- Container -->
    <div class="container">
        <!-- Alert Container -->
        <div id="alert-container" class="alert-container"></div>

        <?php if ($flashMessage): ?>
            <script>
                document.addEventListener('DOMContentLoaded', function() {
                    showAlert('<?php echo addslashes($flashMessage['message']); ?>', '<?php echo $flashMessage['type']; ?>');
                });
            </script>
        <?php endif; ?>

        <!-- Banner para visitantes -->
        <?php if (!$isLoggedIn): ?>
            <div class="guest-banner">
                👋 Está a visualizar o mapa como visitante. 
                <a href="login.php">Faça login</a> para desenhar e guardar os seus próprios terrenos.
            </div>
        <?php endif; ?>

        <!-- Stats Grid (apenas para utilizadores logados) -->
        <?php if ($isLoggedIn): ?>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number" id="total-terrains"><?php echo $stats['total_terrains']; ?></div>
                    <div class="stat-label">Terrenos Registados</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="total-area"><?php echo number_format($stats['total_area'], 1); ?></div>
                    <div class="stat-label">Área Total (ha)</div>
                </div>
            </div>
        <?php endif; ?>

        <!-- Main Grid -->
        <div class="main-grid <?php echo !$isLoggedIn ? 'full-width' : ''; ?>">
            <!-- Map Section -->
            <div class="map-section">
                <?php if ($isLoggedIn): ?>
                    <div class="controls">
                        <button class="btn btn-primary" onclick="startDrawing()">✏️ Desenhar Terreno</button>
                        <button class="btn btn-secondary" onclick="clearMap()">🗑️ Limpar Mapa</button>
                    </div>
                <?php endif; ?>
                <div id="map"></div>
            </div>

            <!-- Sidebar (apenas para utilizadores logados) -->
            <?php if ($isLoggedIn): ?>
                <div class="sidebar">
                    <!-- Formulário de guardar -->
                    <div id="save-form" class="section" style="display: none;">
                        <h3>Guardar Terreno</h3>
                        <div class="form-group">
                            <label for="terrain-name">Nome *</label>
                            <input type="text" id="terrain-name" placeholder="Ex: Campo Norte">
                        </div>
                        <div class="form-group">
                            <label for="terrain-description">Descrição</label>
                            <textarea id="terrain-description" placeholder="Descrição opcional..."></textarea>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button class="btn btn-primary" onclick="saveTerrain()">💾 Guardar</button>
                            <button class="btn btn-secondary" onclick="stopDrawing()">✖️ Cancelar</button>
                        </div>
                    </div>

                    <!-- Lista de terrenos -->
                    <div class="section">
                        <h3>Meus Terrenos</h3>
                        <div id="terrain-list" class="terrain-list">
                            <div class="empty-state">
                                <h4>A carregar...</h4>
                            </div>
                        </div>
                    </div>
                </div>
            <?php endif; ?>
        </div>
    </div>

    <!-- Leaflet JS -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
    <!-- Leaflet Draw JS -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>
    <!-- Leaflet GeometryUtil -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet-geometryutil/0.10.1/leaflet.geometryutil.min.js"></script>
    
    <!-- Passar variável de estado de login para JavaScript -->
    <script>
        const userLoggedIn = <?php echo $isLoggedIn ? 'true' : 'false'; ?>;
    </script>
    
    <!-- Custom JS -->
    <script src="assets/js/app.js"></script>
</body>
</html>