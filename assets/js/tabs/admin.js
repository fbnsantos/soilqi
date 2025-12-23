/**
 * Admin Tab JavaScript
 * Funções específicas para o painel de administração
 */

// Carregar lista de utilizadores
function loadUsers() {
    const formData = new FormData();
    formData.append('action', 'get_users');

    fetch('?tab=admin', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayUsers(data.users);
        } else {
            showAlert('Erro ao carregar utilizadores.', 'error');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao carregar utilizadores.', 'error');
    });
}

// Exibir utilizadores na tabela
function displayUsers(users) {
    const tbody = document.getElementById('users-tbody');
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Nenhum utilizador encontrado</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td><strong>${user.username}</strong></td>
            <td>${user.email}</td>
            <td>${new Date(user.created_at).toLocaleDateString('pt-PT')}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="viewUser(${user.id})" title="Ver detalhes">
                    👁️
                </button>
            </td>
        </tr>
    `).join('');
}

// Ver detalhes de um utilizador
function viewUser(userId) {
    showAlert('Funcionalidade em desenvolvimento: Ver utilizador #' + userId, 'info');
}

// Exportar dados
function exportData() {
    showAlert('Funcionalidade em desenvolvimento: Exportar dados', 'info');
}

// Ver logs do sistema
function viewLogs() {
    showAlert('Funcionalidade em desenvolvimento: Ver logs', 'info');
}

// Limpar cache
function clearCache() {
    if (confirm('Tem a certeza que quer limpar o cache do sistema?')) {
        showAlert('Funcionalidade em desenvolvimento: Limpar cache', 'info');
    }
}

// Carregar utilizadores quando a página carrega
document.addEventListener('DOMContentLoaded', function() {
    if (activeTab === 'admin') {
        loadUsers();
    }
});