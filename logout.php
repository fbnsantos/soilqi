<?php
require_once 'config.php';

// Verificar se está logado
if (!isLoggedIn()) {
    redirect('login.php');
}

// Limpar todas as variáveis de sessão
$_SESSION = array();

// Destruir o cookie de sessão se existir
if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000,
        $params["path"], $params["domain"],
        $params["secure"], $params["httponly"]
    );
}

// Destruir a sessão
session_destroy();

// Definir mensagem flash para mostrar na página de login
session_start();
setFlashMessage('Logout realizado com sucesso!', 'success');

// Redirecionar para a página de login
redirect('login.php');
?>