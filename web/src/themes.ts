// Visual theme per card style. Used for the built-in ornamental artwork (shown
// until, or instead of, the Nano Banana artwork) and for typography colours.
export interface Theme {
  bg: string; // page background
  panel: string; // centre text panel
  ink: string; // main text
  accent: string; // ornaments, ampersand
  soft: string; // secondary text
  display: string; // couple-name font
}

const T: Record<string, Theme> = {
  'royal-rajasthani': { bg: '#5c0f1f', panel: 'rgba(255,248,235,0.92)', ink: '#3b0a14', accent: '#c9a84c', soft: '#7a4a3a', display: "'Cormorant Garamond', serif" },
  'south-indian-temple': { bg: '#7a1414', panel: 'rgba(255,246,225,0.93)', ink: '#4a0d0d', accent: '#e0a526', soft: '#7d4b1f', display: "'Cormorant Garamond', serif" },
  'bengali-alpana': { bg: '#a3121c', panel: 'rgba(255,255,255,0.94)', ink: '#5a0910', accent: '#ffffff', soft: '#8a3a3f', display: "'Cormorant Garamond', serif" },
  'punjabi-phulkari': { bg: '#b0145e', panel: 'rgba(255,250,240,0.93)', ink: '#5e0a33', accent: '#f4a300', soft: '#8a3d5c', display: "'Cormorant Garamond', serif" },
  'minimal-pastel': { bg: '#efe4dc', panel: 'rgba(255,255,255,0.9)', ink: '#3d3a36', accent: '#b9a07a', soft: '#7d776f', display: "'Cormorant Garamond', serif" },
  'modern-floral': { bg: '#e9d6d2', panel: 'rgba(255,253,250,0.92)', ink: '#3a2a2e', accent: '#c19a5b', soft: '#7c6468', display: "'Cormorant Garamond', serif" },
};

export function themeFor(style: string): Theme {
  return T[style] ?? T['royal-rajasthani'];
}

/** A tiled ornamental SVG (mandala rosettes + border) as a CSS background URL. */
export function ornamentUrl(style: string): string {
  const t = themeFor(style);
  const petals = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const x = 40 + Math.cos(a) * 18;
    const y = 40 + Math.sin(a) * 18;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="7" ry="3" transform="rotate(${i * 30} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <rect width="80" height="80" fill="${t.bg}"/>
    <g fill="none" stroke="${t.accent}" stroke-opacity="0.55" stroke-width="0.8">${petals}
      <circle cx="40" cy="40" r="6"/><circle cx="40" cy="40" r="28" stroke-dasharray="2 3"/>
      <path d="M0 0 L10 0 M0 0 L0 10 M80 80 L70 80 M80 80 L80 70"/></g>
    <g fill="${t.accent}" fill-opacity="0.5"><circle cx="0" cy="40" r="2"/><circle cx="80" cy="40" r="2"/>
      <circle cx="40" cy="0" r="2"/><circle cx="40" cy="80" r="2"/></g></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/** The six invitation styles, in the order hosts and guests see them. */
export const TEMPLATE_STYLES: { id: string; label: string; sub: string }[] = [
  { id: 'royal-rajasthani', label: 'Royal Rajasthani', sub: 'Arches, peacocks, maroon and gold' },
  { id: 'south-indian-temple', label: 'South Indian temple', sub: 'Gopurams, brass lamps, jasmine' },
  { id: 'bengali-alpana', label: 'Bengali alpana', sub: 'Rice-paste patterns, red and white' },
  { id: 'punjabi-phulkari', label: 'Punjabi phulkari', sub: 'Embroidery, marigolds, magenta' },
  { id: 'minimal-pastel', label: 'Minimal pastel', sub: 'Fine-line florals, blush and sage' },
  { id: 'modern-floral', label: 'Modern floral', sub: 'Watercolour roses, gold foil' },
];
