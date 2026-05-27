-- Migração 001: Tabela de medições de campo (SoilQI Field PWA)
-- Suporta: condutividade elétrica, pH, temperatura, humidade, coordenadas GNSS

CREATE TABLE IF NOT EXISTS field_measurements (
    id           INT           PRIMARY KEY AUTO_INCREMENT,
    user_id      INT           NOT NULL,
    terrain_id   INT           NULL,
    latitude     DECIMAL(10,7) NOT NULL,
    longitude    DECIMAL(10,7) NOT NULL,
    gps_accuracy DECIMAL(8,2)  NULL     COMMENT 'Precisão GPS em metros',
    conductivity DECIMAL(10,4) NULL     COMMENT 'Condutividade elétrica em mS/cm',
    ph           DECIMAL(4,2)  NULL     COMMENT 'pH do solo (0–14)',
    temperature  DECIMAL(5,2)  NULL     COMMENT 'Temperatura do solo em °C',
    moisture     DECIMAL(5,2)  NULL     COMMENT 'Humidade do solo em %',
    notes        TEXT          NULL,
    measured_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id) ON DELETE SET NULL,
    INDEX idx_user_measured (user_id, measured_at),
    INDEX idx_terrain       (terrain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
