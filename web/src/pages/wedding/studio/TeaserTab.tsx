import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileToAttachment, post, type WeddingDraft } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';
import { buildTeaserSlides, drawSlideFrame, renderTeaserVideo } from '../../../teaser.ts';

export function TeaserTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [draft, setDraft] = useState<WeddingDraft | null>(null);
  const [assets, setAssets] = useState<{ card_art?: string; music?: string; events?: Record<string, string> }>({});
  const [musicBusy, setMusicBusy] = useState(false);
  const [recPct, setRecPct] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      setDraft(j.draft);
      setAssets(j.assets ?? {});
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const slides = useMemo(() => (draft ? buildTeaserSlides(draft, assets) : []), [draft, assets]);

  // Draw preview frame onto canvas
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !slides.length) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (slides[0].imageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => drawSlideFrame(ctx, c.width, c.height, slides[0], img, 0, true);
      img.onerror = () => drawSlideFrame(ctx, c.width, c.height, slides[0], null, 0, true);
      img.src = slides[0].imageUrl;
    } else {
      drawSlideFrame(ctx, c.width, c.height, slides[0], null, 0, true);
    }
  }, [slides]);

  async function makeMusic() {
    setMusicBusy(true);
    setError('');
    try {
      await post(`/api/weddings/${slug}/music`, { host_token: token });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not compose music.');
    } finally {
      setMusicBusy(false);
    }
  }

  async function recordTeaser() {
    const c = canvasRef.current;
    if (!c || !slides.length) return;
    setError('');
    setRecPct(0);
    try {
      const musicUrl = assets.music ? `/api/assets/${assets.music}` : undefined;
      const blob = await renderTeaserVideo(c, slides, musicUrl, setRecPct);
      const localUrl = URL.createObjectURL(blob);
      setVideoUrl(localUrl);
      // Save to server as asset kind='teaser'
      const att = await fileToAttachment(blob, `${slug}-teaser.webm`);
      await post(`/api/weddings/${slug}/teaser`, { t: token, mime_type: 'video/webm', data: att.data }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record teaser video.');
    } finally {
      setRecPct(null);
    }
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">AI Studio</p>
          <h1 className="h2">Song &amp; <span className="serif">video teaser</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Compose an instrumental wedding theme with Lyria and render a 1080×1920 vertical Save-the-Date video teaser.
          </p>
        </div>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      <div className="pl-home-grid">
        <section className="card">
          <p className="eyebrow">Lyria music</p>
          <h2 className="h3" style={{ margin: '0 0 10px' }}>Invitation soundtrack</h2>
          <p className="muted small">30-second instrumental theme matched to your card style and tradition.</p>
          {assets.music && (
            <audio controls src={`/api/assets/${assets.music}`} style={{ width: '100%', margin: '12px 0' }} />
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={musicBusy} onClick={() => void makeMusic()}>
            {musicBusy ? 'Composing with Lyria…' : assets.music ? '✦ Compose new track' : '✦ Compose invitation song'}
          </button>
        </section>

        <section className="card">
          <p className="eyebrow">Vertical video (9:16)</p>
          <h2 className="h3" style={{ margin: '0 0 10px' }}>Save-the-Date teaser</h2>
          <div className="pl-teaser-wrap">
            <canvas ref={canvasRef} width={540} height={960} className="pl-teaser-canvas" aria-label="Wedding teaser canvas preview" />
          </div>
          <div className="pl-row-btns" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-cta btn-sm" disabled={recPct !== null || !slides.length} onClick={() => void recordTeaser()}>
              {recPct !== null ? `Rendering ${recPct}%…` : '✦ Render & download video'}
            </button>
            {videoUrl && (
              <a className="btn btn-outline btn-sm" href={videoUrl} download={`${slug}-teaser.webm`}>
                Download WebM ↗
              </a>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
