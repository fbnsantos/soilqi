<?php
/**
 * Tab: Administração
 * Painel de administração do sistema
 */

// Este ficheiro é incluído pelo index.php
// Variáveis disponíveis: $isLoggedIn, $currentUser, $activeTab, $isAdmin

// Garantir que as variáveis existem (fallback)
if (!isset($isLoggedIn)) $isLoggedIn = false;
if (!isset($isAdmin)) $isAdmin = false;
if (!isset($currentUser)) $currentUser = null;

// Verificar permissões de administrador
if (!$isAdmin) {
    echo '<div class="section" style="text-align:center;padding:60px 20px;">';
    echo '<div style="font-size:56px;margin-bottom:16px;">🔒</div>';
    echo '<h2 style="color:#1f2937;margin-bottom:8px;">Acesso Restrito</h2>';
    echo '<p style="color:#6b7280;margin-bottom:4px;">Esta área é exclusiva para administradores do sistema.</p>';
    if ($isLoggedIn) {
        echo '<p style="color:#9ca3af;font-size:13px;">A sua conta <strong>' . htmlspecialchars($currentUser['username']) . '</strong> não tem permissões de administrador.</p>';
        echo '<p style="color:#9ca3af;font-size:13px;margin-top:8px;">Contacte um administrador para obter acesso.</p>';
    }
    echo '</div>';
    return;
}

// API endpoints para operações de administração
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isLoggedIn && $isAdmin) {
    header('Content-Type: application/json');
    
    $action = $_POST['action'] ?? '';
    $response = ['success' => false, 'message' => ''];
    
    try {
        $pdo = getDBConnection();
        
        switch ($action) {
            case 'get_users':
                $stmt = $pdo->query("SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC");
                $users = $stmt->fetchAll();
                
                $response['success'] = true;
                $response['users'] = $users;
                break;
                
            case 'toggle_admin':
                $userId = intval($_POST['user_id']);
                
                // Não permitir que o utilizador mude o próprio role
                if ($userId == $currentUser['id']) {
                    $response['message'] = 'Não pode alterar as suas próprias permissões.';
                    break;
                }
                
                // Obter role atual
                $stmt = $pdo->prepare("SELECT role FROM users WHERE id = ?");
                $stmt->execute([$userId]);
                $user = $stmt->fetch();
                
                if (!$user) {
                    $response['message'] = 'Utilizador não encontrado.';
                    break;
                }
                
                // Toggle role
                $newRole = $user['role'] === ROLE_ADMIN ? ROLE_USER : ROLE_ADMIN;
                
                $stmt = $pdo->prepare("UPDATE users SET role = ? WHERE id = ?");
                $stmt->execute([$newRole, $userId]);
                
                $response['success'] = true;
                $response['message'] = 'Permissões atualizadas com sucesso.';
                $response['new_role'] = $newRole;
                break;
                
            case 'execute_sql':
                // Verificar se é admin
                if (!$isAdmin) {
                    $response['message'] = 'Acesso negado.';
                    break;
                }
                
                $sql = $_POST['sql'] ?? '';
                
                if (empty($sql)) {
                    $response['message'] = 'Query SQL vazia.';
                    break;
                }
                
                // Proteção básica - não permitir múltiplas queries
                if (substr_count($sql, ';') > 1) {
                    $response['message'] = 'Apenas uma query SQL por vez é permitida.';
                    break;
                }
                
                try {
                    // Detectar tipo de query
                    $sql_upper = strtoupper(trim($sql));
                    $is_select = strpos($sql_upper, 'SELECT') === 0;
                    $is_show = strpos($sql_upper, 'SHOW') === 0;
                    $is_describe = strpos($sql_upper, 'DESCRIBE') === 0 || strpos($sql_upper, 'DESC') === 0;
                    $is_explain = strpos($sql_upper, 'EXPLAIN') === 0;
                    
                    $stmt = $pdo->prepare($sql);
                    $stmt->execute();
                    
                    // Se é SELECT, SHOW, DESCRIBE ou EXPLAIN, retornar resultados
                    if ($is_select || $is_show || $is_describe || $is_explain) {
                        $results = $stmt->fetchAll();
                        $response['success'] = true;
                        $response['type'] = 'select';
                        $response['results'] = $results;
                        $response['row_count'] = count($results);
                        
                        // Obter nomes das colunas
                        if (count($results) > 0) {
                            $response['columns'] = array_keys($results[0]);
                        }
                    } else {
                        // Para INSERT, UPDATE, DELETE, etc.
                        $rowCount = $stmt->rowCount();
                        $response['success'] = true;
                        $response['type'] = 'modify';
                        $response['affected_rows'] = $rowCount;
                        
                        // Se foi INSERT, tentar obter o último ID
                        if (strpos($sql_upper, 'INSERT') === 0) {
                            $response['last_insert_id'] = $pdo->lastInsertId();
                        }
                    }
                    
                    $response['message'] = 'Query executada com sucesso.';
                } catch (PDOException $e) {
                    $response['success'] = false;
                    $response['message'] = 'Erro SQL: ' . $e->getMessage();
                    $response['error_code'] = $e->getCode();
                }
                break;
                
            case 'get_table_structure':
                // Verificar se é admin
                if (!$isAdmin) {
                    $response['message'] = 'Acesso negado.';
                    break;
                }
                
                $tableName = $_POST['table_name'] ?? '';
                
                if (empty($tableName)) {
                    $response['message'] = 'Nome da tabela não fornecido.';
                    break;
                }
                
                try {
                    $stmt = $pdo->prepare("DESCRIBE " . $tableName);
                    $stmt->execute();
                    $structure = $stmt->fetchAll();
                    
                    $response['success'] = true;
                    $response['structure'] = $structure;
                } catch (PDOException $e) {
                    $response['message'] = 'Erro ao obter estrutura: ' . $e->getMessage();
                }
                break;
                
            case 'get_tables_list':
                // Verificar se é admin
                if (!$isAdmin) {
                    $response['message'] = 'Acesso negado.';
                    break;
                }
                
                try {
                    $stmt = $pdo->query("SHOW TABLES");
                    $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
                    
                    $response['success'] = true;
                    $response['tables'] = $tables;
                } catch (PDOException $e) {
                    $response['message'] = 'Erro ao listar tabelas: ' . $e->getMessage();
                }
                break;
                
            case 'delete_user':
                $userId = intval($_POST['user_id']);
                
                // Não permitir que o utilizador se elimine a si próprio
                if ($userId == $currentUser['id']) {
                    $response['message'] = 'Não pode eliminar a sua própria conta.';
                    break;
                }
                
                $stmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
                $stmt->execute([$userId]);
                
                $response['success'] = true;
                $response['message'] = 'Utilizador eliminado com sucesso.';
                break;
                
            case 'get_system_stats':
                // Total de utilizadores
                $stmt = $pdo->query("SELECT COUNT(*) as total FROM users");
                $totalUsers = $stmt->fetch()['total'];

                // Total de admins
                $stmt = $pdo->query("SELECT COUNT(*) as total FROM users WHERE role = '" . ROLE_ADMIN . "'");
                $totalAdmins = $stmt->fetch()['total'];

                // Total de terrenos
                $stmt = $pdo->query("SELECT COUNT(*) as total FROM terrains");
                $totalTerrains = $stmt->fetch()['total'];

                // Área total
                $stmt = $pdo->query("SELECT COALESCE(SUM(area), 0) as total FROM terrains");
                $totalArea = $stmt->fetch()['total'];

                $response['success'] = true;
                $response['stats'] = [
                    'users' => $totalUsers,
                    'admins' => $totalAdmins,
                    'terrains' => $totalTerrains,
                    'area' => $totalArea
                ];
                break;

            // ── Página de Entrada ────────────────────────────────────────────────
            case 'get_landing_content':
                try {
                    $pdo->exec("CREATE TABLE IF NOT EXISTS landing_content (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        lang ENUM('pt','en') NOT NULL,
                        content_key VARCHAR(100) NOT NULL,
                        content_value MEDIUMTEXT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY uq_lang_key (lang, content_key)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                    $pdo->exec("CREATE TABLE IF NOT EXISTS landing_videos (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        youtube_id VARCHAR(20) NOT NULL,
                        title VARCHAR(255) NOT NULL DEFAULT '',
                        sort_order INT NOT NULL DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                    $rows = $pdo->query("SELECT lang, content_key, content_value FROM landing_content")->fetchAll(PDO::FETCH_ASSOC);
                    $content = ['pt' => [], 'en' => []];
                    foreach ($rows as $r) { $content[$r['lang']][$r['content_key']] = $r['content_value']; }

                    $videos = $pdo->query("SELECT id, youtube_id, title, sort_order FROM landing_videos ORDER BY sort_order ASC, id ASC")->fetchAll(PDO::FETCH_ASSOC);

                    $response['success'] = true;
                    $response['content'] = $content;
                    $response['videos']  = $videos;
                } catch (PDOException $e2) {
                    $response['message'] = 'Erro: ' . $e2->getMessage();
                }
                break;

            case 'save_landing_content':
                $lang  = $_POST['lang'] ?? '';
                $key   = $_POST['content_key'] ?? '';
                $value = $_POST['content_value'] ?? '';
                if (!in_array($lang, ['pt','en']) || !$key) { $response['message'] = 'Dados inválidos.'; break; }
                $stmt = $pdo->prepare("INSERT INTO landing_content (lang, content_key, content_value)
                    VALUES (?,?,?) ON DUPLICATE KEY UPDATE content_value=VALUES(content_value)");
                $stmt->execute([$lang, $key, $value]);
                $response['success'] = true;
                $response['message'] = 'Guardado.';
                break;

            case 'add_landing_video':
                $ytId  = trim($_POST['youtube_id'] ?? '');
                $title = trim($_POST['video_title'] ?? '');
                if (!$ytId) { $response['message'] = 'ID do vídeo obrigatório.'; break; }
                // Accept full URL or just the ID
                if (preg_match('/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/', $ytId, $m)) { $ytId = $m[1]; }
                $order = (int)($pdo->query("SELECT COALESCE(MAX(sort_order),0) FROM landing_videos")->fetchColumn()) + 1;
                $stmt = $pdo->prepare("INSERT INTO landing_videos (youtube_id, title, sort_order) VALUES (?,?,?)");
                $stmt->execute([$ytId, $title, $order]);
                $response['success'] = true;
                $response['id']      = $pdo->lastInsertId();
                $response['message'] = 'Vídeo adicionado.';
                break;

            case 'delete_landing_video':
                $vid = intval($_POST['video_id'] ?? 0);
                $pdo->prepare("DELETE FROM landing_videos WHERE id=?")->execute([$vid]);
                $response['success'] = true;
                break;

            case 'reorder_landing_video':
                $vid   = intval($_POST['video_id'] ?? 0);
                $order = intval($_POST['sort_order'] ?? 0);
                $pdo->prepare("UPDATE landing_videos SET sort_order=? WHERE id=?")->execute([$order, $vid]);
                $response['success'] = true;
                break;

            // ── Parâmetros de Campo ───────────────────────────────────────────
            case 'get_all_parameters':
                try {
                    $stmt = $pdo->query("
                        SELECT fp.id, fp.name, fp.unit, fp.description, fp.scope, fp.user_id,
                               u.username, fp.created_at
                        FROM field_parameters fp
                        LEFT JOIN users u ON u.id = fp.user_id
                        ORDER BY fp.scope DESC, fp.name ASC
                    ");
                    $response['success']    = true;
                    $response['parameters'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } catch (PDOException $e2) {
                    $response['success']    = true;
                    $response['parameters'] = [];
                    $response['hint'] = 'Execute a migração 007 em Migrações de BD.';
                }
                break;

            case 'add_global_parameter':
                $pname = trim($_POST['param_name'] ?? '');
                $punit = trim($_POST['param_unit'] ?? '');
                $pdesc = trim($_POST['param_desc'] ?? '');
                if (!$pname) { $response['message'] = 'Nome obrigatório.'; break; }
                try {
                    $stmt = $pdo->prepare("
                        INSERT INTO field_parameters (name, unit, description, scope, user_id)
                        VALUES (?, ?, ?, 'global', NULL)
                    ");
                    $stmt->execute([$pname, $punit, $pdesc]);
                    $response['success'] = true;
                    $response['message'] = 'Parâmetro global criado.';
                    $response['id']      = $pdo->lastInsertId();
                } catch (PDOException $e2) {
                    $response['message'] = ($e2->getCode() === '23000')
                        ? 'Já existe um parâmetro global com esse nome.'
                        : 'Erro: ' . $e2->getMessage();
                }
                break;

            case 'delete_parameter':
                $pid = intval($_POST['param_id'] ?? 0);
                if (!$pid) { $response['message'] = 'ID inválido.'; break; }
                $pdo->prepare("DELETE FROM field_parameters WHERE id = ?")->execute([$pid]);
                $response['success'] = true;
                $response['message'] = 'Parâmetro eliminado.';
                break;

            // ── Migrações ─────────────────────────────────────────────────────
            case 'get_migrations':
                // Auto-criar tabela de controlo se não existir
                $pdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (
                    id          INT          PRIMARY KEY AUTO_INCREMENT,
                    filename    VARCHAR(255) NOT NULL UNIQUE,
                    applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                $migrationsDir = __DIR__ . '/../migrations/';
                $filenames = [];
                if (is_dir($migrationsDir)) {
                    $found = glob($migrationsDir . '*.sql');
                    natsort($found);
                    foreach ($found as $f) { $filenames[] = basename($f); }
                }

                $applied = [];
                foreach ($pdo->query("SELECT filename, applied_at FROM schema_migrations")->fetchAll() as $row) {
                    $applied[$row['filename']] = $row['applied_at'];
                }

                $response['success']    = true;
                $response['migrations'] = array_values(array_map(function($f) use ($applied) {
                    return [
                        'filename'   => $f,
                        'applied'    => isset($applied[$f]),
                        'applied_at' => $applied[$f] ?? null,
                    ];
                }, $filenames));
                break;

            case 'mqtt_diagnostics':
                $diag    = [];
                $mqttHost = defined('MQTT_HOST') ? MQTT_HOST : '';
                $mqttPort = defined('MQTT_PORT') ? (int)MQTT_PORT : 1883;
                $mqttUser = defined('MQTT_USER') ? MQTT_USER : '';
                $mqttPass = defined('MQTT_PASS') ? MQTT_PASS : '';

                // 1 — fsockopen disponível?
                $disabled = array_map('trim', explode(',', ini_get('disable_functions')));
                $fsockDisabled = in_array('fsockopen', $disabled);
                $diag[] = [
                    'test'   => 'fsockopen disponível',
                    'ok'     => !$fsockDisabled,
                    'detail' => $fsockDisabled
                        ? 'fsockopen está em disable_functions — impossível fazer ligações TCP'
                        : 'fsockopen activo',
                ];

                // 2 — Configuração definida?
                $cfgOk = $mqttHost !== '';
                $diag[] = [
                    'test'   => 'Configuração MQTT (config.php)',
                    'ok'     => $cfgOk,
                    'detail' => $cfgOk
                        ? "MQTT_HOST={$mqttHost}  MQTT_PORT={$mqttPort}  " . ($mqttUser ? "user={$mqttUser}" : 'sem autenticação')
                        : 'MQTT_HOST não definido em config.php',
                ];

                if (!$fsockDisabled && $cfgOk) {
                    // 3 — Resolução DNS
                    $ip       = @gethostbyname($mqttHost);
                    $resolved = ($ip !== $mqttHost);
                    $diag[] = [
                        'test'   => 'Resolução DNS',
                        'ok'     => $resolved,
                        'detail' => $resolved ? "{$mqttHost} → {$ip}" : "Não foi possível resolver \"{$mqttHost}\"",
                    ];

                    // 4 — Ligação TCP
                    $sock = @fsockopen($mqttHost, $mqttPort, $tcpErrno, $tcpErrstr, 5);
                    $tcpOk = (bool)$sock;
                    $diag[] = [
                        'test'   => "Ligação TCP a {$mqttHost}:{$mqttPort}",
                        'ok'     => $tcpOk,
                        'detail' => $tcpOk ? 'Porta aberta e acessível' : "Falhou: {$tcpErrstr} ({$tcpErrno})",
                    ];

                    if ($sock) {
                        // 5 — MQTT CONNACK
                        $cid   = 'soilqi_diag_' . substr(md5(uniqid()), 0, 6);
                        $body  = "\x00\x04MQTT\x04";
                        $flags = 0x02; // clean session
                        if ($mqttUser !== '') {
                            $flags |= 0x80;
                            if ($mqttPass !== '') $flags |= 0x40;
                        }
                        $body .= chr($flags) . "\x00\x3c";
                        $encStr = function($s) { $l = strlen($s); return chr($l >> 8) . chr($l & 0xFF) . $s; };
                        $body  .= $encStr($cid);
                        if ($mqttUser !== '') {
                            $body .= $encStr($mqttUser);
                            if ($mqttPass !== '') $body .= $encStr($mqttPass);
                        }
                        // remaining length
                        $len = strlen($body); $remLen = '';
                        do { $b = $len & 0x7F; $len >>= 7; if ($len > 0) $b |= 0x80; $remLen .= chr($b); } while ($len > 0);

                        stream_set_timeout($sock, 3);
                        fwrite($sock, chr(0x10) . $remLen . $body);
                        $ack = fread($sock, 4);
                        fwrite($sock, "\xe0\x00"); // DISCONNECT
                        fclose($sock);

                        $rcMap = [0=>'Ligação aceite',1=>'Versão inaceitável',2=>'Client ID rejeitado',
                                  3=>'Servidor indisponível',4=>'Credenciais inválidas',5=>'Não autorizado'];
                        $rc    = strlen($ack) >= 4 ? ord($ack[3]) : -1;
                        $connOk = (strlen($ack) >= 4 && ord($ack[0]) === 0x20 && $rc === 0);
                        $diag[] = [
                            'test'   => 'Handshake MQTT (CONNECT → CONNACK)',
                            'ok'     => $connOk,
                            'detail' => $rcMap[$rc] ?? "Resposta inesperada (rc={$rc}, bytes=" . strlen($ack) . ")",
                        ];
                    }
                }

                $response['success']     = true;
                $response['diagnostics'] = $diag;
                break;

            case 'run_migration':
                $filename = basename($_POST['filename'] ?? '');

                // Validação do nome (apenas letras, números, hífen, underscore, ponto)
                if (empty($filename) || !preg_match('/^[\w\-]+\.sql$/i', $filename)) {
                    $response['message'] = 'Nome de ficheiro inválido.';
                    break;
                }

                $migrationsDir = realpath(__DIR__ . '/../migrations');
                $filepath      = $migrationsDir . DIRECTORY_SEPARATOR . $filename;

                if (!$migrationsDir || !file_exists($filepath)
                    || strpos(realpath($filepath), $migrationsDir) !== 0) {
                    $response['message'] = 'Ficheiro não encontrado ou acesso negado.';
                    break;
                }

                // Garantir tabela de controlo existe
                $pdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    filename VARCHAR(255) NOT NULL UNIQUE,
                    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                // Verificar se já foi aplicada
                $chk = $pdo->prepare("SELECT id FROM schema_migrations WHERE filename = ?");
                $chk->execute([$filename]);
                if ($chk->fetch()) {
                    $response['message'] = 'Esta migração já foi aplicada anteriormente.';
                    break;
                }

                // Ler SQL e separar em statements
                $sql = file_get_contents($filepath);
                $sql = preg_replace('/--[^\n]*/', '', $sql);           // strip -- comments
                $sql = preg_replace('/\/\*.*?\*\//s', '', $sql);       // strip /* */ comments
                $statements = array_values(array_filter(
                    array_map('trim', explode(';', $sql)),
                    function($s) { return strlen($s) > 0; }
                ));

                $executed = 0;
                try {
                    foreach ($statements as $sqlStmt) {
                        // Ignorar USE / CREATE DATABASE (dependentes do servidor)
                        if (preg_match('/^\s*(USE\s|CREATE\s+DATABASE)/i', $sqlStmt)) continue;
                        $pdo->exec($sqlStmt);
                        $executed++;
                    }
                    // Registar como aplicada
                    $pdo->prepare("INSERT INTO schema_migrations (filename) VALUES (?)")->execute([$filename]);
                    $response['success']    = true;
                    $response['message']    = "Migração \"{$filename}\" aplicada! ({$executed} instruções executadas)";
                    $response['statements'] = $executed;
                } catch (PDOException $migEx) {
                    $response['message'] = 'Erro ao executar migração: ' . $migEx->getMessage();
                }
                break;
        }
    } catch (PDOException $e) {
        $response['message'] = 'Erro no sistema: ' . $e->getMessage();
    }
    
    echo json_encode($response);
    exit;
}

// Obter estatísticas do sistema
$systemStats = [
    'users' => 0,
    'admins' => 0,
    'terrains' => 0,
    'area' => 0
];

try {
    $pdo = getDBConnection();
    
    // Total de utilizadores
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM users");
    $systemStats['users'] = $stmt->fetch()['total'];
    
    // Total de admins
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM users WHERE role = '" . ROLE_ADMIN . "'");
    $systemStats['admins'] = $stmt->fetch()['total'];
    
    // Total de terrenos
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM terrains");
    $systemStats['terrains'] = $stmt->fetch()['total'];
    
    // Área total
    $stmt = $pdo->query("SELECT COALESCE(SUM(area), 0) as total FROM terrains");
    $systemStats['area'] = $stmt->fetch()['total'];
    
} catch (PDOException $e) {
    // Manter valores padrão
}
?>

<!-- Título da secção -->
<div class="section-header">
    <h2>⚙️ Painel de Administração</h2>
    <p>Gestão e estatísticas do sistema</p>
</div>

<!-- Estatísticas do Sistema -->
<div class="stats-grid">
    <div class="stat-card">
        <div class="stat-number"><?php echo $systemStats['users']; ?></div>
        <div class="stat-label">👥 Utilizadores Registados</div>
    </div>
    <div class="stat-card">
        <div class="stat-number"><?php echo $systemStats['admins']; ?></div>
        <div class="stat-label">👑 Administradores</div>
    </div>
    <div class="stat-card">
        <div class="stat-number"><?php echo $systemStats['terrains']; ?></div>
        <div class="stat-label">🗺️ Terrenos no Sistema</div>
    </div>
    <div class="stat-card">
        <div class="stat-number"><?php echo number_format($systemStats['area'], 1); ?></div>
        <div class="stat-label">📏 Área Total (ha)</div>
    </div>
</div>

<!-- Painel de gestão -->
<div class="admin-panels">
    <!-- Gestão de Utilizadores -->
    <div class="section">
        <div class="section-title">
            <h3>👥 Gestão de Utilizadores</h3>
            <button class="btn btn-primary btn-sm" onclick="loadUsers()">🔄 Recarregar</button>
        </div>
        
        <div id="users-table" class="data-table">
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Utilizador</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Data de Registo</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody id="users-tbody">
                    <tr>
                        <td colspan="6" class="text-center">A carregar...</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- Configurações do Sistema -->
    <div class="section">
        <h3>⚙️ Configurações do Sistema</h3>
        
        <div class="config-item">
            <div class="config-label">
                <strong>Nome do Sistema</strong>
                <span class="config-desc">Nome exibido no cabeçalho</span>
            </div>
            <div class="config-value">
                <?php echo SITE_NAME; ?>
            </div>
        </div>
        
        <div class="config-item">
            <div class="config-label">
                <strong>Versão</strong>
                <span class="config-desc">Versão atual do sistema</span>
            </div>
            <div class="config-value">
                <?php echo SITE_VERSION; ?>
            </div>
        </div>
        
        <div class="config-item">
            <div class="config-label">
                <strong>Base de Dados</strong>
                <span class="config-desc">Tipo de base de dados em uso</span>
            </div>
            <div class="config-value">
                <?php echo DB_TYPE === 'sqlite' ? 'SQLite' : 'MySQL'; ?>
            </div>
        </div>
    </div>

    <!-- Ações de Sistema -->
    <div class="section">
        <h3>🔧 Ações de Sistema</h3>
        
        <div class="action-buttons">
            <button class="btn btn-secondary" onclick="exportData()">
                📥 Exportar Dados
            </button>
            <button class="btn btn-secondary" onclick="viewLogs()">
                📋 Ver Logs
            </button>
            <button class="btn btn-secondary" onclick="clearCache()">
                🗑️ Limpar Cache
            </button>
        </div>
        
        <div class="warning-box">
            <strong>⚠️ Atenção:</strong> Estas ações podem afetar o funcionamento do sistema. 
            Use com cuidado.
        </div>
    </div>

    <!-- Página de Entrada -->
    <div class="section">
        <div class="section-title">
            <h3>🌐 Página de Entrada</h3>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary btn-sm" onclick="setLandingLang('pt')" id="lp-btn-pt" style="font-weight:700;">🇵🇹 PT</button>
                <button class="btn btn-secondary btn-sm" onclick="setLandingLang('en')" id="lp-btn-en">🇬🇧 EN</button>
                <a href="login.php" target="_blank" class="btn btn-secondary btn-sm">👁️ Ver página</a>
            </div>
        </div>
        <p style="color:#6b7280;font-size:14px;margin-bottom:20px;">
            Edite o texto e vídeos que aparecem na página de entrada (login) para visitantes não autenticados.
            Edite separadamente para Português e Inglês — o visitante vê a versão correspondente ao idioma do browser.
        </p>

        <!-- Campos de texto -->
        <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:24px;">
            <div>
                <label style="font-size:12px;font-weight:700;color:#374151;display:block;margin-bottom:5px;">Título</label>
                <input type="text" id="lp-title" class="lp-input"
                       style="width:100%;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:15px;font-weight:600;box-sizing:border-box;"
                       placeholder="Título da página de entrada">
            </div>
            <div>
                <label style="font-size:12px;font-weight:700;color:#374151;display:block;margin-bottom:5px;">Subtítulo</label>
                <input type="text" id="lp-subtitle" class="lp-input"
                       style="width:100%;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;"
                       placeholder="Subtítulo / tagline">
            </div>
            <div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
                    <label style="font-size:12px;font-weight:700;color:#374151;">
                        Texto introdutório
                        <span style="font-weight:400;color:#9ca3af;margin-left:6px;">Markdown suportado</span>
                    </label>
                    <div style="display:flex;gap:4px;">
                        <button class="btn btn-secondary btn-sm" id="lp-tab-edit"   onclick="switchLpTab('edit')"    style="font-weight:700;">✏️ Editar</button>
                        <button class="btn btn-secondary btn-sm" id="lp-tab-preview" onclick="switchLpTab('preview')">👁️ Preview</button>
                    </div>
                </div>
                <!-- Editor -->
                <textarea id="lp-body" rows="10"
                          oninput="updateLpPreview()"
                          style="width:100%;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;font-family:'Courier New',monospace;line-height:1.6;resize:vertical;box-sizing:border-box;"
                          placeholder="# Título&#10;&#10;Texto em **negrito**, *itálico*, [links](https://...)&#10;&#10;- Item 1&#10;- Item 2"></textarea>
                <!-- Preview -->
                <div id="lp-preview"
                     style="display:none;min-height:120px;padding:12px 16px;border:1.5px solid #e5e7eb;border-radius:8px;background:#fafafa;font-size:14px;line-height:1.75;color:#374151;">
                </div>
                <div style="margin-top:6px;font-size:11px;color:#9ca3af;">
                    Suporta: **negrito** *itálico* `código` # títulos - listas [link](url) &gt; citação --- separador
                </div>
            </div>
            <div>
                <button class="btn btn-primary" onclick="saveLandingContent()" id="lp-save-btn">💾 Guardar texto</button>
                <span id="lp-save-status" style="margin-left:10px;font-size:13px;color:#6b7280;"></span>
            </div>
        </div>

        <!-- Vídeos YouTube -->
        <div style="border-top:1px solid #f3f4f6;padding-top:20px;">
            <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:12px;">▶️ Vídeos YouTube</div>
            <div id="lp-videos-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
                <div style="color:#9ca3af;font-size:13px;">A carregar…</div>
            </div>
            <!-- Adicionar vídeo -->
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
                <div class="filter-group">
                    <label>URL ou ID do YouTube</label>
                    <input type="text" id="lp-yt-id" placeholder="ex: dQw4w9WgXcQ ou https://youtu.be/…" style="min-width:260px;">
                </div>
                <div class="filter-group">
                    <label>Título do vídeo</label>
                    <input type="text" id="lp-yt-title" placeholder="ex: Demonstração SoilQI" style="min-width:180px;">
                </div>
                <button class="btn btn-primary btn-sm" onclick="addLandingVideo()" style="margin-bottom:1px;">+ Adicionar vídeo</button>
            </div>
        </div>
    </div>

    <!-- Parâmetros de Campo -->
    <div class="section">
        <div class="section-title">
            <h3>🧪 Parâmetros de Campo</h3>
            <button class="btn btn-primary btn-sm" onclick="showAddParamModal()">+ Novo Parâmetro Global</button>
        </div>
        <p style="color:#6b7280; font-size:14px; margin-bottom:16px;">
            Parâmetros globais são visíveis para todos os utilizadores. Parâmetros de utilizador são criados pelo próprio utilizador.
        </p>
        <div id="admin-params-list">
            <div class="text-center" style="padding:20px; color:#6b7280;">A carregar…</div>
        </div>
    </div>

    <!-- Migrações de Base de Dados -->
    <div class="section">
        <div class="section-title">
            <h3>🗄️ Migrações de Base de Dados</h3>
            <button class="btn btn-primary btn-sm" onclick="loadMigrations()">🔄 Atualizar</button>
        </div>
        <p style="color:#6b7280;font-size:14px;margin-bottom:16px;">
            Coloque ficheiros <code>.sql</code> na pasta <code>migrations/</code> do projeto para os gerir aqui.
            As migrações são executadas por ordem (ex: <code>001_…sql</code>, <code>002_…sql</code>).
        </p>
        <div id="migrations-list">
            <div class="text-center" style="padding:20px;color:#6b7280;">A carregar…</div>
        </div>
    </div>

    <!-- Diagnóstico MQTT -->
    <div class="section">
        <div class="section-title">
            <h3>🔌 Diagnóstico MQTT</h3>
            <button class="btn btn-primary btn-sm" onclick="runMqttDiagnostics()">▶️ Executar</button>
        </div>
        <p style="color:#6b7280;font-size:14px;margin-bottom:16px;">
            Testa a ligação PHP → broker MQTT passo a passo:
            disponibilidade de <code>fsockopen</code>, configuração,
            resolução DNS, ligação TCP e handshake MQTT completo.
        </p>
        <div id="mqtt-diag-result">
            <div style="color:#9ca3af;font-size:13px;">Prima "Executar" para iniciar o diagnóstico.</div>
        </div>
    </div>

    <!-- Console SQL -->
    <div class="section">
        <h3>💻 Console SQL</h3>
        <p style="color: #6b7280; margin-bottom: 15px;">Execute queries SQL diretamente na base de dados. <strong>Use com extremo cuidado!</strong></p>
        
        <!-- Tabelas disponíveis -->
        <div style="margin-bottom: 15px;">
            <button class="btn btn-secondary btn-sm" onclick="loadTablesList()">
                📋 Listar Tabelas
            </button>
            <button class="btn btn-secondary btn-sm" onclick="showTableStructure()">
                🔍 Ver Estrutura
            </button>
            <button class="btn btn-secondary btn-sm" onclick="insertPresetQuery('SELECT * FROM users LIMIT 10')">
                👥 Ver Utilizadores
            </button>
            <button class="btn btn-secondary btn-sm" onclick="insertPresetQuery('SELECT * FROM terrains LIMIT 10')">
                🗺️ Ver Terrenos
            </button>
        </div>

        <!-- Área do SQL -->
        <div class="sql-editor">
            <label for="sql-query" style="display: block; margin-bottom: 8px; font-weight: 600;">
                Query SQL:
            </label>
            <textarea 
                id="sql-query" 
                placeholder="Digite sua query SQL aqui... (ex: SELECT * FROM users)"
                style="width: 100%; min-height: 120px; font-family: 'Courier New', monospace; font-size: 14px; padding: 12px; border: 2px solid #e5e7eb; border-radius: 8px; resize: vertical;"
            ></textarea>
            
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <button class="btn btn-primary" onclick="executeSQL()">
                    ▶️ Executar Query
                </button>
                <button class="btn btn-secondary" onclick="clearSQLEditor()">
                    🗑️ Limpar
                </button>
            </div>
        </div>

        <!-- Resultados -->
        <div id="sql-results" style="margin-top: 20px; display: none;">
            <h4 style="margin-bottom: 12px; color: #1f2937;">Resultados:</h4>
            <div id="sql-results-content"></div>
        </div>

        <!-- Avisos de segurança -->
        <div class="danger-box" style="margin-top: 15px;">
            <strong>🚨 AVISO DE SEGURANÇA:</strong>
            <ul style="margin: 8px 0 0 20px; padding: 0;">
                <li>Queries executadas aqui afetam diretamente a base de dados</li>
                <li>DROP, TRUNCATE e DELETE sem WHERE podem perder todos os dados</li>
                <li>Faça backup antes de executar queries de modificação</li>
                <li>Esta funcionalidade deve ser usada apenas por administradores experientes</li>
            </ul>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/marked@9/marked.min.js"></script>

<style>
/* Estilos específicos da página de admin */
.section-header {
    margin-bottom: 30px;
}

.section-header h2 {
    font-size: 28px;
    color: #1f2937;
    margin-bottom: 8px;
}

.section-header p {
    color: #6b7280;
    font-size: 16px;
}

.admin-panels {
    display: flex;
    flex-direction: column;
    gap: 30px;
}

.section-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.data-table {
    overflow-x: auto;
}

.data-table table {
    width: 100%;
    border-collapse: collapse;
}

.data-table th {
    background: #f8f9fa;
    padding: 12px;
    text-align: left;
    font-weight: 600;
    color: #374151;
    border-bottom: 2px solid #e5e7eb;
}

.data-table td {
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
}

.data-table tbody tr:hover {
    background: #f8f9fa;
}

.text-center {
    text-align: center;
}

.config-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    margin-bottom: 12px;
}

.config-label {
    display: flex;
    flex-direction: column;
}

.config-desc {
    font-size: 12px;
    color: #6b7280;
    margin-top: 4px;
}

.config-value {
    font-weight: 600;
    color: #667eea;
}

.action-buttons {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
}

.warning-box {
    padding: 12px;
    background: #fef3c7;
    border: 1px solid #fbbf24;
    border-radius: 8px;
    color: #92400e;
    font-size: 14px;
}

/* Role Badges */
.badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
}

.badge-admin {
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    color: #78350f;
}

.badge-user {
    background: #e5e7eb;
    color: #4b5563;
}

/* SQL Console */
.sql-editor {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
}

.sql-results-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 15px;
    font-size: 13px;
    background: white;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.sql-results-table th {
    background: #667eea;
    color: white;
    padding: 10px;
    text-align: left;
    font-weight: 600;
    border: 1px solid #5568d3;
}

.sql-results-table td {
    padding: 8px 10px;
    border: 1px solid #e5e7eb;
}

.sql-results-table tbody tr:nth-child(even) {
    background: #f8f9fa;
}

.sql-results-table tbody tr:hover {
    background: #e5e7eb;
}

.sql-info {
    padding: 12px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    color: #1e40af;
    margin-top: 15px;
    font-size: 14px;
}

.sql-success {
    padding: 12px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    color: #166534;
    margin-top: 15px;
    font-size: 14px;
}

.sql-error {
    padding: 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #991b1b;
    margin-top: 15px;
    font-size: 14px;
}

.danger-box {
    padding: 15px;
    background: #fef2f2;
    border: 2px solid #dc2626;
    border-radius: 8px;
    color: #991b1b;
    font-size: 14px;
}

.danger-box strong {
    display: block;
    margin-bottom: 8px;
    font-size: 15px;
}

.danger-box ul {
    margin: 0;
    padding-left: 20px;
}

.danger-box li {
    margin: 4px 0;
}
</style>