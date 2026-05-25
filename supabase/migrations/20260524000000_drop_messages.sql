-- Drop the messages table. Connection notes now live inline on contacts.
--
-- Auto-connect (the only consumer that tracked draft/sent/replied status) was
-- removed in Phase 1 of the restructure, so every row in messages is "draft
-- forever". Move the latest content per contact onto contacts.connection_note
-- and drop the table.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS connection_note TEXT;

UPDATE contacts c
SET connection_note = (
  SELECT m.content
  FROM messages m
  WHERE m.contact_id = c.id
  ORDER BY m.created_at DESC
  LIMIT 1
)
WHERE c.connection_note IS NULL;

DROP TABLE IF EXISTS messages;
