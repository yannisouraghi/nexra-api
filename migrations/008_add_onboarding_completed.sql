-- Migration: Add onboarding_completed column to users table
-- Stores whether the user has completed the onboarding tutorial

ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
