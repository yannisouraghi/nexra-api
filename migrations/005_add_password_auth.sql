-- Add password authentication support to users table
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'google';

-- Create index for email lookups during login
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
