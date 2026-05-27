-- Migration: 003_api_tokens
-- Tokens de longa duração para autenticação persistente da PWA SoilQI Field

CREATE TABLE IF NOT EXISTS api_tokens (
    id            INT           PRIMARY KEY AUTO_INCREMENT,
    user_id       INT           NOT NULL,
    token         VARCHAR(64)   NOT NULL,
    device_name   VARCHAR(255)  NULL,
    last_used_at  TIMESTAMP     NULL,
    expires_at    DATETIME      NOT NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uk_api_token (token),
    INDEX idx_at_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
