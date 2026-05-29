-- Migration: 006_raster_results
-- Resultados de rasters de satélite (NDVI, NDMI, LST…)
-- Gerados pelo Sentinel.py via MQTT e devolvidos à plataforma web.

CREATE TABLE IF NOT EXISTS raster_results (
    id           INT           NOT NULL AUTO_INCREMENT,
    user_id      INT           NOT NULL,
    terrain_id   INT           NULL,
    request_id   VARCHAR(36)   NOT NULL,          -- UUID gerado pelo PHP
    raster_type  VARCHAR(50)   NOT NULL,          -- ndvi | ndvi_anomaly | ndvi_diff | ndmi | lst
    name         VARCHAR(255)  NOT NULL,
    status       ENUM('pending','processing','done','error')
                               NOT NULL DEFAULT 'pending',
    png_data     MEDIUMBLOB    NULL,              -- resultado PNG (armazenado em binário)
    min_lat      DECIMAL(10,7) NULL,
    max_lat      DECIMAL(10,7) NULL,
    min_lng      DECIMAL(10,7) NULL,
    max_lng      DECIMAL(10,7) NULL,
    date_from    DATE          NULL,
    date_to      DATE          NULL,
    date_from2   DATE          NULL,              -- período de referência (ndvi_diff / ndvi_anomaly)
    date_to2     DATE          NULL,
    error_msg    TEXT          NULL,
    created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE  KEY uidx_request   (request_id),
    INDEX        idx_rr_user   (user_id),
    INDEX        idx_rr_terrain(terrain_id),
    INDEX        idx_rr_status (status),

    FOREIGN KEY (user_id)    REFERENCES users(id)     ON DELETE CASCADE,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
