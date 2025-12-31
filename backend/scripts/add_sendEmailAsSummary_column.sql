-- Add sendEmailAsSummary column to users table
-- This column allows users to receive one summary email per import instead of individual emails per document

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS "sendEmailAsSummary" BOOLEAN DEFAULT false;

COMMENT ON COLUMN users."sendEmailAsSummary" IS 'Send one summary email per import instead of individual emails per document';

