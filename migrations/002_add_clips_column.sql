-- Migration: Add clips column to recordings table for storing video clip metadata
-- Run with: npx wrangler d1 execute nexra-db --file=migrations/002_add_clips_column.sql

-- Add clips column (JSON array of clip metadata)
ALTER TABLE recordings ADD COLUMN clips TEXT;
