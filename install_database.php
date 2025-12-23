<?php
// install_database.php - Instalador automático da base de dados

// Definir configurações (pode ser sobreposto pelo config.php se existir)
if (file_exists('config.php')) {
    require_once 'config.php';
} else {
    // Configurações padrão se config.php não existir
    define('DB_HOST', 'localhost');
    define('DB_USER', 'root');
    define('DB_PASS', '');
    define('DB_NAME', 'terrain_mapper');
}

$messages = [];
$errors = [];
$success = false;

// Função para conectar à base de dados (sem especificar DB_NAME inicialmente)
function getInitialConnection() {
    try {
        $pdo = new PDO(
            "mysql:host=" . DB_HOST . ";charset=utf8mb4",
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false
            ]
        );
        return $pdo;
    } catch (PDOException $e) {
        throw new Exception("Erro na ligação ao servidor MySQL: " . $e->getMessage());
    }
}

// Função para conectar à base de dados específica
function getDatabaseConnection() {
    try {
        $pdo = new PDO(
            "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false
            ]
        );
        return $pdo;
    } catch (PDOException $e) {
        throw new Exception("Erro na ligação à base de dados: " . $e->getMessage());
    }
}

// Função para executar queries SQL múltiplas
function executeSQLFile($pdo, $sqlContent) {
    global $messages, $errors;
    
    // Remover comentários e linhas vazias
    $lines = explode("\n", $sqlContent);
    $cleanedLines = [];
    
    foreach ($lines as $line) {
        $line = trim($line);
        // Ignorar linhas vazias e comentários
        if (!empty($line) && !str_starts_with($line, '--') && !str_starts_with($line, '#')) {
            $cleanedLines[] = $line;
        }
    }
    
    $cleanedSQL = implode("\n", $cleanedLines);
    
    // Dividir em statements separados
    $statements = preg_split('/;\s*$/m', $cleanedSQL);
    
    foreach ($statements as $statement) {
        $statement = trim($statement);
        if (empty($statement)) continue;
        
        try {
            $pdo->exec($statement);
            
            // Identificar o tipo de operação para feedback
            if (stripos($statement, 'CREATE DATABASE') !== false) {
                $messages[] = "✅ Base de dados criada com sucesso";
            } elseif (stripos($statement, 'CREATE TABLE') !== false) {
                preg_match('/CREATE TABLE\s+(\w+)/i', $statement, $matches);
                $tableName = $matches[1] ?? 'tabela';
                $messages[] = "✅ Tabela '{$tableName}' criada com sucesso";
            } elseif (stripos($statement, 'INSERT INTO') !== false) {
                preg_match('/INSERT INTO\s+(\w+)/i', $statement, $matches);
                $tableName = $matches[1] ?? 'tabela';
                $messages[] = "✅ Dados inseridos na tabela '{$tableName}' com sucesso";
            } elseif (stripos($statement, 'USE') !== false) {
                $messages[] = "✅ Base de dados selecionada";
            } else {
                $messages[] = "✅ Comando SQL executado com sucesso";
            }
            
        } catch (PDOException $e) {
            $errorMsg = "❌ Erro ao executar: " . substr($statement, 0, 50) . "...";
            $errorMsg .= "\n   Detalhes: " . $e->getMessage();
            $errors[] = $errorMsg;
        }
    }
}

// Verificar se foi submetido o formulário
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        // Verificar se o arquivo database.sql existe
        if (!file_exists('database.sql')) {
            throw new Exception("Ficheiro 'database.sql' não encontrado!");
        }
        
        // Ler o conteúdo do arquivo SQL
        $sqlContent = file_get_contents('database.sql');
        if ($sqlContent === false) {
            throw new Exception("Erro ao ler o ficheiro 'database.sql'!");
        }
        
        $messages[] = "📁 Ficheiro database.sql carregado com sucesso";
        
        // Conectar ao servidor MySQL (sem especificar base de dados)
        $pdo = getInitialConnection();
        $messages[] = "🔌 Ligação ao servidor MySQL estabelecida";
        
        // Executar as queries
        executeSQLFile($pdo, $sqlContent);
        
        // Verificar se as tabelas foram criadas
        try {
            $pdo_db = getDatabaseConnection();
            $result = $pdo_db->query("SHOW TABLES");
            $tables = $result->fetchAll(PDO::FETCH_COLUMN);
            
            if (!empty($tables)) {
                $messages[] = "🔍 Tabelas encontradas: " . implode(', ', $tables);
                
                // Verificar se os utilizadores de demonstração foram criados
                $userCount = $pdo_db->query("SELECT COUNT(*) FROM users")->fetchColumn();
                $messages[] = "👥 Utilizadores na base de dados: {$userCount}";
                
                $success = true;
                $messages[] = "🎉 Instalação concluída com sucesso!";
            }
        } catch (Exception $e) {
            $errors[] = "⚠️ Base de dados criada, mas não foi possível verificar as tabelas: " . $e->getMessage();
        }
        
    } catch (Exception $e) {
        $errors[] = "💥 Erro crítico: " . $e->getMessage();
    }
}

// Verificar se a base de dados já existe
$dbExists = false;
$tablesExist = false;
try {
    $pdo_check = getDatabaseConnection();
    $dbExists = true;
    
    $result = $pdo_check->query("SHOW TABLES");
    $tables = $result->fetchAll(PDO::FETCH_COLUMN);
    $tablesExist = !empty($tables);
    
} catch (Exception $e) {
    // Base de dados não existe ou não é acessível
}
?>

<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Instalador da Base de Dados - Sistema de Registo de Terrenos</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 30px;
            text-align: center;
        }

        .header h1 {
            font-size: 28px;
            margin-bottom: 8px;
        }

        .header p {
            opacity: 0.9;
            font-size: 16px;
        }

        .content {
            padding: 30px;
        }

        .status-section {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
        }

        .status-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid #e9ecef;
        }

        .status-item:last-child {
            border-bottom: none;
        }

        .status-label {
            font-weight: 500;
            color: #495057;
        }

        .status-value {
            font-weight: 600;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 14px;
        }

        .status-success {
            background: #d4edda;
            color: #155724;
        }

        .status-error {
            background: #f8d7da;
            color: #721c24;
        }

        .status-warning {
            background: #fff3cd;
            color: #856404;
        }

        .config-section {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
        }

        .config-section h3 {
            color: #495057;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .config-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-family: monospace;
            font-size: 14px;
        }

        .config-label {
            color: #6c757d;
        }

        .config-value {
            color: #495057;
            font-weight: 600;
        }

        .install-section {
            text-align: center;
            margin-bottom: 30px;
        }

        .btn {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            display: inline-block;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .btn-success {
            background: linear-gradient(135deg, #28a745, #20c997);
        }

        .btn-success:hover {
            box-shadow: 0 8px 25px rgba(40, 167, 69, 0.4);
        }

        .messages {
            margin-top: 30px;
        }

        .message-group {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .message-group h4 {
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .message-list {
            list-style: none;
        }

        .message-list li {
            padding: 8px 0;
            border-bottom: 1px solid #e9ecef;
            font-family: monospace;
            font-size: 14px;
            line-height: 1.5;
            white-space: pre-line;
        }

        .message-list li:last-child {
            border-bottom: none;
        }

        .success-message {
            color: #155724;
        }

        .error-message {
            color: #721c24;
        }

        .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
        }

        .warning-title {
            font-weight: 600;
            color: #856404;
            margin-bottom: 8px;
        }

        .warning-text {
            color: #856404;
            font-size: 14px;
        }

        @media (max-width: 600px) {
            .status-item {
                flex-direction: column;
                align-items: start;
                gap: 8px;
            }

            .config-item {
                flex-direction: column;
                gap: 4px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛠️ Instalador da Base de Dados</h1>
            <p>Sistema de Registo de Terrenos</p>
        </div>

        <div class="content">
            <!-- Status da Instalação -->
            <div class="status-section">
                <h3>📊 Estado da Instalação</h3>
                <div class="status-item">
                    <span class="status-label">Ficheiro database.sql</span>
                    <span class="status-value <?php echo file_exists('database.sql') ? 'status-success' : 'status-error'; ?>">
                        <?php echo file_exists('database.sql') ? '✅ Encontrado' : '❌ Não encontrado'; ?>
                    </span>
                </div>
                <div class="status-item">
                    <span class="status-label">Ligação MySQL</span>
                    <span class="status-value <?php echo $dbExists ? 'status-success' : 'status-error'; ?>">
                        <?php echo $dbExists ? '✅ Conectado' : '❌ Erro de ligação'; ?>
                    </span>
                </div>
                <div class="status-item">
                    <span class="status-label">Base de dados '<?php echo DB_NAME; ?>'</span>
                    <span class="status-value <?php echo $dbExists ? 'status-success' : 'status-warning'; ?>">
                        <?php echo $dbExists ? '✅ Existe' : '⚠️ Não existe'; ?>
                    </span>
                </div>
                <div class="status-item">
                    <span class="status-label">Tabelas da aplicação</span>
                    <span class="status-value <?php echo $tablesExist ? 'status-success' : 'status-warning'; ?>">
                        <?php echo $tablesExist ? '✅ Criadas' : '⚠️ Não criadas'; ?>
                    </span>
                </div>
            </div>

            <!-- Configurações Atuais -->
            <div class="config-section">
                <h3>⚙️ Configurações da Base de Dados</h3>
                <div class="config-item">
                    <span class="config-label">Host:</span>
                    <span class="config-value"><?php echo DB_HOST; ?></span>
                </div>
                <div class="config-item">
                    <span class="config-label">Utilizador:</span>
                    <span class="config-value"><?php echo DB_USER; ?></span>
                </div>
                <div class="config-item">
                    <span class="config-label">Base de Dados:</span>
                    <span class="config-value"><?php echo DB_NAME; ?></span>
                </div>
            </div>

            <?php if ($tablesExist): ?>
                <!-- Base de dados já instalada -->
                <div class="warning">
                    <div class="warning-title">⚠️ Base de Dados Já Instalada</div>
                    <div class="warning-text">
                        A base de dados já existe e contém tabelas. Se continuar, poderá sobrescrever dados existentes.
                    </div>
                </div>
            <?php endif; ?>

            <!-- Botão de Instalação -->
            <div class="install-section">
                <?php if ($success): ?>
                    <a href="index.php" class="btn btn-success">
                        🚀 Ir para a Aplicação
                    </a>
                <?php else: ?>
                    <form method="POST">
                        <button type="submit" class="btn" <?php echo !file_exists('database.sql') ? 'disabled' : ''; ?>>
                            <?php if ($tablesExist): ?>
                                🔄 Reinstalar Base de Dados
                            <?php else: ?>
                                🛠️ Instalar Base de Dados
                            <?php endif; ?>
                        </button>
                    </form>
                <?php endif; ?>
            </div>

            <!-- Mensagens de Resultado -->
            <?php if (!empty($messages) || !empty($errors)): ?>
                <div class="messages">
                    <?php if (!empty($messages)): ?>
                        <div class="message-group">
                            <h4>✅ Operações Realizadas</h4>
                            <ul class="message-list">
                                <?php foreach ($messages as $message): ?>
                                    <li class="success-message"><?php echo htmlspecialchars($message); ?></li>
                                <?php endforeach; ?>
                            </ul>
                        </div>
                    <?php endif; ?>

                    <?php if (!empty($errors)): ?>
                        <div class="message-group">
                            <h4>❌ Erros Encontrados</h4>
                            <ul class="message-list">
                                <?php foreach ($errors as $error): ?>
                                    <li class="error-message"><?php echo htmlspecialchars($error); ?></li>
                                <?php endforeach; ?>
                            </ul>
                        </div>
                    <?php endif; ?>
                </div>
            <?php endif; ?>

            <?php if (!file_exists('database.sql')): ?>
                <div class="warning">
                    <div class="warning-title">📁 Ficheiro database.sql Não Encontrado</div>
                    <div class="warning-text">
                        Certifique-se que o ficheiro 'database.sql' está na mesma pasta que este instalador.
                    </div>
                </div>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>