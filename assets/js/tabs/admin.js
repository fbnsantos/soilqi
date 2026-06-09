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
            // Carregar secções ao iniciar
            loadAdminParams();
            loadLandingEditor();

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

// ══════════════════════════════════════════════════════════════════════════════
// Parâmetros de Campo (Admin)
// ══════════════════════════════════════════════════════════════════════════════

function loadAdminParams() {
    const el = document.getElementById('admin-params-list');
    if (!el) return;
    el.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:10px 0;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_all_parameters');
    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const params = data.parameters || [];
            if (data.hint) {
                el.innerHTML = `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px;font-size:13px;color:#92400e;">⚠️ ${data.hint}</div>`;
                return;
            }
            if (params.length === 0) {
                el.innerHTML = '<div style="color:#9ca3af;font-size:13px;">Nenhum parâmetro ainda. Execute a migração 007.</div>';
                return;
            }
            el.innerHTML = '<table style="width:100%;font-size:13px;border-collapse:collapse;">' +
                '<thead><tr>' +
                ['ID','Nome','Unidade','Descrição','Âmbito','Utilizador','Ações'].map(h =>
                    `<th style="text-align:left;padding:8px 10px;background:#f9fafb;color:#374151;font-size:12px;border-bottom:2px solid #e5e7eb;">${h}</th>`
                ).join('') +
                '</tr></thead><tbody>' +
                params.map(p => {
                    const scopeBadge = p.scope === 'global'
                        ? '<span style="background:#dbeafe;color:#1e40af;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">global</span>'
                        : '<span style="background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">pessoal</span>';
                    return `<tr style="border-bottom:1px solid #f3f4f6;">
                        <td style="padding:8px 10px;color:#9ca3af;">${p.id}</td>
                        <td style="padding:8px 10px;font-weight:700;">${escHtmlAdmin(p.name)}</td>
                        <td style="padding:8px 10px;color:#6b7280;">${escHtmlAdmin(p.unit || '—')}</td>
                        <td style="padding:8px 10px;color:#6b7280;">${escHtmlAdmin(p.description || '—')}</td>
                        <td style="padding:8px 10px;">${scopeBadge}</td>
                        <td style="padding:8px 10px;color:#6b7280;">${escHtmlAdmin(p.username || '—')}</td>
                        <td style="padding:8px 10px;">
                            <button class="btn btn-secondary btn-sm" style="color:#ef4444;"
                                    onclick="deleteAdminParam(${p.id}, '${escHtmlAdmin(p.name)}')">🗑️</button>
                        </td>
                    </tr>`;
                }).join('') +
                '</tbody></table>';
        })
        .catch(() => { el.innerHTML = '<div style="color:#ef4444;font-size:13px;">Erro ao carregar.</div>'; });
}

function showAddParamModal() {
    const existing = document.getElementById('add-param-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'add-param-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:24px;width:min(440px,95vw);box-shadow:0 20px 60px rgba(0,0,0,.3);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h3 style="font-size:17px;color:#1f2937;">🧪 Novo Parâmetro Global</h3>
                <button onclick="this.closest('#add-param-modal').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;">✕</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;">
                <div>
                    <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:4px;font-weight:600;">Nome *</label>
                    <input id="ap-name" type="text" placeholder="ex: nitrogénio" style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:4px;font-weight:600;">Unidade</label>
                    <input id="ap-unit" type="text" placeholder="ex: mg/kg" style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:4px;font-weight:600;">Descrição</label>
                    <input id="ap-desc" type="text" placeholder="ex: Teor de azoto no solo" style="width:100%;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;">
                </div>
            </div>
            <div style="display:flex;gap:10px;">
                <button class="btn btn-primary" style="flex:1;" onclick="submitAddParam()">💾 Criar</button>
                <button class="btn btn-secondary" onclick="this.closest('#add-param-modal').remove()">Cancelar</button>
            </div>
            <div id="ap-status" style="margin-top:10px;font-size:13px;"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => { const n = document.getElementById('ap-name'); if (n) n.focus(); }, 80);
}

function submitAddParam() {
    const name = (document.getElementById('ap-name').value || '').trim();
    const unit = (document.getElementById('ap-unit').value || '').trim();
    const desc = (document.getElementById('ap-desc').value || '').trim();
    const statusEl = document.getElementById('ap-status');
    if (!name) { statusEl.innerHTML = '<span style="color:#ef4444;">Nome obrigatório.</span>'; return; }

    const fd = new FormData();
    fd.append('action',     'add_global_parameter');
    fd.append('param_name', name);
    fd.append('param_unit', unit);
    fd.append('param_desc', desc);
    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                document.getElementById('add-param-modal').remove();
                loadAdminParams();
            } else {
                statusEl.innerHTML = `<span style="color:#ef4444;">${escHtmlAdmin(data.message || 'Erro')}</span>`;
            }
        })
        .catch(() => { statusEl.innerHTML = '<span style="color:#ef4444;">Erro de rede.</span>'; });
}

function deleteAdminParam(id, name) {
    if (!confirm(`Eliminar o parâmetro "${name}"?\nIsto afecta todos os utilizadores que o usem.`)) return;
    const fd = new FormData();
    fd.append('action',   'delete_parameter');
    fd.append('param_id', id);
    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) loadAdminParams();
            else alert('Erro: ' + (data.message || 'desconhecido'));
        })
        .catch(() => alert('Erro de rede.'));
}

// ══════════════════════════════════════════════════════════════════════════════
// Landing Page Editor
// ══════════════════════════════════════════════════════════════════════════════

let _landingLang    = 'pt';
let _landingContent = { pt: {}, en: {} };
let _landingVideos  = [];

function loadLandingEditor() {
    const fd = new FormData();
    fd.append('action', 'get_landing_content');
    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) return;
            _landingContent = data.content || { pt: {}, en: {} };
            _landingVideos  = data.videos  || [];
            renderLandingFields();
            renderLandingVideos();
        })
        .catch(() => {});
}

function setLandingLang(lang) {
    _landingLang = lang;
    document.getElementById('lp-btn-pt').style.fontWeight = lang === 'pt' ? '700' : '400';
    document.getElementById('lp-btn-en').style.fontWeight = lang === 'en' ? '700' : '400';
    renderLandingFields();
    updateLpPreview();
}

function switchLpTab(tab) {
    const editor  = document.getElementById('lp-body');
    const preview = document.getElementById('lp-preview');
    const btnEdit = document.getElementById('lp-tab-edit');
    const btnPrev = document.getElementById('lp-tab-preview');
    if (!editor || !preview) return;
    if (tab === 'preview') {
        updateLpPreview();
        editor.style.display  = 'none';
        preview.style.display = 'block';
        btnEdit.style.fontWeight = '400';
        btnPrev.style.fontWeight = '700';
    } else {
        editor.style.display  = 'block';
        preview.style.display = 'none';
        btnEdit.style.fontWeight = '700';
        btnPrev.style.fontWeight = '400';
        editor.focus();
    }
}

function updateLpPreview() {
    const body    = document.getElementById('lp-body')?.value || '';
    const preview = document.getElementById('lp-preview');
    if (!preview) return;
    if (typeof marked !== 'undefined') {
        preview.innerHTML = marked.parse(body);
    } else {
        preview.textContent = body;
    }
}

function renderLandingFields() {
    const c = _landingContent[_landingLang] || {};
    const title    = document.getElementById('lp-title');
    const subtitle = document.getElementById('lp-subtitle');
    const body     = document.getElementById('lp-body');
    if (title)    title.value    = c.title    || '';
    if (subtitle) subtitle.value = c.subtitle || '';
    if (body)     body.value     = c.body     || '';
}

function saveLandingContent() {
    const title    = (document.getElementById('lp-title')?.value    || '').trim();
    const subtitle = (document.getElementById('lp-subtitle')?.value || '').trim();
    const body     = (document.getElementById('lp-body')?.value     || '');
    const statusEl = document.getElementById('lp-save-status');
    const btn      = document.getElementById('lp-save-btn');

    btn.disabled = true;
    statusEl.textContent = 'A guardar…';

    const fields = { title, subtitle, body };
    const saves  = Object.entries(fields).map(([key, val]) => {
        const fd = new FormData();
        fd.append('action',        'save_landing_content');
        fd.append('lang',          _landingLang);
        fd.append('content_key',   key);
        fd.append('content_value', val);
        return fetch('?tab=admin', { method: 'POST', body: fd }).then(r => r.json());
    });

    Promise.all(saves)
        .then(results => {
            const ok = results.every(r => r.success);
            statusEl.style.color = ok ? '#16a34a' : '#ef4444';
            statusEl.textContent = ok ? '✅ Guardado!' : '❌ Erro ao guardar';
            if (ok) {
                _landingContent[_landingLang] = { title, subtitle, body };
                setTimeout(() => { statusEl.textContent = ''; }, 3000);
            }
        })
        .catch(() => { statusEl.style.color = '#ef4444'; statusEl.textContent = '❌ Erro de rede'; })
        .finally(() => { btn.disabled = false; });
}

function renderLandingVideos() {
    const el = document.getElementById('lp-videos-list');
    if (!el) return;
    if (_landingVideos.length === 0) {
        el.innerHTML = '<div style="color:#9ca3af;font-size:13px;">Nenhum vídeo adicionado.</div>';
        return;
    }
    el.innerHTML = _landingVideos.map((v, idx) => `
        <div style="display:flex;align-items:center;gap:10px;background:#f9fafb;border-radius:8px;padding:8px 12px;border:1px solid #e5e7eb;">
            <img src="https://img.youtube.com/vi/${escHtmlAdmin(v.youtube_id)}/default.jpg"
                 style="width:60px;height:45px;object-fit:cover;border-radius:5px;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${escHtmlAdmin(v.title || v.youtube_id)}
                </div>
                <div style="font-size:11px;color:#9ca3af;font-family:monospace;">${escHtmlAdmin(v.youtube_id)}</div>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
                ${idx > 0 ? `<button class="btn btn-secondary btn-sm" onclick="moveLandingVideo(${v.id},-1)" title="Mover para cima">↑</button>` : '<span style="width:28px;"></span>'}
                ${idx < _landingVideos.length - 1 ? `<button class="btn btn-secondary btn-sm" onclick="moveLandingVideo(${v.id},1)" title="Mover para baixo">↓</button>` : '<span style="width:28px;"></span>'}
                <button class="btn btn-secondary btn-sm" style="color:#ef4444;" onclick="deleteLandingVideo(${v.id})" title="Remover">🗑️</button>
            </div>
        </div>`
    ).join('');
}

function addLandingVideo() {
    const ytId  = (document.getElementById('lp-yt-id')?.value    || '').trim();
    const title = (document.getElementById('lp-yt-title')?.value || '').trim();
    if (!ytId) { alert('Introduza o URL ou ID do vídeo.'); return; }

    const fd = new FormData();
    fd.append('action',     'add_landing_video');
    fd.append('youtube_id', ytId);
    fd.append('video_title', title);
    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                document.getElementById('lp-yt-id').value    = '';
                document.getElementById('lp-yt-title').value = '';
                loadLandingEditor();
            } else {
                alert('Erro: ' + (data.message || 'desconhecido'));
            }
        })
        .catch(() => alert('Erro de rede.'));
}

function deleteLandingVideo(id) {
    if (!confirm('Remover este vídeo da página de entrada?')) return;
    const fd = new FormData();
    fd.append('action',   'delete_landing_video');
    fd.append('video_id', id);
    fetch('?tab=admin', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(() => loadLandingEditor())
        .catch(() => {});
}

function moveLandingVideo(id, dir) {
    const idx = _landingVideos.findIndex(v => v.id == id);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= _landingVideos.length) return;

    // swap sort_order values
    const a = _landingVideos[idx];
    const b = _landingVideos[swapIdx];

    Promise.all([
        fetch('?tab=admin', { method:'POST', body: (() => { const f=new FormData(); f.append('action','reorder_landing_video'); f.append('video_id', a.id); f.append('sort_order', b.sort_order); return f; })() }).then(r=>r.json()),
        fetch('?tab=admin', { method:'POST', body: (() => { const f=new FormData(); f.append('action','reorder_landing_video'); f.append('video_id', b.id); f.append('sort_order', a.sort_order); return f; })() }).then(r=>r.json()),
    ]).then(() => loadLandingEditor()).catch(() => {});
}

function escHtmlAdmin(s) {
    return String(s || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}