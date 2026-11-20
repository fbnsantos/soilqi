<?php
/**
 * SEO do SoilQI — tudo o que os motores de pesquisa leem sai daqui:
 *  - <head> das páginas públicas (title, description, canonical, hreflang, robots,
 *    Open Graph, Twitter, verificação Google/Bing, JSON-LD, Google Analytics opcional);
 *  - robots.txt, sitemap.xml e llms.txt, gerados a partir das definições do painel
 *    Administração → SEO e Indexação e gravados na raiz do site;
 *  - IndexNow (Bing, Yandex, Seznam…): ficheiro-chave e aviso de URLs alterados.
 *
 * As definições ficam na tabela system_settings (chaves seo_*).
 */

const SEO_DEFAULTS = [
    'seo_site_url'            => 'https://soilqi.com',
    'seo_site_name'           => 'SoilQI',
    'seo_title_pt'            => '', // vazio = título da Página de Entrada
    'seo_title_en'            => '',
    'seo_desc_pt'             => 'SoilQI é uma plataforma académica de agricultura de precisão desenvolvida na Universidade do Porto. Integra monitorização robótica, IoT, dados de campo e imagens de satélite para investigação e ensino.',
    'seo_desc_en'             => 'SoilQI is an academic precision agriculture platform developed at the University of Porto. It integrates robotic monitoring, IoT sensors, field data and satellite imagery for crop management research.',
    'seo_keywords'            => 'precision agriculture, agricultura de precisão, soil quality, IoT, robótica agrícola, Universidade do Porto, ORIOOS, ViField, VineShieldDT, QGIS, VRT, variable rate technology',
    'seo_author'              => 'Universidade do Porto — Agricultura de Precisão',
    'seo_org_name'            => 'Universidade do Porto',
    'seo_org_url'             => 'https://www.up.pt',
    'seo_og_image'            => '/assets/img/og-image.png',
    'seo_allow_indexing'      => '1',
    'seo_google_verification' => '',
    'seo_bing_verification'   => '',
    'seo_ga_id'               => '',
    'seo_extra_urls'          => '',
    'seo_robots_extra'        => '',
    'seo_indexnow_enabled'    => '1',
    'seo_indexnow_key'        => '',
    'seo_files_generated_at'  => '',
];

/** Ficheiros gerados na raiz do site. */
const SEO_FILES = ['robots.txt', 'sitemap.xml', 'llms.txt'];

/** Todas as definições SEO (uma só consulta), com os valores por omissão. */
function seoSettings(bool $refresh = false): array
{
    static $cache = null;
    if ($cache !== null && !$refresh) {
        return $cache;
    }
    $s = SEO_DEFAULTS;
    try {
        $rows = getDBConnection()->query("SELECT `key`, `value` FROM system_settings WHERE `key` LIKE 'seo\\_%'")->fetchAll(PDO::FETCH_KEY_PAIR);
        foreach ($rows as $k => $v) {
            if (array_key_exists($k, $s)) {
                $s[$k] = (string) $v;
            }
        }
    } catch (Throwable $e) { /* tabela ainda não existe: usa os valores por omissão */ }
    return $cache = $s;
}

/**
 * URL de um ficheiro estático com a data de modificação como versão (?v=…).
 * O .htaccess manda guardar .js/.css em cache 30 dias ("immutable"): sem isto,
 * os browsers continuam a usar a versão antiga depois de um deploy.
 */
function assetUrl(string $path): string
{
    $file = dirname(__DIR__) . '/' . ltrim($path, '/');
    return htmlspecialchars($path . (is_file($file) ? '?v=' . filemtime($file) : ''), ENT_QUOTES, 'UTF-8');
}

function seo(string $key): string
{
    return seoSettings()[$key] ?? '';
}

function seoIndexingAllowed(): bool
{
    return seo('seo_allow_indexing') === '1';
}

/** URL base sem barra final, ex.: https://soilqi.com */
function seoBaseUrl(): string
{
    $u = rtrim(seo('seo_site_url'), '/');
    return preg_match('#^https?://#i', $u) ? $u : 'https://soilqi.com';
}

/** Caminho relativo ("/x", "x") ou URL absoluto → URL absoluto. */
function seoAbs(string $path): string
{
    if ($path === '' || preg_match('#^https?://#i', $path)) {
        return $path;
    }
    return seoBaseUrl() . '/' . ltrim($path, '/');
}

function seoXml(string $s): string
{
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

/**
 * Bloco <head> das páginas públicas (landing em index.php e login.php).
 * A landing é a mesma nas duas, por isso o canonical aponta sempre para index.php.
 * $title: título da landing (se vazio usa o título SEO da língua).
 */
function seoHead(string $lang, string $title = ''): string
{
    seoEnsureFiles();
    $lang = $lang === 'en' ? 'en' : 'pt';
    $h = fn(string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $site = seo('seo_site_name') ?: 'SoilQI';
    $title = trim(seo("seo_title_$lang")) ?: (trim($title) ?: $site);
    $desc = trim(seo("seo_desc_$lang"));
    $home = seoAbs('/index.php');
    $url = $home . ($lang === 'en' ? '?lang=en' : '');
    $image = seoAbs(seo('seo_og_image'));
    $noindex = !seoIndexingAllowed();

    $t = [];
    $t[] = '<title>' . $h($title) . '</title>';
    $t[] = '<meta name="description" content="' . $h($desc) . '">';
    if (seo('seo_keywords') !== '') {
        $t[] = '<meta name="keywords" content="' . $h(seo('seo_keywords')) . '">';
    }
    if (seo('seo_author') !== '') {
        $t[] = '<meta name="author" content="' . $h(seo('seo_author')) . '">';
    }
    $t[] = '<meta name="robots" content="' . ($noindex ? 'noindex, nofollow'
        : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1') . '">';
    $t[] = '<link rel="canonical" href="' . $h($url) . '">';
    $t[] = '<link rel="alternate" hreflang="pt" href="' . $h($home . '?lang=pt') . '">';
    $t[] = '<link rel="alternate" hreflang="en" href="' . $h($home . '?lang=en') . '">';
    $t[] = '<link rel="alternate" hreflang="x-default" href="' . $h($home) . '">';

    $og = [
        'og:type' => 'website',
        'og:site_name' => $site,
        'og:locale' => $lang === 'pt' ? 'pt_PT' : 'en_GB',
        'og:locale:alternate' => $lang === 'pt' ? 'en_GB' : 'pt_PT',
        'og:title' => $title,
        'og:description' => $desc,
        'og:url' => $url,
    ];
    if ($image !== '') {
        $og['og:image'] = $image;
        $og['og:image:alt'] = $title;
        if (substr(seo('seo_og_image'), -12) === 'og-image.png') { // imagem gerada pelo site: 1200×630
            $og['og:image:width'] = '1200';
            $og['og:image:height'] = '630';
        }
    }
    foreach ($og as $k => $v) {
        $t[] = '<meta property="' . $k . '" content="' . $h($v) . '">';
    }
    $t[] = '<meta name="twitter:card" content="' . ($image !== '' ? 'summary_large_image' : 'summary') . '">';
    $t[] = '<meta name="twitter:title" content="' . $h($title) . '">';
    $t[] = '<meta name="twitter:description" content="' . $h($desc) . '">';
    if ($image !== '') {
        $t[] = '<meta name="twitter:image" content="' . $h($image) . '">';
    }
    if (seo('seo_google_verification') !== '') {
        $t[] = '<meta name="google-site-verification" content="' . $h(seo('seo_google_verification')) . '">';
    }
    if (seo('seo_bing_verification') !== '') {
        $t[] = '<meta name="msvalidate.01" content="' . $h(seo('seo_bing_verification')) . '">';
    }

    $org = ['@type' => 'EducationalOrganization', 'name' => seo('seo_org_name'), 'url' => seo('seo_org_url')];
    $ld = [
        '@context' => 'https://schema.org',
        '@graph' => [
            [
                '@type' => 'WebSite',
                '@id' => seoBaseUrl() . '/#website',
                'url' => $home,
                'name' => $site,
                'description' => $desc,
                'inLanguage' => ['pt-PT', 'en'],
                'publisher' => $org,
            ],
            [
                '@type' => 'SoftwareApplication',
                'name' => $site,
                'url' => $home,
                'applicationCategory' => 'EducationalApplication',
                'operatingSystem' => 'Web',
                'description' => $desc,
                'inLanguage' => ['pt', 'en'],
                'image' => $image ?: null,
                'author' => $org,
                'offers' => ['@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'EUR'],
                'about' => array_map(fn($n) => ['@type' => 'Thing', 'name' => $n], [
                    'Precision Agriculture', 'Soil Quality Monitoring', 'Agricultural Robotics', 'IoT Sensors', 'Variable Rate Technology',
                ]),
                'isPartOf' => [
                    '@type' => 'Course',
                    'name' => $lang === 'en' ? 'Precision Agriculture' : 'Agricultura de Precisão',
                    'description' => $lang === 'en'
                        ? 'Academic course on precision agriculture covering IoT sensors, robotic monitoring, satellite imagery, variable rate technology (VRT) and prescription maps for agricultural machines and robots.'
                        : 'Cadeira académica de agricultura de precisão que abrange sensores IoT, monitorização robótica, imagens de satélite, tecnologia de taxa variável (VRT) e mapas de prescrição para máquinas e robôs agrícolas.',
                    'provider' => $org,
                ],
            ],
        ],
    ];
    $ld['@graph'][1] = array_filter($ld['@graph'][1], fn($v) => $v !== null);
    $t[] = '<script type="application/ld+json">' . json_encode($ld,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) . '</script>';

    $ga = seo('seo_ga_id');
    if (!$noindex && preg_match('/^G-[A-Z0-9]+$/', $ga)) {
        $t[] = '<script async src="https://www.googletagmanager.com/gtag/js?id=' . $h($ga) . '"></script>';
        $t[] = "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','" . $h($ga) . "',{anonymize_ip:true});</script>";
    }
    return implode("\n    ", $t) . "\n";
}

/* ---------- Ficheiros de indexação ---------- */

/** Linhas não vazias de uma definição de texto. */
function seoLines(string $key): array
{
    return array_values(array_filter(array_map('trim', preg_split('/\R/', seo($key)) ?: [])));
}

function seoRobotsTxt(): string
{
    if (!seoIndexingAllowed()) {
        return "# Indexação desativada em Administração → SEO e Indexação\nUser-agent: *\nDisallow: /\n";
    }
    $r = [
        '# Gerado pelo SoilQI (Administração → SEO e Indexação) em ' . date('Y-m-d H:i'),
        'User-agent: *',
        'Allow: /',
        '',
        '# Ficheiros de sistema, scripts e áreas privadas',
    ];
    foreach (['/config.php', '/config_template.php', '/database.sql', '/debug.php', '/git.php', '/install_database.php',
              '/migrate.php', '/set_admins.php', '/logout.php', '/tabs/', '/api/', '/lib/', '/python/', '/migrations/'] as $p) {
        $r[] = "Disallow: $p";
    }
    // As páginas internas exigem sessão: não vale a pena gastar rastreio nelas.
    $r[] = 'Disallow: /index.php?tab=';
    if ($extra = seoLines('seo_robots_extra')) {
        $r[] = '';
        $r[] = '# Regras adicionais';
        array_push($r, ...$extra);
    }
    $r[] = '';
    $r[] = 'Sitemap: ' . seoAbs('/sitemap.xml');
    return implode("\n", $r) . "\n";
}

/** URLs públicos do site: [loc, prioridade, frequência, alternates(lang=>url)|null]. */
function seoPublicUrls(): array
{
    $home = seoAbs('/index.php');
    $alt = ['pt' => "$home?lang=pt", 'en' => "$home?lang=en", 'x-default' => $home];
    $urls = [
        [$home, '1.0', 'weekly', $alt],
        ["$home?lang=en", '0.9', 'weekly', $alt],
    ];
    foreach (seoLines('seo_extra_urls') as $line) {
        if (preg_match('#^(https?://|/)#i', $line)) {
            $urls[] = [seoAbs($line), '0.6', 'monthly', null];
        }
    }
    return $urls;
}

function seoSitemapXml(): string
{
    $lastmod = date('Y-m-d');
    try { // última alteração do conteúdo da landing, se a tabela tiver essa coluna
        $m = getDBConnection()->query('SELECT MAX(updated_at) FROM landing_content')->fetchColumn();
        if ($m) {
            $lastmod = date('Y-m-d', strtotime((string) $m));
        }
    } catch (Throwable $e) { /* sem coluna updated_at: usa a data de hoje */ }

    $x = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"'
          . ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'];
    $image = seoAbs(seo('seo_og_image'));
    foreach (seoPublicUrls() as $i => [$loc, $prio, $freq, $alt]) {
        $x[] = '  <url>';
        $x[] = '    <loc>' . seoXml($loc) . '</loc>';
        $x[] = "    <lastmod>$lastmod</lastmod>";
        $x[] = "    <changefreq>$freq</changefreq>";
        $x[] = "    <priority>$prio</priority>";
        foreach ($alt ?? [] as $hl => $href) {
            $x[] = '    <xhtml:link rel="alternate" hreflang="' . $hl . '" href="' . seoXml($href) . '"/>';
        }
        if ($i === 0 && $image !== '') {
            $x[] = '    <image:image><image:loc>' . seoXml($image) . '</image:loc></image:image>';
        }
        $x[] = '  </url>';
    }
    $x[] = '</urlset>';
    return implode("\n", $x) . "\n";
}

/** Resumo do site em Markdown para assistentes e motores de IA (https://llmstxt.org). */
function seoLlmsTxt(): string
{
    $md = ['# ' . (seo('seo_site_name') ?: 'SoilQI'), '', '> ' . seo('seo_desc_en'), '', seo('seo_desc_pt'), ''];
    $md[] = '## Pages';
    $md[] = '';
    $md[] = '- [SoilQI (Português)](' . seoAbs('/index.php?lang=pt') . '): ' . (seo('seo_title_pt') ?: 'Agricultura de Precisão');
    $md[] = '- [SoilQI (English)](' . seoAbs('/index.php?lang=en') . '): ' . (seo('seo_title_en') ?: 'Precision Agriculture');
    foreach (seoLines('seo_extra_urls') as $line) {
        if (preg_match('#^(https?://|/)#i', $line)) {
            $md[] = '- ' . seoAbs($line);
        }
    }
    $md[] = '';
    $md[] = '## About';
    $md[] = '';
    $md[] = '- Organisation: [' . seo('seo_org_name') . '](' . seo('seo_org_url') . ')';
    $md[] = '- Features (registered users): field measurements, soil-quality maps and interpolation, prescription maps (VRT),'
          . ' operations log, semantic map, ROI calculator for conventional machinery vs agricultural robots.';
    if (seo('seo_keywords') !== '') {
        $md[] = '- Topics: ' . seo('seo_keywords');
    }
    return implode("\n", $md) . "\n";
}

/* ---------- IndexNow ---------- */

function seoIndexNowKey(): string
{
    $key = seo('seo_indexnow_key');
    if (!preg_match('/^[a-f0-9]{32}$/', $key)) {
        $key = bin2hex(random_bytes(16));
        setSystemSetting('seo_indexnow_key', $key);
        seoSettings(true);
    }
    return $key;
}

/**
 * Avisa o IndexNow (Bing, Yandex, Seznam, Naver…) de que os URLs públicos mudaram.
 * Devolve [ok, mensagem].
 */
function seoIndexNowPing(): array
{
    if (!seoIndexingAllowed() || seo('seo_indexnow_enabled') !== '1') {
        return [false, 'IndexNow desativado ou indexação bloqueada.'];
    }
    $host = (string) parse_url(seoBaseUrl(), PHP_URL_HOST);
    if ($host === '' || $host === 'localhost' || filter_var($host, FILTER_VALIDATE_IP)) {
        return [false, 'O URL do site não é um domínio público.'];
    }
    $key = seoIndexNowKey();
    $body = json_encode([
        'host' => $host,
        'key' => $key,
        'keyLocation' => seoAbs("/$key.txt"),
        'urlList' => array_values(array_unique(array_merge(array_column(seoPublicUrls(), 0), [seoAbs('/llms.txt')]))),
    ], JSON_UNESCAPED_SLASHES);
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json; charset=utf-8\r\n",
        'content' => $body,
        'timeout' => 6,
        'ignore_errors' => true,
    ]]);
    $res = @file_get_contents('https://api.indexnow.org/indexnow', false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $hd) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $hd, $m)) {
            $status = (int) $m[1];
        }
    }
    if ($status === 200 || $status === 202) {
        return [true, "IndexNow aceitou o pedido (HTTP $status)."];
    }
    if ($status === 0) {
        return [false, 'Sem resposta do IndexNow (o servidor pode bloquear ligações de saída).'];
    }
    $hint = [400 => 'pedido inválido', 403 => 'a chave não foi encontrada no site — gere os ficheiros primeiro',
             422 => 'URLs não pertencem ao domínio', 429 => 'demasiados pedidos, tente mais tarde'][$status] ?? '';
    return [false, "IndexNow respondeu HTTP $status" . ($hint ? " ($hint)" : '') . '. ' . substr(strip_tags(trim((string) $res)), 0, 200)];
}

/* ---------- Geração ---------- */

/** Conteúdo de cada ficheiro gerado (nome => texto). */
function seoBuildFiles(): array
{
    $files = [
        'robots.txt' => seoRobotsTxt(),
        'sitemap.xml' => seoSitemapXml(),
        'llms.txt' => seoLlmsTxt(),
    ];
    if (seoIndexingAllowed() && seo('seo_indexnow_enabled') === '1') {
        $key = seoIndexNowKey();
        $files["$key.txt"] = $key;
    }
    return $files;
}

/** Grava os ficheiros na raiz do site. Devolve [nome => ['ok'=>bool,'bytes'=>int,'error'=>string]]. */
function seoWriteFiles(): array
{
    $root = dirname(__DIR__);
    $out = [];
    foreach (seoBuildFiles() as $name => $content) {
        $path = $root . DIRECTORY_SEPARATOR . $name;
        $tmp = $path . '.tmp';
        $ok = @file_put_contents($tmp, $content) !== false && @rename($tmp, $path);
        if (!$ok) {
            @unlink($tmp);
            $ok = @file_put_contents($path, $content) !== false; // rename pode falhar em alguns alojamentos
        }
        $err = $ok ? '' : (error_get_last()['message'] ?? 'sem permissão de escrita');
        $out[$name] = ['ok' => $ok, 'bytes' => strlen($content), 'error' => $err];
    }
    // Remover ficheiros-chave IndexNow antigos (32 hex + .txt) que já não são a chave actual
    $current = seo('seo_indexnow_key');
    foreach (glob($root . DIRECTORY_SEPARATOR . '*.txt') ?: [] as $f) {
        $b = basename($f, '.txt');
        if (preg_match('/^[a-f0-9]{32}$/', $b) && $b !== $current) {
            @unlink($f);
        }
    }
    setSystemSetting('seo_files_generated_at', date('Y-m-d H:i:s'));
    seoSettings(true);
    return $out;
}

/**
 * Os ficheiros gerados não estão no git (o deploy faz git pull e entraria em conflito):
 * se faltar algum (ex.: instalação nova), gera-os na primeira visita à página pública.
 */
function seoEnsureFiles(): void
{
    $root = dirname(__DIR__);
    foreach (SEO_FILES as $f) {
        if (!is_file($root . DIRECTORY_SEPARATOR . $f)) {
            try { seoWriteFiles(); } catch (Throwable $e) { error_log('SoilQI SEO: ' . $e->getMessage()); }
            return;
        }
    }
}

/** Estado actual dos ficheiros na raiz (existe, tamanho, data). */
function seoFilesStatus(): array
{
    $root = dirname(__DIR__);
    $out = [];
    $names = SEO_FILES;
    $key = seo('seo_indexnow_key');
    if ($key !== '') {
        $names[] = "$key.txt";
    }
    foreach ($names as $n) {
        $p = $root . DIRECTORY_SEPARATOR . $n;
        $out[] = [
            'name' => $n,
            'exists' => is_file($p),
            'bytes' => is_file($p) ? filesize($p) : 0,
            'modified' => is_file($p) ? date('Y-m-d H:i', filemtime($p)) : null,
            'url' => seoAbs('/' . $n),
        ];
    }
    return $out;
}
