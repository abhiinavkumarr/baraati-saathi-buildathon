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
| AlloyDB Express | Weddings, RSVPs, questions; `AI.EXTRACT()` on RSVP notes, vector search over info |
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

```bash
gcloud run deploy baraati-saathi --source . --region asia-south1 \
  --allow-unauthenticated --set-env-vars GEMINI_API_KEY=...,DATABASE_URL=...
```

## Privacy

Guest data rules live in `.agents/skills/guest-data-guardrails/SKILL.md`: every
query is scoped to the wedding and the guest, the model never sees raw phone
numbers, and there is no tool that can reach another guest's details.
