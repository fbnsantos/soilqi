-- Migration: 005_field_geojson
-- Camadas GeoJSON importadas pelo utilizador (PWA ou plataforma web)
-- Guardadas na BD para poderem ser mostradas no mapa principal

CREATE TABLE IF NOT EXISTS field_geojson (
    id            INT          NOT NULL AUTO_INCREMENT,
    user_id       INT          NOT NULL,
    terrain_id    INT          NULL,
    name          VARCHAR(255) NOT NULL,
    description   TEXT         NULL,
    geojson_data  MEDIUMTEXT   NOT NULL,   -- conteúdo GeoJSON (JSON string)
    feature_count INT          NOT NULL DEFAULT 0,
    bbox_min_lat  DECIMAL(10,7) NULL,
    bbox_max_lat  DECIMAL(10,7) NULL,
    bbox_min_lng  DECIMAL(10,7) NULL,
    bbox_max_lng  DECIMAL(10,7) NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id) ON DELETE SET NULL,
    INDEX idx_fgj_user    (user_id),
    INDEX idx_fgj_terrain (terrain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
