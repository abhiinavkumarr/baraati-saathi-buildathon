-- Baraati Saathi schema. Runs on AlloyDB Express (PostgreSQL 18) and on PGlite
-- for local development. Idempotent: safe to run on every start.
-- Guardrails: see .agents/skills/guest-data-guardrails/SKILL.md

CREATE TABLE IF NOT EXISTS weddings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  host_token  text NOT NULL,            -- secret for the host dashboard link
  draft       jsonb NOT NULL,           -- the structured wedding record
  style       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Generated media (card art, couple illustration, music). Kept in the database
-- so the prototype has one dependency; move to Cloud Storage if it grows.
CREATE TABLE IF NOT EXISTS assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('card_art', 'couple_art', 'music', 'upload')),
  mime_type   text NOT NULL,
  data        bytea NOT NULL,
  prompt      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_wedding_kind ON assets (wedding_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS rsvps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  guest_token text NOT NULL UNIQUE,     -- lets this guest see/change only their own RSVP
  name        text NOT NULL,
  phone       text,
  status      text NOT NULL CHECK (status IN ('yes', 'no', 'maybe')),
  party_size  integer NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 20),
  note        text,                     -- free text: "coming with mom, landing 6 pm"
  extracted   jsonb,                    -- structured from note (AI.EXTRACT on AlloyDB)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsvps_wedding ON rsvps (wedding_id, created_at DESC);

-- Questions Saathi couldn't answer, for the host's inbox.
CREATE TABLE IF NOT EXISTS questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  rsvp_id     uuid REFERENCES rsvps(id) ON DELETE SET NULL,
  question    text NOT NULL,
  answer      text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS questions_wedding ON questions (wedding_id, status, created_at DESC);

-- "Ask your guest list" runs Gemini-written SQL as this role. It owns nothing
-- and is granted nothing on the tables above: inside a rolled-back sandbox it
-- only sees two temporary tables holding ONE wedding's rows (server/insights.ts).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saathi_reader') THEN
    CREATE ROLE saathi_reader NOLOGIN;
  END IF;
  EXECUTE format('GRANT saathi_reader TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'saathi_reader setup: %', SQLERRM;
END $$;
REVOKE ALL ON weddings, assets, rsvps, questions FROM saathi_reader;
