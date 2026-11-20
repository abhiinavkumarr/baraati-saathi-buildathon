import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { intakeRouter } from './intake.ts';
import { designRouter } from './design.ts';
import { rateLimit } from './rateLimit.ts';
import { saathiRouter } from './saathi.ts';
import { insightsRouter } from './insights.ts';
import { controlRouter } from './control.ts';
import { HttpError, MODELS } from './gemini.ts';
import { getDb } from './db.ts';
import { skillMenu } from './skills.ts';

const app = express();
app.set('trust proxy', true); // Cloud Run sits behind Google's front end
app.use(express.json({ limit: '30mb' }));

app.get('/api/health', async (_req, res) => {
  const db = await getDb();
  res.json({
    ok: true,
    db: db.kind,
    ...(db.note ? { db_note: db.note } : {}),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    models: MODELS,
    skills: skillMenu().map((s) => s.name),
  });
});

const TEN_MIN = 10 * 60_000;
app.use('/api/intake', rateLimit('intake', 40, TEN_MIN));
app.use(/^\/api\/weddings\/[^/]+\/(art|music|event-art)$/, rateLimit('media', 30, TEN_MIN));
app.use(/^\/api\/weddings\/[^/]+\/rsvp$/, rateLimit('rsvp', 20, TEN_MIN));
app.use(/^\/api\/saathi\/[^/]+\/chat$/, rateLimit('chat', 40, TEN_MIN));
app.use(/^\/api\/saathi\/[^/]+\/live-token$/, rateLimit('live', 15, TEN_MIN));
app.use(/^\/api\/saathi\/[^/]+\/tool$/, rateLimit('tool', 200, TEN_MIN));
app.use(/^\/api\/host\/[^/]+\/ask$/, rateLimit('ask', 30, TEN_MIN));
app.use(/^\/api\/host\/[^/]+\/agent$/, rateLimit('agent', 40, TEN_MIN));
app.use(/^\/api\/host\/[^/]+\/(apply|briefing)$/, rateLimit('host', 300, TEN_MIN));
app.use('/api', intakeRouter);
app.use('/api', designRouter);
app.use('/api', saathiRouter);
app.use('/api', insightsRouter);
app.use('/api', controlRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Serve the built web app (npm run build) and let the client router handle paths.
const webDist = fileURLToPath(new URL('../dist/web/', import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(webDist + 'index.html'));
}

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};
app.use(onError);

const port = Number(process.env.PORT) || 8080;
await getDb();
app.listen(port, () => console.log(`[saathi] listening on http://localhost:${port}`));
