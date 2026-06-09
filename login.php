<?php
require_once 'config.php';

if (isLoggedIn()) { redirect('index.php'); }

$error   = '';
$success = '';

// ── Login ────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['login'])) {
    $username = sanitizeInput($_POST['username']);
    $password = $_POST['password'];
    if (empty($username) || empty($password)) {
        $error = 'Por favor, preencha todos os campos.';
    } else {
        try {
            $pdo  = getDBConnection();
            $stmt = $pdo->prepare("SELECT id, username, password FROM users WHERE username = ?");
            $stmt->execute([$username]);
            $user = $stmt->fetch();
            if ($user && verifyPassword($password, $user['password'])) {
                $_SESSION['user_id']  = $user['id'];
                $_SESSION['username'] = $user['username'];
                setFlashMessage('Login realizado com sucesso!', 'success');
                redirect('index.php');
            } else {
                $error = 'Credenciais inválidas.';
            }
        } catch (PDOException $e) { $error = 'Erro no sistema. Tente novamente.'; }
    }
}

// ── Registo ───────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['register'])) {
    $username         = sanitizeInput($_POST['reg_username']);
    $email            = sanitizeInput($_POST['reg_email']);
    $password         = $_POST['reg_password'];
    $confirm_password = $_POST['reg_confirm_password'];
    if (empty($username) || empty($email) || empty($password) || empty($confirm_password)) {
        $error = 'Por favor, preencha todos os campos.';
    } elseif (!isValidEmail($email)) {
        $error = 'Email inválido.';
    } elseif (strlen($password) < 6) {
        $error = 'A palavra-passe deve ter pelo menos 6 caracteres.';
    } elseif ($password !== $confirm_password) {
        $error = 'As palavras-passe não coincidem.';
    } else {
        try {
            $pdo  = getDBConnection();
            $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
            $stmt->execute([$username]);
            if ($stmt->fetch()) {
                $error = 'Nome de utilizador já existe.';
            } else {
                $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
                $stmt->execute([$email]);
                if ($stmt->fetch()) {
                    $error = 'Email já registado.';
                } else {
                    $isFirstUser = isFirstUser();
                    $role        = $isFirstUser ? ROLE_ADMIN : ROLE_USER;
                    $pdo->prepare("INSERT INTO users (username, email, password, role) VALUES (?,?,?,?)")
                        ->execute([$username, $email, hashPassword($password), $role]);
                    $success = $isFirstUser
                        ? 'Conta criada! És o primeiro utilizador e foste definido como administrador.'
                        : 'Conta criada com sucesso! Pode agora fazer login.';
                }
            }
        } catch (PDOException $e) { $error = 'Erro no sistema. Tente novamente.'; }
    }
}

$flashMessage = showFlashMessage();

// ── Renderizador Markdown ─────────────────────────────────────────────────────
function mdInline(string $s): string {
    // Extrair links ANTES de htmlspecialchars para não quebrar os URLs
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
    $lines = explode("\n", $text);
    $html = ''; $buf = []; $ulBuf = []; $olBuf = [];
    $flushBuf = function() use (&$buf, &$html) {
        if ($buf) { $html .= '<p>' . implode('<br>', array_map('mdInline', $buf)) . "</p>\n"; $buf = []; }
    };
    $flushUl = function() use (&$ulBuf, &$html) {
        if ($ulBuf) { $html .= '<ul>' . implode('', array_map(fn($i) => '<li>' . mdInline($i) . '</li>', $ulBuf)) . "</ul>\n"; $ulBuf = []; }
    };
    $flushOl = function() use (&$olBuf, &$html) {
        if ($olBuf) { $html .= '<ol>' . implode('', array_map(fn($i) => '<li>' . mdInline($i) . '</li>', $olBuf)) . "</ol>\n"; $olBuf = []; }
    };
    foreach ($lines as $raw) {
        $line = rtrim($raw);
        if (preg_match('/^(#{1,6})\s+(.+)$/u', $line, $m)) {
            $flushBuf(); $flushUl(); $flushOl();
            $lv = strlen($m[1]);
            $html .= "<h{$lv}>" . mdInline($m[2]) . "</h{$lv}>\n";
            continue;
        }
        if (preg_match('/^\s*[-*_]{3,}\s*$/', $line)) {
            $flushBuf(); $flushUl(); $flushOl();
            $html .= "<hr>\n"; continue;
        }
        if (preg_match('/^>\s?(.*)$/u', $line, $m)) {
            $flushBuf(); $flushUl(); $flushOl();
            $html .= '<blockquote>' . mdInline($m[1]) . "</blockquote>\n"; continue;
        }
        if (preg_match('/^[-*+]\s+(.+)$/u', $line, $m)) {
            $flushBuf(); $flushOl(); $ulBuf[] = $m[1]; continue;
        }
        if (preg_match('/^\d+\.\s+(.+)$/u', $line, $m)) {
            $flushBuf(); $flushUl(); $olBuf[] = $m[1]; continue;
        }
        if (trim($line) === '') { $flushBuf(); $flushUl(); $flushOl(); continue; }
        $flushUl(); $flushOl();
        $buf[] = $line;
    }
    $flushBuf(); $flushUl(); $flushOl();
    return $html;
}

// ── Conteúdo da Landing Page ──────────────────────────────────────────────────
// Detectar língua do browser: pt ou en
$browserLang = 'pt';
$acceptLang  = $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '';
if (stripos($acceptLang, 'en') === 0 || (stripos($acceptLang, 'en') !== false && stripos($acceptLang, 'pt') === false)) {
    $browserLang = 'en';
}
// Permitir override via ?lang=
if (isset($_GET['lang']) && in_array($_GET['lang'], ['pt','en'])) {
    $browserLang = $_GET['lang'];
}

$lc      = ['title' => SITE_NAME, 'subtitle' => '', 'body' => ''];
$videos  = [];
try {
    $pdo2 = getDBConnection();
    $rows = $pdo2->prepare("SELECT content_key, content_value FROM landing_content WHERE lang = ?");
    $rows->execute([$browserLang]);
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) { $lc[$r['content_key']] = $r['content_value']; }
    $videos = $pdo2->query("SELECT youtube_id, title FROM landing_videos ORDER BY sort_order ASC, id ASC")->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $ignored) { /* tabela ainda não existe — usa defaults */ }

$otherLang     = $browserLang === 'pt' ? 'en' : 'pt';
$otherLangLabel = $browserLang === 'pt' ? '🇬🇧 English' : '🇵🇹 Português';
?>
<!DOCTYPE html>
<html lang="<?= $browserLang ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($lc['title']) ?> — <?= SITE_NAME ?></title>
    <link rel="stylesheet" href="assets/css/login.css">
    <style>
        /* ── Landing layout ── */
        body { background: #f8fafc; margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; }

        .landing-wrap {
            min-height: 100vh;
            display: grid;
            grid-template-columns: 420px 1fr;
            grid-template-rows: auto 1fr auto;
        }

        /* Top bar */
        .landing-topbar {
            grid-column: 1 / -1;
            background: linear-gradient(135deg, #1a3a2a 0%, #2d6a4f 100%);
            padding: 14px 32px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            color: #fff;
        }
        .landing-topbar-logo { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
        .landing-topbar-logo span { font-weight: 300; opacity: .7; font-size: 14px; margin-left: 10px; }
        .lang-switcher {
            font-size: 12px; color: rgba(255,255,255,.75);
            text-decoration: none; border: 1px solid rgba(255,255,255,.3);
            padding: 4px 12px; border-radius: 20px; transition: background .15s;
        }
        .lang-switcher:hover { background: rgba(255,255,255,.15); color: #fff; }

        /* Content column */
        .landing-content {
            padding: 48px 48px 32px 48px;
            overflow-y: auto;
            background: #fff;
            border-left: 1px solid #e5e7eb;
        }

        .landing-title {
            font-size: clamp(22px, 3vw, 34px);
            font-weight: 800;
            color: #1a3a2a;
            margin: 0 0 6px;
            line-height: 1.2;
        }
        .landing-subtitle {
            font-size: 15px;
            color: #6b7280;
            margin: 0 0 24px;
            font-weight: 500;
        }
        .landing-body {
            font-size: 15px;
            color: #374151;
            line-height: 1.75;
            margin-bottom: 32px;
        }
        .landing-body h1,.landing-body h2,.landing-body h3 {
            color: #1a3a2a; margin: 20px 0 8px; line-height: 1.3;
        }
        .landing-body h1 { font-size: 22px; }
        .landing-body h2 { font-size: 18px; }
        .landing-body h3 { font-size: 15px; }
        .landing-body p  { margin: 0 0 12px; }
        .landing-body ul,.landing-body ol { margin: 0 0 12px 20px; }
        .landing-body li { margin-bottom: 4px; }
        .landing-body strong { color: #1a3a2a; }
        .landing-body a  { color: #2d6a4f; text-decoration: underline; }
        .landing-body a:hover { color: #1a3a2a; }
        .landing-body code {
            background: #f0fdf4; border: 1px solid #bbf7d0;
            border-radius: 4px; padding: 1px 5px; font-size: 13px;
        }
        .landing-body blockquote {
            border-left: 3px solid #2d6a4f; margin: 0 0 12px;
            padding: 8px 16px; background: #f0fdf4; color: #374151;
            border-radius: 0 6px 6px 0;
        }
        .landing-body hr {
            border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;
        }

        /* Videos */
        .videos-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
        }
        .video-card {
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,.08);
            background: #000;
        }
        .video-card iframe {
            width: 100%;
            aspect-ratio: 16/9;
            display: block;
            border: none;
        }
        .video-title {
            background: #fff;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
            color: #374151;
        }

        /* Login column */
        .landing-login {
            background: #f8fafc;
            padding: 40px 32px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-height: 0;
            overflow-y: auto;
            border-right: 1px solid #e5e7eb;
        }

        /* Footer */
        .landing-footer {
            grid-column: 1 / -1;
            background: #1a3a2a;
            color: rgba(255,255,255,.5);
            text-align: center;
            padding: 14px;
            font-size: 12px;
        }

        /* Login card (reutiliza estilos de login.css mas dentro do novo layout) */
        .login-card {
            background: #fff;
            border-radius: 16px;
            padding: 32px 28px;
            box-shadow: 0 4px 24px rgba(0,0,0,.08);
        }
        .login-card h2 {
            font-size: 20px;
            color: #1f2937;
            margin: 0 0 20px;
            font-weight: 700;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .landing-wrap {
                grid-template-columns: 1fr;
                grid-template-rows: auto auto auto auto;
            }
            .landing-login   { padding: 28px 20px; border-right: none; border-bottom: 1px solid #e5e7eb; }
            .landing-content { padding: 28px 20px; }
            .landing-topbar  { padding: 12px 20px; }
        }
    </style>
</head>
<body>

<div class="landing-wrap">

    <!-- Top bar -->
    <div class="landing-topbar">
        <div class="landing-topbar-logo">
            🌱 <?= htmlspecialchars(SITE_NAME) ?>
            <span>Agricultura de Precisão · Universidade do Porto</span>
        </div>
        <a href="?lang=<?= $otherLang ?>" class="lang-switcher"><?= $otherLangLabel ?></a>
    </div>

    <!-- Formulário de login/registo -->
    <div class="landing-login">
        <div class="login-card">
            <h2><?= $browserLang === 'pt' ? '🔐 Entrar na plataforma' : '🔐 Sign in' ?></h2>

            <?php if ($flashMessage): ?>
                <div class="alert alert-<?= $flashMessage['type'] ?>"><?= $flashMessage['message'] ?></div>
            <?php endif; ?>
            <?php if ($error): ?>
                <div class="alert alert-error"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>
            <?php if ($success): ?>
                <div class="alert alert-success"><?= htmlspecialchars($success) ?></div>
            <?php endif; ?>

            <div class="tabs">
                <div class="tab active" onclick="switchTab('login')">
                    <?= $browserLang === 'pt' ? 'Entrar' : 'Login' ?>
                </div>
                <div class="tab" onclick="switchTab('register')">
                    <?= $browserLang === 'pt' ? 'Registar' : 'Register' ?>
                </div>
            </div>

            <!-- Login -->
            <div id="login-tab" class="tab-content active">
                <form method="POST">
                    <div class="form-group">
                        <label><?= $browserLang === 'pt' ? 'Utilizador' : 'Username' ?></label>
                        <input type="text" name="username" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label><?= $browserLang === 'pt' ? 'Palavra-passe' : 'Password' ?></label>
                        <input type="password" name="password" required autocomplete="current-password">
                    </div>
                    <button type="submit" name="login" class="btn">
                        <?= $browserLang === 'pt' ? 'Entrar' : 'Sign in' ?>
                    </button>
                </form>
            </div>

            <!-- Registo -->
            <div id="register-tab" class="tab-content">
                <form method="POST">
                    <div class="form-group">
                        <label><?= $browserLang === 'pt' ? 'Utilizador' : 'Username' ?></label>
                        <input type="text" name="reg_username" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" name="reg_email" required autocomplete="email">
                    </div>
                    <div class="form-group">
                        <label><?= $browserLang === 'pt' ? 'Palavra-passe' : 'Password' ?></label>
                        <input type="password" name="reg_password" required autocomplete="new-password">
                    </div>
                    <div class="form-group">
                        <label><?= $browserLang === 'pt' ? 'Confirmar' : 'Confirm password' ?></label>
                        <input type="password" name="reg_confirm_password" required autocomplete="new-password">
                    </div>
                    <button type="submit" name="register" class="btn">
                        <?= $browserLang === 'pt' ? 'Criar conta' : 'Create account' ?>
                    </button>
                </form>
            </div>
        </div>
    </div>

    <!-- Conteúdo introdutório -->
    <div class="landing-content">
        <h1 class="landing-title"><?= htmlspecialchars($lc['title'] ?: SITE_NAME) ?></h1>
        <?php if (!empty($lc['subtitle'])): ?>
            <p class="landing-subtitle"><?= htmlspecialchars($lc['subtitle']) ?></p>
        <?php endif; ?>
        <?php if (!empty($lc['body'])): ?>
            <div class="landing-body"><?= renderMarkdown($lc['body']) ?></div>
        <?php endif; ?>

        <?php if (!empty($videos)): ?>
        <div class="videos-grid">
            <?php foreach ($videos as $v): ?>
            <div class="video-card">
                <iframe src="https://www.youtube-nocookie.com/embed/<?= htmlspecialchars($v['youtube_id']) ?>?rel=0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen loading="lazy"></iframe>
                <?php if (!empty($v['title'])): ?>
                <div class="video-title"><?= htmlspecialchars($v['title']) ?></div>
                <?php endif; ?>
            </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>
    </div>

    <!-- Footer -->
    <div class="landing-footer">
        <?= htmlspecialchars(SITE_NAME) ?> v<?= SITE_VERSION ?> &mdash; Universidade do Porto
    </div>

</div>

<script src="assets/js/login.js"></script>
</body>
</html>
