-- Migration 008: Tabela para importações CSV de campo
CREATE TABLE IF NOT EXISTS field_csv_imports (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NOT NULL,
    import_id   VARCHAR(36)  NOT NULL,
    place       VARCHAR(255) NOT NULL DEFAULT '',
    latitude    DECIMAL(10,7) NOT NULL,
    longitude   DECIMAL(10,7) NOT NULL,
    class_value TINYINT      NULL,
    param_values TEXT         NULL,
    imported_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_csv_import  (import_id),
    INDEX idx_csv_user    (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
