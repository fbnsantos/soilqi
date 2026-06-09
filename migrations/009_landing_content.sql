-- Migration 009: Conteúdo editável da página de entrada
CREATE TABLE IF NOT EXISTS landing_content (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    lang         ENUM('pt','en') NOT NULL,
    content_key  VARCHAR(100)    NOT NULL,
    content_value MEDIUMTEXT     NULL,
    updated_at   TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_lang_key (lang, content_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS landing_videos (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    youtube_id VARCHAR(20) NOT NULL,
    title      VARCHAR(255) NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conteúdo por defeito — Português
INSERT IGNORE INTO landing_content (lang, content_key, content_value) VALUES
('pt', 'title',    'SoilQI — Agricultura de Precisão'),
('pt', 'subtitle', 'Plataforma académica da Universidade do Porto'),
('pt', 'body',     'SoilQI é uma plataforma web desenvolvida no âmbito da cadeira de Agricultura de Precisão da Universidade do Porto. Integra monitorização robótica, sensores IoT, importação de dados de campo e imagens de satélite para apoiar o ensino e a experimentação avançada em gestão localizada de culturas.\n\nIntegra-se com o sistema ORIOOS da ViField, com a plataforma VineShieldDT e aceita dados provenientes do QGIS e do John Deere Operations Center, permitindo gerar mapas de prescrição com taxa variável (VRT) para máquinas e robôs agrícolas.');

-- Conteúdo por defeito — Inglês
INSERT IGNORE INTO landing_content (lang, content_key, content_value) VALUES
('en', 'title',    'SoilQI — Precision Agriculture'),
('en', 'subtitle', 'Academic platform of the University of Porto'),
('en', 'body',     'SoilQI is a web platform developed as part of the Precision Agriculture course at the University of Porto. It integrates robotic monitoring, IoT sensors, field data import and satellite imagery to support teaching and advanced experimentation in localised crop management.\n\nIt integrates with the ORIOOS system from ViField, the VineShieldDT platform, and accepts data from QGIS and John Deere Operations Center, enabling variable rate prescription maps (VRT) for agricultural machines and robots.');
