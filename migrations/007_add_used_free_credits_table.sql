-- Migration: Add used_free_credits table to track emails that have received free credits
-- This prevents users from deleting and recreating accounts to get free credits multiple times

CREATE TABLE IF NOT EXISTS used_free_credits (
    email TEXT PRIMARY KEY NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_used_free_credits_email ON used_free_credits(LOWER(email));

-- Migrate existing users: Add all current user emails to the table
-- This ensures existing users who delete their accounts won't get free credits again
INSERT OR IGNORE INTO used_free_credits (email, received_at)
SELECT LOWER(email), created_at FROM users WHERE email IS NOT NULL;
