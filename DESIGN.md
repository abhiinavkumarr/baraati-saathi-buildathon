# DESIGN.md: Baraati Saathi visual system

This file is the single source of truth for how Saathi looks. It brings the
product in line with the **Baraati website** (baraati.co.in): warm cream
paper, deep aubergine ink, a saffron-to-rose gradient used sparingly, big
confident sans-serif headlines with one italic serif word, pill buttons and
soft, rounded cards.

Read `AGENTS.md` first (rules, commands). Then apply this file in the order
given in **Rollout**. Change styling only. Do not change behaviour, routes,
API calls or copy unless this file says so.

---

## 1. The feel, in five lines

1. **Paper, not app chrome.** Cream background, white cards, hairline borders,
   generous space. It should feel like a premium wedding stationer, not a SaaS
   admin.
2. **Ink is the primary colour.** Main buttons are deep ink (`#1F1226`) pills.
   The saffron/rose gradient is the accent: at most one gradient element per
   screen (the hero word, the one main call to action, a progress bar).
3. **One italic serif word per headline.** `Plan the wedding, <em>not the
   chaos.</em>` The italic word uses Instrument Serif. Everything else is Plus
   Jakarta Sans, bold, tight letter-spacing.
4. **Round and soft.** Pills (999px) for buttons, chips, inputs. Cards 24–28px
   radius with a long, low shadow. No hard 1.5px beige borders.
5. **Calm motion.** Short lifts on hover (-1 to -4px), fades on reveal. Nothing
   loops except an intentional "AI is working" shimmer. Respect
   `prefers-reduced-motion`.

---

## 2. Fonts

Replace the Google Fonts `<link>` in `web/index.html` with:

```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Tiro+Devanagari+Hindi&display=swap" rel="stylesheet" />
```

| Role | Font | Notes |
|---|---|---|
| UI, body, headings | **Plus Jakarta Sans** 400/500/600/700/800 | Headings 700–800, `letter-spacing: -0.03em`, `line-height: 1.05` |
| Accent word in headings, big numbers in quotes | **Instrument Serif** *italic* 400 | Class `.serif`. Never for body text or buttons |
| Couple names **on the invitation card only** | Cormorant Garamond (keep) | Stays inside `.invite`. Product UI no longer uses it |
| Hindi text | Tiro Devanagari Hindi | Wrap Hindi in `lang="hi"`; add `:lang(hi) { font-family: 'Tiro Devanagari Hindi', 'Plus Jakarta Sans', sans-serif; }` |

The existing `.display` class (Cormorant) becomes the product headline style:
Plus Jakarta Sans 800. Use `.serif` for the italic accent inside it.

---

## 3. Tokens: drop-in `:root`

Replace the `:root` block at the top of `web/src/styles.css` with this. The old
variable names (`--cream`, `--surface`, `--rose`, `--gold`, `--gold-dp`) are kept
as aliases so existing CSS keeps working while you migrate.

```css
:root {
  /* Surfaces */
  --bg:        #FBF7F1;   /* page */
  --bg-2:      #F4ECE0;   /* sunken panels, table headers, chat composer */
  --bg-warm:   #FFF1E6;   /* soft section wash (gradient end) */
  --card:      #FFFFFF;
  --line:      rgba(31, 18, 38, 0.08);   /* hairline borders */
  --line-2:    rgba(31, 18, 38, 0.14);   /* inputs, stronger dividers */

  /* Ink */
  --ink:       #1F1226;   /* text, primary buttons, dark sections */
  --ink-2:     #4B3B55;   /* secondary text */
  --muted:     #6B5F73;   /* captions, labels (5.5:1 on --bg) */
  --on-ink:    #FFFFFF;

  /* Brand accents (decorative fills, blobs, bars, icons) */
  --saffron:   #FF8A3D;
  --rose:      #FF4D6D;
  --pink:      #EC4899;
  --violet:    #6D5BFF;
  --grad-saffron: linear-gradient(135deg, #FF8A3D 0%, #FF4D6D 100%);
  --grad-dusk:    linear-gradient(135deg, #FF8A3D 0%, #EC4899 50%, #6D5BFF 100%);
  --grad-peach:   linear-gradient(135deg, #FFE7F1 0%, #FFD5A3 100%);
  --grad-lilac:   linear-gradient(135deg, #DBEAFE 0%, #E9D5FF 100%);

  /* Accessible accents: use these whenever the accent carries TEXT */
  --rose-ink:  #C81E4A;   /* rose text/links on cream or white (5.6:1) */
  --grad-cta:  linear-gradient(135deg, #C2410C 0%, #C81E4A 100%); /* white text passes 4.5:1 */

  /* Status (text colours pass 4.5:1 on white; use the -bg for pills) */
  --ok:    #157347;  --ok-bg:    #E7F6EE;
  --warn:  #9A5B00;  --warn-bg:  #FFF4DD;
  --bad:   #B42318;  --bad-bg:   #FDECEA;
  --ai:    #5B3FD9;  --ai-bg:    #EFEBFF;   /* "Saathi / AI did this" marker */

  /* Shape */
  --r-pill: 999px;
  --r-card: 28px;
  --r-md:   20px;
  --r-sm:   14px;

  /* Elevation */
  --shadow-card:  0 1px 0 rgba(255,255,255,0.6) inset, 0 30px 60px -30px rgba(31,18,38,0.12);
  --shadow-float: 0 20px 50px -20px rgba(31,18,38,0.20);
  --shadow-btn:   0 8px 24px rgba(31,18,38,0.18);
  --shadow-cta:   0 12px 28px rgba(200,30,74,0.30);

  /* Motion */
  --ease: cubic-bezier(.2,.7,.2,1);
  --t-fast: .15s;
  --t: .25s;

  /* Legacy aliases: remove once nothing references them */
  --cream:   var(--bg);
  --surface: var(--bg-2);
  --gold:    var(--saffron);
  --gold-dp: var(--rose-ink);

  color-scheme: light;
}

::selection { background: var(--rose); color: #fff; }
```

**Contrast rule (keeps axe at 0):** the bright accents (`--saffron`, `--rose`,
`--pink`, `--grad-saffron`, `--grad-dusk`) fail as text colours and fail with
white text on top. Use them only for decoration (blobs, bars, dots, icon
backgrounds, borders) or behind **ink** text. Any accent **text** uses
`--rose-ink`; any gradient **button** uses `--grad-cta`. Gradient headline words
use `--grad-cta` with `background-clip: text`, and keep `color: var(--rose-ink)`
as the fallback before the `transparent`.

---

## 4. Type scale

```css
h1, .h1 { font-size: clamp(36px, 6vw, 64px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; }
h2, .h2 { font-size: clamp(28px, 4vw, 44px); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }
h3, .h3 { font-size: clamp(18px, 2vw, 22px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; }
p { line-height: 1.6; }
.lead   { font-size: 18px; color: var(--ink-2); max-width: 560px; }
.small  { font-size: 14px; }
.tiny   { font-size: 12px; }
.serif  { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; letter-spacing: -0.01em; }
.grad-text { color: var(--rose-ink); background: var(--grad-cta); -webkit-background-clip: text; background-clip: text; color: transparent; }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; }
.num    { font-weight: 800; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
```

The old `.eyebrow` (gold, 3px tracking) becomes this muted, 0.09em version.
Headline pattern everywhere: `<h1>Your wedding, <span class="serif grad-text">handled.</span></h1>`.

---

## 5. Components

Put shared components in `web/src/styles.css`. Page files (`workspace.css`,
`control.css`, `act2.css`, `act3.css`) should only hold layout, and use the
tokens.

### Buttons

```css
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; padding: 12px 22px; border-radius: var(--r-pill); border: none;
  font: 600 15px/1 'Plus Jakarta Sans', sans-serif; letter-spacing: -0.01em; text-decoration: none; cursor: pointer;
  transition: transform var(--t-fast) var(--ease), box-shadow var(--t) var(--ease), background var(--t); }
.btn:hover { transform: translateY(-1px); }
.btn:disabled { opacity: .5; transform: none; cursor: not-allowed; }
.btn-primary { background: var(--ink); color: var(--on-ink); box-shadow: var(--shadow-btn); }
.btn-cta     { background: var(--grad-cta); color: #fff; box-shadow: var(--shadow-cta); }   /* one per screen */
.btn-ghost   { background: rgba(31,18,38,0.06); color: var(--ink); }
.btn-ghost:hover { background: rgba(31,18,38,0.10); }
.btn-outline { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-2); }
.btn-white   { background: #fff; color: var(--ink); box-shadow: 0 12px 32px rgba(0,0,0,.15); }  /* on ink panels */
.btn-sm { min-height: 36px; padding: 8px 14px; font-size: 14px; }
.icon-btn { width: 44px; height: 44px; border-radius: var(--r-pill); border: none;
  display: grid; place-items: center; background: rgba(31,18,38,0.06); color: var(--ink); }
```

Map existing classes: `.send` → `.btn .btn-primary`; `.pill.solid` → `.btn .btn-primary .btn-sm`;
`.pill` → `.btn .btn-outline .btn-sm`; Publish on proposal cards → `.btn-cta`;
Dismiss → `.btn-ghost`. Recording mic (`.icon-btn.rec`) → `background: var(--rose-ink); color:#fff`
with a soft ring pulse (`box-shadow: 0 0 0 6px rgba(255,77,109,.25)`), not an opacity blink.

### Chips, badges, pills

```css
.chip { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 8px 14px;
  border-radius: var(--r-pill); font-size: 13px; font-weight: 500;
  background: rgba(31,18,38,0.04); border: 1px solid var(--line); color: var(--ink-2); }
.chip:hover { background: rgba(31,18,38,0.08); color: var(--ink); }
.chip[aria-pressed="true"], .chip.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.chip .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--rose); box-shadow: 0 0 0 4px rgba(255,77,109,.18); }

.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: var(--r-pill);
  font-size: 12px; font-weight: 700; background: var(--bg-2); color: var(--ink-2); }
.badge.ok { background: var(--ok-bg); color: var(--ok); }
.badge.warn { background: var(--warn-bg); color: var(--warn); }
.badge.bad { background: var(--bad-bg); color: var(--bad); }
.badge.ai { background: var(--ai-bg); color: var(--ai); }   /* prefix with ✦ */
```

RSVP status everywhere: Coming = `ok`, Maybe = `warn`, Can't come = `bad`,
Pending = plain.

### Cards and panels

```css
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r-card);
  box-shadow: var(--shadow-card); padding: 28px; }
.card-sm { border-radius: var(--r-md); padding: 20px; }
.card-hover { transition: transform var(--t) var(--ease); }
.card-hover:hover { transform: translateY(-4px); }
.glass { background: rgba(255,255,255,0.72); backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%); border: 1px solid rgba(255,255,255,0.75); box-shadow: var(--shadow-float); }
.panel-ink { background: var(--ink); color: #fff; border-radius: 40px; }      /* the one dark hero block */
.panel-ink .muted { color: rgba(255,255,255,0.65); }
.panel-peach { background: var(--grad-peach); border-radius: var(--r-card); }  /* feature/highlight cards */
.panel-lilac { background: var(--grad-lilac); border-radius: var(--r-card); }
```

`.cr-card`, `.choice`, `.ws-section` boxes, stat tiles and RSVP rows all become
`.card` / `.card-sm`. Remove every `border: 1.5px solid var(--line)` in favour of
the hairline `1px solid var(--line)` plus `--shadow-card`.

### Inputs

```css
.input, input[type=text], input[type=email], input[type=tel], input[type=date], input[type=time], select, textarea {
  width: 100%; min-height: 48px; padding: 12px 18px; border-radius: var(--r-pill);
  border: 1px solid var(--line-2); background: #fff; color: var(--ink); font: 500 15px 'Plus Jakarta Sans', sans-serif; }
textarea { border-radius: var(--r-md); min-height: 96px; }
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--ink); box-shadow: 0 0 0 4px rgba(31,18,38,0.08); }
label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
```

### Chat (Saathi and the control-room agent)

```css
.chat { background: var(--card); border: 1px solid var(--line); border-radius: var(--r-card); box-shadow: var(--shadow-card); }
.bubble { max-width: 82%; padding: 12px 16px; border-radius: 20px; line-height: 1.5; font-size: 15px; }
.bubble.saathi { background: var(--bg-2); color: var(--ink); border-bottom-left-radius: 6px; }
.bubble.host, .bubble.me { background: var(--ink); color: #fff; border-bottom-right-radius: 6px; }
.composer { padding: 12px; border-top: 1px solid var(--line); background: var(--card); border-radius: 0 0 var(--r-card) var(--r-card); }
.typing { color: var(--muted); }   /* three dots, not italic text */
```

Saathi's avatar is a 32px circle with `--grad-saffron` and a white "स" or ✦.
"Working" progress steps (control room): a vertical list with a 2px `--line`
rail; the current step has a small `--grad-saffron` dot with a soft pulse; done
steps get a `--ok` check. Keep the steps (the agent takes 11–17 s).

### Proposal cards (control room)

White `.card` with a 4px left accent bar in `--grad-saffron`, a `badge ai`
"✦ Saathi suggests" header, the change as a before → after row (old value
struck through in `--muted`, new value bold ink), EN / हिं as a segmented pill
toggle (`.chip` pair, active one ink), then `[Publish]` `.btn-cta` and
`[Dismiss]` `.btn-ghost` right-aligned. After publishing, the card collapses to
a `badge ok` "Published" line plus the WhatsApp list.

### Stat tiles and charts

- Stat tile: `.card-sm`, label `.eyebrow`, number `.num` 40–44px in ink, a one-line
  `--muted` caption. At most one tile may use `.grad-text` (the headline number).
- Charts (Arrivals, food needs): bars filled `--saffron`, a second series
  `--violet`, gridlines `--line`, axis text `--muted` 12px, bar radius 6px. Label
  values directly on bars; no legend if there is one series.

### Top bar and tabs

```css
.topbar { position: sticky; top: 0; z-index: 50; background: rgba(251,247,241,0.82);
  backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--line); }
.tabs { display: flex; gap: 4px; padding: 4px; background: rgba(31,18,38,0.05); border-radius: var(--r-pill); overflow-x: auto; }
.tabs [role=tab] { padding: 8px 16px; border-radius: var(--r-pill); font-weight: 600; font-size: 14px; color: var(--ink-2); background: none; border: none; white-space: nowrap; }
.tabs [role=tab][aria-selected=true] { background: #fff; color: var(--ink); box-shadow: 0 2px 8px rgba(31,18,38,0.08); }
```

Brand mark: the wordmark `Baraati` in Plus Jakarta Sans 700, 20px,
`letter-spacing: -0.03em`, followed by `Saathi` in `.serif` with `.grad-text`.
Drop the old spaced-out gold `B A R A A T I` wordmark.

### Empty, loading and error states

- Empty: centred, a 56px circle icon on `--grad-peach`, an `h3`, one muted line,
  one `.btn-primary`.
- Loading: skeleton blocks in `--bg-2` with a slow left-to-right shimmer
  (disabled under reduced motion). No spinners on full pages.
- Error: `badge bad` + one plain sentence + a Retry `.btn-ghost`. Never show raw
  error text.

### Focus and motion (global)

```css
:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: inherit; }
.panel-ink :focus-visible { outline-color: #fff; }
.reveal { opacity: 0; transform: translateY(20px); transition: opacity .6s var(--ease), transform .6s var(--ease); }
.reveal.visible { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .reveal { opacity: 1; transform: none; }
}
```

---

## 6. Layout

- Page container: `max-width: 1180px; margin: 0 auto; padding: 0 32px`; at
  ≤ 480px the gutter is **16px**. No horizontal scroll at 360px width.
- Section rhythm: 64–96px between major sections on desktop, 40–56px on phone.
- Grids: 12px gap for tiles, 18–20px for cards. Two-column layouts collapse to
  one column at 860px.
- Background washes: a page may have up to two soft radial blobs
  (`radial-gradient(circle, rgba(255,138,61,.18), transparent 60%)` top-right and
  `rgba(109,91,255,.14)` bottom-left), `pointer-events: none`, never behind text
  that would lose contrast.
- Touch targets ≥ 44px.

---

## 7. Page by page

### Login (`pages/Login.tsx`)
Split layout on desktop: left = brand, `h1` "Your wedding's <span class="serif
grad-text">Saathi</span>", `.lead` one line, three small ✓ points; right = a
`.glass` card on a peach blob holding the form. Phone: single column, form
first after the headline. Primary action `.btn-cta` full width.

### Workspace (`pages/Workspace.tsx`, `workspace.css`)
- `.ws-top` → `.topbar` with brand mark left, wedding switcher (`.ws-wedding-pill`)
  as a `.chip` with the couple's names, user menu right.
- `.ws-tabs` → `.tabs` segmented control.
- Each `.ws-section` → `.card`, heading `h3` + `.eyebrow` above it.
- `.ws-h1` → `.h2` with one `.serif` word.
- Task lists / budget rows: rows inside one card separated by `--line`
  dividers, not a card per row. Amounts right-aligned `.num`.
- `.badge.ai` keeps meaning "created by Saathi".

### Create (`pages/Create.tsx`)
- Landing: website-style hero. Left: `.chip` with dot "Google DeepMind ×
  Google Cloud Buildathon", `h1` with `.serif grad-text` word, `.lead`, buttons
  `.btn-cta` (Create) + `.btn-ghost` (See a sample). Right: the live sample
  invitation iframe in a phone frame (36px radius, `--shadow-float`) on a
  saffron glow.
- The 4 steps: numbered circles (56px, `--grad-cta`, white bold number) joined
  by a 1px `--line` rail, like the website's "How it works".
- Choice cards (`.choice`) → `.card .card-hover`; icon in a 48px rounded square
  on `--grad-peach`.
- Style tiles: `.card-sm` with the theme swatch; selected tile gets
  `box-shadow: 0 0 0 2px var(--ink)` and a ✓.
- Live mini card and checklist sit in a sticky right column (`top: 88px`).

### Studio (`pages/Studio.tsx`)
Gallery of generated assets on white `.card`s with 20px radius images. Each
job shows status with `badge` (`ai` while generating, `ok` done, `bad` failed)
and a slim `--grad-saffron` progress bar. Copy buttons are `.btn-ghost .btn-sm`.

### Host control room (`pages/Host.tsx`, `control.css`, root `main.host`)
This is the hero moment, so it gets the one dark block:
- Header: `.panel-ink` (40px radius) with couple names (`h1`, `.serif` on the
  ampersand), days-to-go as a big `.num`, and the agent composer inside it
  (white input, `.btn-white` send, mic `.icon-btn` on `rgba(255,255,255,.12)`).
  Starter prompts are chips with `background: rgba(255,255,255,.1); color:#fff`.
- Below: stat tiles row (4 → 2 → 1 columns), then a two-column body: left the
  agent conversation + proposal cards, right the briefing (each insight a
  `.panel-peach` card with "Ask Saathi to do it →" as a `.btn-white .btn-sm`),
  arrivals chart, food needs, questions inbox.
- Keep scoping to `main.host` (a bare `.host` also matches chat bubbles).

### Invitation (`pages/Invite.tsx`, `act2.css`)
**Leave the card art and per-style themes (`themes.ts`, `--i-*` variables)
alone.** The invitation is the couple's stationery, not Baraati chrome. Only
restyle the chrome around it to the system: RSVP form inputs and buttons
(`.btn-cta` for "Send RSVP", ghost for the others), the update banner (a
`.glass` pill with a `--rose` dot), "Add to calendar" as `.btn-outline .btn-sm`,
and the footer "Made with Baraati Saathi" line in `--muted`.

### Saathi widget (`Saathi.tsx`, `act3.css`)
Floating launcher: 56px circle, `--grad-saffron` background, white ✦ glyph, label
"Ask Saathi" in a white pill beside it on desktop. Panel: `.card` 28px radius,
`--shadow-float`, header with avatar + "Saathi" + a small `badge ai` "Hindi ·
English", chat styles from §5. On phones the panel is a bottom sheet
(`border-radius: 28px 28px 0 0`, full width).

---

## 8. Don'ts

- No gold `#C9A84C` / `#8B6914` in product UI any more (it was the old app
  accent). Gold may remain inside invitation themes only.
- No Cormorant Garamond outside `.invite`.
- No white text on `--saffron`, `--rose`, `--grad-saffron` or `--grad-dusk`.
- No more than one `.btn-cta` and one gradient headline word per screen.
- No 1.5px borders, no square corners on buttons or inputs, no drop shadows
  darker than the tokens.
- No emoji as the only label of a button: icon buttons need `aria-label`.
- No new colours outside the tokens. If something needs one, add a token here
  first.
- Don't change copy, routes, data flow or API calls while restyling.

---

## 9. Rollout (do it in this order, one commit per step)

1. **Foundation:** fonts in `web/index.html`; tokens, type, buttons, chips,
   badges, cards, inputs, focus and motion into `web/src/styles.css`. Keep the
   legacy aliases. Build and look at every page: nothing should break.
2. **Workspace + Login** (`workspace.css`, the two pages): top bar, tabs,
   cards, buttons.
3. **Create + Studio**: hero, steps, choice/style tiles.
4. **Host control room** (`control.css`): ink header, stat tiles, proposal
   cards, briefing, charts.
5. **Invitation chrome + Saathi widget** (`act2.css`, `act3.css`): RSVP form,
   banner, launcher, panel. Do not touch `themes.ts`.
6. **Cleanup:** remove unused legacy aliases and dead CSS; grep for stray hex
   colours (`grep -nE "#[0-9a-fA-F]{3,6}" web/src/*.css`) and move any survivors
   to tokens.

After **each** step:
- `npm run typecheck && npm test && npm run build` (AGENTS.md rule 0).
- Open the page at **390px and 1280px** wide. No horizontal scroll, nothing
  overlapping, text readable.
- Run the axe audit and keep **0 violations** (AGENTS.md rule 6). Contrast is
  the usual failure: see the contrast rule in §3.
- Check keyboard: Tab through the page, the focus ring is always visible.

## 10. Done when

- Every page shares one look with baraati.co.in: cream paper, ink pills, one
  saffron/rose accent moment, Jakarta headlines with an Instrument Serif word.
- No gold, no Cormorant outside the invitation card, no 1.5px beige borders.
- axe: 0 violations on Login, Workspace, Create, Studio, Host, Invite and the
  open Saathi panel.
- All tests pass, CI is green, and the live demo links in `.data/seed-links.txt`
  still work after deploy.
