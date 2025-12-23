<?php
/**
 * Index.php - Controller Principal
 * Sistema de gestão modular com tabs
 */

require_once 'config.php';

// Verificar se está logado
$isLoggedIn = isLoggedIn();
$currentUser = $isLoggedIn ? getCurrentUser() : null;
$flashMessage = showFlashMessage();
$isAdmin = isAdmin();
$canClaimAdmin = canClaimAdmin();

// Processar reclamação de admin (se aplicável)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['claim_admin']) && $canClaimAdmin) {
    if (claimAdminRole()) {
        redirect('index.php?tab=admin');
    }
}

// Obter tab ativo (default: map)
$activeTab = $_GET['tab'] ?? 'map';

// Tabs disponíveis
$availableTabs = [
    'map' => [
        'title' => 'Mapa',
        'icon' => '🗺️',
        'file' => 'tabs/map.php',
        'requiresAuth' => false,
        'requiresAdmin' => false
    ],
    'admin' => [
        'title' => 'Administração',
        'icon' => '⚙️',
        'file' => 'tabs/admin.php',
        'requiresAuth' => true,
        'requiresAdmin' => true
    ]
];

// Validar tab
if (!isset($availableTabs[$activeTab])) {
    $activeTab = 'map';
}

// Verificar se o tab requer autenticação
if ($availableTabs[$activeTab]['requiresAuth'] && !$isLoggedIn) {
    setFlashMessage('Precisa fazer login para aceder a esta área.', 'error');
    redirect('login.php');
}

// Verificar se o tab requer permissões de admin
if ($availableTabs[$activeTab]['requiresAdmin'] && !$isAdmin) {
    setFlashMessage('Acesso negado. Requer permissões de administrador.', 'error');
    $activeTab = 'map'; // Redireciona para o mapa
}

// Verificar se o ficheiro do tab existe
$tabFile = $availableTabs[$activeTab]['file'];
if (!file_exists($tabFile)) {
    die("Erro: Ficheiro do tab não encontrado: {$tabFile}");
}

?>
<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo $availableTabs[$activeTab]['title']; ?> - <?php echo SITE_NAME; ?></title>
    
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

    <!-- Navigation Menu -->
    <div class="nav-menu">
        <div class="nav-content">
            <?php foreach ($availableTabs as $tabKey => $tabInfo): ?>
                <?php 
                // Mostrar tab se:
                // 1. Não requer auth, OU
                // 2. User está logado e não requer admin, OU
                // 3. User está logado e é admin
                $showTab = !$tabInfo['requiresAuth'] || 
                          ($isLoggedIn && !$tabInfo['requiresAdmin']) || 
                          ($isLoggedIn && $tabInfo['requiresAdmin'] && $isAdmin);
                ?>
                <?php if ($showTab): ?>
                    <a href="?tab=<?php echo $tabKey; ?>" 
                       class="nav-item <?php echo $activeTab === $tabKey ? 'active' : ''; ?>">
                        <span class="nav-icon"><?php echo $tabInfo['icon']; ?></span>
                        <span class="nav-text"><?php echo $tabInfo['title']; ?></span>
                    </a>
                <?php endif; ?>
            <?php endforeach; ?>
        </div>
    </div>

    <!-- Main Content Container -->
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

        <!-- Notificação para reclamar admin (apenas para primeiro utilizador) -->
        <?php if ($canClaimAdmin): ?>
            <div class="admin-claim-banner">
                <div class="admin-claim-content">
                    <div class="admin-claim-icon">👑</div>
                    <div class="admin-claim-text">
                        <h3>Bem-vindo ao Sistema!</h3>
                        <p>Parece que é o primeiro utilizador. Deseja tornar-se administrador do sistema?</p>
                    </div>
                    <form method="POST" style="display: inline;">
                        <button type="submit" name="claim_admin" class="btn btn-primary">
                            👑 Tornar-me Administrador
                        </button>
                    </form>
                </div>
            </div>
        <?php endif; ?>

        <!-- Load Tab Content -->
        <?php 
        // Passar variáveis importantes para o tab
        $tab_data = [
            'isLoggedIn' => $isLoggedIn,
            'currentUser' => $currentUser,
            'activeTab' => $activeTab,
            'isAdmin' => $isAdmin
        ];
        
        // Incluir o conteúdo do tab
        include $tabFile; 
        ?>
    </div>

    <!-- Footer -->
    <div class="footer">
        <div class="footer-content">
            <p>&copy; <?php echo date('Y'); ?> <?php echo SITE_NAME; ?> v<?php echo SITE_VERSION; ?></p>
            <p>Sistema de Gestão de Terrenos</p>
        </div>
    </div>

    <!-- Leaflet JS -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
    <!-- Leaflet Draw JS -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>
    <!-- Leaflet GeometryUtil -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet-geometryutil/0.10.1/leaflet.geometryutil.min.js"></script>
    
    <!-- Passar variáveis globais para JavaScript -->
    <script>
        const userLoggedIn = <?php echo $isLoggedIn ? 'true' : 'false'; ?>;
        const activeTab = '<?php echo $activeTab; ?>';
    </script>
    
    <!-- Load tab-specific JavaScript if exists -->
    <?php
    $tabJsFile = 'assets/js/tabs/' . $activeTab . '.js';
    if (file_exists($tabJsFile)): ?>
        <script src="<?php echo $tabJsFile; ?>"></script>
    <?php endif; ?>
    
    <!-- Main JS -->
    <script src="assets/js/app.js"></script>
</body>
</html>