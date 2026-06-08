'use strict';
/**
 * assets/js/tabs/sharing.js — Lógica da tab Partilha de Terrenos
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function _shFetch(fd, cb) {
    fetch('index.php?tab=sharing', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(cb)
        .catch(() => cb({ success: false, message: 'Erro de rede.' }));
}

function _shEsc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                          .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _shStatus(msg, type) {
    const el = document.getElementById('sh-form-status');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = type === 'success' ? '#d1fae5' : type === 'warning' ? '#fef3c7' : '#fee2e2';
    el.style.color      = type === 'success' ? '#065f46' : type === 'warning' ? '#92400e' : '#991b1b';
    el.innerHTML = msg;
    if (type === 'success') setTimeout(() => { if (el) el.style.display = 'none'; }, 4000);
}

const SH_PERM_LABEL = {
    view: '<span class="sh-badge sh-badge-view">👁 Visualizar</span>',
    edit: '<span class="sh-badge sh-badge-edit">✏️ Editar</span>',
};
const SH_STATUS_LABEL = {
    pending:  '<span class="sh-badge sh-badge-pending">⏳ Pendente</span>',
    accepted: '<span class="sh-badge sh-badge-accepted">✅ Aceite</span>',
    rejected: '<span class="sh-badge sh-badge-rejected">❌ Rejeitado</span>',
};

// ── Inicialização ─────────────────────────────────────────────────────────────

function sharingInit() {
    sharingLoadTerrains();
    sharingLoadMyShares();
    sharingCheckPending();
}

function sharingLoadTerrains() {
    const fd = new FormData();
    fd.append('action', 'get_user_terrains');
    _shFetch(fd, data => {
        const sel = document.getElementById('sh-terrain-sel');
        if (!sel) return;
        sel.innerHTML = '<option value="">— Selecione um terreno —</option>';
        (data.terrains || []).forEach(t => {
            const area = t.area ? ` (${parseFloat(t.area).toFixed(1)} ha)` : '';
            const opt  = document.createElement('option');
            opt.value       = t.id;
            opt.textContent = t.name + area;
            sel.appendChild(opt);
        });
    });
}

// ── Secções (tabs internas) ───────────────────────────────────────────────────

function sharingShowSection(name) {
    document.getElementById('sh-section-outgoing').style.display = name === 'outgoing' ? '' : 'none';
    document.getElementById('sh-section-incoming').style.display = name === 'incoming' ? '' : 'none';

    document.getElementById('sh-tab-btn-outgoing').classList.toggle('sh-tab-active', name === 'outgoing');
    document.getElementById('sh-tab-btn-incoming').classList.toggle('sh-tab-active', name === 'incoming');

    const sBtnO = document.getElementById('sh-tab-btn-outgoing');
    const sBtnI = document.getElementById('sh-tab-btn-incoming');
    sBtnO.style.borderBottomColor = name === 'outgoing' ? '#667eea' : 'transparent';
    sBtnO.style.color             = name === 'outgoing' ? '#667eea' : '#6b7280';
    sBtnI.style.borderBottomColor = name === 'incoming' ? '#667eea' : 'transparent';
    sBtnI.style.color             = name === 'incoming' ? '#667eea' : '#6b7280';

    if (name === 'incoming') sharingLoadIncoming();
}

// ── Enviar convite ────────────────────────────────────────────────────────────

function sharingShare() {
    const tid    = document.getElementById('sh-terrain-sel')?.value;
    const target = document.getElementById('sh-user-input')?.value?.trim();
    const perm   = document.getElementById('sh-perm-sel')?.value;
    const msg    = document.getElementById('sh-msg-input')?.value?.trim();

    if (!tid)    { _shStatus('Selecione um terreno.', 'error'); return; }
    if (!target) { _shStatus('Indique o nome ou email do utilizador.', 'error'); return; }

    const btn = document.querySelector('button[onclick="sharingShare()"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }

    const fd = new FormData();
    fd.append('action',             'share_terrain');
    fd.append('terrain_id',         tid);
    fd.append('username_or_email',  target);
    fd.append('permission',         perm || 'view');
    fd.append('message',            msg  || '');

    _shFetch(fd, data => {
        if (btn) { btn.disabled = false; btn.textContent = '📤 Enviar convite'; }
        _shStatus(data.message || (data.success ? 'Convite enviado.' : 'Erro.'),
                  data.success ? 'success' : 'error');
        if (data.success) {
            document.getElementById('sh-user-input').value  = '';
            document.getElementById('sh-msg-input').value   = '';
            sharingLoadMyShares();
        }
    });
}

// ── Minhas partilhas (outgoing) ───────────────────────────────────────────────

function sharingLoadMyShares() {
    const el = document.getElementById('sh-my-list');
    if (!el) return;
    el.innerHTML = '<div class="sh-empty" style="padding:14px;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_my_shares');
    _shFetch(fd, data => {
        const items = data.shares || [];
        if (!items.length) {
            el.innerHTML = '<div class="sh-empty">Ainda não partilhou nenhum terreno.<br>Use o formulário acima para convidar um utilizador.</div>';
            return;
        }
        // Agrupar por terreno
        const byTerrain = {};
        items.forEach(s => {
            if (!byTerrain[s.terrain_id]) {
                byTerrain[s.terrain_id] = { name: s.terrain_name, area: s.area, shares: [] };
            }
            byTerrain[s.terrain_id].shares.push(s);
        });

        el.innerHTML = Object.values(byTerrain).map(group => {
            const area = group.area ? `${parseFloat(group.area).toFixed(1)} ha` : '';
            const rows = group.shares.map(s => `
            <div style="display:flex; align-items:center; gap:8px; padding:7px 10px;
                        background:#f8fafc; border-radius:6px; margin-top:5px; flex-wrap:wrap;">
                <span style="font-size:13px; flex-shrink:0;">👤</span>
                <span style="flex:1; font-size:12px; font-weight:600; color:#374151; min-width:80px;">
                    ${_shEsc(s.shared_with_name)}
                </span>
                ${SH_PERM_LABEL[s.permission] || ''}
                ${SH_STATUS_LABEL[s.status]   || ''}
                <span style="font-size:10px; color:#9ca3af;">${s.created_at}</span>
                <button class="sh-btn sh-btn-revoke"
                        onclick="sharingRevoke(${s.id})" title="Remover partilha">🗑 Remover</button>
            </div>`).join('');

            return `<div class="sh-card">
                <div class="sh-card-header">
                    <div class="sh-terrain-icon">🏡</div>
                    <div>
                        <div class="sh-terrain-name">${_shEsc(group.name)}</div>
                        <div class="sh-terrain-sub">${area}</div>
                    </div>
                </div>
                ${rows}
            </div>`;
        }).join('');
    });
}

function sharingRevoke(id) {
    if (!confirm('Remover esta partilha? O utilizador deixará de ter acesso ao terreno.')) return;
    const fd = new FormData();
    fd.append('action', 'revoke_share');
    fd.append('id', id);
    _shFetch(fd, data => {
        if (data.success) sharingLoadMyShares();
        else alert(data.message || 'Erro ao remover.');
    });
}

// ── Partilhados comigo (incoming) ─────────────────────────────────────────────

function sharingLoadIncoming() {
    const el = document.getElementById('sh-incoming-list');
    if (!el) return;
    el.innerHTML = '<div class="sh-empty" style="padding:14px;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_shared_with_me');
    _shFetch(fd, data => {
        const items = data.shares || [];

        // Actualizar badge
        const pending = items.filter(s => s.status === 'pending').length;
        _sharingSetBadge(pending);

        if (!items.length) {
            el.innerHTML = '<div class="sh-empty">Nenhum terreno foi partilhado consigo.<br>Quando alguém o convidar, verá aqui o convite para aceitar ou rejeitar.</div>';
            return;
        }

        el.innerHTML = items.map(s => {
            const area = s.area ? `${parseFloat(s.area).toFixed(1)} ha` : '';
            const msgBlock = s.message ? `<div style="font-size:11px;color:#6b7280;
                background:#f9fafb;border-radius:5px;padding:5px 8px;margin:6px 0;
                font-style:italic;">"${_shEsc(s.message)}"</div>` : '';
            const actions = s.status === 'pending'
                ? `<button class="sh-btn sh-btn-accept" onclick="sharingRespond(${s.id},'accepted')">✅ Aceitar</button>
                   <button class="sh-btn sh-btn-reject" onclick="sharingRespond(${s.id},'rejected')">❌ Rejeitar</button>`
                : s.status === 'accepted'
                ? `<button class="sh-btn sh-btn-leave"  onclick="sharingLeave(${s.id})">🚪 Abandonar</button>`
                : `<span style="font-size:10px;color:#9ca3af;">Convite rejeitado</span>`;

            return `<div class="sh-card">
                <div class="sh-card-header">
                    <div class="sh-terrain-icon">${s.status === 'accepted' ? '🌍' : '📩'}</div>
                    <div>
                        <div class="sh-terrain-name">${_shEsc(s.terrain_name)}</div>
                        <div class="sh-terrain-sub">
                            Partilhado por <strong>${_shEsc(s.owner_name)}</strong>
                            ${area ? ' · ' + area : ''} · ${s.created_at}
                        </div>
                    </div>
                </div>
                <div class="sh-meta">
                    ${SH_PERM_LABEL[s.permission] || ''}
                    ${SH_STATUS_LABEL[s.status]   || ''}
                </div>
                ${msgBlock}
                <div class="sh-actions">${actions}</div>
            </div>`;
        }).join('');
    });
}

function sharingRespond(id, action) {
    const fd = new FormData();
    fd.append('action',   'respond_share');
    fd.append('id',       id);
    fd.append('response', action);
    _shFetch(fd, data => {
        const el = document.getElementById('sh-incoming-list');
        const banner = document.createElement('div');
        banner.style.cssText = `padding:9px 12px; margin-bottom:10px; border-radius:7px; font-size:12px;
            font-weight:600; background:${data.success && action==='accepted' ? '#d1fae5' : '#fee2e2'};
            color:${data.success && action==='accepted' ? '#065f46' : '#991b1b'};`;
        banner.innerHTML = data.message || (data.success ? 'OK' : 'Erro');
        if (el) el.prepend(banner);
        setTimeout(() => banner.remove(), 4000);
        sharingLoadIncoming();
        sharingCheckPending();
    });
}

function sharingLeave(id) {
    if (!confirm('Deixar de seguir este terreno partilhado?')) return;
    const fd = new FormData();
    fd.append('action', 'leave_share');
    fd.append('id', id);
    _shFetch(fd, data => {
        if (data.success) sharingLoadIncoming();
        else alert(data.message || 'Erro.');
    });
}

// ── Verificar convites pendentes ──────────────────────────────────────────────

function sharingCheckPending() {
    const fd = new FormData();
    fd.append('action', 'get_pending_count');
    _shFetch(fd, data => {
        const n = data.count || 0;
        _sharingSetBadge(n);
        const banner = document.getElementById('sh-pending-banner');
        const text   = document.getElementById('sh-pending-text');
        if (banner && text) {
            if (n > 0) {
                text.textContent = n === 1 ? 'Tem 1 convite de partilha pendente' : `Tem ${n} convites de partilha pendentes`;
                banner.style.display = 'block';
            } else {
                banner.style.display = 'none';
            }
        }
    });
}

function _sharingSetBadge(n) {
    const badge = document.getElementById('sh-incoming-badge');
    if (!badge) return;
    if (n > 0) {
        badge.textContent    = n;
        badge.style.display  = 'inline';
    } else {
        badge.style.display = 'none';
    }
    // Actualizar também o badge do nav (global)
    const navBadge = document.getElementById('sharing-nav-badge');
    if (navBadge) {
        navBadge.textContent   = n > 0 ? n : '';
        navBadge.style.display = n > 0 ? 'inline' : 'none';
    }
}
