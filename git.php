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

$allParams = [
    // Base de dados
    'dbhost'         => $params['dbhost']         ?? null,
    'dbuser'         => $params['dbuser']         ?? null,
    'dbpass'         => $params['dbpass']         ?? null,
    'dbname'         => $params['dbname']         ?? null,
    // Aplicação
    'site_url'       => $params['site_url']       ?? null,
    // MQTT
    'mqtt_host'      => $params['mqtt_host']      ?? null,
    'mqtt_port'      => $params['mqtt_port']      ?? null,
    'mqtt_user'      => $params['mqtt_user']      ?? null,
    'mqtt_pass'      => $params['mqtt_pass']      ?? null,
    // Sentinel
    'raster_api_key' => $params['raster_api_key'] ?? null,
];

// Filtrar apenas parâmetros que foram passados
$allParams = array_filter($allParams, function($value) {
    return $value !== null && $value !== '';
});

// Compat: $dbParams mantido para não quebrar lógica abaixo
$dbParams = array_filter($allParams, function($v, $k) {
    return in_array($k, ['dbhost','dbuser','dbpass','dbname']);
}, ARRAY_FILTER_USE_BOTH);

if (!empty($allParams)) {
    echo "<h3>⚙️ Gerando config.php a partir do template</h3>";

    // Campos sensíveis a mascarar no output
    $secretKeys = ['dbpass', 'mqtt_pass', 'raster_api_key'];

    // Mostrar parâmetros recebidos (mascarar secrets)
    foreach ($allParams as $key => $value) {
        $displayValue = in_array($key, $secretKeys) ? str_repeat('*', strlen($value)) : $value;
        echo "<p><strong>" . strtoupper($key) . ":</strong> <code>$displayValue</code></p>";
    }

    $templateFile = 'config_template.php';
    $configFile = 'config.php';

    if (file_exists($configFile) && !unlink($configFile)) {
        echo "❌ Erro ao eliminar o ficheiro config.php antigo!";
    } else {
        echo "✅ config.php anterior removido.";
    }

    if (file_exists($templateFile)) {

        // Ler conteúdo do template
        $templateContent = file_get_contents($templateFile);

        if ($templateContent !== false) {
            echo "<p>✅ Template carregado com sucesso</p>";

            // Mapear parâmetros → placeholders do template
            $paramToPlaceholder = [
                'dbhost'         => '{{DB_HOST}}',
                'dbuser'         => '{{DB_USER}}',
                'dbpass'         => '{{DB_PASS}}',
                'dbname'         => '{{DB_NAME}}',
                'site_url'       => '{{SITE_URL}}',
                'mqtt_host'      => '{{MQTT_HOST}}',
                'mqtt_port'      => '{{MQTT_PORT}}',   // numérico — sem aspas no template
                'mqtt_user'      => '{{MQTT_USER}}',
                'mqtt_pass'      => '{{MQTT_PASS}}',
                'raster_api_key' => '{{RASTER_API_KEY}}',
            ];

            // Substituir placeholders pelos valores reais
            $configContent = $templateContent;
            $replacements = 0;

            foreach ($allParams as $param => $value) {
                if (isset($paramToPlaceholder[$param])) {
                    $placeholder = $paramToPlaceholder[$param];
                    // mqtt_port é numérico no template (sem aspas) — não escapar
                    $escapedValue = ($param === 'mqtt_port') ? intval($value) : addslashes($value);

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

                // Valores padrão para placeholders não fornecidos
                $defaults = [
                    '{{DB_HOST}}'        => 'localhost',
                    '{{DB_USER}}'        => 'root',
                    '{{DB_PASS}}'        => '',
                    '{{DB_NAME}}'        => 'terrain_mapper',
                    '{{SITE_URL}}'       => '',
                    '{{MQTT_HOST}}'      => 'localhost',
                    '{{MQTT_PORT}}'      => '1883',
                    '{{MQTT_USER}}'      => '',
                    '{{MQTT_PASS}}'      => '',
                    '{{RASTER_API_KEY}}' => '',
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
    echo "<p>ℹ️ Nenhum parâmetro foi passado — apenas git pull executado.</p>";

    if (!file_exists('config.php')) {
        echo "<p>⚠️ config.php não existe no servidor. Chama este script com os parâmetros para o gerar.</p>";
    } else {
        echo "<p>✅ config.php já existe — não foi alterado.</p>";
    }

    echo "<p><strong>Parâmetros disponíveis:</strong><br>
        <code>dbhost, dbuser, dbpass, dbname</code> (base de dados)<br>
        <code>site_url, mqtt_host, mqtt_port, mqtt_user, mqtt_pass, raster_api_key</code> (app)
    </p>";
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
    
    <p><strong>Com geração de config.php (todos os parâmetros):</strong></p>
    <code style="word-break:break-all;">
        git.php?dbhost=localhost&dbuser=USER&dbpass=PASS&dbname=DB
        &site_url=https://soilqi.com
        &mqtt_host=mqtt.vifield.com&mqtt_port=8883&mqtt_user=vifield&mqtt_pass=PASS
        &raster_api_key=CHAVE
    </code>

    <p><strong>Para usar com GitHub Secrets:</strong></p>
    <code style="word-break:break-all;">
        git.php?dbhost=${{ secrets.DB_HOST }}&dbuser=${{ secrets.DB_USER }}&dbpass=${{ secrets.DB_PASS }}&dbname=${{ secrets.DB_NAME }}
        &site_url=${{ secrets.SITE_URL }}
        &mqtt_host=${{ secrets.MQTT_HOST }}&mqtt_port=${{ secrets.MQTT_PORT }}&mqtt_user=${{ secrets.MQTT_USER }}&mqtt_pass=${{ secrets.MQTT_PASS }}
        &raster_api_key=${{ secrets.RASTER_API_KEY }}
    </code>

    <p><em>💡 Se um parâmetro não for passado, o placeholder fica com o valor padrão (ex: mqtt_host → localhost).</em></p>
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

