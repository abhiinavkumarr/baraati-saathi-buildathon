// Renders the shareable card image (1080×1920 PNG): AI artwork with the couple's
// names, dates and venue laid on top as real text, so nothing is ever misspelled.
import type { WeddingDraft } from './api.ts';
import { themeFor } from './themes.ts';
import { fmtDate, fmtTime } from './format.ts';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function renderCard(d: WeddingDraft, artUrl?: string): Promise<Blob> {
  const W = 1080, H = 1920;
  const t = themeFor(d.style);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  await document.fonts.ready;

  g.fillStyle = t.bg;
  g.fillRect(0, 0, W, H);
  if (artUrl) {
    const img = await loadImage(artUrl);
    const s = Math.max(W / img.width, H / img.height);
    g.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
  }

  // Centre panel
  const px = 120, py = 420, pw = W - 240, ph = 1080;
  g.fillStyle = t.panel;
  g.beginPath();
  g.roundRect(px, py, pw, ph, 36);
  g.fill();
  g.strokeStyle = t.accent;
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(px + 18, py + 18, pw - 36, ph - 36, 26);
  g.stroke();

  g.textAlign = 'center';
  const cx = W / 2;
  let y = py + 120;
  const line = (text: string, font: string, color: string, gap: number, maxW = pw - 120) => {
    if (!text) return;
    g.font = font;
    g.fillStyle = color;
    // simple wrap
    const words = text.split(' ');
    let row = '';
    for (const w of words) {
      const test = row ? `${row} ${w}` : w;
      if (g.measureText(test).width > maxW && row) {
        g.fillText(row, cx, y);
        y += gap;
        row = w;
      } else row = test;
    }
    g.fillText(row, cx, y);
    y += gap;
  };

  line(d.invite_line, 'italic 500 34px "Cormorant Garamond", serif', t.soft, 46);
  y += 30;
  line('TOGETHER WITH THEIR FAMILIES', '600 24px "Plus Jakarta Sans", sans-serif', t.soft, 70);
  line(d.partner1_name, '600 128px "Cormorant Garamond", serif', t.ink, 120);
  line('&', 'italic 600 84px "Cormorant Garamond", serif', t.accent, 120);
  line(d.partner2_name, '600 128px "Cormorant Garamond", serif', t.ink, 110);
  y += 20;
  const main = d.events.find((e) => /phera|wedding|lagna|muhurtham|biye|shaadi|vivah/i.test(e.name)) ?? d.events.at(-1);
  if (main) {
    line(main.name.toUpperCase(), '700 30px "Plus Jakarta Sans", sans-serif', t.accent, 52);
    line([fmtDate(main.date), fmtTime(main.start_time)].filter(Boolean).join(' · '), '500 36px "Plus Jakarta Sans", sans-serif', t.ink, 52);
    line(main.venue_name, '500 34px "Plus Jakarta Sans", sans-serif', t.soft, 48);
  }
  if (d.city) line(d.city, 'italic 500 40px "Cormorant Garamond", serif', t.ink, 60);

  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}
