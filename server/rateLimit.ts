// In-memory fixed-window limiter. Enough for one Cloud Run instance at a demo;
// move to the database if the service scales out.
import type { RequestHandler } from 'express';

const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(name: string, max: number, windowMs: number): RequestHandler {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || '?';
    const key = `${name}:${ip}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      next();
      return;
    }
    if (++h.n > max) {
      res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
      return;
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 60_000).unref();
