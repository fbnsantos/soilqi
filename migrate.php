<?php
/**
 * Script de Migração Automática
 * Adiciona coluna 'role' e funções necessárias
 * 
 * INSTRUÇÕES:
 * 1. Acesse: http://seudominio.com/migrate.php
 * 2. Clique em "Executar Migração"
 * 3. Apague este ficheiro após uso!
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);

// Incluir config
require_once 'config.php';

?>
<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Migração do Sistema</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 3px solid #667eea;
            padding-bottom: 10px;
        }
        .success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .btn {
            background: #667eea;
            color: white;
            padding: 12px 30px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
        }
        .btn:hover {
            background: #5568d3;
        }
        .btn-danger {
            background: #dc3545;
        }
        .btn-danger:hover {
            background: #c82333;
        }
        pre {
            background: #f4f4f4;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
        }
        .step {
            background: #e7f3ff;
            border-left: 4px solid #2196F3;
            padding: 15px;
            margin: 15px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔄 Migração do Sistema de Terrenos</h1>

<?php
// Processar migração
if (isset($_POST['migrate'])) {
    echo "<h2>Executando Migração...</h2>";
    
    try {
        $pdo = getDBConnection();
        $errors = [];
        $success = [];
        
        // Step 1: Verificar se coluna 'role' já existe
        echo "<div class='step'><strong>Step 1:</strong> Verificar estrutura da tabela users...</div>";
        $stmt = $pdo->query("DESCRIBE users");
        $columns = $stmt->fetchAll(PDO::FETCH_COLUMN);
        
        $hasRole = in_array('role', $columns);
        
        if ($hasRole) {
            echo "<div class='warning'>⚠️ Coluna 'role' já existe. Pulando...</div>";
        } else {
            // Step 2: Adicionar coluna 'role'
            echo "<div class='step'><strong>Step 2:</strong> Adicionando coluna 'role' à tabela users...</div>";
            
            try {
                $pdo->exec("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user' AFTER password");
                $success[] = "✅ Coluna 'role' adicionada com sucesso!";
            } catch (PDOException $e) {
                $errors[] = "❌ Erro ao adicionar coluna 'role': " . $e->getMessage();
            }
        }
        
        // Step 3: Criar índice
        echo "<div class='step'><strong>Step 3:</strong> Criando índice na coluna 'role'...</div>";
        
        try {
            $pdo->exec("CREATE INDEX idx_role ON users(role)");
            $success[] = "✅ Índice criado com sucesso!";
        } catch (PDOException $e) {
            // Índice já existe, ignorar
            echo "<div class='warning'>⚠️ Índice já existe. Pulando...</div>";
        }
        
        // Step 4: Definir primeiro utilizador como admin
        echo "<div class='step'><strong>Step 4:</strong> Definir primeiro utilizador como admin...</div>";
        
        try {
            // Verificar se já existe admin
            $stmt = $pdo->query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
            $adminCount = $stmt->fetch()['count'];
            
            if ($adminCount == 0) {
                // Pegar o primeiro utilizador
                $stmt = $pdo->query("SELECT id, username FROM users ORDER BY id ASC LIMIT 1");
                $firstUser = $stmt->fetch();
                
                if ($firstUser) {
                    $pdo->prepare("UPDATE users SET role = 'admin' WHERE id = ?")->execute([$firstUser['id']]);
                    $success[] = "✅ Utilizador '{$firstUser['username']}' definido como administrador!";
                } else {
                    echo "<div class='warning'>⚠️ Nenhum utilizador encontrado para promover.</div>";
                }
            } else {
                echo "<div class='warning'>⚠️ Já existe(m) $adminCount administrador(es). Pulando...</div>";
            }
        } catch (PDOException $e) {
            $errors[] = "❌ Erro ao promover utilizador: " . $e->getMessage();
        }
        
        // Step 5: Verificar se funções existem no config.php
        echo "<div class='step'><strong>Step 5:</strong> Verificando funções no config.php...</div>";
        
        $missingFunctions = [];
        if (!function_exists('isAdmin')) $missingFunctions[] = 'isAdmin()';
        if (!function_exists('hasAdmin')) $missingFunctions[] = 'hasAdmin()';
        if (!function_exists('canClaimAdmin')) $missingFunctions[] = 'canClaimAdmin()';
        if (!function_exists('claimAdminRole')) $missingFunctions[] = 'claimAdminRole()';
        if (!function_exists('getTotalUsers')) $missingFunctions[] = 'getTotalUsers()';
        if (!function_exists('isFirstUser')) $missingFunctions[] = 'isFirstUser()';
        
        if (count($missingFunctions) > 0) {
            echo "<div class='error'>";
            echo "<strong>❌ Funções em falta no config.php:</strong><br>";
            echo "<ul>";
            foreach ($missingFunctions as $func) {
                echo "<li>$func</li>";
            }
            echo "</ul>";
            echo "<p><strong>AÇÃO NECESSÁRIA:</strong> Precisa substituir o config.php pelo ficheiro atualizado que inclui estas funções.</p>";
            echo "</div>";
            
            $errors[] = "Funções em falta no config.php";
        } else {
            $success[] = "✅ Todas as funções necessárias existem no config.php!";
        }
        
        // Mostrar resultados
        echo "<hr>";
        echo "<h2>📊 Resultados da Migração</h2>";
        
        if (count($success) > 0) {
            echo "<div class='success'>";
            foreach ($success as $msg) {
                echo "<p>$msg</p>";
            }
            echo "</div>";
        }
        
        if (count($errors) > 0) {
            echo "<div class='error'>";
            foreach ($errors as $msg) {
                echo "<p>$msg</p>";
            }
            echo "</div>";
        }
        
        if (count($errors) == 0) {
            echo "<div class='success'>";
            echo "<h3>🎉 Migração Concluída com Sucesso!</h3>";
            echo "<p>O sistema foi atualizado e está pronto para usar.</p>";
            echo "<p><strong>Próximos passos:</strong></p>";
            echo "<ol>";
            echo "<li>Teste o sistema acessando <a href='index.php'>index.php</a></li>";
            echo "<li>Faça login e verifique o painel de administração</li>";
            echo "<li><strong style='color: red;'>IMPORTANTE: Apague este ficheiro (migrate.php)</strong></li>";
            echo "</ol>";
            echo "</div>";
        } else {
            echo "<div class='error'>";
            echo "<h3>⚠️ Migração Concluída com Erros</h3>";
            echo "<p>Alguns passos falharam. Verifique os erros acima e corrija manualmente.</p>";
            echo "</div>";
        }
        
    } catch (Exception $e) {
        echo "<div class='error'>";
        echo "<h3>❌ Erro Fatal</h3>";
        echo "<p>" . $e->getMessage() . "</p>";
        echo "</div>";
    }
    
} else {
    // Mostrar interface inicial
    ?>
    
    <div class="warning">
        <h3>⚠️ Atenção!</h3>
        <p>Este script irá:</p>
        <ol>
            <li>Adicionar a coluna 'role' à tabela 'users'</li>
            <li>Criar índice na coluna 'role'</li>
            <li>Definir o primeiro utilizador como administrador</li>
            <li>Verificar funções no config.php</li>
        </ol>
        <p><strong>Recomendação:</strong> Faça backup da base de dados antes de continuar!</p>
    </div>

    <h3>📋 Pré-requisitos</h3>
    <div class="step">
        <p>Antes de executar a migração, certifique-se que:</p>
        <ul>
            <li>✅ A base de dados está acessível</li>
            <li>✅ A tabela 'users' existe</li>
            <li>✅ Tem pelo menos 1 utilizador registado</li>
            <li>✅ Fez backup da base de dados</li>
        </ul>
    </div>

    <h3>🔍 Verificação Atual</h3>
    <?php
    try {
        $pdo = getDBConnection();
        
        // Verificar coluna role
        $stmt = $pdo->query("DESCRIBE users");
        $columns = $stmt->fetchAll(PDO::FETCH_COLUMN);
        $hasRole = in_array('role', $columns);
        
        echo "<p><strong>Coluna 'role':</strong> ";
        if ($hasRole) {
            echo "<span style='color: green;'>✅ Existe</span>";
        } else {
            echo "<span style='color: red;'>❌ Não existe (será criada)</span>";
        }
        echo "</p>";
        
        // Verificar utilizadores
        $stmt = $pdo->query("SELECT COUNT(*) as count FROM users");
        $userCount = $stmt->fetch()['count'];
        echo "<p><strong>Total de utilizadores:</strong> $userCount</p>";
        
        if ($userCount == 0) {
            echo "<div class='error'>";
            echo "<strong>❌ Erro:</strong> Nenhum utilizador encontrado!<br>";
            echo "Por favor, registe pelo menos 1 utilizador antes de executar a migração.";
            echo "</div>";
            echo '<p><a href="login.php" class="btn">Registar Utilizador</a></p>';
        } else {
            // Mostrar primeiro utilizador
            $stmt = $pdo->query("SELECT id, username, email FROM users ORDER BY id ASC LIMIT 1");
            $firstUser = $stmt->fetch();
            
            echo "<div class='step'>";
            echo "<p><strong>Primeiro utilizador (será admin):</strong></p>";
            echo "<ul>";
            echo "<li><strong>ID:</strong> {$firstUser['id']}</li>";
            echo "<li><strong>Username:</strong> {$firstUser['username']}</li>";
            echo "<li><strong>Email:</strong> {$firstUser['email']}</li>";
            echo "</ul>";
            echo "</div>";
            
            // Verificar funções
            $missingFunctions = [];
            if (!function_exists('isAdmin')) $missingFunctions[] = 'isAdmin()';
            if (!function_exists('hasAdmin')) $missingFunctions[] = 'hasAdmin()';
            
            if (count($missingFunctions) > 0) {
                echo "<div class='warning'>";
                echo "<strong>⚠️ Atenção:</strong> As seguintes funções não existem no config.php:<br>";
                echo "<ul>";
                foreach ($missingFunctions as $func) {
                    echo "<li>$func</li>";
                }
                echo "</ul>";
                echo "<p>Após a migração, precisará substituir o config.php pelo ficheiro atualizado.</p>";
                echo "</div>";
            }
            
            // Botão de migração
            echo '<form method="POST">';
            echo '<button type="submit" name="migrate" class="btn">🚀 Executar Migração</button>';
            echo '</form>';
        }
        
    } catch (Exception $e) {
        echo "<div class='error'>";
        echo "<strong>❌ Erro ao conectar à base de dados:</strong><br>";
        echo $e->getMessage();
        echo "</div>";
    }
    ?>

<?php } ?>

        <hr>
        <p style="text-align: center; color: #666;">
            <small>⚠️ Apague este ficheiro (migrate.php) após a migração!</small>
        </p>
    </div>
</body>
</html>