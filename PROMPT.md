# ᚷᚨᛚᛞᚱ — Website Build Prompt

Build a single-page Next.js (App Router, static export) landing website for a desktop app called **galdr**.

---

## Project identity

- **App name:** galdr (lowercase)
- **Tagline:** "media incantations"
- **GitHub:** https://github.com/ellipog/galdr
- **Site repo:** `galdr-web`
- **Concept:** The name "galdr" is Old Norse for "magical incantation." The app frames media conversion (video, audio, image via FFmpeg) as spellcasting — raw media in, enchanted media out.
- **Aesthetic:** The app uses a strict monochrome terminal theme (black background, white/gray monospace text, Elder Futhark runes as decorative elements). The website should match this identity but lean into an **ancient grimoire / spellbook** interpretation rather than a strict terminal emulator.

---

## Tech stack

- **Framework:** Next.js 15+ with App Router
- **Language:** TypeScript
- **Styling:** CSS Modules (NOT Tailwind — the aesthetic demands pixel-perfect control)
- **Animation:** Framer Motion (section reveals, button hover, ASCII mockup animations, text stagger)
- **Scramble effect:** A custom `ScrambleText` component (ported from the galdr desktop app) — see full component code below
- **Deployment:** Static export (`next.config.js` with `output: 'export'`) hosted on Vercel with a custom domain (placeholder: galdr.app)
- **No other external UI libraries** — all components hand-built

### Dependencies

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "framer-motion": "^12.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.8.0"
  }
}
```

---

## Design system

Extracted from the actual galdr app source. Follow these values exactly.

### Colors

```
--bg: #000000
--fg: #c8c8c8
--bg-dim: #111111
--fg-dim: #6a6a6a
--fg-faint: #262626
--accent: #c8c8c8
```

No colors, no gradients, no shadows. Pure black and white/gray.

### Typography

- Font stack: `"Courier New", "Liberation Mono", "Nimbus Mono PS", "Source Code Pro", monospace`
- Base size: 16px (slightly larger than the app's 14px for web readability)
- Line-height: 1.6
- Headings: All-caps, letter-spacing 0.15em
- UI labels (buttons, badges): All-caps, letter-spacing 0.1em
- Body: sentence case, monospace only

### Runes

Elder Futhark runes are used as section markers and decorative punctuation. Use these sparingly — as ornamentation, not prose.

| Rune | Name   | Meaning / Use                   |
|------|--------|----------------------------------|
| ᚠ    | Fehu   | Wealth — beginning of a section |
| ᚨ    | Ansuz  | Message — communication blocks  |
| ᚷ    | Gebo   | Gift — downloads, CTAs          |
| ᚲ    | Kaunan | Torch — highlights, callouts    |
| ᛏ    | Tiwaz  | Justice — actions, buttons      |
| ᛟ    | Oþalan | Heritage — footer, meta         |

### Spacing

- Base unit: 4px. Use multiples: 4, 8, 12, 16, 24, 32, 48, 64
- Content max-width: 800px (centered)
- Border-radius: 0 everywhere
- All borders: 1px solid var(--fg-faint)

### Interactive elements

- **Buttons:** background var(--fg), color var(--bg). Hover: invert (bg transparent, color var(--fg), border 1px solid var(--fg)). All-caps label. No icons inside buttons (runes may appear adjacent).
- **Links:** color var(--fg), underline. No visited color change. Hover: remove underline.
- **Cards/panels:** background var(--bg-dim), border 1px solid var(--fg-faint), padding 24px. No border-radius.
- **Terminal-style blocks:** background var(--bg-dim), padding 16px, monospace. Prefix lines with `>` or `ᚠ `.

### CRT overlay (optional)

```css
body::before {
  content: "";
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(255, 255, 255, 0.015) 2px,
    rgba(255, 255, 255, 0.015) 4px
  );
  pointer-events: none;
  z-index: 9999;
}
```

---

## Copy / voice

The site uses a **grimoire / spellbook** voice. Key guidelines:

- "Incantation" instead of "command," "spell" instead of "operation," "grimoire" instead of "documentation"
- Section headings framed with runes (e.g., `ᚠ SPELLS` or `ᚷ DOWNLOAD`)
- Feature descriptions are terse, factual sentences with occasional magical framing (e.g., "Accepts any media format FFmpeg understands. Speaks the old codecs.")
- First-person plural ("we") for the creators. Second-person ("you") for the user.
- No emoji anywhere. No exclamation points except in runic dividers.
- All UI text in US English.

---

## ScrambleText component

Port this exact component into the website. It's used for headings with a rune-scramble animation.

```tsx
import { useState, useEffect, useRef, useCallback } from "react";

const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛝᛟᛞ";
const REVEAL_DURATION = 600;

interface Props {
  text: string;
  as?: "span" | "div" | "h1" | "h2" | "h3" | "p" | "button";
  className?: string;
  hover?: boolean;
  load?: boolean;
  trigger?: boolean;
  ticks?: number;
  onClick?: () => void;
}

function randomRune(): string {
  return RUNES[Math.floor(Math.random() * RUNES.length)];
}

function shuffle(target: string, factor: number): string {
  let out = "";
  for (let i = 0; i < target.length; i++) {
    if (target[i] === " ") {
      out += " ";
    } else if (Math.random() < factor) {
      out += randomRune();
    } else {
      out += target[i];
    }
  }
  return out;
}

export default function ScrambleText({
  text,
  as: Tag = "span",
  className,
  hover = false,
  load = false,
  trigger,
  ticks = 8,
  onClick,
}: Props) {
  const [display, setDisplay] = useState(text);
  const [active, setActive] = useState(false);
  const timerRef = useRef<number>(undefined);
  const prevTrigger = useRef(false);

  const run = useCallback(() => {
    setActive(true);
    let step = 0;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      step++;
      const factor = Math.max(0, 1 - step / ticks);
      setDisplay(shuffle(text, factor));
      if (step >= ticks) {
        clearInterval(timerRef.current);
        setDisplay(text);
        setActive(false);
      }
    }, REVEAL_DURATION / ticks);
  }, [text, ticks]);

  useEffect(() => {
    if (load) run();
  }, [load, run]);

  useEffect(() => {
    if (trigger && trigger !== prevTrigger.current) {
      prevTrigger.current = trigger;
      run();
    }
  }, [trigger, run]);

  useEffect(() => {
    if (!active) setDisplay(text);
  }, [text, active]);

  return (
    <Tag
      className={className}
      onClick={onClick}
      onMouseEnter={hover && !active ? run : undefined}
      onMouseLeave={hover ? () => { setDisplay(text); setActive(false); clearInterval(timerRef.current); } : undefined}
    >
      {display}
    </Tag>
  );
}
```

**Usage on the site:**
- The hero "galdr" heading uses `load={true}` — scrambles on page load
- All section headings (About, Spells, Command Alchemy, Download, Colophon) use `trigger` driven by Framer Motion's `inView` prop — they scramble when scrolled into view

---

## Animation plan (Framer Motion + ScrambleText)

### Framer Motion

- **Section containers:** `motion.section` with `initial={{ opacity: 0, y: 12 }}` and `whileInView={{ opacity: 1, y: 0, transition: { duration: 0.5 } }}`, `viewport={{ once: true, margin: "-80px" }}`
- **ASCII mockup:** `motion.div` with a subtle ambient pulse animation (slow, looping opacity between 0.95 and 1, or a subtle border glow) — `animate={{ opacity: [0.95, 1, 0.95] }}` with `transition={{ duration: 4, repeat: Infinity }}`
- **Mockup bottom line ("ᚲ casting web..."):** `motion.span` with staggered character reveal using `staggerChildren: 0.03` — each character fades in sequentially
- **Buttons:** `motion.button` with `whileHover={{ scale: 1.02 }}` and `whileTap={{ scale: 0.98 }}`
- **Page-level stagger:** Wrap sections in a parent `motion.div` with `staggerChildren: 0.15` — not for scroll, but to sequence the load animation on first visit (optional, only if it doesn't interfere with scroll-triggered reveals)
- **`prefers-reduced-motion`:** Wrap all Framer Motion animations in a check: if `useReducedMotion()` returns true, render static HTML (no motion wrappers)

### ScrambleText

| Element | Prop |
|---|---|
| Hero "galdr" heading | `load={true}` |
| `ᚨ ABOUT` heading | `trigger={inView}` from Framer Motion |
| `ᚲ SPELLS` heading | `trigger={inView}` from Framer Motion |
| `ᚲ COMMAND ALCHEMY` heading | `trigger={inView}` from Framer Motion |
| `ᚷ DOWNLOAD` heading | `trigger={inView}` from Framer Motion |
| `ᛟ COLOPHON` heading | `trigger={inView}` from Framer Motion |

---

## Page structure (single scrollable page)

### 1. `<head>` and metadata

```tsx
export const metadata = {
  title: "galdr — media incantations",
  description: "A desktop GUI wrapper around FFmpeg for converting and manipulating video, audio, and image files. Terminal aesthetic. Runic theme.",
  openGraph: {
    title: "galdr — media incantations",
    description: "A desktop GUI wrapper around FFmpeg. Terminal aesthetic. Runic theme.",
    url: "https://galdr.app",
    siteName: "galdr",
  },
  twitter: {
    card: "summary",
    title: "galdr — media incantations",
    description: "A desktop GUI wrapper around FFmpeg. Terminal aesthetic. Runic theme.",
  },
  themeColor: "#000000",
};
```

### 2. Hero section (full viewport height)

- At top: a decorative runic line: `ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ ᚺ ᚾ ᛁ ᛃ ᛇ ᛈ ᛉ ᛊ ᛏ ᛒ ᛖ ᛗ ᛚ ᛝ ᛟ ᛞ` (hidden on mobile)
- Below it: `<h1>` with `ScrambleText text="galdr" as="h1" load={true} />` — large all-caps monospace, font-size around 4rem
- Below that: tagline "media incantations" in smaller all-caps, letter-spacing 0.15em, color var(--fg-dim) — fades in using Framer Motion with a slight delay after the scramble finishes
- Below tagline: an **ASCII art mockup of the galdr app window** drawn entirely in monospace box-drawing characters:

```
┌─────────────────────────────────┐
│  ᚷᚨᛚᛞᚱ          _ □ X        │
├─────────────────────────────────┤
│                                 │
│   INPUT    input.mp4           │
│   FORMAT   [ WebM  ⌄ ]        │
│   QUALITY  ████████░░░ 73%    │
│   ─────────────────────────    │
│   > ffmpeg -i input.mp4 ...   │
│   ᚲ casting web | ██████ 67%  │
│                                 │
└─────────────────────────────────┘
```

The mockup is wrapped in a `motion.div` with a slow ambient pulse. The bottom line `ᚲ casting web | ██████ 67%` uses Framer Motion `staggerChildren` — each character fades in sequentially on page load (only played once). The mockup uses `white-space: pre` and the monospace font stack. Keep it horizontally centered.

- Below the mockup, a CTA button: `<motion.button whileHover={{ scale: 1.02 }}>ᚷ DOWNLOAD</motion.button>` — linking to `#download`
- A secondary link: "VIEW ON GITHUB" — opening https://github.com/ellipog/galdr in a new tab
- Faint horizontal rule at the bottom of the section, made of repeated `ᛟ` characters
- The full runic alphabet line at top is hidden on mobile

### 3. About section (`id="about"`)

- `motion.section` with `whileInView` fade-in
- ScrambleText heading: `ScrambleText text="ᚨ ABOUT" as="h2" trigger={inView} />`
- A terminal-style card (bg-dim, border, padding 24px):
  ```
  ᚨ ABOUT
  
  galdr is a desktop GUI wrapper around FFmpeg. It converts
  and manipulates video, audio, and image files with a terminal
  aesthetic and runic theme.
  
  Every conversion is an incantation. Raw media in, enchanted
  media out.
  
  > Built with Tauri, React, and Rust
  > Uses FFmpeg under the hood
  > Free and open source
  ```
- Simple, terse, no fluff

### 4. Features section (`id="spells"`)

- `motion.section` with `whileInView` fade-in, `staggerChildren: 0.1` on its children
- ScrambleText heading: `ScrambleText text="ᚲ SPELLS" as="h2" trigger={inView} />`
- A 2-column (desktop) / 1-column (mobile) grid of 6 feature cards. Each card is a `motion.div` card (bg-dim, border, padding 24px):

| Rune | Heading | Description | Incantation line |
|------|---------|-------------|------------------|
| ᚲ | CONVERT | Single or batch conversion between any formats FFmpeg supports. | `> convert *.mp4 --to mkv` |
| ᛏ | COMPRESS | Quality-controlled compression with live size estimation. | `> compress input.mp4 --quality 60` |
| ᚨ | INSPECT | Deep media inspection via ffprobe. Codec, resolution, bitrate. | `> inspect input.mkv` |
| ᚷ | TRIM | Cut, crop, rotate, resize, speed up, slow down. All the fundamentals. | `> trim input.mp4 --start 00:01:30 --end 00:02:15` |
| ᚠ | RUNE TAGS | Save presets as named runes. Reusable incantations. | `> rune-save ᛏ youtube-h264` |
| ᛟ | COMPARE | Side-by-side before/after preview. See the spell take effect. | `> compare input.mp4 output.mp4` |

Each card heading uses a small ScrambleText with `hover={true}` (scramble on mouse enter).

### 5. Command Alchemy section (`id="alchemy"`)

- `motion.section` with `whileInView` fade-in
- ScrambleText heading: `ScrambleText text="ᚲ COMMAND ALCHEMY" as="h2" trigger={inView} />`
- A full-width card (bg-dim, border, padding 24px):
  ```
  The FFmpeg command builds in real time as you tweak settings.
  Every slider, dropdown, and toggle updates the command string
  immediately. No more man-page spelunking.

  > ffmpeg -i input.mp4 -c:v libx264 -crf 23 -c:a aac -b:a 128k output.mp4
  ```
- The code line is a terminal-block inset (bg even darker, or just padding with a faint left border)

### 6. Download section (`id="download"`)

This section fetches the latest GitHub release data at build time and renders real download buttons.

**Implementation:**

In the server component:
```tsx
const res = await fetch(
  'https://api.github.com/repos/ellipog/galdr/releases/latest',
  { cache: 'no-store' }
);

if (!res.ok) {
  // Fallback render
}

const release = await res.json();
```

`release.tag_name`, `release.html_url`, `release.assets[]` — each asset has `name`, `browser_download_url`, `size`.

Filter assets by filename to assign to OS cards:

| OS | Asset name pattern |
|---|---|
| Windows | `-setup.exe` |
| macOS | `.dmg` |
| Linux | `.AppImage` or `.deb` |

**Layout:**
- ScrambleText heading: `ScrambleText text="ᚷ DOWNLOAD" as="h2" trigger={inView} />`
- Subtitle: `Latest release: ${release.tag_name}` in fg-dim
- Three download cards in a row (desktop) / stack (mobile), each `motion.div` with stagger
  - OS name in all-caps
  - Asset filename in fg-dim
  - `<motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>ᚷ DOWNLOAD</motion.button>` — linking to the asset's `browser_download_url`
  - File size in MB below
- If no matching asset for an OS: disabled card with "Not available yet" in fg-dim, no button
- If API fetch fails: fallback — centered paragraph linking to `https://github.com/ellipog/galdr/releases/latest`
- Below cards, package manager hints:
  ```
  > winget install galdr        # Windows (coming soon)
  > brew install galdr          # macOS (coming soon)
  > sudo apt install galdr      # Linux (coming soon)
  ```

### 7. Footer (`id="colophon"`)

- `motion.footer` with `whileInView` fade-in
- Horizontal rule of repeated `ᛟ` characters
- ScrambleText: `ScrambleText text="ᛟ COLOPHON" as="h3" trigger={inView} />`
- Centered text:
  ```
  Built with Tauri, React, and Rust
  Licensed under MIT

  github.com/ellipog/galdr
  ```
- GitHub link opens in new tab
- `© 2026 Ellio. All rights reserved.` in fg-faint

---

## Sticky nav (optional but recommended)

A thin fixed bar at the top of the viewport, visible after scrolling past the hero. Background var(--bg), border-bottom 1px solid var(--fg-faint). Contains:
- Left: "galdr" in all-caps (letter-spacing 0.15em, fg-dim — not a link, just a label)
- Right: anchor links in all-caps — `ABOUT`, `SPELLS`, `DOWNLOAD` (underline on hover)

The nav scrolls away with the page (not sticky, or sticky with low z-index). If sticking to sticky, make sure it doesn't overlap hero content on initial load. A simpler approach: show it only after scrolling past the hero, using Framer Motion `useScroll` / `useTransform` to fade it in.

---

## Back-to-top button

A fixed-position square button in the bottom-right corner (offset 24px) that appears after scrolling past 2x viewport height. Styled as:
- Width/height 40px
- Border 1px solid var(--fg-faint), bg var(--bg)
- Contains the Tiwaz rune: `ᛏ`
- `whileHover={{ scale: 1.05 }}`
- Visible state animated with Framer Motion (AnimatePresence, fade + slide up)
- Click scrolls to top smoothly

---

## Responsive design

- **Desktop (>768px):** 2-column feature grid, 3-column download cards. Content max-width 800px centered. Full runic alphabet visible at top.
- **Mobile (<768px):** Single column everything. Feature cards stack. Download cards stack. Hide the full runic alphabet line. Reduce ASCII mockup font-size slightly. Heading sizes step down proportionally.
- **Touch targets:** Buttons and links minimum 44x44px tap area.
- The sticky nav (if implemented) collapses: on mobile, only the "galdr" label remains visible, anchor links are hidden (still there as a tap target if space allows, or just remove them on mobile).

---

## Accessibility

- All decorative runes marked `aria-hidden="true"`
- Skip-to-content link (visually hidden, appears on keyboard focus)
- Minimum contrast ratio 4.5:1 (white-on-black exceeds this by default)
- All interactive elements have visible `focus-visible` outline (1px solid var(--fg))
- Semantic HTML: `<header>`, `<main>`, `<section>`, `<footer>`, `<h1>`–`<h3>`
- Framer Motion `useReducedMotion()` respected globally — if user prefers reduced motion, render all sections statically (no motion wrappers, no ScrambleText animation)

---

## SEO

- Each `<section>` has an `id` matching its anchor
- Open Graph and Twitter Card meta tags (as specified in metadata)
- JSON-LD structured data for `SoftwareApplication`:

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "galdr",
  "operatingSystem": "Windows, macOS, Linux",
  "applicationCategory": "Multimedia",
  "description": "A desktop GUI wrapper around FFmpeg for converting and manipulating media files.",
  "url": "https://galdr.app",
  "downloadUrl": "https://github.com/ellipog/galdr/releases/latest"
}
```

---

## Performance

- Lighthouse score: 95+ across all categories
- All CSS in CSS Modules (no runtime CSS-in-JS)
- No raster images on the page (the ASCII mockup is pure text)
- All fonts from system font stack (no web font downloads)
- Static export only — no server-side rendering
- Framer Motion is the only JS-heavy dependency (~15KB gzipped) — acceptable for a landing page
- The GitHub API fetch happens at build time only — no client-side requests
- No `use client` directives except where strictly necessary (ScrambleText, Framer Motion animated components). Structure code so most of the page is a server component that imports client components only where animation is needed.

---

## Project structure

```
galdr-web/
  next.config.js             -- output: 'export', images unoptimized
  tsconfig.json
  package.json               -- next, react, react-dom, framer-motion, typescript, @types/react, @types/node
  public/
    favicon.ico              -- simple "g" favicon in monospace style
  src/
    app/
      layout.tsx             -- Root layout: metadata export, html lang="en", body with globals.css
      page.tsx               -- Single page composing all sections (server component wrapping motion children)
      globals.css            -- CSS reset, custom properties, scroll behavior, CRT overlay
    components/
      HeroSection.tsx        + HeroSection.module.css
      AboutSection.tsx       + AboutSection.module.css
      FeaturesSection.tsx    + FeaturesSection.module.css
      AlchemySection.tsx     + AlchemySection.module.css
      DownloadSection.tsx    + DownloadSection.module.css
      FooterSection.tsx      + FooterSection.module.css
      ScrambleText.tsx       + ScrambleText.module.css  -- component as provided above
      Button.tsx             + Button.module.css         -- motion.button wrapper
      Divider.tsx            + Divider.module.css         -- rune repeated HR
      StickyNav.tsx          + StickyNav.module.css       -- optional thin top nav
      BackToTop.tsx          + BackToTop.module.css       -- optional ᛏ button
```

---

## Additional constraints

- Every file must be fully implemented — no placeholders, no TODOs, no "// implement later"
- The site must look polished and complete from the first build
- Run `npm run build` and fix all errors before delivering
- The GitHub API fetch in DownloadSection must handle errors gracefully (no release yet, rate limit hit) with a clean fallback UI
- No CSS frameworks, no utility libraries
- No external fonts, no external icon libraries (rune characters are sufficient)
- The ASCII mockup, terminal blocks, runes, and typography carry all visual weight — no images needed

---

## Deliver

Output the complete project files for `galdr-web/`. Every file from the project structure above, fully implemented. The site should build without errors and look like a shippable landing page.