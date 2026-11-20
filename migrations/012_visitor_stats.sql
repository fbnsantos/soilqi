-- Monitorização de visitantes (sem cookies, sem IPs guardados) — ver lib/visitor_stats.php
-- As tabelas também são criadas automaticamente na primeira visita.
CREATE TABLE IF NOT EXISTS page_views (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at    DATETIME     NOT NULL,
    day           DATE         NOT NULL,
    path          VARCHAR(300) NOT NULL,
    visitor       CHAR(16)     NOT NULL,
    logged_in     TINYINT(1)   NOT NULL DEFAULT 0,
    referrer_host VARCHAR(120) NOT NULL DEFAULT '',
    source        VARCHAR(80)  NOT NULL DEFAULT '',
    channel       VARCHAR(16)  NOT NULL DEFAULT 'direct',
    country       CHAR(2)      NOT NULL DEFAULT '',
    language      VARCHAR(8)   NOT NULL DEFAULT '',
    device        VARCHAR(16)  NOT NULL DEFAULT '',
    os            VARCHAR(16)  NOT NULL DEFAULT '',
    browser       VARCHAR(24)  NOT NULL DEFAULT '',
    INDEX idx_pv_day (day),
    INDEX idx_pv_day_channel (day, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bot_hits (
    day  DATE         NOT NULL,
    bot  VARCHAR(40)  NOT NULL,
    hits INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (day, bot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
