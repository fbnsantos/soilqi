<?php
session_start();

//version 1.2

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

// Função para conectar à base de dados
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

// Função para verificar se o utilizador está logado
function isLoggedIn() {
    return isset($_SESSION['user_id']) && !empty($_SESSION['user_id']);
}

// Função para obter dados do utilizador atual
function getCurrentUser() {
    if (!isLoggedIn()) {
        return null;
    }
    
    try {
        $pdo = getDBConnection();
        $stmt = $pdo->prepare("SELECT id, username, email, created_at FROM users WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        return $stmt->fetch();
    } catch (PDOException $e) {
        return null;
    }
}

// Função para redirecionar
function redirect($url) {
    header("Location: $url");
    exit;
}

// Função para exibir mensagens flash
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

// Função para definir mensagem flash
function setFlashMessage($message, $type = 'info') {
    $_SESSION['flash_message'] = $message;
    $_SESSION['flash_type'] = $type;
}

// Função para sanitizar input
function sanitizeInput($data) {
    return htmlspecialchars(strip_tags(trim($data)));
}

// Função para validar email
function isValidEmail($email) {
    return filter_var($email, FILTER_VALIDATE_EMAIL);
}

// Função para hash de password
function hashPassword($password) {
    return password_hash($password, PASSWORD_DEFAULT);
}

// Função para verificar password
function verifyPassword($password, $hash) {
    return password_verify($password, $hash);
}

// Scripts SQL para criar as tabelas (executar manualmente no phpMyAdmin ou cliente MySQL)
/*
CREATE DATABASE IF NOT EXISTS terrain_mapper CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE terrain_mapper;

CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE terrains (
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
*/
?>