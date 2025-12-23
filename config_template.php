<?php
/**
 * Configurações do Sistema
 * Version 1.3a - Com sistema de roles
 */

// Iniciar sessão
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Configurações da Base de Dados
define('DB_HOST', '{{DB_HOST}}');
define('DB_USER', '{{DB_USER}}');
define('DB_PASS', '{{DB_PASS}}');
define('DB_NAME', '{{DB_NAME}}');

// Configurações da Aplicação
define('SITE_NAME', 'Farm Management Information Systems');
define('SITE_VERSION', '1.0');
define('TIMEZONE', 'Europe/Lisbon');

// Configurar timezone
date_default_timezone_set(TIMEZONE);

// Roles do sistema
define('ROLE_ADMIN', 'admin');
define('ROLE_USER', 'user');
define('DB_TYPE', 'mysql');

/**
 * Função para conectar à base de dados
 */
function getDBConnection() {
    try {
        $pdo = new PDO(
            "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false
            ]
        );
        return $pdo;
    } catch (PDOException $e) {
        die("Erro na ligação à base de dados: " . $e->getMessage());
    }
}

/**
 * Função para verificar se o utilizador está logado
 */
function isLoggedIn() {
    return isset($_SESSION['user_id']) && !empty($_SESSION['user_id']);
}

/**
 * Função para obter dados do utilizador atual
 */
function getCurrentUser() {
    if (!isLoggedIn()) {
        return null;
    }
    
    try {
        $pdo = getDBConnection();
        $stmt = $pdo->prepare("SELECT id, username, email, role, created_at FROM users WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        return $stmt->fetch();
    } catch (PDOException $e) {
        return null;
    }
}

/**
 * Verificar se o utilizador é administrador
 */
function isAdmin() {
    if (!isLoggedIn()) {
        return false;
    }
    
    $user = getCurrentUser();
    return $user && $user['role'] === ROLE_ADMIN;
}

/**
 * Verificar se existe pelo menos um administrador no sistema
 */
function hasAdmin() {
    try {
        $pdo = getDBConnection();
        $stmt = $pdo->query("SELECT COUNT(*) as count FROM users WHERE role = '" . ROLE_ADMIN . "'");
        $result = $stmt->fetch();
        return $result['count'] > 0;
    } catch (PDOException $e) {
        return false;
    }
}

/**
 * Verificar se o utilizador pode reclamar posição de admin
 * (apenas se for o primeiro utilizador e não houver admins)
 */
function canClaimAdmin() {
    if (!isLoggedIn()) {
        return false;
    }
    
    try {
        $pdo = getDBConnection();
        
        // Contar total de utilizadores
        $stmt = $pdo->query("SELECT COUNT(*) as count FROM users");
        $totalUsers = $stmt->fetch()['count'];
        
        // Contar admins
        $stmt = $pdo->query("SELECT COUNT(*) as count FROM users WHERE role = '" . ROLE_ADMIN . "'");
        $totalAdmins = $stmt->fetch()['count'];
        
        // Se há apenas 1 utilizador (o atual) e nenhum admin
        return $totalUsers == 1 && $totalAdmins == 0;
    } catch (PDOException $e) {
        return false;
    }
}

/**
 * Reclamar posição de administrador
 */
function claimAdminRole() {
    if (!isLoggedIn() || !canClaimAdmin()) {
        return false;
    }
    
    try {
        $pdo = getDBConnection();
        $stmt = $pdo->prepare("UPDATE users SET role = ? WHERE id = ?");
        $result = $stmt->execute([ROLE_ADMIN, $_SESSION['user_id']]);
        
        if ($result) {
            setFlashMessage('Parabéns! Tornou-se administrador do sistema.', 'success');
            return true;
        }
        return false;
    } catch (PDOException $e) {
        return false;
    }
}

/**
 * Obter total de utilizadores
 */
function getTotalUsers() {
    try {
        $pdo = getDBConnection();
        $stmt = $pdo->query("SELECT COUNT(*) as count FROM users");
        return $stmt->fetch()['count'];
    } catch (PDOException $e) {
        return 0;
    }
}

/**
 * Verificar se é o primeiro registo
 */
function isFirstUser() {
    return getTotalUsers() === 0;
}

/**
 * Função para redirecionar
 */
function redirect($url) {
    header("Location: $url");
    exit;
}

/**
 * Função para exibir mensagens flash
 */
function showFlashMessage() {
    if (isset($_SESSION['flash_message'])) {
        $message = $_SESSION['flash_message'];
        $type = $_SESSION['flash_type'] ?? 'info';
        unset($_SESSION['flash_message'], $_SESSION['flash_type']);
        
        return [
            'message' => $message,
            'type' => $type
        ];
    }
    return null;
}

/**
 * Função para definir mensagem flash
 */
function setFlashMessage($message, $type = 'info') {
    $_SESSION['flash_message'] = $message;
    $_SESSION['flash_type'] = $type;
}

/**
 * Função para sanitizar input
 */
function sanitizeInput($data) {
    return htmlspecialchars(strip_tags(trim($data)));
}

/**
 * Função para validar email
 */
function isValidEmail($email) {
    return filter_var($email, FILTER_VALIDATE_EMAIL);
}

/**
 * Função para hash de password
 */
function hashPassword($password) {
    return password_hash($password, PASSWORD_DEFAULT);
}

/**
 * Função para verificar password
 */
function verifyPassword($password, $hash) {
    return password_verify($password, $hash);
}

/**
 * Scripts SQL para criar/atualizar as tabelas
 * Executar manualmente no phpMyAdmin ou cliente MySQL
 */
/*
-- Criar base de dados (se não existir)
CREATE DATABASE IF NOT EXISTS terrain_mapper CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE terrain_mapper;

-- Criar tabela de utilizadores
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_role (role)
) ENGINE=InnoDB;

-- Criar tabela de terrenos
CREATE TABLE IF NOT EXISTS terrains (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    coordinates JSON NOT NULL,
    area DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB;

-- Se estiver a atualizar uma base de dados existente, adicionar coluna role:
-- ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user' AFTER password;
-- CREATE INDEX idx_role ON users(role);

-- Opcional: Definir o primeiro utilizador como admin
-- UPDATE users SET role = 'admin' WHERE id = 1 LIMIT 1;
*/
?>