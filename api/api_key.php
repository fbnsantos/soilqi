<?php
/**
 * api/api_key.php — API Key permanente do utilizador para autenticação PWA
 * GET  → retorna (ou cria) a chave permanente
 * POST action=regenerate → gera nova chave (revoga a anterior)
 *
 * Requer sessão autenticada (cookie de sessão).
 */

session_start();
require_once __DIR__ . '/../config.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if (empty($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Não autenticado.']);
    exit;
}

$userId = (int)$_SESSION['user_id'];

try {
    $pdo = getDBConnection();

    // Garantir tabela api_tokens (idempotente)
    $pdo->exec("CREATE TABLE IF NOT EXISTS api_tokens (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        user_id      INT NOT NULL,
        token        VARCHAR(128) NOT NULL UNIQUE,
        device_name  VARCHAR(100) NOT NULL DEFAULT 'device',
        expires_at   DATETIME NOT NULL,
        last_used_at DATETIME NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_at_token (token),
        INDEX idx_at_user  (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $regenerate = ($_SERVER['REQUEST_METHOD'] === 'POST');

    if ($regenerate) {
        // Revogar chave permanente existente
        $pdo->prepare("DELETE FROM api_tokens WHERE user_id = ? AND device_name = 'permanent'")
            ->execute([$userId]);
    }

    // Buscar chave permanente existente
    $st = $pdo->prepare("SELECT token, created_at FROM api_tokens
                         WHERE user_id = ? AND device_name = 'permanent' LIMIT 1");
    $st->execute([$userId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        // Criar nova chave permanente (válida até 2099)
        $token   = bin2hex(random_bytes(32));   // 64 caracteres hex
        $expires = '2099-12-31 23:59:59';
        $pdo->prepare("INSERT INTO api_tokens (user_id, token, device_name, expires_at) VALUES (?, ?, 'permanent', ?)")
            ->execute([$userId, $token, $expires]);
        $row = ['token' => $token, 'created_at' => date('Y-m-d H:i:s')];
    }

    echo json_encode([
        'success'    => true,
        'key'        => $row['token'],
        'created_at' => $row['created_at'],
        'hint'       => 'Cole esta chave na app móvel SoilQI Field para autenticar sem login.',
    ]);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Erro: ' . $e->getMessage()]);
}
