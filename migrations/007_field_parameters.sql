-- Migration 007: Tabela de parâmetros de campo (globais e por utilizador)
CREATE TABLE IF NOT EXISTS field_parameters (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    unit        VARCHAR(50)  NOT NULL DEFAULT '',
    description VARCHAR(255) NOT NULL DEFAULT '',
    scope       ENUM('global','user') NOT NULL DEFAULT 'global',
    user_id     INT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_param (name, scope, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Parâmetros globais por defeito
INSERT IGNORE INTO field_parameters (name, unit, description, scope, user_id) VALUES
    ('condutividade', 'mS/cm', 'Condutividade eléctrica do solo',  'global', NULL),
    ('ph',            '',      'Valor de pH do solo',               'global', NULL),
    ('temperatura',   '°C',    'Temperatura do solo',               'global', NULL),
    ('humidade',      '%',     'Teor de humidade do solo',          'global', NULL);
