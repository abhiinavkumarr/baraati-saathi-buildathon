# PLANNER_SPEC.md: Saathi, the Baraati wedding planner

Build spec for the coding agent. Read **AGENTS.md** (rules, commands, deploy) and **DESIGN.md** (every pixel) first. This file says *what* to build and in *which order*; when it conflicts with AGENTS.md, AGENTS.md wins.

**How to build:** one agent, in the order of §11. Finish P0 before P1 and P1 before P2; a finished P0 beats a half-built P1. Work continuously and keep every commit working: the product will keep being iterated on after this pass.

---

## 1. What we are building

Saathi becomes a wedding planner for Indian weddings:

1. **Log in** with a name and phone/email. There is no password yet.
2. See **the weddings you own**, or **create one**.
3. **Open a wedding.** It has three sections:
   - **Your Wedding**: the planning back office (guests, vendors, budget, tasks, sheets, run sheet).
   - **Baraati App**: what guests see and how the host runs it (invitation, RSVPs, events, info, announcements, rooms, travel).
   - **AI Studio**: Google models making things (invitation, logo, WhatsApp messages, song and teaser).
4. **Ask Saathi** is available on every page: one Gemini agent that can read everything and *propose* changes in any section. The host confirms each change.

Everything already built is kept and re-homed. Nothing working is deleted.

| Today | Moves to |
|---|---|
| `Create.tsx` card/voice/chat intake | Create wedding → "Start from your wedding card" |
| `Invite.tsx` living invitation, `Saathi.tsx` guest concierge | Baraati App → Invitation (preview + share) |
| `Host.tsx` control room (agent, proposals, briefing, charts) | Agent → the Ask Saathi drawer + Wedding home briefing; charts → Baraati App → RSVPs / Travel |
| `Studio.tsx` card art, couple art, ceremony art, music | AI Studio → Invitation creator |
| `Workspace.tsx` tabs (localStorage tasks/budget) | Replaced by the three sections (data moves to the DB) |
| `Login.tsx` | Rebuilt per §3 |

## 2. Non-negotiables

- **IP boundary (AGENTS.md rule 1):** never copy code from the Baraati app, guest web or Planner repos. This spec describes their *features*; write the code fresh.
- **Privacy:**
  - Guest phone numbers are optional, stored only for building `wa.me` links, shown masked (`••••3210`), and **never** sent to any model.
  - Follow `.agents/skills/guest-data-guardrails/SKILL.md`.
  - **No** govt IDs, no face recognition, no health or allergy data.
- **Model SQL:** runs only through `runScoped` in `server/insights.ts` (role `saathi_reader`, temp tables, rollback). Never grant that role anything.
- **The host decides:** agent tools only *propose*. Changes happen in `POST /api/host/:slug/apply`.
- **Quality bar:** run `npm run typecheck && npm test && npm run build` before every commit. Check axe for 0 violations, check 390 px and 1280 px, and follow DESIGN.md components only.
- **No new runtime dependencies** unless unavoidable. The router stays hand-written. CSV and the grid are written by hand. There is no UI kit.

---

## 3. Accounts and weddings (P0)

### Data
In `db/schema.sql`, which is idempotent: use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, and keep it working on PGlite **and** AlloyDB.

```sql
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact text NOT NULL UNIQUE,          -- normalised: '+919876543210' or 'name@example.com'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,                -- 32 random bytes, base64url
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id);
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS host_side text;        -- bride | groom | planner
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS expected_guests int;
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS hashtag text;
ALTER TABLE weddings ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;
```

### API (new `server/auth.ts`, mounted in `server/index.ts`)

| Route | Does | Notes |
|---|---|---|
| `POST /api/login {name, contact}` | Normalise contact → upsert user → new session | Phone: strip spaces/dashes; 10 digits → `+91…`; keep `+` E.164. Email: trim + lowercase. Reject anything else (400). Rate-limit like `/ask`. Returns `{user:{id,name}, session}` |
| `GET /api/me/weddings` | Weddings where `owner_user_id = me` | Header `Authorization: Bearer <session>`. Returns `[{slug, host_token, couple, first_date, days, private}]`. A **private** wedding is returned only if the header `x-owner-passcode` equals env `OWNER_PASSCODE` (constant-time compare). Otherwise it is listed as `{slug, locked:true}` with no token |
| `POST /api/weddings` (existing) | Also sets `owner_user_id` when a valid Bearer session is sent | Keep it working without a session for old scripts |

Every existing host endpoint keeps using the wedding's `host_token` (`hostWeddingRow(slug, token)` in `server/insights.ts`), and so does every new one. Use the constant-time `crypto.timingSafeEqual` for new token checks.

### Screens
- **Login (`/`):**
  - Name, phone or email, and "Continue".
  - A secondary button, **"Try the sample wedding"**: it creates a throwaway user plus a fresh sample (reuse `createSampleWedding()` from `web/src/pages/Login.tsx`, then seed the planning data from §5.6) and opens it.
  - Store `{session, user}` in `localStorage['saathi:session']`.
- **My weddings (`/weddings`):**
  - Cards: couple, dates, days-to-go, and the wedding's logo if one exists.
  - A "+ Create a wedding" card.
  - Locked private weddings show a passcode field.
  - With zero weddings, go straight to `/new`.
- **Create (`/new`).** Three steps with a progress bar. These are the Baraati app's create fields, rebuilt:
  1. **The couple:**
     - bride's and groom's names, both required and Title-Cased;
     - "You are": Bride's side / Groom's side / Wedding planner (required);
     - an optional couple photo, saved as an `upload` asset.
  2. **Venue and guests:** venue name (required), city (required; a free-text input with a `<datalist>` of ~40 big Indian cities), and expected guests (optional, digits).
  3. **Wedding days:**
     - 1–4 days, starting with 2 (Wedding, Reception), each with an **empty** date.
     - "+ Add day" (max 4) and "Remove" (min 1).
     - Each day has a date input and ceremony pills: Mehendi, Haldi, Sangeet, Baraat, Varmala, Wedding, Reception, and "+ Custom".
     - **Rules:**
       - every day needs a date;
       - no past dates;
       - each day is after the previous one (`min` = previous day + 1);
       - picking a date fills empty later days with the next consecutive dates.
     - Card style: 6 tiles from the existing `STYLES`.
  - **Create** builds a `WeddingDraft` (`server/wedding.ts`):
    - `partner1_name` = bride, `partner2_name` = groom, `city`, `style`;
    - one `events[]` entry per ceremony with the day's date, `venue_name`, and a default start time (Mehendi 15:00, Haldi 10:00, Sangeet 19:00, Baraat 18:00, Varmala 20:00, Wedding 21:00, Reception 19:30, custom 18:00).
  - Store `host_side`, `expected_guests` and `hashtag = '#' + Bride + Groom + YYYY` on the row.
  - **Alternative path:** a top link, **"Start from your wedding card or a voice note"**, opens the existing intake (`Create.tsx` + `POST /api/intake/turn`). When intake finishes, pre-fill this form instead of saving directly.

**Accept when:**
- login with `98765 43210` and with `+91 9876543210` is the same user;
- another user's session never lists or opens my wedding;
- a private wedding without the passcode returns no token;
- Create refuses past or out-of-order dates.

---

## 4. Wedding shell and home (P0)

### Routes (`web/src/App.tsx`, keep the hand-written matcher)
```
/                      Login
/weddings              My weddings
/new                   Create
/w/:slug               Wedding home
/w/:slug/plan/:tab     guests | vendors | budget | tasks | sheets | runsheet
/w/:slug/app/:tab      invite | rsvps | events | info | announcements | rooms | travel
/w/:slug/studio/:tab   invitation | logo | messages | teaser
/i/:slug               public invitation (unchanged)
/h/:slug, /studio/:slug  → redirect into /w/:slug (keep ?t=)
```
The current wedding's `{slug, host_token}` lives in a React context, `WeddingContext`, loaded from `/api/me/weddings`. Pages read the token from there, never from the URL.

### `WeddingShell` (`web/src/pages/wedding/WeddingShell.tsx`)
- **Top bar** (DESIGN.md `.topbar`):
  - left: the wedding logo (or initials) and the couple's names;
  - a wedding switcher;
  - a section switcher **Your Wedding · Baraati App · AI Studio** (`.tabs`);
  - right: the user and Sign out.
- **Sub-tabs** for the section under the top bar. On phones they scroll horizontally.
- **Ask Saathi:**
  - a floating pill bottom-right on every page that opens a right-side drawer (a bottom sheet on phones);
  - it hosts the existing agent UI from `Host.tsx` (`ControlRoom`, `ProposalCard`, `Progress`, voice mic);
  - extract those into `web/src/components/agent/*` so both the drawer and the pages can use them.
  - After `/apply` succeeds, the drawer fires a `saathi:changed` window event, and open pages refetch.

### Home (`/w/:slug`)
1. **Hero:** `.panel-ink` with the couple's names, the dates, and days-to-go as a big `.num`.
2. **What needs you.** It is computed on the server and ranked, at most 6 items, each linking to its page:
   - overdue tasks;
   - payments due in 7 days;
   - pending RSVPs;
   - confirmed outstation guests with no pickup;
   - open guest questions;
   - booked-vendor categories still empty: Venue, Catering, Photography, Decor, Makeup.
3. **AI briefing:** the existing `GET /api/host/:slug/briefing` (`server/control.ts`). Keep the "Ask Saathi to do it →" buttons; they open the drawer with the prompt.
4. **Three section cards** with live numbers:
   - Your Wedding: "₹x of ₹y paid · n tasks open";
   - Baraati App: "n coming · n pending";
   - AI Studio: "n creations".

New endpoint: `GET /api/host/:slug/home?t=`, which returns `{needs:[{kind,text,href,count}], counts:{…}}`. The numbers come from code, not the model.

**Accept when:** every page renders inside the shell at 390 px with no horizontal scroll, and the drawer works on every page.

---

## 5. Your Wedding (planning)

All new tables carry `wedding_id uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE`, plus `created_at`/`updated_at`. **Every query filters by the wedding resolved from the host token.** Put the routes in a new `server/planning.ts`. CRUD follows one pattern:

- `GET /api/host/:slug/<thing>?t=`
- `POST /api/host/:slug/<thing>` (body includes `t`)
- `PATCH /api/host/:slug/<thing>/:id`
- `DELETE /api/host/:slug/<thing>/:id`

Validate every field (type, length, enum). An unknown id or another wedding's id returns 404.

### 5.1 Guests (P0)
One guest list. **Extend the existing `rsvps` table rather than adding a new one**: the text-to-SQL sandbox, control room, briefing and tests already read it.

```sql
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS side text;          -- bride | groom | both | null
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS group_name text;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS relation text;      -- "Chacha ji", "College friend"
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS room text;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'rsvp';  -- rsvp | host | import
-- status gains 'pending': drop and re-add the CHECK as yes|no|maybe|pending (idempotent DO block)
```

- **Host-added guests:**
  - `source='host'`, `status='pending'`, and a fresh `guest_token`.
  - Their personal invite link is `/i/:slug?g=<guest_token>`.
  - Change the invite to accept a token in `g` (look up the name server-side, through the existing `my-plan` route) and to still accept a plain name for old links.
- **Page:**
  - search;
  - filter chips for side, group and status;
  - a table on desktop and cards on a phone, with name, side, group, party size, status badge, room and arrival;
  - add/edit in a side sheet;
  - delete with a confirm;
  - multi-select → "Set group" / "Set side";
  - CSV export.
- **AI import (P1): "Paste or snap your list".**
  - The input is a textarea (WhatsApp or Excel paste), a CSV file, or a photo of a handwritten list.
  - `POST /api/host/:slug/guests/import-preview`:
    - phones are stripped from the text **before** it is sent (replace them with `[phone]`);
    - Gemini (`generateJson` in `server/gemini.ts`, with a schema) returns `[{name, party_size, side, group_name, relation}]`, dedupes, and keeps household words like "Sharma family (4)" as one row with `party_size` 4;
    - images go as `inlineData` parts, the same way `server/intake.ts` sends a card photo.
  - The review table is editable, then "Add n guests" calls `POST …/guests/bulk`.

### 5.2 Vendors (P0)
```sql
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wedding_id uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  category text NOT NULL,     -- Venue, Catering, Decor, Photography, Makeup, Mehendi artist, DJ & Music, Pandit, Transport, Invitations, Clothing, Jewellery, Gifts, Other
  name text NOT NULL, contact_name text, phone text,
  status text NOT NULL DEFAULT 'shortlisted' CHECK (status IN ('shortlisted','negotiating','booked','cancelled')),
  who_pays text CHECK (who_pays IN ('bride','groom','shared')),
  quoted numeric(12,2), ceremonies text[], notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
```
- **Page:**
  - cards grouped by category;
  - a status pipeline filter (Shortlisted → Negotiating → Booked);
  - each card shows the quote, paid, due, masked phone and `tel:` / WhatsApp buttons;
  - an empty-category hint: "Still to book: Photography, Decor".
- **AI quote reader (P1): "Drop a quote".**
  - Input: PDF or photo.
  - `POST …/vendors/read-quote` → Gemini extracts `{vendor_name, category, total, milestones:[{label, amount, due_date}], cancellation_terms, inclusions[]}`.
  - The UI shows it as a **proposal card**: vendor + payments + a task per milestone ("Pay ₹50,000 advance to Lakeview Caterers"). It goes through `/apply` as `kind:'vendor_bundle'`.

### 5.3 Budget and payments (P0)
```sql
CREATE TABLE IF NOT EXISTS budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wedding_id uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  category text NOT NULL, planned numeric(12,2) NOT NULL DEFAULT 0, UNIQUE (wedding_id, category)
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wedding_id uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE,
  label text NOT NULL, amount numeric(12,2) NOT NULL CHECK (amount > 0),
  due_date date, paid_at date, created_at timestamptz NOT NULL DEFAULT now()
);
```
- **Totals** come from a pure function, `computeBudget(lines, vendors, payments, today)`, in `server/planning.ts`, and are unit-tested. Per category:
  - **planned**;
  - **committed** = sum of `quoted` for booked vendors;
  - **paid** = sum of payments with `paid_at`;
  - **due 30d** = unpaid payments due within 30 days;
  - **over** = committed > planned.
- **Page:**
  - a header with total planned / committed / paid as `.num` tiles, using ₹ formatting: `₹4.5 L`, `₹1.2 Cr`, and full rupees in tooltips;
  - a per-category table with inline-editable "planned" and a progress bar;
  - an "Upcoming payments" list with a "Mark paid" button.

### 5.4 Tasks (P0)
```sql
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wedding_id uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  title text NOT NULL, category text, ceremony text, assignee text,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','waiting','done')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','critical')),
  due_date date, source text NOT NULL DEFAULT 'host',   -- host | ai | quote
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
```
- `urgency(task, today)` is a pure function, tested: **overdue / this week / later / undated / done**.
- **Page:** a list grouped by urgency, quick add ("Book mehendi artist by 5 Jan" → a title and a parsed date; a regex is fine), a status dropdown, priority chips, and filters by assignee and ceremony.
- **AI: "Make my checklist".** `POST …/tasks/suggest` sends Gemini the wedding date(s), ceremonies, city, tradition and today's date. It returns 15–25 dated tasks working back from the wedding (e.g., venue 6 months before, invitations 6 weeks before, mehendi artist 2 months before), plus a `category` and a `ceremony` for each. They are shown as one proposal card with checkboxes; the host applies the selected ones (`kind:'tasks'`).
- The old localStorage `DEFAULT_TASKS`/`DEFAULT_BUDGET` in `Workspace.tsx` become the **sample-wedding seed** (§5.6), not client state.

### 5.5 Sheets (P1): "like Excel"
```sql
CREATE TABLE IF NOT EXISTS sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wedding_id uuid NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name text NOT NULL, columns jsonb NOT NULL DEFAULT '[]', rows jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
```
- `columns`: `[{id, name, type: 'text'|'number'|'date'|'check'}]`; `rows`: `[{id, cells:{[colId]: value}}]`. The limits are 30 columns and 500 rows.
- **Page:**
  - a sheet list (left) and a grid (right);
  - click a cell to edit, with Enter/Tab/arrow-key navigation;
  - add/rename/delete rows and columns;
  - a number column shows its sum in the footer;
  - CSV import/export;
  - autosave debounced at 800 ms (`PATCH …/sheets/:id`).
  - Make the grid keyboard-accessible: `role="grid"`, `aria-rowindex`/`aria-colindex`.
- **AI: "Make a sheet for …".** Prompt, e.g. "Mehendi shopping list" or "Return gifts for 40 families". `POST …/sheets/suggest` returns `{name, columns, rows}`, created as a new sheet.

### 5.6 Sample-wedding seed (P0)
When "Try the sample wedding" creates a wedding, or `scripts/seed-demo.ts` runs, also insert:
- **12 vendors**, mixed statuses;
- **budget lines** for 10 categories, totalling about ₹30 L;
- **8 payments**, some paid, some due this week, one overdue;
- **14 tasks**, some overdue and some done;
- **one sheet**, "Sangeet song list", with 8 rows.

The seed guests already exist (`scripts/seed-demo.ts`); give them sides and groups. Demo guests have **no phone numbers** (AGENTS.md rule 3).

### 5.7 Run sheet (P2)
`runsheet_items (id, wedding_id, date, start_time, end_time, title, place, vendor_id, show_to_guests bool, notes)`.
- **Page:** one timeline per day, with the ceremonies from `draft.events` shown as fixed markers.
- Items with `show_to_guests` appear under that day on the invitation, as a "Day schedule" list.

---

## 6. Baraati App (P0 unless marked)

These pages manage what guests see. Most of them re-home UI that already exists.

| Tab | Content | Built from |
|---|---|---|
| **Invitation** (`invite`) | Phone-frame live preview of `/i/:slug` (iframe), share link, copy, QR (`GET /api/qr`), "Open as a guest", and a personal-links list (guest → WhatsApp link with `?g=<guest_token>`) | `Invite.tsx`, `Workspace.tsx` GuestsTab links |
| **RSVPs** (`rsvps`) | Counts: attending / maybe / can't / pending, with heads (party sizes). Per-guest list with a status badge. Food-needs and party-size bars. "Remind the pending ones" opens Ask Saathi with *"Remind everyone who hasn't replied"* (existing `propose_reminders`) | `Host.tsx` charts, `control.ts` |
| **Events** (`events`) | Edit ceremonies (name, date, start time, venue, address, dress code, notes), add and delete. It writes `draft.events` through a new `PATCH /api/host/:slug/events` that validates with the existing draft rules. Each card shows its ceremony art (`assets.kind='event_art'`, labelled by event name) and a "Regenerate art" button (existing `/event-art`). The invite and concierge update automatically because they read the draft | `Workspace.tsx` CeremoniesTab, `design.ts` |
| **Info** (`info`) | Info cards (`draft.info`, add/edit/delete); the **guest questions inbox** (open questions → answer → becomes an info card, existing `POST /api/host/:slug/questions/:id/answer`) | `saathi.ts`, `Host.tsx` |
| **Announcements** (`announcements`) | List of past announcements, plus "New announcement": write it yourself, or "Ask Saathi to write it" (EN + हिं). Audience: all / coming / maybe / pickup / a **group** (new). After publishing, show the per-guest WhatsApp list | `control.ts` apply path |
| **Rooms** (`rooms`, P1) | Table of attending guests → a room input (saves `rsvps.room`), sorted by room or name. **AI "Propose rooming"**: a new tool `propose_rooming` groups confirmed outstation guests by family/group into rooms of 2–3; the host applies it | new |
| **Travel** (`travel`, P1) | Arrivals table from `rsvps.extracted` (date, time, mode, number, from, pickup), arrivals-by-day chart, CSV. **AI "Pair arrivals into cabs"**: tool `propose_pickups` groups pickups landing at the same point within 45 min, at 4 seats per cab | `Workspace.tsx` LogisticsTab, `computeStats` in `control.ts` |
| **More in the Baraati app** | Static tiles, not built: Govt IDs, Games, Photo Drive, Wedding Album. Each says "Available in the Baraati app" | none |

**Accept when:**
- editing an event changes the public invitation within one refresh;
- an announcement published here shows on the invite's update banner;
- a personal link greets the guest by name.

---

## 7. AI Studio

All generation goes through `server/gemini.ts` (`MODELS`, `withFallback`, `generateImage`, `generateMusic`, `generateJson`). Each result is saved to `assets` with a `label`, so the Studio shows a gallery of everything made for the wedding. Add `logo` and `teaser` to the `assets.kind` CHECK (drop and re-add it in the existing `DO` block style).

| Tool | Behaviour |
|---|---|
| **Invitation creator (P0)** | The existing `Studio.tsx` jobs, restyled: card art in the 6 regional styles, couple illustration from a photo, ceremony art per event, and Lyria music. Each job shows `badge ai` while running and a thin progress bar |
| **Logo / monogram (P0)** | `POST /api/weddings/:slug/logo {t, style}`, where style is `classic` (gold-foil initials in a mandala ring), `floral` (initials entwined with marigold and jasmine) or `modern` (minimal line monogram). It builds the prompt from the couple's initials (e.g. "S & N") and the card style's palette. **Nano Banana returns JPEG only**, so ask for a plain cream background. Generate 3 at once, then "Use this one" sets `draft.logo_asset_id`. The chosen logo shows in the top bar, on My weddings, and at the top of the invitation. Download button |
| **WhatsApp message writer (P0)** | `POST /api/host/:slug/messages {t, kind, language, tone, extra}`. `kind`: invite / save-the-date / reminder / thank-you / announcement. `language`: English / Hindi / Hinglish. `tone`: formal / warm / shayari / filmi / funny. Gemini gets the public details only (`publicDetails` in `server/saathi.ts`) and returns `{variants:[{text}]}` ×3. Each uses `{name}` for the guest's name and stays under 600 characters, with the date, venue and invitation link. UI: three cards → Copy, or "Send to guests…" (pick guests or a group → per-guest `wa.me` links with `{name}` filled). Never send phones to the model |
| **Song + video teaser (P1)** | Song: the existing `/music`. Teaser: a client-side player (`web/src/teaser.ts`) that draws, on a 1080×1920 canvas, the couple's names → card art → each ceremony's art with its name and date → logo + "Save the date", with a slow Ken Burns pan and crossfades over the music, about 20 s. "Download video" records the canvas plus the audio with `MediaRecorder` (WebM) and saves it as asset kind `teaser`. Reduced-motion users get static slides |
| **Veo clip (P2, stretch)** | Only if `scripts/probe-models.ts` shows a Veo model on this key: an 8-second cinematic clip from the card art. Otherwise don't show it |

---

## 8. Ask Saathi agent upgrades (P1, the "Google AI depth" story)

1. **Sandbox tables** (`runScoped` in `server/insights.ts`): copy this wedding's rows into temp tables `tasks`, `vendors` and `payments` beside `guests` and `events`.
   - **Leave out** `vendors.phone` and `contact_name`.
   - Extend `DATA_DICTIONARY`.
   - Keep `checkSql` and the role exactly as they are.
   - The host can then ask:
     - *"Kitna paisa abhi dena baaki hai?"*
     - *"Which tasks are overdue?"*
     - *"Photographer ko kitna diya?"*
2. **New propose-only tools** in `TOOLS` in `server/control.ts`. Each one returns a proposal card, and each gets a branch in `/apply` that validates again:

   | Tool | Applies |
   |---|---|
   | `propose_tasks {tasks:[{title, due_date, category, ceremony, priority}]}` | insert tasks (`source='ai'`) |
   | `propose_vendor {name, category, status, quoted, who_pays, notes}` | insert vendor |
   | `propose_payment {vendor_name, label, amount, due_date, paid}` | insert payment (vendor matched by name in this wedding) |
   | `propose_budget_line {category, planned}` | upsert line |
   | `propose_rooming {rooms:[{room, guest_names[]}]}` | set `rsvps.room` |
   | `propose_pickups {cabs:[{time, point, guest_names[]}]}` | an announcement draft to those guests plus a task "Book n cabs" |

   Keep the 6-hop limit. The existing progress steps stay, because the agent takes 11–17 s.
3. **Context:** add the budget totals, counts of open/overdue tasks, and vendors by status to the agent's system prompt. These are numbers only, computed by `computeBudget` and `urgency`.
4. **Skills:**
   - update `.agents/skills/host-control-room/SKILL.md` (new tools, when to use which);
   - add `.agents/skills/wedding-planner/SKILL.md` (Indian wedding planning lead times, vendor categories, how to read a quote, rupee formatting, Hinglish examples);
   - register it in `server/skills.ts` and update the skill-list test.

**Demo lines that must work:**
- *"Mehendi artist book karna hai, 25 hazaar budget, aur ek task bana do"* → vendor + budget line + task cards.
- *"Is hafte kya pay karna hai?"* → table.
- *"Haldi 12 baje kar do aur sabko bata do"* → still works.

---

## 9. Importing a real wedding (P0, after §3–§5 exist)

The file `.data/import/srishti-nishit.json` is already on disk. It is gitignored and **must never be committed or printed**. Format `saathi-import-v1`:

```jsonc
{
  "format": "saathi-import-v1",
  "owner":   { "name", "contact", "only_owner": true },   // the ONE user who may see this wedding
  "wedding": { "bride_name", "groom_name", "hashtag", "venue_name", "city", "host_side", "expected_guests" },
  "days":    [{ "date": "YYYY-MM-DD", "ceremonies": "Haldi · Wedding" }],
  "events":  [{ "name", "date", "start_time", "end_time", "venue_name", "venue_address", "dress_code", "notes" }],
  "venues":  [{ "name", "address", "maps_url", "is_primary" }],
  "info":    [{ "question", "answer" }],
  "groups":  [{ "name", "member_refs": ["<guest ref>"] }],
  "guests":  [{ "ref", "name", "is_host", "side", "rsvp", "room",
               "travel": null | { "arrival_date", "arrival_time", "departure_date", "departure_time", "mode", "from", "number" } }],
  "added_people": [{ "name", "side", "rsvp", "room", "came_with_ref", "travel" }]
}
```

Write `scripts/import-wedding.ts <file>`. The owner comes from the file's `owner` block, so the owner's phone number never appears in code, commands, logs or git. It does the following:
- upserts the owner user from `owner.name` + `owner.contact` (normalised as in §3);
- makes that user the wedding's `owner_user_id`. **Only that user can see this wedding.** It must not appear for any other user, in the sample, in `/api/health`, or in any public list. Every `/api/host/:slug/*` route needs its host token, which is only returned to the owner (with the passcode, §3). For a `private` wedding, `GET /api/weddings/:slug`, `/i/:slug` and the guest concierge return 404 unless the request carries that host token (`?t=`). The owner's preview iframe passes it; nobody else can open it;
- creates the wedding with `private=true` and the draft built from `wedding` and `events` (style `royal-rajasthani`), `info` and `venues`;
- inserts each guest into `rsvps`:
  - `source='import'`, a new `guest_token`, `phone` NULL, `party_size` 1;
  - `status` from `rsvp` (anything unknown → `pending`);
  - `side` normalised: contains "bride" → `bride`, contains "groom" → `groom`, else NULL;
  - `room` as given (it is free text: "3005", "Home", "Not coming" are all real values; keep them);
  - travel mapped into `extracted` (`arrival_date`, `arrival_time` as HH:MM, `arrival_mode`, `flight_or_train`, `arrival_point` = `from`);
- sets `group_name` from the first group that lists the guest's ref;
- skips hosts in the guest count but keeps them in the list.

The script prints counts only, never names. It is idempotent: if a private wedding with the same hashtag and owner exists, it is replaced. The founder runs it, locally first, then against AlloyDB. `OWNER_PASSCODE` goes into Secret Manager and the deploy command (`--set-secrets`).

This wedding is **never** used in the deck, video or judge demo, which all use the sample wedding.

---

## 10. Tests (add to `tests/`, all on in-memory PGlite)

- `auth.test.ts`:
  - contact normalisation;
  - the same user from two phone formats;
  - user B can't list user A's weddings;
  - a private wedding needs the passcode.
- `planning.test.ts`:
  - CRUD scoping: wedding B's token can't read, patch or delete wedding A's vendors, tasks or payments (404);
  - `computeBudget` numbers;
  - `urgency` buckets around today.
- `insights.test.ts` (extend):
  - the new temp tables exist;
  - a vendor phone is absent;
  - a `DELETE`/`UPDATE` is rejected.
- `control.test.ts` (extend): each new `/apply` kind writes the right rows, and only in this wedding.
- `import.test.ts`:
  - a tiny fixture JSON (made-up names and a made-up owner) imports with the right side/status mapping and no phones;
  - only the fixture's owner can list it;
  - a second user, or no session, gets nothing;
  - its public invite returns 404 without the host token.
- Keep all existing tests green, and update the skill list.

## 11. Build order (one agent, on `master`)

Commit after every step, once `npm run typecheck && npm test && npm run build` passes and the pages look right at 390 px and 1280 px. Deploy (AGENTS.md command) after steps 1, 3, 5 and 7, and run `scripts/smoke.ts` against the live URL each time.

| # | Step |
|---|---|
| 1 | **Foundation:** schema for §3, §5 and §7 (all tables and columns at once); `server/auth.ts`; routes, `WeddingContext`, `WeddingShell` and the Ask Saathi drawer (§4, agent UI extracted from `Host.tsx` into `web/src/components/agent/*`); Login, My weddings, Create, Home; `tests/auth.test.ts` |
| 2 | **Your Wedding P0:** Guests → Vendors → Budget → Tasks → sample seed (§5.6) |
| 3 | **Baraati App P0:** Invitation & sharing → RSVPs → Events → Info & questions → Announcements |
| 4 | **AI Studio P0:** Invitation creator re-homed → Logo → WhatsApp message writer |
| 5 | **Import (§9):** private-wedding guards, `scripts/import-wedding.ts`, `tests/import.test.ts` |
| 6 | **P1:** agent upgrades (§8) → Make my checklist → AI guest import → quote reader → Sheets → Song + teaser → Rooms / Travel / Groups with their AI proposals |
| 7 | **P2:** Run sheet → Veo |
| 8 | **Wrap-up:** reseed the sample wedding (`scripts/seed-demo.ts`, update `DEMO_SLUG`), deploy, smoke test live, axe pass, update README and the AGENTS.md map |

**Smoke test (extend `scripts/smoke.ts`):** login → create (2 days) → add guest → add vendor + payment → budget totals → task → make-my-checklist proposal → apply → edit event → invite shows it → announcement → logo → message writer → agent "Is hafte kya pay karna hai?" → `/api/me/weddings` lists it. Every step prints PASS or FAIL.

## 12. Definition of done

- A judge can open the live link, tap **Try the sample wedding**, and in under two minutes see: a planner full of believable data, ask Saathi a Hinglish question, approve a proposal, see the invitation change, and make a logo.
- The founder can log in, unlock Srishti & Nishit with the passcode, and see their 150 guests, rooms and travel. No phone or email appears anywhere: grep the JSON responses.
- CI is green, axe shows 0 violations on every page at 390 px and 1280 px, and README + AGENTS.md describe the three sections.
