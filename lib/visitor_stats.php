<?php
/**
 * Monitorização de visitantes do SoilQI — sem cookies nem serviços externos
 * (adaptado do fbnsantosSI para MySQL).
 *
 * - Cada página vista é registada em page_views.
 * - O IP nunca é guardado: o "visitante" é um hash diário (dia + segredo + IP + navegador),
 *   que permite contar visitantes únicos num dia mas não seguir ninguém entre dias.
 * - Da origem guarda-se só o domínio (ex.: google.com), nunca o URL completo.
 * - Robôs (Google, ChatGPT, Bing…) não contam como visitas: ficam em bot_hits (total por dia).
 * - Visitas de administradores não contam. Visitas de utilizadores com sessão contam,
 *   marcadas com logged_in = 1 (sem guardar quem é).
 * - Registos com mais de 13 meses são apagados automaticamente.
 */

const VIS_RETENTION_DAYS = 400;

/** Robôs conhecidos (nome => padrão no User-Agent). O primeiro que corresponde ganha. */
const VIS_BOTS = [
    'Googlebot' => 'googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|storebot-google',
    'Bingbot' => 'bingbot|bingpreview|msnbot|adidxbot',
    'GPTBot / ChatGPT' => 'gptbot|chatgpt-user|oai-searchbot',
    'ClaudeBot' => 'claudebot|claude-user|claude-searchbot|anthropic-ai',
    'PerplexityBot' => 'perplexitybot|perplexity-user',
    'Applebot' => 'applebot',
    'DuckDuckBot' => 'duckduckbot|duckassistbot',
    'YandexBot' => 'yandex',
    'Baiduspider' => 'baiduspider',
    'Meta / Facebook' => 'facebookexternalhit|facebookbot|meta-externalagent|meta-externalfetcher',
    'LinkedInBot' => 'linkedinbot',
    'Twitter / X' => 'twitterbot',
    'Ahrefs' => 'ahrefs',
    'Semrush' => 'semrush',
    'Common Crawl' => 'ccbot',
    'Bytespider' => 'bytespider',
    'Amazonbot' => 'amazonbot',
    'Outros robôs' => 'bot|crawl|spider|slurp|scrap|preview|monitor|uptime|pingdom|lighthouse|headless|phantom|curl|wget|python|httpclient|okhttp|java/|go-http|libwww|axios|node-fetch|fetch|scan|check|whatsapp|telegram|discord|skype|slack|embedly|validator',
];

/** Origens conhecidas: domínio (ou parte dele) => [nome, canal]. */
const VIS_SOURCES = [
    'chatgpt.com' => ['ChatGPT', 'ai'], 'chat.openai.com' => ['ChatGPT', 'ai'],
    'claude.ai' => ['Claude', 'ai'], 'perplexity.ai' => ['Perplexity', 'ai'],
    'gemini.google.com' => ['Gemini', 'ai'], 'copilot.microsoft.com' => ['Copilot', 'ai'],
    'scholar.google' => ['Google Scholar', 'search'],
    'google' => ['Google', 'search'], 'bing.com' => ['Bing', 'search'], 'duckduckgo.com' => ['DuckDuckGo', 'search'],
    'yahoo.com' => ['Yahoo', 'search'], 'ecosia.org' => ['Ecosia', 'search'], 'search.brave.com' => ['Brave Search', 'search'],
    'yandex' => ['Yandex', 'search'], 'baidu.com' => ['Baidu', 'search'], 'startpage.com' => ['Startpage', 'search'],
    'qwant.com' => ['Qwant', 'search'],
    'linkedin.com' => ['LinkedIn', 'social'], 'lnkd.in' => ['LinkedIn', 'social'],
    'facebook.com' => ['Facebook', 'social'], 'fb.com' => ['Facebook', 'social'], 'instagram.com' => ['Instagram', 'social'],
    't.co' => ['X / Twitter', 'social'], 'x.com' => ['X / Twitter', 'social'], 'twitter.com' => ['X / Twitter', 'social'],
    'youtube.com' => ['YouTube', 'social'], 'reddit.com' => ['Reddit', 'social'], 'bsky.app' => ['Bluesky', 'social'],
    'whatsapp.com' => ['WhatsApp', 'social'], 'teams.microsoft.com' => ['Microsoft Teams', 'social'],
    'moodle' => ['Moodle', 'referral'], 'sigarra' => ['SIGARRA', 'referral'], 'up.pt' => ['Universidade do Porto', 'referral'],
    'github.com' => ['GitHub', 'referral'], 'researchgate.net' => ['ResearchGate', 'referral'],
    'inesctec.pt' => ['INESC TEC', 'referral'], 'fbnsantos' => ['fbnsantos', 'referral'],
];

const VIS_CHANNELS = [
    'direct' => 'Direto (sem origem)',
    'search' => 'Motores de pesquisa',
    'ai' => 'Assistentes de IA',
    'social' => 'Redes sociais / mensagens',
    'email' => 'Email / newsletter',
    'referral' => 'Outros sites',
];

function visEnsureTables(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS page_views (
        id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        created_at    DATETIME     NOT NULL,
        day           DATE         NOT NULL,
        path          VARCHAR(300) NOT NULL,
        visitor       CHAR(16)     NOT NULL,
        logged_in     TINYINT(1)   NOT NULL DEFAULT 0,
        referrer_host VARCHAR(120) NOT NULL DEFAULT '',
        source        VARCHAR(80)  NOT NULL DEFAULT '',
        channel       VARCHAR(16)  NOT NULL DEFAULT 'direct',
        country       CHAR(2)      NOT NULL DEFAULT '',
        language      VARCHAR(8)   NOT NULL DEFAULT '',
        device        VARCHAR(16)  NOT NULL DEFAULT '',
        os            VARCHAR(16)  NOT NULL DEFAULT '',
        browser       VARCHAR(24)  NOT NULL DEFAULT '',
        INDEX idx_pv_day (day),
        INDEX idx_pv_day_channel (day, channel)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS bot_hits (
        day  DATE        NOT NULL,
        bot  VARCHAR(40) NOT NULL,
        hits INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (day, bot)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/**
 * Regista uma página vista. Chamado pelas páginas antes de as mostrar.
 * Um erro aqui nunca estraga a página.
 *
 * @param string $path       caminho a mostrar nas estatísticas (ex.: /index.php?tab=roi)
 * @param bool   $loggedIn   o visitante tem sessão iniciada
 * @param bool   $isAdmin    administradores não contam
 */
function visTrack(string $path, bool $loggedIn = false, bool $isAdmin = false): void
{
    try {
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' || PHP_SAPI === 'cli' || $isAdmin) {
            return;
        }
        // Pré-carregamentos do navegador não são visitas.
        $purpose = strtolower(($_SERVER['HTTP_SEC_PURPOSE'] ?? '') . ($_SERVER['HTTP_PURPOSE'] ?? '') . ($_SERVER['HTTP_X_MOZ'] ?? ''));
        if (strpos($purpose, 'prefetch') !== false || strpos($purpose, 'prerender') !== false) {
            return;
        }
        $ua = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500);
        $day = date('Y-m-d');
        $pdo = getDBConnection();
        $run = function () use ($pdo, $ua, $day, $path, $loggedIn) {
            $bot = visBotName($ua);
            if ($bot !== null) {
                $pdo->prepare('INSERT INTO bot_hits (day, bot, hits) VALUES (?, ?, 1)
                    ON DUPLICATE KEY UPDATE hits = hits + 1')->execute([$day, $bot]);
                return;
            }
            [$refHost, $source, $channel] = visOrigin();
            $visitor = substr(hash('sha256', $day . '|' . visSecret() . '|' . visClientIp() . '|' . $ua), 0, 16);
            $pdo->prepare('INSERT INTO page_views (created_at, day, path, visitor, logged_in, referrer_host, source,
                    channel, country, language, device, os, browser)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([
                    date('Y-m-d H:i:s'), $day, substr($path, 0, 300), $visitor, $loggedIn ? 1 : 0,
                    $refHost, $source, $channel, visCountry(), visLanguage(),
                    visDevice($ua), visOs($ua), visBrowser($ua),
                ]);
        };
        try {
            $run();
        } catch (PDOException $e) {
            if ($e->getCode() !== '42S02') { // 42S02 = tabela não existe: cria e tenta de novo
                throw $e;
            }
            visEnsureTables($pdo);
            $run();
        }
        if (random_int(1, 200) === 1) {
            $limit = date('Y-m-d', strtotime('-' . VIS_RETENTION_DAYS . ' days'));
            $pdo->prepare('DELETE FROM page_views WHERE day < ?')->execute([$limit]);
            $pdo->prepare('DELETE FROM bot_hits WHERE day < ?')->execute([$limit]);
        }
    } catch (Throwable $e) {
        error_log('SoilQI estatísticas: ' . $e->getMessage());
    }
}

/** Caminho legível do pedido actual: script + só os parâmetros tab e lang. */
function visCurrentPath(): string
{
    $script = '/' . basename((string) ($_SERVER['SCRIPT_NAME'] ?? 'index.php'));
    $q = [];
    foreach (['tab', 'lang'] as $k) {
        if (isset($_GET[$k]) && is_string($_GET[$k]) && preg_match('/^[a-z0-9_-]{1,30}$/i', $_GET[$k])) {
            $q[$k] = $_GET[$k];
        }
    }
    return $script . ($q ? '?' . http_build_query($q) : '');
}

function visSecret(): string
{
    // Segredo do servidor que nunca sai daqui: impede reconstituir o hash a partir de um IP.
    return hash('sha256', (defined('DB_PASS') ? DB_PASS : '') . '|' . (defined('DB_NAME') ? DB_NAME : '') . '|' . __DIR__);
}

function visClientIp(): string
{
    foreach (['HTTP_CF_CONNECTING_IP', 'REMOTE_ADDR'] as $k) {
        $ip = trim((string) ($_SERVER[$k] ?? ''));
        if ($ip !== '' && filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }
    return '';
}

function visBotName(string $ua): ?string
{
    if (trim($ua) === '') {
        return 'Outros robôs';
    }
    foreach (VIS_BOTS as $name => $pattern) {
        if (preg_match('#' . $pattern . '#i', $ua)) {
            return $name;
        }
    }
    return null;
}

/** [domínio de origem, nome da origem, canal] */
function visOrigin(): array
{
    $param = function (string $k) { return isset($_GET[$k]) && is_string($_GET[$k]) ? trim($_GET[$k]) : ''; };
    $utm = $param('utm_source') ?: $param('ref');
    $medium = strtolower($param('utm_medium'));
    $ref = (string) ($_SERVER['HTTP_REFERER'] ?? '');
    $host = strtolower((string) (parse_url($ref, PHP_URL_HOST) ?: ''));
    $host = preg_replace('/^(www\.|m\.|l\.|lm\.)/', '', $host);
    $own = preg_replace('/^www\./', '', strtolower((string) ($_SERVER['HTTP_HOST'] ?? '')));
    $own = preg_replace('/:\d+$/', '', $own);

    if ($host !== '' && $host === $own) {
        return [$host, '', 'internal']; // navegação dentro do site
    }
    // utm_source (ex.: o ChatGPT acrescenta ?utm_source=chatgpt.com) tem prioridade sobre o Referer.
    $known = visKnownSource($utm !== '' ? strtolower($utm) : $host);
    if ($medium === 'email' || $medium === 'newsletter') {
        return [$host, $utm !== '' ? substr($utm, 0, 80) : ($known[0] ?? $host), 'email'];
    }
    if ($known) {
        return [$host, $known[0], $known[1]];
    }
    if ($utm !== '') {
        return [$host, substr($utm, 0, 80), 'referral'];
    }
    if ($host === '') {
        return ['', '', 'direct'];
    }
    return [substr($host, 0, 120), $host, 'referral'];
}

function visKnownSource(string $hostOrName): ?array
{
    if ($hostOrName === '') {
        return null;
    }
    // Corresponde a partes inteiras do domínio: "google" apanha google.com e google.pt; "t.co" não apanha t.com.
    foreach (VIS_SOURCES as $needle => $info) {
        if (preg_match('#(^|\.)' . preg_quote($needle, '#') . '(\.|$)#', $hostOrName)) {
            return $info;
        }
    }
    return null;
}

function visCountry(): string
{
    // Cloudflare ou GeoIP do alojamento, se existirem. O IP não é usado para mais nada.
    $c = strtoupper((string) ($_SERVER['HTTP_CF_IPCOUNTRY'] ?? $_SERVER['GEOIP_COUNTRY_CODE'] ?? $_SERVER['HTTP_X_COUNTRY_CODE'] ?? ''));
    return preg_match('/^[A-Z]{2}$/', $c) && !in_array($c, ['XX', 'T1', 'ZZ'], true) ? $c : '';
}

function visLanguage(): string
{
    $al = (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
    return preg_match('/^\s*([a-z]{2,3})/i', $al, $m) ? strtolower($m[1]) : '';
}

function visDevice(string $ua): string
{
    if (preg_match('/iPad|Tablet|PlayBook|Silk|Kindle/i', $ua) || (stripos($ua, 'Android') !== false && stripos($ua, 'Mobile') === false)) {
        return 'Tablet';
    }
    return preg_match('/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i', $ua) ? 'Telemóvel' : 'Computador';
}

function visOs(string $ua): string
{
    if (preg_match('/iPhone|iPad|iPod/i', $ua)) return 'iOS';
    if (stripos($ua, 'Android') !== false) return 'Android';
    if (stripos($ua, 'Windows') !== false) return 'Windows';
    if (stripos($ua, 'CrOS') !== false) return 'ChromeOS';
    if (preg_match('/Mac OS X|Macintosh/i', $ua)) return 'macOS';
    if (stripos($ua, 'Linux') !== false) return 'Linux';
    return 'Outro';
}

function visBrowser(string $ua): string
{
    if (stripos($ua, 'Edg/') !== false || stripos($ua, 'EdgiOS') !== false) return 'Edge';
    if (stripos($ua, 'OPR/') !== false || stripos($ua, 'Opera') !== false) return 'Opera';
    if (stripos($ua, 'SamsungBrowser') !== false) return 'Samsung Internet';
    if (stripos($ua, 'Firefox') !== false || stripos($ua, 'FxiOS') !== false) return 'Firefox';
    if (stripos($ua, 'Chrome') !== false || stripos($ua, 'CriOS') !== false) return 'Chrome';
    if (stripos($ua, 'Safari') !== false) return 'Safari';
    return 'Outro';
}

/* ---------- Relatório para o painel de administração ---------- */

/** Todos os números da secção Visitantes para os últimos $days dias (incluindo hoje). */
function visReport(int $days): array
{
    $days = in_array($days, [7, 30, 90, 365], true) ? $days : 30;
    $pdo = getDBConnection();
    visEnsureTables($pdo);

    $from = date('Y-m-d', strtotime('-' . ($days - 1) . ' days'));
    $prevFrom = date('Y-m-d', strtotime('-' . (2 * $days - 1) . ' days'));
    $tomorrow = date('Y-m-d', strtotime('+1 day'));
    $q = function (string $sql, array $args = []) use ($pdo) {
        $st = $pdo->prepare($sql);
        $st->execute($args);
        return $st;
    };
    $count = function (string $a, string $b) use ($q) {
        return $q('SELECT COUNT(*) AS views, COUNT(DISTINCT day, visitor) AS visitors
            FROM page_views WHERE day >= ? AND day < ?', [$a, $b])->fetch(PDO::FETCH_ASSOC);
    };
    $now = $count($from, $tomorrow);
    $prev = $count($prevFrom, $from);
    $entries = (int) $q("SELECT COUNT(*) FROM page_views WHERE day >= ? AND channel <> 'internal'", [$from])->fetchColumn();
    $logged = (int) $q('SELECT COUNT(*) FROM page_views WHERE day >= ? AND logged_in = 1', [$from])->fetchColumn();
    $today = $q('SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM page_views WHERE day = ?', [date('Y-m-d')])
        ->fetch(PDO::FETCH_ASSOC);

    // Série diária, com os dias sem visitas a zero.
    $byDay = [];
    foreach ($q('SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM page_views WHERE day >= ? GROUP BY day', [$from])
             ->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $byDay[$r['day']] = $r;
    }
    $series = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $d = date('Y-m-d', strtotime("-$i days"));
        $series[] = ['day' => $d, 'views' => (int) ($byDay[$d]['views'] ?? 0), 'visitors' => (int) ($byDay[$d]['visitors'] ?? 0)];
    }

    $group = function (string $col, string $where = '', int $limit = 10) use ($q, $from) {
        return array_map(function ($r) {
            return ['label' => (string) $r['label'], 'views' => (int) $r['views'], 'visitors' => (int) $r['visitors']];
        }, $q("SELECT $col AS label, COUNT(*) AS views, COUNT(DISTINCT day, visitor) AS visitors
            FROM page_views WHERE day >= ? $where GROUP BY label ORDER BY views DESC LIMIT $limit", [$from])->fetchAll(PDO::FETCH_ASSOC));
    };

    $channels = array_map(function ($r) {
        $r['label'] = VIS_CHANNELS[$r['label']] ?? $r['label'];
        return $r;
    }, $group('channel', "AND channel <> 'internal'", 20));

    $bots = array_map(function ($r) {
        return ['label' => (string) $r['label'], 'views' => (int) $r['views']];
    }, $q('SELECT bot AS label, SUM(hits) AS views FROM bot_hits WHERE day >= ? GROUP BY bot ORDER BY views DESC', [$from])
        ->fetchAll(PDO::FETCH_ASSOC));

    return [
        'days' => $days,
        'from' => $from,
        'views' => (int) $now['views'],
        'visitors' => (int) $now['visitors'],
        'prev_views' => (int) $prev['views'],
        'prev_visitors' => (int) $prev['visitors'],
        'entries' => $entries,
        'logged_views' => $logged,
        'today_views' => (int) $today['views'],
        'today_visitors' => (int) $today['visitors'],
        'series' => $series,
        'pages' => $group('path', '', 15),
        'channels' => $channels,
        'sources' => $group("CASE WHEN source <> '' THEN source ELSE referrer_host END", "AND channel NOT IN ('internal', 'direct')", 15),
        'audience' => $group("CASE WHEN logged_in = 1 THEN 'Utilizadores com sessão' ELSE 'Visitantes públicos' END", '', 2),
        'countries' => $group("CASE WHEN country <> '' THEN country ELSE '?' END"),
        'languages' => $group("CASE WHEN language <> '' THEN language ELSE '?' END"),
        'devices' => $group('device'),
        'os' => $group('os'),
        'browsers' => $group('browser'),
        'bots' => $bots,
    ];
}
