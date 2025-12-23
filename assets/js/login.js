/**
 * Login Page JavaScript
 * Gestão de tabs e validação de formulários
 */

// Alternar entre tabs de login e registo
function switchTab(tabName) {
    // Remover active de todos os tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Ativar tab selecionado
    event.target.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
}

// Limpar mensagens de erro/sucesso quando trocar de tab
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            setTimeout(() => {
                const alerts = document.querySelectorAll('.alert');
                alerts.forEach(alert => {
                    // Manter mensagens de sucesso de criação de conta
                    if (!alert.classList.contains('alert-success') || 
                        !alert.textContent.includes('Conta criada')) {
                        alert.style.display = 'none';
                    }
                });
            }, 100);
        });
    });
});