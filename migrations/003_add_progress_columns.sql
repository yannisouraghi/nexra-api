-- Add progress tracking columns to analyses table
ALTER TABLE analyses ADD COLUMN progress INTEGER DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN progress_message TEXT DEFAULT NULL;
