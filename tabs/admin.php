<?php
/**
 * Tab: Administração
 * Painel de administração do sistema
 */

// Este ficheiro é incluído pelo index.php
// Variáveis disponíveis: $isLoggedIn, $currentUser, $activeTab

// Verificar permissões de administrador
// TODO: Implementar sistema de permissões no futuro
// Por agora, qualquer utilizador logado pode aceder

// API endpoints para operações de administração
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isLoggedIn) {
    header('Content-Type: application/json');
    
    $action = $_POST['action'] ?? '';
    $response = ['success' => false, 'message' => ''];
    
    try {
        $pdo = getDBConnection();
        
        switch ($action) {
            case 'get_users':
                $stmt = $pdo->query("SELECT id, username, email, created_at FROM users ORDER BY created_at DESC");
                $users = $stmt->fetchAll();
                
                $response['success'] = true;
                $response['users'] = $users;
                break;
                
            case 'get_system_stats':
                // Total de utilizadores
                $stmt = $pdo->query("SELECT COUNT(*) as total FROM users");
                $totalUsers = $stmt->fetch()['total'];
                
                // Total de terrenos
                $stmt = $pdo->query("SELECT COUNT(*) as total FROM terrains");
                $totalTerrains = $stmt->fetch()['total'];
                
                // Área total
                $stmt = $pdo->query("SELECT COALESCE(SUM(area), 0) as total FROM terrains");
                $totalArea = $stmt->fetch()['total'];
                
                $response['success'] = true;
                $response['stats'] = [
                    'users' => $totalUsers,
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
    'terrains' => 0,
    'area' => 0
];

try {
    $pdo = getDBConnection();
    
    // Total de utilizadores
    $stmt = $pdo->query("SELECT COUNT(*) as total FROM users");
    $systemStats['users'] = $stmt->fetch()['total'];
    
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
                        <th>Data de Registo</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody id="users-tbody">
                    <tr>
                        <td colspan="5" class="text-center">A carregar...</td>
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
</style>