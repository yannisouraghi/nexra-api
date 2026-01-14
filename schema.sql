-- Nexra API Database Schema

-- Analyses table: stores game analysis requests and results
CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    puuid TEXT NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed

    -- Game info (basic)
    champion TEXT,
    result TEXT, -- win, loss
    duration INTEGER,
    game_mode TEXT,
    kills INTEGER,
    deaths INTEGER,
    assists INTEGER,
    role TEXT, -- TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY

    -- Complete Riot API match data (JSON)
    match_data JSON, -- All data from Riot API for AI analysis

    -- Analysis results (JSON)
    stats JSON,
    errors JSON,
    tips JSON,
    clips JSON,

    -- Error info
    error_message TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_analyses_puuid ON analyses(puuid);
CREATE INDEX IF NOT EXISTS idx_analyses_match_id ON analyses(match_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);

-- Recordings table: stores video recording metadata
CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL UNIQUE,
    puuid TEXT NOT NULL,
    region TEXT NOT NULL,

    -- Video info
    video_key TEXT NOT NULL, -- R2 object key
    duration INTEGER,
    file_size INTEGER,

    -- Clips for AI analysis (JSON array)
    clips TEXT, -- JSON array of clip metadata with frame keys

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_recordings_match_id ON recordings(match_id);
CREATE INDEX IF NOT EXISTS idx_recordings_puuid ON recordings(puuid);
