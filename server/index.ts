import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { intakeRouter } from './intake.ts';
import { HttpError, MODELS } from './gemini.ts';
import { getDb } from './db.ts';
import { skillMenu } from './skills.ts';

const app = express();
app.use(express.json({ limit: '30mb' }));

app.get('/api/health', async (_req, res) => {
  const db = await getDb();
  res.json({
    ok: true,
    db: db.kind,
    gemini: Boolean(process.env.GEMINI_API_KEY),
    models: MODELS,
    skills: skillMenu().map((s) => s.name),
  });
});

app.use('/api', intakeRouter);

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
