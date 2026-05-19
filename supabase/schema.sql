-- jobreach schema
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS jobs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url          TEXT        NOT NULL UNIQUE,
  company      TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  description  TEXT,
  location     TEXT,
  salary_range TEXT,
  requirements TEXT,
  cover_letter TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending',  -- pending | applied | interview | offer | rejected
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  title            TEXT,
  linkedin_url     TEXT,
  company          TEXT        NOT NULL,
  role_type        TEXT        NOT NULL,  -- recruiter | hiring_manager | new_grad_hire | other
  outreach_message TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  job_id     UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  platform   TEXT        NOT NULL DEFAULT 'linkedin',  -- linkedin | email
  content    TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'draft',     -- draft | sent | replied
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contacts_job_id_idx  ON contacts(job_id);
CREATE INDEX IF NOT EXISTS messages_job_id_idx  ON messages(job_id);
CREATE INDEX IF NOT EXISTS messages_contact_id_idx ON messages(contact_id);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
