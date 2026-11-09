-- Migration 011: Simulações da Calculadora ROI (Robô vs Máquina Convencional)
-- inputs  : JSON com todos os parâmetros introduzidos pelo utilizador
-- results : JSON com os macro-indicadores calculados (TCO, break-even, CO2e, ROI…)
CREATE TABLE IF NOT EXISTS roi_simulations (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    name        VARCHAR(160) NOT NULL,
    group_label VARCHAR(120) NULL,
    notes       TEXT NULL,
    inputs      LONGTEXT NOT NULL,
    results     LONGTEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_roi_user (user_id),
    INDEX idx_roi_group (user_id, group_label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
