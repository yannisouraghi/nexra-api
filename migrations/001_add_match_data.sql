-- Migration: Add role and match_data columns to analyses table
-- Run with: npx wrangler d1 execute nexra-db --file=migrations/001_add_match_data.sql

-- Add role column if it doesn't exist
ALTER TABLE analyses ADD COLUMN role TEXT;

-- Add match_data column if it doesn't exist
ALTER TABLE analyses ADD COLUMN match_data TEXT;
