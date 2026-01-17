-- Migration: Add users table for authentication
-- Links Google OAuth to Riot accounts

-- Users table: stores authenticated users and their linked Riot accounts
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, -- Google OAuth ID
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    image TEXT, -- Profile picture URL

    -- Linked Riot account
    riot_puuid TEXT UNIQUE, -- Links to analyses and recordings
    riot_game_name TEXT,
    riot_tag_line TEXT,
    riot_region TEXT,
    riot_linked_at TEXT,

    -- Credits system
    credits INTEGER NOT NULL DEFAULT 3, -- Free credits to start
    total_credits_used INTEGER NOT NULL DEFAULT 0,

    -- Subscription (for future)
    subscription_tier TEXT DEFAULT 'free', -- free, pro, unlimited
    subscription_expires_at TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_riot_puuid ON users(riot_puuid);

-- Add user_id column to analyses table for direct user reference
ALTER TABLE analyses ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);

-- Add user_id column to recordings table
ALTER TABLE recordings ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_recordings_user_id ON recordings(user_id);
