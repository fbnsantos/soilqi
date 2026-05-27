-- Migration: 004_photo_path
-- Adiciona suporte a fotografia nas medições de campo (PWA SoilQI Field)
-- O ficheiro é guardado em pwa/uploads/photos/ e o caminho relativo fica aqui

ALTER TABLE field_measurements
    ADD COLUMN photo_path VARCHAR(255) NULL AFTER notes;
