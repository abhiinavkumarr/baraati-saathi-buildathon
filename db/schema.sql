-- Baraati Saathi schema. Runs on AlloyDB Express (PostgreSQL 18) and on PGlite
-- for local development. Idempotent: safe to run on every start.
-- Guardrails: see .agents/skills/guest-data-guardrails/SKILL.md

-- Accounts and sessions (§3)
CREATE TABLE IF NOT EXISTS users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  contact    text NOT NULL UNIQUE,          -- normalised: '+919876543210' or 'name@example.com'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,              -- 32 random bytes, base64url
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS weddings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  host_token  text NOT NULL,            -- secret for the host dashboard link
  draft       jsonb NOT NULL,           -- the structured wedding record
  style       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id);
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS host_side text;
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS expected_guests int;
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS hashtag text;
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;  -- shared read-only demo (server/demo.ts)
CREATE INDEX IF NOT EXISTS weddings_owner ON weddings (owner_user_id, created_at DESC);

-- Generated media (card art, couple illustration, ceremony art, music, logo, teaser).
CREATE TABLE IF NOT EXISTS assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('card_art', 'couple_art', 'event_art', 'music', 'upload', 'logo', 'teaser')),
  mime_type   text NOT NULL,
  data        bytea NOT NULL,
  prompt      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_wedding_kind ON assets (wedding_id, kind, created_at DESC);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('card_art', 'couple_art', 'event_art', 'music', 'upload', 'logo', 'teaser'));

CREATE TABLE IF NOT EXISTS rsvps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  guest_token text NOT NULL UNIQUE,     -- lets this guest see/change only their own RSVP
  name        text NOT NULL,
  phone       text,
  status      text NOT NULL CHECK (status IN ('yes', 'no', 'maybe', 'pending')),
  party_size  integer NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 20),
  note        text,                     -- free text: "coming with mom, landing 6 pm"
  extracted   jsonb,                    -- structured from note (AI.EXTRACT on AlloyDB)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsvps_wedding ON rsvps (wedding_id, created_at DESC);
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS side text;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS group_name text;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS relation text;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS room text;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'rsvp';
ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_status_check CHECK (status IN ('yes', 'no', 'maybe', 'pending'));

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

-- Updates the host publishes from the control room. Shown on the invitation
-- and known to Saathi.
CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  text_en     text NOT NULL,
  text_hi     text,
  audience    text NOT NULL DEFAULT 'all',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_audience_check;
CREATE INDEX IF NOT EXISTS announcements_wedding ON announcements (wedding_id, created_at DESC);

-- Planning tables (§5)
CREATE TABLE IF NOT EXISTS vendors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id   uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  category     text NOT NULL,
  name         text NOT NULL,
  contact_name text,
  phone        text,
  status       text NOT NULL DEFAULT 'shortlisted' CHECK (status IN ('shortlisted', 'negotiating', 'booked', 'cancelled')),
  who_pays     text CHECK (who_pays IN ('bride', 'groom', 'shared')),
  quoted       numeric(12, 2),
  ceremonies   text[],
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendors_wedding ON vendors (wedding_id, category, created_at DESC);

CREATE TABLE IF NOT EXISTS budget_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  category    text NOT NULL,
  planned     numeric(12, 2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wedding_id, category)
);

CREATE TABLE IF NOT EXISTS payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id   uuid REFERENCES vendors(id) ON DELETE CASCADE,
  label       text NOT NULL,
  amount      numeric(12, 2) NOT NULL CHECK (amount > 0),
  due_date    date,
  paid_at     date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_wedding ON payments (wedding_id, due_date);

CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  title       text NOT NULL,
  category    text,
  ceremony    text,
  assignee    text,
  status      text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'waiting', 'done')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
  due_date    date,
  source      text NOT NULL DEFAULT 'host',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_wedding ON tasks (wedding_id, status, due_date);

CREATE TABLE IF NOT EXISTS sheets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id  uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name        text NOT NULL,
  columns     jsonb NOT NULL DEFAULT '[]',
  rows        jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sheets_wedding ON sheets (wedding_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS runsheet_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id     uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  date           date NOT NULL,
  start_time     text,
  end_time       text,
  title          text NOT NULL,
  place          text,
  vendor_id      uuid REFERENCES vendors(id) ON DELETE SET NULL,
  show_to_guests boolean NOT NULL DEFAULT false,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runsheet_wedding ON runsheet_items (wedding_id, date, start_time);

-- "Ask your guest list" runs Gemini-written SQL as this role. It owns nothing
-- and is granted nothing on the tables above: inside a rolled-back sandbox it
-- only sees temporary tables holding ONE wedding's rows (server/insights.ts).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saathi_reader') THEN
    CREATE ROLE saathi_reader NOLOGIN;
  END IF;
  EXECUTE format('GRANT saathi_reader TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'saathi_reader setup: %', SQLERRM;
END $$;
REVOKE ALL ON weddings, assets, rsvps, questions, announcements, users, sessions, vendors, budget_lines, payments, tasks, sheets, runsheet_items FROM saathi_reader;
