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
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Nenhum utilizador encontrado</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => {
        const roleLabel = user.role === 'admin' 
            ? '<span class="badge badge-admin">👑 Admin</span>' 
            : '<span class="badge badge-user">👤 Utilizador</span>';
        
        return `
        <tr>
            <td>${user.id}</td>
            <td><strong>${user.username}</strong></td>
            <td>${user.email}</td>
            <td>${roleLabel}</td>
            <td>${new Date(user.created_at).toLocaleDateString('pt-PT')}</td>
            <td>
                <button class="btn btn-secondary btn-sm" 
                        onclick="toggleAdmin(${user.id}, '${user.username}')" 
                        title="Alterar permissões">
                    ${user.role === 'admin' ? '👤' : '👑'}
                </button>
                <button class="btn btn-danger btn-sm" 
                        onclick="deleteUser(${user.id}, '${user.username}')" 
                        title="Eliminar">
                    🗑️
                </button>
            </td>
        </tr>
    `}).join('');
}

// Alternar permissões de admin
function toggleAdmin(userId, username) {
    if (!confirm(`Deseja alterar as permissões de "${username}"?`)) {
        return;
    }

    const formData = new FormData();
    formData.append('action', 'toggle_admin');
    formData.append('user_id', userId);

    fetch('?tab=admin', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showAlert(data.message, 'success');
            loadUsers(); // Recarregar lista
        } else {
            showAlert(data.message, 'error');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao alterar permissões.', 'error');
    });
}

// Eliminar utilizador
function deleteUser(userId, username) {
    if (!confirm(`Tem a certeza que quer eliminar o utilizador "${username}"?\n\nEsta ação não pode ser desfeita e todos os terrenos deste utilizador serão eliminados.`)) {
        return;
    }

    const formData = new FormData();
    formData.append('action', 'delete_user');
    formData.append('user_id', userId);

    fetch('?tab=admin', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showAlert(data.message, 'success');
            loadUsers(); // Recarregar lista
        } else {
            showAlert(data.message, 'error');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao eliminar utilizador.', 'error');
    });
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

// =====================================================
// CONSOLE SQL
// =====================================================

// Executar query SQL
function executeSQL() {
    const query = document.getElementById('sql-query').value.trim();
    
    if (!query) {
        showAlert('Por favor, insira uma query SQL.', 'error');
        return;
    }
    
    // Confirmação para queries perigosas
    const dangerousKeywords = ['DROP', 'TRUNCATE', 'DELETE', 'UPDATE', 'ALTER', 'CREATE'];
    const queryUpper = query.toUpperCase();
    const isDangerous = dangerousKeywords.some(keyword => queryUpper.includes(keyword));
    
    if (isDangerous) {
        if (!confirm('⚠️ AVISO: Esta query pode modificar ou eliminar dados.\n\nTem a certeza que quer continuar?\n\nQuery: ' + query.substring(0, 100))) {
            return;
        }
    }
    
    const formData = new FormData();
    formData.append('action', 'execute_sql');
    formData.append('sql', query);

    // Mostrar loading
    document.getElementById('sql-results').style.display = 'block';
    document.getElementById('sql-results-content').innerHTML = '<div style="text-align: center; padding: 20px;">⏳ Executando query...</div>';

    fetch('?tab=admin', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        displaySQLResults(data);
    })
    .catch(error => {
        console.error('Erro:', error);
        document.getElementById('sql-results-content').innerHTML = 
            '<div class="sql-error"><strong>Erro de conexão:</strong> ' + error.message + '</div>';
    });
}

// Exibir resultados SQL
function displaySQLResults(data) {
    const resultsDiv = document.getElementById('sql-results-content');
    
    if (!data.success) {
        resultsDiv.innerHTML = `
            <div class="sql-error">
                <strong>❌ Erro:</strong> ${data.message}
                ${data.error_code ? '<br><small>Código de erro: ' + data.error_code + '</small>' : ''}
            </div>
        `;
        return;
    }
    
    let html = '<div class="sql-success"><strong>✅ Sucesso:</strong> ' + data.message + '</div>';
    
    // Se é SELECT (retorna resultados)
    if (data.type === 'select' && data.results) {
        html += '<div class="sql-info">📊 Linhas retornadas: ' + data.row_count + '</div>';
        
        if (data.results.length > 0) {
            html += '<table class="sql-results-table">';
            
            // Cabeçalho
            html += '<thead><tr>';
            data.columns.forEach(col => {
                html += '<th>' + escapeHtml(col) + '</th>';
            });
            html += '</tr></thead>';
            
            // Dados
            html += '<tbody>';
            data.results.forEach(row => {
                html += '<tr>';
                data.columns.forEach(col => {
                    const value = row[col];
                    html += '<td>' + (value !== null ? escapeHtml(String(value)) : '<em style="color: #999;">NULL</em>') + '</td>';
                });
                html += '</tr>';
            });
            html += '</tbody>';
            
            html += '</table>';
        } else {
            html += '<div class="sql-info">ℹ️ Nenhum resultado encontrado.</div>';
        }
    }
    // Se é INSERT, UPDATE, DELETE (modifica dados)
    else if (data.type === 'modify') {
        html += '<div class="sql-info">📝 Linhas afetadas: ' + data.affected_rows + '</div>';
        
        if (data.last_insert_id) {
            html += '<div class="sql-info">🆔 ID inserido: ' + data.last_insert_id + '</div>';
        }
    }
    
    resultsDiv.innerHTML = html;
    
    // Scroll suave para os resultados
    document.getElementById('sql-results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Escapar HTML para prevenir XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Limpar editor SQL
function clearSQLEditor() {
    document.getElementById('sql-query').value = '';
    document.getElementById('sql-results').style.display = 'none';
}

// Inserir query pré-definida
function insertPresetQuery(query) {
    document.getElementById('sql-query').value = query;
    document.getElementById('sql-query').focus();
}

// Carregar lista de tabelas
function loadTablesList() {
    const formData = new FormData();
    formData.append('action', 'get_tables_list');

    fetch('?tab=admin', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            let tablesText = '-- Tabelas disponíveis:\n';
            tablesText += data.tables.map(table => '-- • ' + table).join('\n');
            tablesText += '\n\nSELECT * FROM ';
            
            document.getElementById('sql-query').value = tablesText;
            showAlert('Lista de tabelas carregada!', 'success');
        } else {
            showAlert(data.message, 'error');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao carregar tabelas.', 'error');
    });
}

// Mostrar estrutura de uma tabela
function showTableStructure() {
    const tableName = prompt('Digite o nome da tabela para ver a estrutura:\n(ex: users, terrains)');
    
    if (!tableName) {
        return;
    }
    
    const formData = new FormData();
    formData.append('action', 'get_table_structure');
    formData.append('table_name', tableName);

    fetch('?tab=admin', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            let structureText = '-- Estrutura da tabela: ' + tableName + '\n';
            structureText += '-- ' + '='.repeat(50) + '\n';
            
            data.structure.forEach(col => {
                structureText += '-- ' + col.Field + ': ' + col.Type;
                if (col.Key === 'PRI') structureText += ' [PRIMARY KEY]';
                if (col.Null === 'NO') structureText += ' [NOT NULL]';
                if (col.Default) structureText += ' [DEFAULT: ' + col.Default + ']';
                structureText += '\n';
            });
            
            structureText += '\nDESCRIBE ' + tableName + ';';
            
            document.getElementById('sql-query').value = structureText;
            showAlert('Estrutura da tabela "' + tableName + '" carregada!', 'success');
        } else {
            showAlert(data.message, 'error');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao carregar estrutura da tabela.', 'error');
    });
}

// =====================================================
// MIGRAÇÕES DE BASE DE DADOS
// =====================================================

function loadMigrations() {
    const container = document.getElementById('migrations-list');
    if (!container) return;
    container.innerHTML = '<div class="text-center" style="padding:20px;color:#6b7280;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_migrations');

    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) displayMigrations(data.migrations);
            else container.innerHTML = `<div class="sql-error">❌ ${data.message}</div>`;
        })
        .catch(() => {
            container.innerHTML = '<div class="sql-error">❌ Erro ao carregar migrações.</div>';
        });
}

function displayMigrations(migrations) {
    const container = document.getElementById('migrations-list');

    if (!migrations || migrations.length === 0) {
        container.innerHTML = `
            <div class="sql-info">
                ℹ️ Nenhum ficheiro <code>.sql</code> encontrado na pasta <code>migrations/</code>.<br>
                <small style="color:#6b7280">Crie ficheiros como <code>001_nome.sql</code> nessa pasta para os ver aqui.</small>
            </div>`;
        return;
    }

    const allApplied = migrations.every(m => m.applied);
    const pendingCount = migrations.filter(m => !m.applied).length;

    const summary = allApplied
        ? `<div class="sql-success" style="margin-bottom:12px">✅ Todas as migrações estão aplicadas.</div>`
        : `<div class="warning-box" style="margin-bottom:12px">
               ⚠️ <strong>${pendingCount}</strong> migração(ões) por aplicar.
           </div>`;

    const rows = migrations.map(m => {
        const badge = m.applied
            ? '<span class="badge badge-admin">✅ Aplicada</span>'
            : '<span class="badge badge-user">⏳ Pendente</span>';
        const when = m.applied_at
            ? new Date(m.applied_at).toLocaleString('pt-PT')
            : '—';
        const action = m.applied
            ? '<span style="color:#9ca3af;font-size:12px">Já aplicada</span>'
            : `<button class="btn btn-primary btn-sm" onclick="runMigration('${escapeHtml(m.filename)}')">▶️ Aplicar</button>`;

        return `<tr>
            <td><code style="font-size:13px">${escapeHtml(m.filename)}</code></td>
            <td>${badge}</td>
            <td style="font-size:12px;color:#6b7280">${when}</td>
            <td>${action}</td>
        </tr>`;
    }).join('');

    container.innerHTML = summary + `
        <div class="data-table">
            <table>
                <thead>
                    <tr>
                        <th>Ficheiro</th>
                        <th>Estado</th>
                        <th>Aplicada em</th>
                        <th>Ação</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function runMigration(filename) {
    if (!confirm(`Aplicar a migração "${filename}"?\n\nEsta operação modifica a base de dados.`)) return;

    // Feedback visual no botão
    const btns = document.querySelectorAll(`[onclick="runMigration('${filename}')"]`);
    btns.forEach(b => { b.disabled = true; b.textContent = '⏳ A aplicar…'; });

    const fd = new FormData();
    fd.append('action', 'run_migration');
    fd.append('filename', filename);

    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showAlert(`✅ ${data.message}`, 'success');
                loadMigrations();
            } else {
                showAlert(`❌ ${data.message}`, 'error');
                btns.forEach(b => { b.disabled = false; b.innerHTML = '▶️ Aplicar'; });
            }
        })
        .catch(() => {
            showAlert('❌ Erro de ligação ao aplicar a migração.', 'error');
            btns.forEach(b => { b.disabled = false; b.innerHTML = '▶️ Aplicar'; });
        });
}

// =====================================================
// DIAGNÓSTICO MQTT
// =====================================================

function runMqttDiagnostics() {
    const el = document.getElementById('mqtt-diag-result');
    if (!el) return;
    el.innerHTML = '<div style="padding:12px;color:#6b7280;">⏳ A executar diagnósticos…</div>';

    const fd = new FormData();
    fd.append('action', 'mqtt_diagnostics');

    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                el.innerHTML = `<div class="sql-error">❌ ${escapeHtml(data.message || 'Erro desconhecido')}</div>`;
                return;
            }
            displayMqttDiagnostics(data.diagnostics);
        })
        .catch(() => {
            el.innerHTML = '<div class="sql-error">❌ Erro de rede ao executar diagnósticos.</div>';
        });
}

function displayMqttDiagnostics(tests) {
    const el = document.getElementById('mqtt-diag-result');
    const allOk = tests.every(t => t.ok);

    const rows = tests.map(t => `
        <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">
                ${t.ok ? '✅' : '❌'} <strong>${escapeHtml(t.test)}</strong>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;
                       color:${t.ok ? '#166534' : '#991b1b'};font-size:13px;">
                ${escapeHtml(t.detail)}
            </td>
        </tr>`).join('');

    const summary = allOk
        ? `<div class="sql-success" style="margin-bottom:12px">
               ✅ Todos os testes passaram — o PHP consegue ligar ao broker MQTT.
           </div>`
        : `<div class="sql-error" style="margin-bottom:12px">
               ❌ Alguns testes falharam — verifique os detalhes abaixo.
           </div>`;

    el.innerHTML = summary + `
        <div class="data-table">
            <table>
                <thead>
                    <tr>
                        <th>Teste</th>
                        <th>Detalhe</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// Carregar utilizadores quando a página carrega
document.addEventListener('DOMContentLoaded', function() {
    if (activeTab === 'admin') {
        loadUsers();
        loadMigrations();
        
        // Atalhos de teclado para o SQL editor
        const sqlQuery = document.getElementById('sql-query');
        if (sqlQuery) {
            sqlQuery.addEventListener('keydown', function(e) {
                // Ctrl + Enter ou Cmd + Enter para executar
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    executeSQL();
                }
                
                // Tab para identação
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
                    this.selectionStart = this.selectionEnd = start + 4;
                }
            });
        }
    }
});