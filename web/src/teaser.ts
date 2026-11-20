// Client-side 1080×1920 vertical invitation teaser renderer & WebM recorder (§7).
import type { WeddingDraft } from './api.ts';
import { fmtDate } from './format.ts';

export interface TeaserSlide {
  title: string;
  subtitle: string;
  imageUrl?: string;
}

export function buildTeaserSlides(
  draft: WeddingDraft,
  assets: { card_art?: string; events?: Record<string, string> },
): TeaserSlide[] {
  const couple = `${draft.partner1_name} & ${draft.partner2_name}`;
  const dates = [...new Set(draft.events.map((e) => e.date).filter(Boolean))].sort();
  const dateLine = dates[0] ? fmtDate(dates[0], { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const slides: TeaserSlide[] = [
    {
      title: couple,
      subtitle: [dateLine, draft.city].filter(Boolean).join(' · '),
      imageUrl: assets.card_art ? `/api/assets/${assets.card_art}` : undefined,
    },
  ];
  for (const ev of draft.events.slice(0, 4)) {
    const artId = assets.events?.[ev.name];
    slides.push({
      title: ev.name,
      subtitle: [ev.date ? fmtDate(ev.date, { day: 'numeric', month: 'short' }) : '', ev.venue_name].filter(Boolean).join(' · '),
      imageUrl: artId ? `/api/assets/${artId}` : assets.card_art ? `/api/assets/${assets.card_art}` : undefined,
    });
  }
  slides.push({
    title: 'Save the Date',
    subtitle: couple,
    imageUrl: draft.logo_asset_id ? `/api/assets/${draft.logo_asset_id}` : assets.card_art ? `/api/assets/${assets.card_art}` : undefined,
  });
  return slides;
}

function loadImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function drawSlideFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  slide: TeaserSlide,
  img: HTMLImageElement | null,
  progress: number, // 0..1 within slide
  reducedMotion: boolean,
) {
  ctx.fillStyle = '#1F1226';
  ctx.fillRect(0, 0, w, h);

  if (img) {
    const scale = reducedMotion ? 1.04 : 1.02 + progress * 0.08;
    const iw = img.naturalWidth || w;
    const ih = img.naturalHeight || h;
    const cover = Math.max(w / iw, h / ih) * scale;
    const dw = iw * cover;
    const dh = ih * cover;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // Soft dark vignette for crisp text readability
  const grad = ctx.createLinearGradient(0, h * 0.45, 0, h);
  grad.addColorStop(0, 'rgba(31,18,38,0.12)');
  grad.addColorStop(1, 'rgba(31,18,38,0.88)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${Math.round(w * 0.085)}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillText(slide.title, w / 2, h * 0.78, w * 0.86);

  if (slide.subtitle) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `500 ${Math.round(w * 0.04)}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(slide.subtitle, w / 2, h * 0.84, w * 0.86);
  }
}

export async function renderTeaserVideo(
  canvas: HTMLCanvasElement,
  slides: TeaserSlide[],
  musicUrl?: string,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported.');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const imgs = await Promise.all(slides.map((s) => (s.imageUrl ? loadImg(s.imageUrl) : Promise.resolve(null))));

  const stream = canvas.captureStream(30);
  let audioEl: HTMLAudioElement | null = null;
  if (musicUrl) {
    try {
      audioEl = new Audio(musicUrl);
      audioEl.crossOrigin = 'anonymous';
      const audioCtx = new AudioContext();
      const src = audioCtx.createMediaElementSource(audioEl);
      const dest = audioCtx.createMediaStreamDestination();
      src.connect(dest);
      src.connect(audioCtx.destination);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      await audioEl.play().catch(() => {});
    } catch {
      /* continue silent if browser blocks audio capture */
    }
  }

  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const totalMs = Math.min(20_000, Math.max(10_000, slides.length * 3200));
  const slideMs = totalMs / slides.length;

  return new Promise((resolve, reject) => {
    rec.onerror = () => reject(new Error('Recording failed.'));
    rec.onstop = () => {
      audioEl?.pause();
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
    rec.start();
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= totalMs) {
        onProgress?.(100);
        rec.stop();
        return;
      }
      const idx = Math.min(slides.length - 1, Math.floor(elapsed / slideMs));
      const p = (elapsed - idx * slideMs) / slideMs;
      drawSlideFrame(ctx, canvas.width, canvas.height, slides[idx], imgs[idx], p, reducedMotion);
      onProgress?.(Math.round((elapsed / totalMs) * 100));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
