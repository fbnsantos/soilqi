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

// ── Landing page para utilizadores não autenticados ──────────────────────────
if (!$isLoggedIn) {
    // Detectar língua
    $browserLang = 'pt';
    $acceptLang  = $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '';
    if (stripos($acceptLang, 'en') === 0 || (stripos($acceptLang, 'en') !== false && stripos($acceptLang, 'pt') === false)) {
        $browserLang = 'en';
    }
    if (isset($_GET['lang']) && in_array($_GET['lang'], ['pt','en'])) {
        $browserLang = $_GET['lang'];
    }
    $lc = ['title' => SITE_NAME, 'subtitle' => '', 'body' => ''];
    $videos = [];
    try {
        $pdo2 = getDBConnection();
        $rows = $pdo2->prepare("SELECT content_key, content_value FROM landing_content WHERE lang = ?");
        $rows->execute([$browserLang]);
        foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) { $lc[$r['content_key']] = $r['content_value']; }
        $videos = $pdo2->query("SELECT youtube_id, title FROM landing_videos ORDER BY sort_order ASC, id ASC")->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $ignored) {}
    $otherLang      = $browserLang === 'pt' ? 'en' : 'pt';
    $otherLangLabel = $browserLang === 'pt' ? '🇬🇧 English' : '🇵🇹 Português';

    function mdInline(string $s): string {
        $links = [];
        $s = preg_replace_callback('/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/u', function($m) use (&$links) {
            $ph = "\x02LINK" . count($links) . "\x03";
            $links[$ph] = '<a href="' . htmlspecialchars($m[2], ENT_QUOTES, 'UTF-8') . '" target="_blank" rel="noopener">'
                        . htmlspecialchars($m[1], ENT_QUOTES, 'UTF-8') . '</a>';
            return $ph;
        }, $s);
        $s = htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $s = preg_replace('/`([^`]+)`/u',       '<code>$1</code>',     $s);
        $s = preg_replace('/\*\*(.+?)\*\*/us',  '<strong>$1</strong>', $s);
        $s = preg_replace('/__(.+?)__/us',       '<strong>$1</strong>', $s);
        $s = preg_replace('/\*([^*\n]+?)\*/u',  '<em>$1</em>',         $s);
        $s = preg_replace('/(?<![a-zA-Z0-9])_([^_\n]+?)_(?![a-zA-Z0-9])/u', '<em>$1</em>', $s);
        return $links ? strtr($s, $links) : $s;
    }
    function renderMarkdown(string $text): string {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $lines = explode("\n", $text); $html = ''; $buf = []; $ulBuf = []; $olBuf = [];
        $flushBuf = function() use (&$buf, &$html) { if ($buf) { $html .= '<p>' . implode('<br>', array_map('mdInline', $buf)) . "</p>\n"; $buf = []; } };
        $flushUl  = function() use (&$ulBuf, &$html) { if ($ulBuf) { $html .= '<ul>' . implode('', array_map(fn($i) => '<li>' . mdInline($i) . '</li>', $ulBuf)) . "</ul>\n"; $ulBuf = []; } };
        $flushOl  = function() use (&$olBuf, &$html) { if ($olBuf) { $html .= '<ol>' . implode('', array_map(fn($i) => '<li>' . mdInline($i) . '</li>', $olBuf)) . "</ol>\n"; $olBuf = []; } };
        foreach ($lines as $raw) {
            $line = rtrim($raw);
            if (preg_match('/^(#{1,6})\s+(.+)$/u', $line, $m)) { $flushBuf(); $flushUl(); $flushOl(); $lv=strlen($m[1]); $html .= "<h{$lv}>" . mdInline($m[2]) . "</h{$lv}>\n"; continue; }
            if (preg_match('/^\s*[-*_]{3,}\s*$/', $line)) { $flushBuf(); $flushUl(); $flushOl(); $html .= "<hr>\n"; continue; }
            if (preg_match('/^>\s?(.*)$/u', $line, $m)) { $flushBuf(); $flushUl(); $flushOl(); $html .= '<blockquote>' . mdInline($m[1]) . "</blockquote>\n"; continue; }
            if (preg_match('/^[-*+]\s+(.+)$/u', $line, $m)) { $flushBuf(); $flushOl(); $ulBuf[] = $m[1]; continue; }
            if (preg_match('/^\d+\.\s+(.+)$/u', $line, $m)) { $flushBuf(); $flushUl(); $olBuf[] = $m[1]; continue; }
            if (trim($line) === '') { $flushBuf(); $flushUl(); $flushOl(); continue; }
            $flushUl(); $flushOl(); $buf[] = $line;
        }
        $flushBuf(); $flushUl(); $flushOl();
        return $html;
    }
    // Derivar descrição SEO a partir do body (primeiros 160 chars, sem markdown)
    $seoDesc = $browserLang === 'en'
        ? 'SoilQI is an academic precision agriculture platform developed at the University of Porto. It integrates robotic monitoring, IoT sensors, field data and satellite imagery for crop management research.'
        : 'SoilQI é uma plataforma académica de agricultura de precisão desenvolvida na Universidade do Porto. Integra monitorização robótica, IoT, dados de campo e imagens de satélite para investigação e ensino.';
    $seoTitle = htmlspecialchars($lc['title'] ?: 'SoilQI — Agricultura de Precisão');
    $canonicalLang = $browserLang === 'en' ? '?lang=en' : '';
    ?>
<!DOCTYPE html>
<html lang="<?= $browserLang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= $seoTitle ?></title>

    <!-- SEO básico -->
    <meta name="description" content="<?= htmlspecialchars($seoDesc) ?>">
    <meta name="keywords" content="precision agriculture, agricultura de precisão, soil quality, IoT, robótica agrícola, Universidade do Porto, ORIOOS, ViField, VineShieldDT, QGIS, VRT, variable rate technology">
    <meta name="author" content="Universidade do Porto — Agricultura de Precisão">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://soilqi.com/index.php<?= $canonicalLang ?>">
    <link rel="alternate" hreflang="pt" href="https://soilqi.com/index.php?lang=pt">
    <link rel="alternate" hreflang="en" href="https://soilqi.com/index.php?lang=en">
    <link rel="alternate" hreflang="x-default" href="https://soilqi.com/index.php">

    <!-- Open Graph (Facebook, LinkedIn, WhatsApp…) -->
    <meta property="og:type"        content="website">
    <meta property="og:url"         content="https://soilqi.com/index.php<?= $canonicalLang ?>">
    <meta property="og:title"       content="<?= $seoTitle ?>">
    <meta property="og:description" content="<?= htmlspecialchars($seoDesc) ?>">
    <meta property="og:image"       content="https://soilqi.com/assets/img/og-image.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:locale"      content="<?= $browserLang === 'pt' ? 'pt_PT' : 'en_GB' ?>">
    <meta property="og:site_name"   content="SoilQI">

    <!-- Twitter Card -->
    <meta name="twitter:card"        content="summary_large_image">
    <meta name="twitter:title"       content="<?= $seoTitle ?>">
    <meta name="twitter:description" content="<?= htmlspecialchars($seoDesc) ?>">
    <meta name="twitter:image"       content="https://soilqi.com/assets/img/og-image.png">

    <!-- JSON-LD — SoftwareApplication + EducationalOrganization -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "SoilQI",
      "url": "https://soilqi.com",
      "applicationCategory": "EducationalApplication",
      "operatingSystem": "Web",
      "description": "<?= addslashes($seoDesc) ?>",
      "inLanguage": ["pt", "en"],
      "author": {
        "@type": "EducationalOrganization",
        "name": "Universidade do Porto",
        "url": "https://www.up.pt"
      },
      "about": [
        {"@type": "Thing", "name": "Precision Agriculture"},
        {"@type": "Thing", "name": "Soil Quality Monitoring"},
        {"@type": "Thing", "name": "Agricultural Robotics"},
        {"@type": "Thing", "name": "IoT Sensors"},
        {"@type": "Thing", "name": "Variable Rate Technology"}
      ],
      "isPartOf": {
        "@type": "Course",
        "name": "<?= $browserLang === 'en' ? 'Precision Agriculture' : 'Agricultura de Precisão' ?>",
        "description": "<?= $browserLang === 'en' ? 'Academic course on precision agriculture covering IoT sensors, robotic monitoring, satellite imagery, variable rate technology (VRT) and prescription maps for agricultural machines and robots.' : 'Cadeira académica de agricultura de precisão que abrange sensores IoT, monitorização robótica, imagens de satélite, tecnologia de taxa variável (VRT) e mapas de prescrição para máquinas e robôs agrícolas.' ?>",
        "url": "https://soilqi.com",
        "inLanguage": ["pt", "en"],
        "provider": {
          "@type": "EducationalOrganization",
          "name": "Universidade do Porto",
          "url": "https://www.up.pt"
        }
      }
    }
    </script>

    <link rel="stylesheet" href="assets/css/login.css">
    <style>
        body { background: #f8fafc; margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
        .landing-wrap { min-height: 100vh; display: grid; grid-template-columns: 420px 1fr; grid-template-rows: auto 1fr auto; }
        .landing-topbar { grid-column: 1/-1; background: linear-gradient(135deg,#1a3a2a 0%,#2d6a4f 100%); padding: 14px 32px; display: flex; align-items: center; justify-content: space-between; color: #fff; }
        .landing-topbar-logo { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
        .landing-topbar-logo span { font-weight: 300; opacity: .7; font-size: 14px; margin-left: 10px; }
        .lang-switcher { font-size: 12px; color: rgba(255,255,255,.75); text-decoration: none; border: 1px solid rgba(255,255,255,.3); padding: 4px 12px; border-radius: 20px; transition: background .15s; }
        .lang-switcher:hover { background: rgba(255,255,255,.15); color: #fff; }
        .landing-login { background: #f8fafc; padding: 40px 32px; display: flex; flex-direction: column; justify-content: center; min-height: 0; overflow-y: auto; border-right: 1px solid #e5e7eb; }
        .landing-content { padding: 48px 48px 32px 48px; overflow-y: auto; background: #fff; }
        .landing-title { font-size: clamp(22px,3vw,34px); font-weight: 800; color: #1a3a2a; margin: 0 0 6px; line-height: 1.2; }
        .landing-subtitle { font-size: 15px; color: #6b7280; margin: 0 0 24px; font-weight: 500; }
        .landing-body { font-size: 15px; color: #374151; line-height: 1.75; margin-bottom: 32px; }
        .landing-body h1,.landing-body h2,.landing-body h3 { color: #1a3a2a; margin: 20px 0 8px; }
        .landing-body h1 { font-size: 22px; } .landing-body h2 { font-size: 18px; } .landing-body h3 { font-size: 15px; }
        .landing-body p { margin: 0 0 12px; }
        .landing-body ul,.landing-body ol { margin: 0 0 12px 20px; } .landing-body li { margin-bottom: 4px; }
        .landing-body strong { color: #1a3a2a; } .landing-body a { color: #2d6a4f; text-decoration: underline; }
        .landing-body code { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 1px 5px; font-size: 13px; }
        .landing-body blockquote { border-left: 3px solid #2d6a4f; margin: 0 0 12px; padding: 8px 16px; background: #f0fdf4; border-radius: 0 6px 6px 0; }
        .landing-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
        .videos-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(280px,1fr)); gap: 16px; margin-bottom: 32px; }
        .video-card { border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.08); background: #000; }
        .video-card iframe { width: 100%; aspect-ratio: 16/9; display: block; border: none; }
        .video-title { background: #fff; padding: 8px 12px; font-size: 12px; font-weight: 600; color: #374151; }
        .login-card { background: #fff; border-radius: 16px; padding: 32px 28px; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
        .login-card h2 { font-size: 20px; color: #1f2937; margin: 0 0 20px; font-weight: 700; }
        .landing-footer { grid-column: 1/-1; background: #1a3a2a; color: rgba(255,255,255,.5); text-align: center; padding: 14px; font-size: 12px; }
        @media (max-width: 768px) {
            .landing-wrap { grid-template-columns: 1fr; grid-template-rows: auto auto auto auto; }
            .landing-login { padding: 28px 20px; border-right: none; border-bottom: 1px solid #e5e7eb; }
            .landing-content { padding: 28px 20px; }
            .landing-topbar { padding: 12px 20px; }
        }
    </style>
</head>
<body>
<div class="landing-wrap">
    <div class="landing-topbar">
        <div class="landing-topbar-logo">🌱 <?= htmlspecialchars(SITE_NAME) ?><span>Agricultura de Precisão · Universidade do Porto</span></div>
        <a href="?lang=<?= $otherLang ?>" class="lang-switcher"><?= $otherLangLabel ?></a>
    </div>
    <div class="landing-login">
        <div class="login-card">
            <h2><?= $browserLang === 'pt' ? '🔐 Entrar na plataforma' : '🔐 Sign in' ?></h2>
            <?php if ($flashMessage): ?>
                <div class="alert alert-<?= $flashMessage['type'] ?>"><?= $flashMessage['message'] ?></div>
            <?php endif; ?>
            <div class="tabs">
                <div class="tab active" onclick="switchTab('login')"><?= $browserLang === 'pt' ? 'Entrar' : 'Login' ?></div>
                <div class="tab" onclick="switchTab('register')"><?= $browserLang === 'pt' ? 'Registar' : 'Register' ?></div>
            </div>
            <div id="login-tab" class="tab-content active">
                <form method="POST" action="login.php">
                    <div class="form-group">
                        <label><?= $browserLang === 'pt' ? 'Utilizador' : 'Username' ?></label>
                        <input type="text" name="username" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label><?= $browserLang === 'pt' ? 'Palavra-passe' : 'Password' ?></label>
                        <input type="password" name="password" required autocomplete="current-password">
                    </div>
                    <button type="submit" name="login" class="btn"><?= $browserLang === 'pt' ? 'Entrar' : 'Sign in' ?></button>
                </form>
            </div>
            <div id="register-tab" class="tab-content">
                <form method="POST" action="login.php">
                    <div class="form-group"><label><?= $browserLang === 'pt' ? 'Utilizador' : 'Username' ?></label><input type="text" name="reg_username" required autocomplete="username"></div>
                    <div class="form-group"><label>Email</label><input type="email" name="reg_email" required autocomplete="email"></div>
                    <div class="form-group"><label><?= $browserLang === 'pt' ? 'Palavra-passe' : 'Password' ?></label><input type="password" name="reg_password" required autocomplete="new-password"></div>
                    <div class="form-group"><label><?= $browserLang === 'pt' ? 'Confirmar' : 'Confirm password' ?></label><input type="password" name="reg_confirm_password" required autocomplete="new-password"></div>
                    <button type="submit" name="register" class="btn"><?= $browserLang === 'pt' ? 'Criar conta' : 'Create account' ?></button>
                </form>
            </div>
        </div>
    </div>
    <div class="landing-content">
        <h1 class="landing-title"><?= htmlspecialchars($lc['title'] ?: SITE_NAME) ?></h1>
        <?php if (!empty($lc['subtitle'])): ?><p class="landing-subtitle"><?= htmlspecialchars($lc['subtitle']) ?></p><?php endif; ?>
        <?php if (!empty($lc['body'])): ?><div class="landing-body"><?= renderMarkdown($lc['body']) ?></div><?php endif; ?>
        <?php if (!empty($videos)): ?>
        <div class="videos-grid">
            <?php foreach ($videos as $v): ?>
            <div class="video-card">
                <iframe src="https://www.youtube-nocookie.com/embed/<?= htmlspecialchars($v['youtube_id']) ?>?rel=0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen loading="lazy"></iframe>
                <?php if (!empty($v['title'])): ?><div class="video-title"><?= htmlspecialchars($v['title']) ?></div><?php endif; ?>
            </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>
    </div>
    <div class="landing-footer"><?= htmlspecialchars(SITE_NAME) ?> v<?= SITE_VERSION ?> &mdash; Universidade do Porto</div>
</div>
<script src="assets/js/login.js"></script>
</body>
</html>
    <?php
    exit;
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
                    <!-- Botão CAN Controller PWA -->
                    <a href="can/" target="_blank" rel="noopener"
                       title="CAN Controller — Taxa variável por prescrição GPS"
                       style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;
                              background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);
                              border-radius:20px;color:#fff;font-size:11px;font-weight:600;
                              text-decoration:none;transition:background .15s;white-space:nowrap;">
                        🚜 CAN Controller
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
    <?php
    // Tabs que ficam no dropdown "Menu"
    $menuGroupTabs = ['sharing', 'admin'];
    $menuActive    = in_array($activeTab, $menuGroupTabs);
    ?>
    <div class="nav-menu">
        <div class="nav-content">

            <?php foreach ($availableTabs as $tabKey => $tabInfo): ?>
                <?php
                if (in_array($tabKey, $menuGroupTabs)) continue; // vai para o dropdown
                $showTab = !$tabInfo['requiresAuth'] || $isLoggedIn;
                ?>
                <?php if ($showTab): ?>
                    <a href="?tab=<?php echo $tabKey; ?>"
                       class="nav-item <?php echo $activeTab === $tabKey ? 'active' : ''; ?>">
                        <span class="nav-icon"><?php echo $tabInfo['icon']; ?></span>
                        <span class="nav-text"><?php echo $tabInfo['title']; ?></span>
                    </a>
                <?php endif; ?>
            <?php endforeach; ?>

            <?php if ($isLoggedIn): ?>
            <!-- ── Dropdown: Partilha + Administração ── -->
            <div class="nav-dropdown <?php echo $menuActive ? 'open' : ''; ?>"
                 id="nav-group-menu">
                <button class="nav-menu-trigger <?php echo $menuActive ? 'active' : ''; ?>"
                        onclick="navGroupToggle()" type="button"
                        aria-haspopup="true" aria-expanded="<?php echo $menuActive ? 'true' : 'false'; ?>">
                    <span class="nav-icon">☰</span>
                    <span class="nav-text">
                        Menu
                        <!-- Badge de convites pendentes -->
                        <span id="sharing-nav-badge"
                              style="background:#ef4444;color:#fff;font-size:9px;font-weight:800;
                                     padding:1px 5px;border-radius:8px;vertical-align:middle;
                                     margin-left:3px;
                                     display:<?php echo $pendingShares > 0 ? 'inline' : 'none'; ?>;"
                        ><?php echo $pendingShares > 0 ? $pendingShares : ''; ?></span>
                    </span>
                    <span class="nav-menu-chevron">▾</span>
                </button>

                <div class="nav-menu-panel">

                    <!-- Partilha -->
                    <a href="?tab=sharing"
                       class="nav-menu-item <?php echo $activeTab === 'sharing' ? 'active' : ''; ?>">
                        <span class="nav-menu-item-icon">🤝</span>
                        <span style="flex:1;">Partilha</span>
                        <?php if ($pendingShares > 0): ?>
                            <span style="background:#ef4444;color:#fff;font-size:9px;font-weight:800;
                                         padding:1px 6px;border-radius:8px;"><?php echo $pendingShares; ?></span>
                        <?php endif; ?>
                    </a>

                    <!-- Administração (visível para todos os logados; acesso controlado pelo tab) -->
                    <a href="?tab=admin"
                       class="nav-menu-item <?php echo $activeTab === 'admin' ? 'active' : ''; ?>">
                        <span class="nav-menu-item-icon">⚙️</span>
                        <span>Administração</span>
                    </a>

                </div>
            </div>
            <?php endif; ?>

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

    <!-- Nav dropdown toggle -->
    <script>
    function navGroupToggle() {
        const el = document.getElementById('nav-group-menu');
        if (!el) return;
        el.classList.toggle('open');
        const btn = el.querySelector('.nav-menu-trigger');
        if (btn) btn.setAttribute('aria-expanded', el.classList.contains('open'));
    }
    // Fechar ao clicar fora
    document.addEventListener('click', function(e) {
        const el = document.getElementById('nav-group-menu');
        if (el && !el.contains(e.target)) el.classList.remove('open');
    });
    </script>

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