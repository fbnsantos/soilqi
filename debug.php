<?php
/**
 * Debug Script - Verificação do Sistema
 * REMOVA ESTE FICHEIRO EM PRODUÇÃO!
 */

// Ativar todos os erros
error_reporting(E_ALL);
ini_set('display_errors', 1);

echo "<h1>🔍 Debug - Sistema de Gestão de Terrenos</h1>";
echo "<style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
    .section { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; }
    .success { color: green; }
    .error { color: red; }
    .warning { color: orange; }
    pre { background: #f0f0f0; padding: 10px; border-radius: 4px; overflow: auto; }
</style>";

// 1. Verificar PHP
echo "<div class='section'>";
echo "<h2>1. Versão PHP</h2>";
$phpVersion = phpversion();
if (version_compare($phpVersion, '7.4.0', '>=')) {
    echo "<p class='success'>✅ PHP Version: $phpVersion (OK)</p>";
} else {
    echo "<p class='error'>❌ PHP Version: $phpVersion (Requer 7.4+)</p>";
}
echo "</div>";

// 2. Verificar config.php
echo "<div class='section'>";
echo "<h2>2. Ficheiro config.php</h2>";
if (file_exists('config.php')) {
    echo "<p class='success'>✅ config.php existe</p>";
    
    require_once 'config.php';
    
    // Verificar constantes
    $constants = ['DB_HOST', 'DB_NAME', 'DB_USER', 'SITE_NAME'];
    foreach ($constants as $const) {
        if (defined($const)) {
            $value = constant($const);
            // Ocultar password
            if ($const === 'DB_PASS') {
                $value = '***';
            }
            echo "<p class='success'>✅ $const = '$value'</p>";
        } else {
            echo "<p class='error'>❌ $const não está definido</p>";
        }
    }
} else {
    echo "<p class='error'>❌ config.php não encontrado</p>";
    die();
}
echo "</div>";

// 3. Testar conexão à base de dados
echo "<div class='section'>";
echo "<h2>3. Conexão à Base de Dados</h2>";
try {
    $pdo = getDBConnection();
    echo "<p class='success'>✅ Conexão à base de dados bem-sucedida</p>";
    
    // Listar tabelas
    $stmt = $pdo->query("SHOW TABLES");
    $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
    
    echo "<p class='success'>✅ Tabelas encontradas: " . count($tables) . "</p>";
    echo "<ul>";
    foreach ($tables as $table) {
        echo "<li>$table</li>";
    }
    echo "</ul>";
    
    // Verificar estrutura da tabela users
    if (in_array('users', $tables)) {
        echo "<h3>Estrutura da tabela 'users':</h3>";
        $stmt = $pdo->query("DESCRIBE users");
        $structure = $stmt->fetchAll();
        
        // Verificar se coluna 'role' existe
        $hasRole = false;
        foreach ($structure as $col) {
            if ($col['Field'] === 'role') {
                $hasRole = true;
                break;
            }
        }
        
        if ($hasRole) {
            echo "<p class='success'>✅ Coluna 'role' existe</p>";
        } else {
            echo "<p class='error'>❌ Coluna 'role' NÃO existe</p>";
            echo "<div class='warning' style='padding: 15px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; margin: 10px 0;'>";
            echo "<strong>🔧 AÇÃO NECESSÁRIA:</strong><br>";
            echo "A coluna 'role' precisa ser adicionada à tabela users.<br><br>";
            echo "<strong>Opção 1 - Usar Script de Migração Automática:</strong><br>";
            echo "Acesse: <a href='migrate.php' style='color: #667eea; font-weight: bold;'>migrate.php</a> para adicionar automaticamente<br><br>";
            echo "<strong>Opção 2 - SQL Manual:</strong><br>";
            echo "<pre style='background: #f0f0f0; padding: 10px; border-radius: 4px;'>ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user' AFTER password;\nCREATE INDEX idx_role ON users(role);\nUPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM (SELECT id FROM users) AS temp) LIMIT 1;</pre>";
            echo "</div>";
        }
        
        echo "<p><strong>Colunas disponíveis:</strong></p>";
        echo "<table border='1' cellpadding='5' style='border-collapse: collapse;'>";
        echo "<tr><th>Campo</th><th>Tipo</th><th>Null</th><th>Key</th><th>Default</th></tr>";
        foreach ($structure as $col) {
            $rowStyle = ($col['Field'] === 'role') ? "background: #d4edda;" : "";
            echo "<tr style='$rowStyle'>";
            echo "<td><strong>{$col['Field']}</strong></td>";
            echo "<td>{$col['Type']}</td>";
            echo "<td>{$col['Null']}</td>";
            echo "<td>{$col['Key']}</td>";
            echo "<td>{$col['Default']}</td>";
            echo "</tr>";
        }
        echo "</table>";
    }
    
} catch (Exception $e) {
    echo "<p class='error'>❌ Erro na conexão: " . $e->getMessage() . "</p>";
}
echo "</div>";

// 4. Verificar funções
echo "<div class='section'>";
echo "<h2>4. Funções do Sistema</h2>";
$functions = ['isLoggedIn', 'getCurrentUser', 'isAdmin', 'hasAdmin', 'hashPassword'];
foreach ($functions as $func) {
    if (function_exists($func)) {
        echo "<p class='success'>✅ $func() existe</p>";
    } else {
        echo "<p class='error'>❌ $func() não existe</p>";
    }
}
echo "</div>";

// 5. Verificar estrutura de ficheiros
echo "<div class='section'>";
echo "<h2>5. Estrutura de Ficheiros</h2>";
$requiredFiles = [
    'index.php',
    'login.php',
    'logout.php',
    'tabs/map.php',
    'tabs/admin.php',
    'assets/css/style.css',
    'assets/js/app.js',
    'assets/js/tabs/admin.js'
];

foreach ($requiredFiles as $file) {
    if (file_exists($file)) {
        echo "<p class='success'>✅ $file</p>";
    } else {
        echo "<p class='error'>❌ $file não encontrado</p>";
    }
}
echo "</div>";

// 6. Verificar sessão
echo "<div class='section'>";
echo "<h2>6. Sessão PHP</h2>";
if (session_status() === PHP_SESSION_ACTIVE) {
    echo "<p class='success'>✅ Sessão ativa</p>";
    echo "<p>Session ID: " . session_id() . "</p>";
} else {
    echo "<p class='warning'>⚠️ Sessão não iniciada</p>";
}
echo "</div>";

// 7. Verificar utilizadores
echo "<div class='section'>";
echo "<h2>7. Utilizadores no Sistema</h2>";
try {
    // Tentar com role
    try {
        $stmt = $pdo->query("SELECT id, username, email, role FROM users");
        $users = $stmt->fetchAll();
        $hasRoleColumn = true;
    } catch (PDOException $e) {
        // Se falhar, tentar sem role
        $stmt = $pdo->query("SELECT id, username, email FROM users");
        $users = $stmt->fetchAll();
        $hasRoleColumn = false;
        
        echo "<p class='warning'>⚠️ Coluna 'role' não encontrada. Mostrando dados básicos.</p>";
    }
    
    if (count($users) > 0) {
        echo "<p class='success'>✅ Utilizadores encontrados: " . count($users) . "</p>";
        echo "<table border='1' cellpadding='5' style='border-collapse: collapse; width: 100%;'>";
        
        if ($hasRoleColumn) {
            echo "<tr><th>ID</th><th>Username</th><th>Email</th><th>Role</th></tr>";
            foreach ($users as $user) {
                $roleStyle = $user['role'] === 'admin' ? "background: #fff3cd; font-weight: bold;" : "";
                echo "<tr>";
                echo "<td>" . $user['id'] . "</td>";
                echo "<td>" . $user['username'] . "</td>";
                echo "<td>" . $user['email'] . "</td>";
                echo "<td style='$roleStyle'>" . $user['role'] . "</td>";
                echo "</tr>";
            }
        } else {
            echo "<tr><th>ID</th><th>Username</th><th>Email</th></tr>";
            foreach ($users as $user) {
                echo "<tr>";
                echo "<td>" . $user['id'] . "</td>";
                echo "<td>" . $user['username'] . "</td>";
                echo "<td>" . $user['email'] . "</td>";
                echo "</tr>";
            }
        }
        
        echo "</table>";
        
        if (!$hasRoleColumn) {
            echo "<div class='warning' style='margin-top: 15px; padding: 15px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px;'>";
            echo "<strong>🔧 Para adicionar a coluna 'role':</strong><br>";
            echo "Acesse: <a href='migrate.php' style='color: #667eea; font-weight: bold;'>migrate.php</a>";
            echo "</div>";
        }
    } else {
        echo "<p class='warning'>⚠️ Nenhum utilizador registado</p>";
        echo "<p>Registe-se em: <a href='login.php'>login.php</a></p>";
    }
} catch (Exception $e) {
    echo "<p class='error'>❌ Erro ao carregar utilizadores: " . $e->getMessage() . "</p>";
}
echo "</div>";

// 8. Info do servidor
echo "<div class='section'>";
echo "<h2>8. Informação do Servidor</h2>";
echo "<p><strong>PHP Version:</strong> " . PHP_VERSION . "</p>";
echo "<p><strong>Server Software:</strong> " . $_SERVER['SERVER_SOFTWARE'] . "</p>";
echo "<p><strong>Document Root:</strong> " . $_SERVER['DOCUMENT_ROOT'] . "</p>";
echo "<p><strong>Script Filename:</strong> " . $_SERVER['SCRIPT_FILENAME'] . "</p>";
echo "</div>";

echo "<hr>";
echo "<p><strong>⚠️ IMPORTANTE:</strong> Remova este ficheiro (debug.php) após verificar o sistema!</p>";
?>