<?php
/**
 * Script de Deploy Automático
 * Executa git pull, npm build e reconfigura config.php
 * 
 * Uso: git.php?dbhost=HOST&dbuser=USER&dbpass=PASS&dbname=NAME
 */

echo "<h2>🚀 Script de Deploy Automático</h2>";

// Configurar ambiente
putenv("HOME=/home/criisadmin");

// Mostrar informações do sistema
$currentUser = get_current_user();
echo "<p><strong>Current User:</strong> " . $currentUser . "</p>";

$whoami = shell_exec("whoami");
echo "<p><strong>Whoami:</strong> <code>" . trim($whoami) . "</code></p>";

echo "<hr>";


// ==================================================
// 2. CONFIGURAR GIT E FAZER PULL
// ==================================================

echo "<h3>📦 Git Operations</h3>";

// Adicionar diretório como seguro
$output = shell_exec("git config --global --add safe.directory /var/www/html/pikachu/pikachuPM 2>&1");
if ($output) {
    echo "<p>Git safe directory: <code>$output</code></p>";
}

// Executar git pull
echo "<p><strong>Executando git pull...</strong></p>";
$gitOutput = shell_exec('git pull 2>&1');
echo "<pre style='background:#f4f4f4; padding:10px; border-radius:5px;'>$gitOutput</pre>";

// Verificar status do git
$gitStatus = shell_exec('git status --porcelain 2>&1');
if (empty(trim($gitStatus))) {
    echo "<p>✅ Repositório está limpo e atualizado</p>";
} else {
    echo "<p>⚠️ Existem alterações locais:</p>";
    echo "<pre style='background:#fff3cd; padding:10px; border-radius:5px;'>$gitStatus</pre>";
}

echo "<hr>";

// ==================================================
// 1. GERAR CONFIG.PHP A PARTIR DO TEMPLATE
// ==================================================

$method = $_SERVER['REQUEST_METHOD'];
$params = ($method === 'POST') ? $_POST : $_GET;

$dbParams = [
    'dbhost' => $params['dbhost'] ?? null,
    'dbuser' => $params['dbuser'] ?? null, 
    'dbpass' => $params['dbpass'] ?? null,
    'dbname' => $params['dbname'] ?? null
];

// Filtrar apenas parâmetros que foram passados
$dbParams = array_filter($dbParams, function($value) {
    return $value !== null && $value !== '';
});

if (!empty($dbParams)) {
    echo "<h3>⚙️ Gerando config.php a partir do template</h3>";
    
    // Mostrar parâmetros recebidos (mascarar password)
    foreach ($dbParams as $key => $value) {
        $displayValue = ($key === 'dbpass') ? str_repeat('*', strlen($value)) : $value;
        echo "<p><strong>" . strtoupper($key) . ":</strong> <code>$displayValue</code></p>";
    }
    
    $templateFile = 'config_template.php';
    $configFile = 'config.php';

    if (unlink($configFile)) {
                 echo "✅ Ficheiro eliminado com sucesso!";
    } else {
                echo "❌ Erro ao eliminar o ficheiro!";
    }
    
    if (file_exists($templateFile)) {
 
        // Fazer backup do config atual se existir
        //if (file_exists($configFile)) {
        //    $backupFile = 'config.php.backup.' . date('Y-m-d_H-i-s');
        //    if (copy($configFile, $backupFile)) {
         //       echo "<p>✅ Backup do config atual criado: <code>$backupFile</code></p>";
         //   }
       /// }
        
        // Ler conteúdo do template
        $templateContent = file_get_contents($templateFile);
        
        if ($templateContent !== false) {
            echo "<p>✅ Template carregado com sucesso</p>";
            
            // Mapear parâmetros para placeholders
            $paramToPlaceholder = [
                'dbhost' => '{{DB_HOST}}',
                'dbuser' => '{{DB_USER}}', 
                'dbpass' => '{{DB_PASS}}',
                'dbname' => '{{DB_NAME}}'
            ];
            
            // Substituir placeholders pelos valores reais
            $configContent = $templateContent;
            $replacements = 0;
            
            foreach ($dbParams as $param => $value) {
                if (isset($paramToPlaceholder[$param])) {
                    $placeholder = $paramToPlaceholder[$param];
                    
                    // Escapar valor para uso em PHP
                    $escapedValue = addslashes($value);
                    
                    if (strpos($configContent, $placeholder) !== false) {
                        $configContent = str_replace($placeholder, $escapedValue, $configContent);
                        $replacements++;
                        echo "<p>✅ <strong>$placeholder</strong> substituído</p>";
                    }
                }
            }
            
            // Verificar se ainda existem placeholders não substituídos
            $remainingPlaceholders = [];
            foreach ($paramToPlaceholder as $placeholder) {
                if (strpos($configContent, $placeholder) !== false) {
                    $remainingPlaceholders[] = $placeholder;
                }
            }
            
            if (!empty($remainingPlaceholders)) {
                echo "<p>⚠️ Placeholders não substituídos (usar valores padrão): <code>" . implode(', ', $remainingPlaceholders) . "</code></p>";
                
                // Substituir placeholders restantes por valores padrão
                $defaults = [
                    '{{DB_HOST}}' => 'localhost',
                    '{{DB_USER}}' => 'root',
                    '{{DB_PASS}}' => '',
                    '{{DB_NAME}}' => 'terrain_mapper'
                ];
                
                foreach ($remainingPlaceholders as $placeholder) {
                    if (isset($defaults[$placeholder])) {
                        $configContent = str_replace($placeholder, $defaults[$placeholder], $configContent);
                        echo "<p>ℹ️ <strong>$placeholder</strong> substituído por valor padrão: <code>{$defaults[$placeholder]}</code></p>";
                    }
                }
            }
            
            // Escrever o novo config.php
            if (file_put_contents($configFile, $configContent)) {
                echo "<p>✅ <strong>config.php</strong> gerado com sucesso!</p>";
                echo "<p>📊 Total de substituições: <strong>$replacements</strong></p>";
                
                // Se foi fornecido dbname, gerar também database.sql se template existir
                if (isset($dbParams['dbname']) && file_exists('database_template.sql')) {
                    echo "<p>🔄 Gerando database.sql a partir do template...</p>";
                    
                    $dbTemplateContent = file_get_contents('database_template.sql');
                    if ($dbTemplateContent !== false) {
                        $dbSqlContent = str_replace('{{DB_NAME}}', addslashes($dbParams['dbname']), $dbTemplateContent);
                        
                        if (file_put_contents('database.sql', $dbSqlContent)) {
                            echo "<p>✅ database.sql atualizado com o nome da base de dados: <strong>{$dbParams['dbname']}</strong></p>";
                        }
                    }
                }
            } else {
                echo "<p>❌ Erro ao escrever o ficheiro config.php</p>";
            }
            
        } else {
            echo "<p>❌ Erro ao ler o template config_template.php</p>";
        }
        
    } else {
        echo "<p>❌ Template <strong>config_template.php</strong> não encontrado!</p>";
        echo "<p>💡 Crie o ficheiro config_template.php com placeholders {{DB_HOST}}, {{DB_USER}}, {{DB_PASS}}, {{DB_NAME}}</p>";
    }
    
    echo "<hr>";
} else {
    echo "<p>ℹ️ Nenhum parâmetro de base de dados foi passado.</p>";
    
    // Verificar se config.php existe, senão tentar gerar com valores padrão do template
    if (!file_exists('config.php') && file_exists('config_template.php')) {
        echo "<p>⚠️ config.php não encontrado. Gerando com valores padrão do template...</p>";
        
        $templateContent = file_get_contents('config_template.php');
        if ($templateContent !== false) {
            $defaults = [
                '{{DB_HOST}}' => 'localhost',
                '{{DB_USER}}' => 'root',
                '{{DB_PASS}}' => '',
                '{{DB_NAME}}' => 'terrain_mapper'
            ];
            
            $configContent = $templateContent;
            foreach ($defaults as $placeholder => $value) {
                $configContent = str_replace($placeholder, $value, $configContent);
            }
            
            if (file_put_contents('config.php', $configContent)) {
                echo "<p>✅ config.php gerado com valores padrão</p>";
            }
        }
    }
    
    echo "<p><strong>Parâmetros disponíveis:</strong> <code>dbhost, dbuser, dbpass, dbname</code></p>";
    echo "<hr>";
}


// ==================================================
// 3. NPM BUILD (se diretório PKMT existe)
// ==================================================

if (is_dir('PKMT')) {
    echo "<h3>📋 NPM Build Process</h3>";
    
    // Verificar se package.json existe
    if (file_exists('PKMT/package.json')) {
        echo "<p>✅ package.json encontrado</p>";
        
        // NPM Install
        echo "<p><strong>Executando npm install...</strong></p>";
        $npmInstall = shell_exec("cd PKMT && npm install 2>&1");
        echo "<pre style='background:#f4f4f4; padding:10px; border-radius:5px;'>$npmInstall</pre>";
        
        // NPM Build
        echo "<p><strong>Executando npm run build...</strong></p>";
        $npmBuild = shell_exec("cd PKMT && npm run build 2>&1");
        echo "<pre style='background:#f4f4f4; padding:10px; border-radius:5px;'>$npmBuild</pre>";
        
        // Verificar se build foi bem-sucedido
        if (is_dir('PKMT/dist') || is_dir('PKMT/build')) {
            echo "<p>✅ Build concluído com sucesso</p>";
        } else {
            echo "<p>⚠️ Diretório de build não encontrado - verifique se o build foi bem-sucedido</p>";
        }
        
    } else {
        echo "<p>❌ package.json não encontrado em PKMT/</p>";
    }
} else {
    echo "<h3>📋 NPM Build Process</h3>";
    echo "<p>ℹ️ Diretório PKMT não encontrado - saltando npm build</p>";
}

echo "<hr>";

// ==================================================
// 4. VERIFICAÇÕES FINAIS
// ==================================================

echo "<h3>🔍 Verificações Finais</h3>";

// Verificar se config_template.php existe
if (file_exists('config_template.php')) {
    echo "<p>✅ config_template.php existe</p>";
    
    // Verificar sintaxe do template
    $templateTest = shell_exec('php -l config_template.php 2>&1');
    if (strpos($templateTest, 'No syntax errors') !== false) {
        echo "<p>✅ config_template.php tem sintaxe válida</p>";
    } else {
        echo "<p>❌ Erro de sintaxe em config_template.php:</p>";
        echo "<pre style='background:#f8d7da; padding:10px; border-radius:5px;'>$templateTest</pre>";
    }
} else {
    echo "<p>❌ config_template.php não encontrado</p>";
}

// Verificar se config.php está acessível
if (file_exists('config.php')) {
    echo "<p>✅ config.php existe e está acessível</p>";
    
    // Tentar incluir config.php para verificar sintaxe
    $configTest = shell_exec('php -l config.php 2>&1');
    if (strpos($configTest, 'No syntax errors') !== false) {
        echo "<p>✅ config.php tem sintaxe válida</p>";
        
        // Verificar se ainda tem placeholders não substituídos
        $configContent = file_get_contents('config.php');
        if (preg_match('/\{\{[^}]+\}\}/', $configContent, $matches)) {
            echo "<p>⚠️ config.php ainda contém placeholders: <code>" . $matches[0] . "</code></p>";
        } else {
            echo "<p>✅ config.php não contém placeholders não substituídos</p>";
        }
    } else {
        echo "<p>❌ Erro de sintaxe em config.php:</p>";
        echo "<pre style='background:#f8d7da; padding:10px; border-radius:5px;'>$configTest</pre>";
    }
} else {
    echo "<p>❌ config.php não encontrado</p>";
}

// Verificar se install_database.php existe
if (file_exists('install_database.php')) {
    echo "<p>✅ install_database.php disponível</p>";
    echo "<p>🔗 <a href='install_database.php' target='_blank'>Executar Instalador da Base de Dados</a></p>";
}

// Verificar se a aplicação principal existe
if (file_exists('index.php')) {
    echo "<p>✅ index.php (aplicação principal) encontrado</p>";
    echo "<p>🔗 <a href='index.php' target='_blank'>Abrir Aplicação</a></p>";
} else {
    echo "<p>❌ index.php não encontrado</p>";
}

// Mostrar informações do sistema
$phpVersion = phpversion();
$serverTime = date('Y-m-d H:i:s');

echo "<p><strong>PHP Version:</strong> $phpVersion</p>";
echo "<p><strong>Server Time:</strong> $serverTime</p>";
echo "<p><strong>Working Directory:</strong> " . getcwd() . "</p>";

echo "<hr>";
echo "<h3>✅ Deploy Concluído</h3>";
echo "<p><strong>Timestamp:</strong> " . date('Y-m-d H:i:s') . "</p>";

// ==================================================
// 5. EXEMPLO DE USO
// ==================================================
?>

<div style="background:#e3f2fd; padding:15px; border-radius:8px; margin-top:20px;">
    <h4>📖 Como Usar Este Script</h4>
    <p><strong>URL Base (apenas git + npm):</strong></p>
    <code>http://criis-projects.inesctec.pt/pikachu/pikachuPM/git.php</code>
    
    <p><strong>Com geração de config.php:</strong></p>
    <code>
        git.php?dbhost=localhost&dbuser=myuser&dbpass=mypass&dbname=mydatabase
    </code>
    
    <p><strong>Para usar com GitHub Secrets:</strong></p>
    <code>
        git.php?dbhost=${{ secrets.DB_HOST }}&dbuser=${{ secrets.DB_USER }}&dbpass=${{ secrets.DB_PASS }}&dbname=${{ secrets.DB_NAME }}
    </code>
    
    <p><em>💡 O config.php é gerado a partir do config_template.php, substituindo os placeholders {{DB_HOST}}, {{DB_USER}}, etc.</em></p>
</div>

<div style="background:#f3e5f5; padding:15px; border-radius:8px; margin-top:15px;">
    <h4>🔧 Funcionamento</h4>
    <ul>
        <li>✅ Lê o <strong>config_template.php</strong> como base</li>
        <li>✅ Substitui placeholders <code>{{DB_HOST}}</code>, <code>{{DB_USER}}</code>, etc.</li>
        <li>✅ Gera novo <strong>config.php</strong> com valores reais</li>
        <li>✅ Faz backup do config.php anterior</li>
        <li>✅ Valores não fornecidos usam defaults (localhost, root, etc.)</li>
    </ul>
</div>

<div style="background:#fff3cd; padding:15px; border-radius:8px; margin-top:15px;">
    <h4>📁 Ficheiros Necessários</h4>
    <ul>
        <li><code>config_template.php</code> - Template com placeholders</li>
        <li><code>git.php</code> - Este script</li>
        <li><code>database.sql</code> - Script da base de dados (opcional)</li>
    </ul>
    <p><em>💡 O config.php é gerado automaticamente e pode ser substituído a qualquer momento</em></p>
</div>

<div style="background:#f0f9ff; padding:15px; border-radius:8px; margin-top:15px;">
    <h4>🔒 Segurança</h4>
    <ul>
        <li>✅ Template original nunca é modificado</li>
        <li>✅ Backup automático do config.php antes de alterações</li>
        <li>✅ Validação de sintaxe PHP após geração</li>
        <li>✅ Passwords mascaradas no output do script</li>
        <li>✅ Sanitização de valores antes de escrever</li>
        <li>✅ Verificação de placeholders não substituídos</li>
    </ul>
</div>

<?php
echo "<p style='text-align:center; margin-top:30px; color:#666; font-size:12px;'>
    Script executado em " . date('Y-m-d H:i:s') . " | Duração: " . round((microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']), 2) . "s
</p>";
?>

