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
    echo '<div class="section">';
    echo '<div class="warning-box">';
    echo '<strong>⚠️ Acesso Negado</strong><br>';
    echo 'Apenas administradores podem aceder a esta página.';
    echo '</div>';
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