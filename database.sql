-- Script SQL para configurar a base de dados do Sistema de Registo de Terrenos
-- Execute este script no phpMyAdmin ou cliente MySQL

-- Criar base de dados
CREATE DATABASE IF NOT EXISTS wkfzkqte_soiqi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE wkfzkqte_soiqi;

-- Tabela de utilizadores
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE=InnoDB;

-- Tabela de terrenos
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
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB;

-- Inserir utilizador de demonstração (password: demo123)
INSERT INTO users (username, email, password) VALUES 
('demo', 'demo@example.com', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
('admin', 'admin@example.com', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');

-- Verificar se as tabelas foram criadas corretamente
SHOW TABLES;

-- Verificar estrutura das tabelas
DESCRIBE users;
DESCRIBE terrains;