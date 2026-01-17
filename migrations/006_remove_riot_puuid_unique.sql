-- Migration to remove UNIQUE constraint from riot_puuid
-- This allows multiple Nexra accounts to be linked to the same Riot account

-- Step 1: Create new table without UNIQUE on riot_puuid
CREATE TABLE users_new (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    image TEXT,

    -- Linked Riot account (no longer UNIQUE - same Riot can be linked to multiple accounts)
    riot_puuid TEXT,
    riot_game_name TEXT,
    riot_tag_line TEXT,
    riot_region TEXT,
    riot_linked_at TEXT,

    -- Credits system
    credits INTEGER NOT NULL DEFAULT 3,
    total_credits_used INTEGER NOT NULL DEFAULT 0,

    -- Subscription
    subscription_tier TEXT DEFAULT 'free',
    subscription_expires_at TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT,

    -- Auth
    password_hash TEXT,
    auth_provider TEXT DEFAULT 'google'
);

-- Step 2: Copy data from old table
INSERT INTO users_new SELECT * FROM users;

-- Step 3: Drop old table
DROP TABLE users;

-- Step 4: Rename new table
ALTER TABLE users_new RENAME TO users;

-- Step 5: Recreate indexes (without UNIQUE on riot_puuid)
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_riot_puuid ON users(riot_puuid);
