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

// Contagem de convites de partilha pendentes (badge no nav)
$pendingShares = 0;
if ($isLoggedIn) {
    try {
        $pdoIdx = getDBConnection();
        $stIdx  = $pdoIdx->prepare("SELECT COUNT(*) FROM terrain_shares WHERE shared_with=? AND status='pending'");
        $stIdx->execute([$currentUser['id']]);
        $pendingShares = (int)$stIdx->fetchColumn();
    } catch (Exception $ignored) { /* tabela ainda não existe */ }
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
    'field' => [
        'title' => 'Medições de Campo',
        'icon' => '📊',
        'file' => 'tabs/field.php',
        'requiresAuth' => true,
        'requiresAdmin' => false
    ],
    'operations' => [
        'title' => 'Operações',
        'icon'  => '🚜',
        'file'  => 'tabs/operations.php',
        'requiresAuth'  => true,
        'requiresAdmin' => false
    ],
    'sharing' => [
        'title' => 'Partilha',
        'icon'  => '🤝',
        'file'  => 'tabs/sharing.php',
        'requiresAuth'  => true,
        'requiresAdmin' => false
    ],
    'semantic' => [
        'title' => 'Mapa Semântico',
        'icon'  => '🤖',
        'file'  => 'tabs/semantic.php',
        'requiresAuth'  => true,
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

// Tab de admin: não redireciona — o conteúdo do tab trata do acesso negado

// Verificar se o ficheiro do tab existe
$tabFile = $availableTabs[$activeTab]['file'];
if (!file_exists($tabFile)) {
    die("Erro: Ficheiro do tab não encontrado: {$tabFile}");
}

// ── Intercepção de AJAX ──────────────────────────────────────────────────────
// As chamadas AJAX dos tabs fazem POST com um campo 'action'.
// Têm de ser tratadas ANTES de qualquer HTML, senão o JSON fica embrulhado
// na página e o r.json() falha no cliente.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    include $tabFile;   // o tab chama exit() após json_encode()
    exit;               // segurança: garante que o HTML não é enviado
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
    <!-- API Key Modal (overlay) -->
    <div id="apikey-overlay" onclick="if(event.target===this)closeApiKeyModal()"
         style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);
                z-index:9999;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:14px;padding:24px 28px;max-width:480px;
                    width:calc(100% - 32px);box-shadow:0 20px 60px rgba(0,0,0,.2);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                <h3 style="font-size:16px;font-weight:700;color:#1f2937;margin:0;">
                    🔑 API Key — App Móvel
                </h3>
                <button onclick="closeApiKeyModal()"
                        style="border:none;background:none;font-size:20px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
            </div>
            <p style="font-size:12px;color:#6b7280;margin:0 0 14px;line-height:1.6;">
                Use esta chave para autenticar a <strong>App Móvel SoilQI Field</strong>
                (PWA) sem precisar de fazer login no browser do telemóvel.<br>
                Cole-a no ecrã de configuração da app.
            </p>
            <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;
                        padding:10px 12px;display:flex;gap:8px;align-items:center;margin-bottom:12px;">
                <input id="apikey-value" type="text" readonly
                       style="flex:1;border:none;background:none;font-family:monospace;font-size:11px;
                              color:#374151;outline:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                       value="A carregar…">
                <button onclick="copyApiKey()" id="apikey-copy-btn"
                        style="padding:4px 10px;background:#667eea;color:#fff;border:none;
                               border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">
                    📋 Copiar
                </button>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button onclick="regenerateApiKey()"
                        style="padding:5px 12px;background:#f3f4f6;color:#6b7280;border:none;
                               border-radius:6px;font-size:11px;cursor:pointer;">
                    🔄 Gerar nova chave
                </button>
                <a href="pwa/" target="_blank" rel="noopener"
                   style="padding:5px 12px;background:#f0fdf4;color:#15803d;border:none;
                          border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;">
                    📱 Abrir App
                </a>
                <span id="apikey-status" style="font-size:10px;color:#9ca3af;"></span>
            </div>
        </div>
    </div>

    <!-- Header -->
    <div class="header">
        <div class="header-content">
            <div class="header-left">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <div>
                        <h1 style="margin:0;"><?php echo SITE_NAME; ?></h1>
                        <p style="margin:0;">Sistema de Gestão de Terrenos</p>
                    </div>
                    <!-- Botão de instalação da PWA (app móvel) -->
                    <a href="pwa/" target="_blank" rel="noopener" id="pwa-header-btn"
                       title="Instalar App Móvel SoilQI Field"
                       style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;
                              background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);
                              border-radius:20px;color:#fff;font-size:11px;font-weight:600;
                              text-decoration:none;transition:background .15s;white-space:nowrap;">
                        📱 App Móvel
                    </a>
                </div>
            </div>
            <div class="header-right">
                <?php if ($isLoggedIn): ?>
                    <div class="user-info">
                        <div class="user-avatar">
                            <?php echo strtoupper(substr($currentUser['username'], 0, 1)); ?>
                        </div>
                        <div class="user-details">
                            <span class="user-name"><?php echo htmlspecialchars($currentUser['username']); ?></span>
                            <span class="user-role <?php echo $isAdmin ? 'role-admin' : 'role-user'; ?>">
                                <?php echo $isAdmin ? '👑 Admin' : '👤 Utilizador'; ?>
                            </span>
                        </div>
                    </div>
                    <button onclick="openApiKeyModal()" title="API Key para App Móvel"
                            style="padding:6px 10px;background:rgba(255,255,255,.15);
                                   border:1px solid rgba(255,255,255,.3);border-radius:8px;
                                   color:#fff;font-size:13px;cursor:pointer;">🔑</button>
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
                // 2. User está logado (tabs com requiresAdmin também aparecem — o conteúdo trata das permissões)
                $showTab = !$tabInfo['requiresAuth'] || $isLoggedIn;
                ?>
                <?php if ($showTab): ?>
                    <a href="?tab=<?php echo $tabKey; ?>"
                       class="nav-item <?php echo $activeTab === $tabKey ? 'active' : ''; ?>">
                        <span class="nav-icon"><?php echo $tabInfo['icon']; ?></span>
                        <span class="nav-text"><?php echo $tabInfo['title']; ?>
                            <?php if ($tabKey === 'sharing' && $pendingShares > 0): ?>
                                <span id="sharing-nav-badge"
                                      style="background:#ef4444;color:#fff;font-size:9px;font-weight:800;
                                             padding:1px 5px;border-radius:8px;vertical-align:middle;
                                             margin-left:3px;"><?php echo $pendingShares; ?></span>
                            <?php else: ?>
                                <span id="sharing-nav-badge" style="display:none;background:#ef4444;
                                      color:#fff;font-size:9px;font-weight:800;padding:1px 5px;
                                      border-radius:8px;vertical-align:middle;margin-left:3px;"></span>
                            <?php endif; ?>
                        </span>
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

    <?php if ($activeTab === 'map'): ?>
    <!-- jsPDF — necessário para geração de relatórios PDF no tab Mapa -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <?php endif; ?>
    
    <!-- Main JS -->
    <script src="assets/js/app.js"></script>

    <!-- API Key Modal logic -->
    <script>
    function openApiKeyModal() {
        const overlay = document.getElementById('apikey-overlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        const inp = document.getElementById('apikey-value');
        if (inp && inp.value === 'A carregar…') loadApiKey();
    }
    function closeApiKeyModal() {
        const overlay = document.getElementById('apikey-overlay');
        if (overlay) overlay.style.display = 'none';
    }
    function loadApiKey() {
        const inp = document.getElementById('apikey-value');
        const sts = document.getElementById('apikey-status');
        if (inp) inp.value = 'A carregar…';
        fetch('api/api_key.php')
            .then(r => r.json())
            .then(d => {
                if (d.success && inp) inp.value = d.key;
                if (sts) sts.textContent = d.created_at ? 'Criada em ' + d.created_at.slice(0,10) : '';
            })
            .catch(() => { if (inp) inp.value = 'Erro ao carregar.'; });
    }
    function copyApiKey() {
        const val = document.getElementById('apikey-value')?.value;
        if (!val || val === 'A carregar…') return;
        navigator.clipboard?.writeText(val).then(() => {
            const btn = document.getElementById('apikey-copy-btn');
            if (btn) { btn.textContent = '✅ Copiado!'; setTimeout(() => btn.textContent = '📋 Copiar', 2000); }
        }).catch(() => { document.getElementById('apikey-value')?.select(); document.execCommand('copy'); });
    }
    function regenerateApiKey() {
        if (!confirm('Gerar nova API Key? A chave anterior deixará de funcionar na app.')) return;
        const inp = document.getElementById('apikey-value');
        const sts = document.getElementById('apikey-status');
        if (inp) inp.value = 'A gerar…';
        fetch('api/api_key.php', { method: 'POST' })
            .then(r => r.json())
            .then(d => {
                if (d.success && inp) inp.value = d.key;
                if (sts) sts.textContent = '✅ Nova chave gerada';
            })
            .catch(() => { if (inp) inp.value = 'Erro.'; });
    }
    </script>
</body>
</html>