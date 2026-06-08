<?php
/**
 * tabs/sharing.php — Partilha de Terrenos entre Utilizadores
 * Permite convidar outros utilizadores para aceder a terrenos próprios
 * e aceitar/rejeitar terrenos partilhados por outros.
 */

if (!isset($isLoggedIn))  $isLoggedIn  = false;
if (!isset($currentUser)) $currentUser = null;

$userId = (int)($_SESSION['user_id'] ?? 0);

function _sh_init_table(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS terrain_shares (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        terrain_id   INT NOT NULL,
        owner_id     INT NOT NULL,
        shared_with  INT NOT NULL,
        permission   ENUM('view','edit') NOT NULL DEFAULT 'view',
        status       ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
        message      TEXT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_share (terrain_id, shared_with),
        INDEX idx_sh_owner  (owner_id),
        INDEX idx_sh_shared (shared_with)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// ── AJAX ──────────────────────────────────────────────────────────────────────
if (isset($_POST['action'])) {
    header('Content-Type: application/json');
    $resp = ['success' => false, 'message' => ''];

    if (!$userId) {
        http_response_code(403);
        echo json_encode(['success'=>false,'message'=>'Autenticação necessária.']);
        exit;
    }

    try {
        $pdo = getDBConnection();
        _sh_init_table($pdo);

        switch ($_POST['action']) {

            // ── Enviar convite ────────────────────────────────────────────────
            case 'share_terrain': {
                $tid    = intval($_POST['terrain_id']         ?? 0);
                $target = trim($_POST['username_or_email']    ?? '');
                $perm   = trim($_POST['permission']           ?? 'view');
                $msg    = trim($_POST['message']              ?? '');

                if (!$tid || !$target) {
                    $resp['message'] = 'Terreno e utilizador são obrigatórios.';
                    echo json_encode($resp); exit;
                }
                if (!in_array($perm, ['view','edit'], true)) $perm = 'view';

                // Verificar propriedade do terreno
                $st = $pdo->prepare("SELECT id,name FROM terrains WHERE id=? AND user_id=? LIMIT 1");
                $st->execute([$tid, $userId]);
                $terrain = $st->fetch(PDO::FETCH_ASSOC);
                if (!$terrain) {
                    $resp['message'] = 'Terreno não encontrado ou sem permissão.';
                    echo json_encode($resp); exit;
                }

                // Encontrar utilizador destino
                $st = $pdo->prepare("SELECT id,username FROM users WHERE username=? OR email=? LIMIT 1");
                $st->execute([$target, $target]);
                $targetUser = $st->fetch(PDO::FETCH_ASSOC);
                if (!$targetUser) {
                    $resp['message'] = 'Utilizador não encontrado. Verifique o nome ou email.';
                    echo json_encode($resp); exit;
                }
                if ((int)$targetUser['id'] === $userId) {
                    $resp['message'] = 'Não pode partilhar consigo próprio.';
                    echo json_encode($resp); exit;
                }

                // Criar ou renovar convite
                $st = $pdo->prepare("
                    INSERT INTO terrain_shares (terrain_id, owner_id, shared_with, permission, status, message)
                    VALUES (?, ?, ?, ?, 'pending', ?)
                    ON DUPLICATE KEY UPDATE permission=VALUES(permission),
                        status='pending', message=VALUES(message), updated_at=NOW()
                ");
                $st->execute([$tid, $userId, $targetUser['id'], $perm, $msg]);
                $resp['success'] = true;
                $resp['message'] = "Convite enviado para <b>{$targetUser['username']}</b>.";
                break;
            }

            // ── Minhas partilhas ──────────────────────────────────────────────
            case 'get_my_shares': {
                $st = $pdo->prepare("
                    SELECT s.id, s.terrain_id, s.permission, s.status,
                           DATE_FORMAT(s.created_at,'%d/%m/%Y') AS created_at,
                           t.name AS terrain_name, t.area,
                           u.username AS shared_with_name
                    FROM terrain_shares s
                    JOIN terrains t ON t.id = s.terrain_id
                    JOIN users    u ON u.id = s.shared_with
                    WHERE s.owner_id = ?
                    ORDER BY s.status ASC, s.created_at DESC
                ");
                $st->execute([$userId]);
                $resp['success'] = true;
                $resp['shares']  = $st->fetchAll(PDO::FETCH_ASSOC);
                break;
            }

            // ── Partilhados comigo ────────────────────────────────────────────
            case 'get_shared_with_me': {
                $st = $pdo->prepare("
                    SELECT s.id, s.terrain_id, s.permission, s.status, s.message,
                           DATE_FORMAT(s.created_at,'%d/%m/%Y') AS created_at,
                           t.name AS terrain_name, t.area,
                           u.username AS owner_name
                    FROM terrain_shares s
                    JOIN terrains t ON t.id = s.terrain_id
                    JOIN users    u ON u.id = s.owner_id
                    WHERE s.shared_with = ?
                    ORDER BY s.status ASC, s.created_at DESC
                ");
                $st->execute([$userId]);
                $resp['success'] = true;
                $resp['shares']  = $st->fetchAll(PDO::FETCH_ASSOC);
                break;
            }

            // ── Responder convite ─────────────────────────────────────────────
            case 'respond_share': {
                $sid    = intval($_POST['id']       ?? 0);
                $action = trim($_POST['response']   ?? '');
                if (!in_array($action, ['accepted','rejected'], true)) {
                    $resp['message'] = 'Acção inválida.'; echo json_encode($resp); exit;
                }
                $st = $pdo->prepare("UPDATE terrain_shares SET status=?, updated_at=NOW()
                    WHERE id=? AND shared_with=? AND status='pending'");
                $st->execute([$action, $sid, $userId]);
                $ok = $st->rowCount() > 0;
                $resp['success'] = $ok;
                $resp['message'] = $ok
                    ? ($action === 'accepted' ? '✅ Partilha aceite! O terreno está agora visível no mapa.' : '❌ Convite rejeitado.')
                    : 'Convite não encontrado.';
                break;
            }

            // ── Revogar/apagar partilha (dono) ────────────────────────────────
            case 'revoke_share': {
                $sid = intval($_POST['id'] ?? 0);
                $st  = $pdo->prepare("DELETE FROM terrain_shares WHERE id=? AND owner_id=?");
                $st->execute([$sid, $userId]);
                $resp['success'] = $st->rowCount() > 0;
                $resp['message'] = $resp['success'] ? 'Partilha removida.' : 'Não encontrado.';
                break;
            }

            // ── Abandonar partilha (convidado) ────────────────────────────────
            case 'leave_share': {
                $sid = intval($_POST['id'] ?? 0);
                $st  = $pdo->prepare("DELETE FROM terrain_shares WHERE id=? AND shared_with=?");
                $st->execute([$sid, $userId]);
                $resp['success'] = $st->rowCount() > 0;
                $resp['message'] = $resp['success'] ? 'Deixou de seguir este terreno.' : 'Não encontrado.';
                break;
            }

            // ── Contagem de convites pendentes ────────────────────────────────
            case 'get_pending_count': {
                $st = $pdo->prepare("SELECT COUNT(*) FROM terrain_shares WHERE shared_with=? AND status='pending'");
                $st->execute([$userId]);
                $resp['success'] = true;
                $resp['count']   = (int)$st->fetchColumn();
                break;
            }

            // ── Lista de terrenos do utilizador (para o select) ────────────────
            case 'get_user_terrains': {
                $st = $pdo->prepare("SELECT id, name, area FROM terrains WHERE user_id=? ORDER BY name ASC");
                $st->execute([$userId]);
                $resp['success']  = true;
                $resp['terrains'] = $st->fetchAll(PDO::FETCH_ASSOC);
                break;
            }

            default:
                http_response_code(400); $resp['message'] = 'Acção desconhecida.';
        }

    } catch (Throwable $e) {
        http_response_code(500);
        $resp['message'] = 'Erro interno: ' . $e->getMessage();
    }
    echo json_encode($resp);
    exit;
}

// ── HTML ──────────────────────────────────────────────────────────────────────
if (!$isLoggedIn): ?>
<div style="padding:60px 20px;text-align:center;">
    <p style="color:#6b7280;font-size:16px;">
        Precisa de fazer <a href="login.php" style="color:#667eea;font-weight:600;">login</a>
        para gerir partilhas de terrenos.
    </p>
</div>
<?php return; endif; ?>

<style>
/* ── Sharing tab ──────────────────────────────────────────────────────── */
.sh-card {
    background:#fff; border:1px solid #e5e7eb; border-radius:10px;
    padding:16px 18px; margin-bottom:10px; transition:box-shadow .15s;
}
.sh-card:hover { box-shadow:0 2px 10px rgba(0,0,0,.07); }

.sh-card-header {
    display:flex; align-items:flex-start; gap:10px; margin-bottom:8px;
}
.sh-terrain-icon {
    width:36px; height:36px; border-radius:8px; display:flex; align-items:center;
    justify-content:center; font-size:18px; flex-shrink:0; background:#f0fdf4;
}
.sh-terrain-name  { font-size:14px; font-weight:700; color:#1f2937; line-height:1.3; }
.sh-terrain-sub   { font-size:11px; color:#9ca3af; margin-top:2px; }
.sh-meta          { font-size:11px; color:#6b7280; display:flex; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
.sh-actions       { display:flex; gap:6px; flex-wrap:wrap; }

.sh-badge {
    display:inline-flex; align-items:center; gap:3px; font-size:10px;
    font-weight:700; padding:2px 8px; border-radius:10px; white-space:nowrap;
}
.sh-badge-pending  { background:#fef3c7; color:#92400e; }
.sh-badge-accepted { background:#d1fae5; color:#065f46; }
.sh-badge-rejected { background:#fee2e2; color:#991b1b; }
.sh-badge-view     { background:#eff6ff; color:#1d4ed8; }
.sh-badge-edit     { background:#f3e8ff; color:#6b21a8; }

.sh-empty {
    text-align:center; color:#9ca3af; font-size:13px; padding:28px 16px;
    background:#f9fafb; border-radius:8px; border:1px dashed #e5e7eb;
}

.sh-btn {
    padding:4px 12px; border:none; border-radius:6px; font-size:11px;
    font-weight:600; cursor:pointer; transition:all .15s;
}
.sh-btn-accept  { background:#d1fae5; color:#065f46; }
.sh-btn-accept:hover  { background:#a7f3d0; }
.sh-btn-reject  { background:#fee2e2; color:#991b1b; }
.sh-btn-reject:hover  { background:#fecaca; }
.sh-btn-revoke  { background:#f3f4f6; color:#6b7280; }
.sh-btn-revoke:hover  { background:#e5e7eb; }
.sh-btn-leave   { background:#fef3c7; color:#92400e; }
.sh-btn-leave:hover   { background:#fde68a; }

/* Tabs internas */
.sh-tab-btn { transition:color .15s, border-color .15s; }
.sh-tab-active { color:#667eea !important; border-bottom-color:#667eea !important; }

/* Formulário */
.sh-form-panel {
    background:#f0f9ff; border:1px solid #bae6fd;
    border-radius:10px; padding:16px 18px; margin-bottom:20px;
}
.sh-lbl {
    font-size:11px; font-weight:600; color:#6b7280;
    display:block; margin-bottom:3px; text-transform:uppercase; letter-spacing:.3px;
}
.sh-inp {
    width:100%; padding:7px 9px; border:1px solid #e5e7eb; border-radius:7px;
    font-size:12px; box-sizing:border-box; background:#fff; color:#1f2937;
}
.sh-inp:focus { outline:none; border-color:#667eea; }

/* Banner de convites pendentes */
#sh-pending-banner {
    padding:10px 14px; background:#fef9c3; border:1px solid #fde047;
    border-radius:8px; font-size:12px; color:#713f12; font-weight:600;
    cursor:pointer; margin-bottom:14px; display:none;
}

/* Secção de header */
.sh-section-hdr {
    display:flex; align-items:center; justify-content:space-between;
    margin:0 0 14px; padding-bottom:10px; border-bottom:2px solid #f1f5f9;
}
.sh-section-title { font-size:15px; font-weight:700; color:#1f2937; }
</style>

<div style="max-width:880px; margin:0 auto; padding:16px;">

    <!-- Banner de convites pendentes -->
    <div id="sh-pending-banner" onclick="sharingShowSection('incoming')">
        📩 <span id="sh-pending-text"></span>
    </div>

    <!-- Tabs internas -->
    <div style="display:flex; gap:0; margin-bottom:20px; border-bottom:2px solid #f1f5f9;">
        <button class="sh-tab-btn sh-tab-active" id="sh-tab-btn-outgoing"
                onclick="sharingShowSection('outgoing')"
                style="padding:9px 18px; border:none; border-bottom:2px solid #667eea;
                       font-size:13px; font-weight:600; color:#667eea; background:none;
                       cursor:pointer; margin-bottom:-2px;">
            🌍 Terrenos que partilhei
        </button>
        <button class="sh-tab-btn" id="sh-tab-btn-incoming"
                onclick="sharingShowSection('incoming')"
                style="padding:9px 18px; border:none; border-bottom:2px solid transparent;
                       font-size:13px; font-weight:600; color:#6b7280; background:none;
                       cursor:pointer; margin-bottom:-2px;">
            📩 Partilhados comigo
            <span id="sh-incoming-badge" style="display:none; margin-left:4px;
                  background:#ef4444; color:#fff; font-size:9px; font-weight:800;
                  padding:1px 5px; border-radius:8px; vertical-align:middle;"></span>
        </button>
    </div>

    <!-- ══ SECÇÃO OUTGOING ══ -->
    <div id="sh-section-outgoing">
        <!-- Formulário para nova partilha -->
        <div class="sh-form-panel">
            <div style="font-size:13px; font-weight:700; color:#0369a1; margin-bottom:12px;">
                📤 Partilhar um terreno com outro utilizador
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                    <label class="sh-lbl">Terreno *</label>
                    <select id="sh-terrain-sel" class="sh-inp">
                        <option value="">— Selecione —</option>
                    </select>
                </div>
                <div>
                    <label class="sh-lbl">Permissão</label>
                    <select id="sh-perm-sel" class="sh-inp">
                        <option value="view">👁 Só visualizar</option>
                        <option value="edit">✏️ Visualizar e editar</option>
                    </select>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr auto; gap:8px; align-items:end; margin-bottom:8px;">
                <div>
                    <label class="sh-lbl">Utilizador (nome ou email) *</label>
                    <input type="text" id="sh-user-input" class="sh-inp"
                           placeholder="nome de utilizador ou email@exemplo.com">
                </div>
                <button onclick="sharingShare()"
                        style="padding:7px 18px; background:linear-gradient(135deg,#667eea,#764ba2);
                               color:#fff; border:none; border-radius:7px; font-size:12px;
                               font-weight:600; cursor:pointer; white-space:nowrap;">
                    📤 Enviar convite
                </button>
            </div>
            <div>
                <label class="sh-lbl">Mensagem <span style="font-weight:400;">(opcional)</span></label>
                <input type="text" id="sh-msg-input" class="sh-inp"
                       placeholder="Nota para o destinatário…">
            </div>
            <div id="sh-form-status" style="display:none; margin-top:9px; font-size:11px;
                 border-radius:6px; padding:7px 10px;"></div>
        </div>

        <!-- Lista das minhas partilhas -->
        <div class="sh-section-hdr">
            <span class="sh-section-title">Convites enviados</span>
            <button onclick="sharingLoadMyShares()"
                    style="font-size:10px; padding:3px 9px; background:#f3f4f6; border:none;
                           border-radius:5px; cursor:pointer; color:#6b7280;">⟳ Atualizar</button>
        </div>
        <div id="sh-my-list">
            <div class="sh-empty">A carregar…</div>
        </div>
    </div>

    <!-- ══ SECÇÃO INCOMING ══ -->
    <div id="sh-section-incoming" style="display:none;">
        <div class="sh-section-hdr">
            <span class="sh-section-title">Convites recebidos &amp; terrenos partilhados</span>
            <button onclick="sharingLoadIncoming()"
                    style="font-size:10px; padding:3px 9px; background:#f3f4f6; border:none;
                           border-radius:5px; cursor:pointer; color:#6b7280;">⟳ Atualizar</button>
        </div>
        <div id="sh-incoming-list">
            <div class="sh-empty">A carregar…</div>
        </div>
    </div>

</div>

<script>
document.addEventListener('DOMContentLoaded', function() { sharingInit(); });
</script>
