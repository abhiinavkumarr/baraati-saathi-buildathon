# AGENTS.md: working on Baraati Saathi

Read this before changing anything. It is the handoff for any coding agent
(Antigravity, Claude Code, Gemini) working in this repository.

## What this is

Baraati Saathi is the prototype for the Google DeepMind × Google Cloud Startup
Buildathon India 2026 (Pune). It turns a wedding card into a living
invitation, gives guests a Hindi/English voice concierge, and gives the host an
AI control room. The README has the full picture: product, architecture,
Google AI usage, security design and tests.

- **Live:** https://baraati-saathi-570792946314.asia-south1.run.app (Cloud Run,
  GCP project `baraati-saathi`, region `asia-south1`, AlloyDB cluster `saathi`)
- **Submission:** the founder handles timing and submission (live link, deck,
  demo video). Don't cut scope or rush for a deadline unless the founder asks.
  The deck and video live outside this repo (in the founder's Baraati workspace:
  `.claude/outputs/2026-11-15-startup-buildathon/`) and are regenerated after
  product changes.
- **What to build next:** `PLANNER_SPEC.md` (Saathi as a wedding planner),
  styled per `DESIGN.md`.
- **Branch:** `master`. CI (`.github/workflows/ci.yml`) runs typecheck, tests
  and build on every push.

## Rules

0. **Before every commit, run `npm run typecheck && npm test && npm run build`**
   and fix anything that fails. CI runs the same three on every push. When a
   change touches the UI, also open the page and check it at phone width.
1. **IP boundary.** The organiser gets a right of first refusal on submitted
   material, so this repo must never contain code copied from the Baraati app
   (React Native app, guest web, Supabase backend). Connecting to Baraati means
   calling its APIs over a documented boundary, not pasting its code in.
2. **No secrets in git or in commands.** The Gemini key, the DB password and
   the private-wedding passcode live in Secret Manager (`gemini-api-key`,
   `alloydb-password`, `owner-passcode` → env `OWNER_PASSCODE`); locally in
   `.env` (ignored). Never print them.
3. **Never invent traction or data** in copy, the deck or the seed. Demo seed
   guests have no phone numbers, so no real person is ever messaged.
4. **Guest privacy.** Follow `.agents/skills/guest-data-guardrails/SKILL.md`.
   Model-written SQL runs only through the sandbox in `server/insights.ts`
   (`saathi_reader` role, temp tables, rollback). Never add another path that
   runs model SQL, and never grant that role anything.
5. **The host decides.** Control-room tools only *propose* cards; changes
   happen in `POST /api/host/:slug/apply`. Keep it that way.
6. **Accessibility stays at zero axe violations** (WCAG 2.1 AA): label icon
   buttons, keep `:focus-visible`, respect `prefers-reduced-motion`.

## Map

```
server/
  index.ts      routes, rate limits, /api/health (db kind, demo slug)
  gemini.ts     Interactions API wrapper (apiVersion v1beta), fallback chains
  intake.ts     Act 1: card / chat / voice note → structured wedding
  design.ts     Act 2: card art, ceremony art (event_art), music, RSVP + note extraction
  saathi.ts     Act 3: guest chat (function calling), Gemini Live tokens + tool relay
  insights.ts   guest-list questions: text-to-SQL sandbox
  control.ts    host control room: agent, /apply, /briefing, announcements
  db.ts         AlloyDB via pg, or embedded PGlite fallback; sandbox()
  skills.ts     loads .agents/skills/*/SKILL.md
web/src/        React 19 + Vite: pages/Create, Studio, Invite, Host; Saathi.tsx, live.ts (voice)
.agents/skills/ 5 Agent Skills loaded at runtime (intake, card-designer, concierge, host-control-room, guardrails)
db/schema.sql   idempotent schema, runs on every start
tests/          node:test on in-memory PGlite (no API key needed)
scripts/        seed-demo, smoke (every flow PASS/FAIL), agent-test, e2e, live-test, probe-models
```

## Commands

```bash
npm install
npm run dev                 # API :8080, PGlite in .data/ (needs GEMINI_API_KEY in .env)
npm run dev:web             # Vite :5173, proxies /api
npm run typecheck && npm test && npm run build    # run before every commit
node --import tsx scripts/smoke.ts                # live check of every flow
node --import tsx scripts/seed-demo.ts <baseUrl>  # fresh demo wedding + links
```

Deploy (from **PowerShell**: Git Bash rewrites `/tmp` in env values):

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" run deploy baraati-saathi --source . --region asia-south1 --allow-unauthenticated --min-instances 1 --max-instances 1 --memory 1Gi --cpu 1 --timeout 300 --set-secrets "GEMINI_API_KEY=gemini-api-key:latest,DB_PASSWORD=alloydb-password:latest,OWNER_PASSCODE=owner-passcode:latest" --set-env-vars "PGLITE_DIR=/tmp/pglite,ALLOYDB_INSTANCE_URI=projects/baraati-saathi/locations/asia-south1/clusters/saathi/instances/saathi-primary,ALLOYDB_PROXY_FLAGS=--public-ip,DB_USER=postgres,DB_NAME=postgres,DEMO_SLUG=riya-kabir-edad262c" --quiet
```

`DEMO_SLUG` is the public sample invitation on the landing page. If you reseed,
update it. The current demo's host links are in `.data/seed-links.txt` (not
committed; host tokens are secret).

## Gotchas that already cost time

- `@google/genai` must use `apiVersion: 'v1beta'` for Interactions input parts.
- Nano Banana returns **JPEG only**; Free-tier keys get 0 image/music quota.
- Cloud Build: use `npm install` (the lockfile is written on Windows), and
  no `ADD --chmod` in the Dockerfile.
- A `useEffect` arrow that returns `scrollIntoView()` crashes React (newer
  browsers return a Promise, which React calls as cleanup). Use braces.
- CSS: the dashboard root is `main.host`; a bare `.host` also matches host chat bubbles.
- Puppeteer screencasts of a static page are 0 bytes; screenshot + ffmpeg instead.
- The control-room agent takes 11–17 s (several Gemini calls); keep the progress steps.
- After the event: delete the AlloyDB cluster and set Cloud Run min-instances to 0.
