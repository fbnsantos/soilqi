<?php
require_once 'config.php';

// Utilizadores a promover a admin
$adminUsers = ['admin', 'fbnsantos'];

try {
    $pdo = getDBConnection();

    $results = [];
    foreach ($adminUsers as $username) {
        $stmt = $pdo->prepare("SELECT id, username, role FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        if (!$user) {
            $results[] = ['user' => $username, 'status' => 'not_found', 'msg' => 'Utilizador não encontrado'];
            continue;
        }

        if ($user['role'] === 'admin') {
            $results[] = ['user' => $username, 'status' => 'already', 'msg' => 'Já era admin'];
            continue;
        }

        $upd = $pdo->prepare("UPDATE users SET role = 'admin' WHERE username = ?");
        $upd->execute([$username]);
        $results[] = ['user' => $username, 'status' => 'ok', 'msg' => 'Promovido a admin'];
    }

} catch (PDOException $e) {
    die('<p style="color:red">Erro na base de dados: ' . htmlspecialchars($e->getMessage()) . '</p>');
}
?>
<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <title>Definir Admins</title>
    <style>
        body { font-family: sans-serif; max-width: 500px; margin: 60px auto; padding: 0 20px; }
        h2   { margin-bottom: 20px; }
        .row { display:flex; align-items:center; gap:12px; padding:12px 16px;
               border-radius:8px; margin-bottom:10px; font-size:15px; }
        .ok      { background:#d1fae5; color:#065f46; }
        .already { background:#dbeafe; color:#1e40af; }
        .not_found { background:#fee2e2; color:#991b1b; }
        .icon { font-size:22px; }
        .note { margin-top:24px; font-size:13px; color:#6b7280;
                border:1px solid #e5e7eb; border-radius:8px; padding:12px; }
        .note strong { color:#dc2626; }
    </style>
</head>
<body>
    <h2>🔑 Definição de Administradores</h2>

    <?php foreach ($results as $r): ?>
        <?php
        $icons = ['ok' => '✅', 'already' => 'ℹ️', 'not_found' => '❌'];
        $icon  = $icons[$r['status']] ?? '❓';
        ?>
        <div class="row <?php echo $r['status']; ?>">
            <span class="icon"><?php echo $icon; ?></span>
            <div>
                <strong><?php echo htmlspecialchars($r['user']); ?></strong><br>
                <small><?php echo $r['msg']; ?></small>
            </div>
        </div>
    <?php endforeach; ?>

    <div class="note">
        <strong>⚠️ Apaga este ficheiro após usar.</strong><br>
        Deixar este ficheiro no servidor permite a qualquer pessoa promover contas a admin.
    </div>

    <p style="margin-top:20px">
        <a href="index.php?tab=admin">→ Ir para o painel de admin</a>
    </p>
</body>
</html>
