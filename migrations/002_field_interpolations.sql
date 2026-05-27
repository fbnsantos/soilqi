-- Migration: 002_field_interpolations
-- Tabela para guardar interpolações IDW geradas nas Medições de Campo
-- Inclui bounds geográficos para georreferenciação (PNG World File)

CREATE TABLE IF NOT EXISTS field_interpolations (
    id            INT          PRIMARY KEY AUTO_INCREMENT,
    user_id       INT          NOT NULL,
    terrain_id    INT          NULL,
    name          VARCHAR(255) NOT NULL,
    param         VARCHAR(50)  NOT NULL COMMENT 'conductivity | ph | temperature | moisture',
    colormap      VARCHAR(50)  NOT NULL,
    resolution    INT          NOT NULL DEFAULT 256,
    power         DECIMAL(4,2) NOT NULL DEFAULT 2.00,
    min_lat       DECIMAL(10,7) NOT NULL,
    max_lat       DECIMAL(10,7) NOT NULL,
    min_lng       DECIMAL(10,7) NOT NULL,
    max_lng       DECIMAL(10,7) NOT NULL,
    min_val       DECIMAL(12,4) NULL,
    max_val       DECIMAL(12,4) NULL,
    png_data      LONGBLOB     NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id) ON DELETE SET NULL,
    INDEX idx_fi_user    (user_id),
    INDEX idx_fi_terrain (terrain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
