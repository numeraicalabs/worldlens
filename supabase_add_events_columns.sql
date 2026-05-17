-- Run this in Supabase SQL Editor to add missing columns to events table
-- Safe to run multiple times (IF NOT EXISTS)
ALTER TABLE events ADD COLUMN IF NOT EXISTS ai_tags      TEXT    DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS keywords     TEXT    DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS sentiment_score REAL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sentiment_tone  TEXT DEFAULT 'neutral';
ALTER TABLE events ADD COLUMN IF NOT EXISTS narrative_id    TEXT DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS timeline_band   TEXT DEFAULT 'geopolitical';
ALTER TABLE events ADD COLUMN IF NOT EXISTS market_impact   REAL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS topic_vector    TEXT DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS sent_credibility REAL DEFAULT 0.75;
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_url       TEXT DEFAULT '';

-- Verify
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'events' ORDER BY ordinal_position;
