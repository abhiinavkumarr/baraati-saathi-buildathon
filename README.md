# Baraati Saathi

**From a wedding card to a concierge in three minutes.** An AI layer for Indian
weddings, built at the Google DeepMind × Google Cloud Startup Buildathon India 2026
by [Baraati](https://baraati.co.in), a wedding app live on iOS, Android and the web.

1. **Card → wedding.** Upload a photo or PDF of your card, or tell Saathi about
   your wedding by chat or voice note, in English, Hindi or Hinglish. Gemini
   builds the full ceremony schedule, suggesting ceremonies from your tradition.
2. **An invitation that moves.** Nano Banana paints card artwork in a regional
   style, Lyria composes the background music, and guests RSVP on a live link.
3. **Saathi, by voice.** Guests, including grandparents, ask in Hindi
   ("Haldi kab hai? Pickup hai?") and hear the answer from the wedding's own data.
   Anything Saathi can't answer goes to the host's inbox.

## Google AI and Google Cloud

| Piece | Used for |
|---|---|
| Gemini 3.8 Flash (Interactions API) | Reading cards and PDFs, the intake conversation, Saathi's reasoning |
| Gemini 3.8 Live | Real-time Hindi / English voice |
| Nano Banana 2.1 | Card artwork and couple illustration |
| Lyria 3 Clip | 30-second instrumental invitation music |
| AlloyDB for PostgreSQL | Weddings, RSVPs, guest questions and generated media, reached from Cloud Run through the AlloyDB Auth Proxy |
| Cloud Run | Hosting |
| Agent Skills (`.agents/skills/`) | The app's agents load their instructions from these SKILL.md files |

## Run locally

```bash
cp .env.example .env      # add GEMINI_API_KEY
npm install
npm run dev               # API on :8080 (local PGlite database in .data/)
npm run dev:web           # web on :5173, proxies /api
```

Set `DATABASE_URL` to an AlloyDB Express connection string to use AlloyDB instead of PGlite.

## Deploy to Cloud Run

The Dockerfile builds the web app and bundles the AlloyDB Auth Proxy.

```bash
# API key in Secret Manager, not in the command line
printf '%s' "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-

gcloud run deploy baraati-saathi --source . --region asia-south1 \
  --allow-unauthenticated --min-instances 1 --max-instances 1 --memory 1Gi \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars ALLOYDB_INSTANCE_URI=projects/P/locations/R/clusters/C/instances/I,ALLOYDB_PROXY_FLAGS=--public-ip,DB_USER=postgres,DB_NAME=postgres \
  --set-secrets DB_PASSWORD=alloydb-password:latest

# Seed the demo wedding and print its links
node --import tsx scripts/seed-demo.ts https://<service-url>
```

`/api/health` shows which database is in use. If AlloyDB can't be reached the
app falls back to an in-container PGlite database (kept alive by
`--min-instances 1`) and reports why.

## Privacy

Guest data rules live in `.agents/skills/guest-data-guardrails/SKILL.md`: every
query is scoped to the wedding and the guest, the model never sees raw phone
numbers, and there is no tool that can reach another guest's details.
