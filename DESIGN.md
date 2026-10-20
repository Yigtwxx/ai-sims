---
name: AI Sims
description: Photoreal character creator and talking companion, staged like a film premiere
colors:
  backstage-deep: "#0b0b0a"
  backstage: "#121211"
  backstage-raised: "#1a1918"
  backstage-lift: "#23221f"
  hairline: "#302e2a"
  ink: "#f3efe8"
  ink-muted: "#aaa59c"
  ink-faint: "#85817a"
  marquee: "#ffb547"
  marquee-deep: "#e8962a"
  tungsten: "#ffe2b0"
  stage-floor: "#1c1a18"
  stage-glow: "#3a322b"
  alert: "#ff6b5e"
typography:
  display:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 4.6vw, 5.5rem)"
    fontWeight: 560
    lineHeight: 0.98
    letterSpacing: "-0.035em"
    fontVariation: "'wdth' 112"
  headline:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.4vw, 3.25rem)"
    fontWeight: 540
    lineHeight: 1.02
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 108"
  subhead:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 0.8vw, 1.75rem)"
    fontWeight: 540
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 104"
  title:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.0625rem, 0.95rem + 0.45vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  ui:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.35
  label:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.25
    fontFeature: "'tnum'"
rounded:
  tile: "10px"
  control: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  section: "clamp(96px, 14vw, 200px)"
components:
  button-primary:
    backgroundColor: "{colors.marquee}"
    textColor: "{colors.backstage}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    height: "52px"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "{colors.marquee-deep}"
  button-quiet:
    backgroundColor: "{colors.backstage-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "0 16px"
  button-icon:
    backgroundColor: "{colors.backstage-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    size: "40px"
  site-header:
    textColor: "{colors.ink}"
    height: "64px"
  poster-tile:
    backgroundColor: "{colors.backstage-raised}"
    rounded: "{rounded.tile}"
    width: "112px"
    height: "150px"
  chip:
    backgroundColor: "{colors.backstage-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    height: "36px"
    padding: "0 14px"
  swatch:
    rounded: "{rounded.pill}"
    size: "28px"
---

# Design System: AI Sims

> Status: **provisional**, first build of the "Karanlık sinematik" direction (2026-10-20). Tokens below are what the landing and app shell ship with; the creator and talk screens inherit them in later chunks.

## Overview

**Creative North Star: "The Lit Stage" (Karanlık sinematik)**

AI Sims is staged like a film premiere shot in a dark studio. The ground is graphite backstage, the light is warm tungsten, and the only thing that is ever bright and coloured is the character standing in the spotlight. This is the photoreal evolution of the earlier "Premiere Wall": the same backstage neutrals and the single marquee-amber accent, now with real studio light, film grain and quieter, more refined type, because the characters are no longer stylized: they are photoreal people, and the interface must have the restraint of a cinema title sequence around them.

Every screen is composed like a shot. The character (or, until it is mounted, an empty lit stage with a floor mark where it will stand) holds the light; copy sits in the dark part of the frame like credits. Colour comes from skin, eyes, hair and clothes. Chrome stays dark and almost silent; amber appears only where a decision is made.

**Key Characteristics:**
- Dark graphite ground with warm, neutral greys (no violet or blue tint). Never pure black, never pure white.
- One accent, marquee amber, for the primary action, focus, selection and live state. Tungsten is light, not UI: it only exists inside stage lighting.
- Real light as the main visual device: spotlight cones, floor pools, slow light sweeps, catchlights. Film grain over everything at very low opacity.
- One type family, Mona Sans, used at two widths: expanded and tightly tracked for display, normal width for UI. Sentence case everywhere.
- Motion is cinematic and authored once per surface (lamps warming up, titles rising out of a mask, a playhead crossing a waveform), never scattered wobble.

## Colors

The palette is restrained: tonal graphite neutrals plus one marquee amber. All other colour belongs to the character.

### Primary
- **Marquee Amber** (#ffb547): primary action fill ("Karakterini oluştur", "Bitti"), focus rings, selected states, the played part of a waveform, the active subtitle word. **Marquee Deep** (#e8962a) is its hover and pressed state.

### Neutral
- **Backstage Deep** (#0b0b0a): the stage void behind the spotlight and the darkest vignette.
- **Backstage** (#121211): page ground.
- **Backstage Raised** (#1a1918) and **Backstage Lift** (#23221f): tonal layers for controls, chips, panels and menus.
- **Hairline** (#302e2a): 1px dividers and control borders.
- **Ink** (#f3efe8), **Ink Muted** (#aaa59c), **Ink Faint** (#85817a): the three text tiers. Ink Faint passes 4.5:1 only on Backstage and Backstage Raised; never set small faint text on Backstage Lift.
- **Alert** (#ff6b5e): errors only.

### Light (not UI)
- **Tungsten** (#ffe2b0): the colour of studio light inside stage posters and 3D lighting. It is used in gradients at low alpha, never as a text, border or fill colour.
- **Stage Floor** (#1c1a18) and **Stage Glow** (#3a322b): the 3D studio floor and the warm backlight behind the character.

### Named Rules
**The One Lamp Rule.** Marquee amber covers well under 10% of any screen. If two amber things compete in one view, one of them is wrong.

**The Skin Truth Rule.** Neutrals stay warm-neutral so photoreal skin reads correctly next to them. No cool blue-greys, no violet blacks.

## Typography

**Display and UI font:** Mona Sans (variable, `wdth` 75 to 125, `wght` 200 to 900; SIL OFL; self-hosted through `next/font`, `latin` + `latin-ext` for ç ğ ı İ ö ş ü).

**Character:** an engineered grotesk with a wide stance. Expanded and tightly tracked it reads like a film title card; at normal width it is a calm, precise UI face. One family keeps the interface quiet around a photoreal person.

### Hierarchy
- **Display** (560, `clamp(2.75rem, 4.6vw, 5.5rem)`, line-height 0.98, `wdth` 112 on desktop and 100 below 640px): hero titles, the character's name on the premiere card. Max two lines on desktop. Never above 6rem.
- **Headline** (540, `clamp(2rem, 3.4vw, 3.25rem)`, line-height 1.02, `wdth` 108): section titles.
- **Subhead** (540, `clamp(24px, ..., 28px)`, `wdth` 104): list headings inside a section (realism layers), large menu links.
- **Title** (600, 17px): row headings, list item names, button labels.
- **Lede** (400, `clamp(17px, ..., 20px)`, line-height 1.5, max 46ch): the one paragraph under a hero or section title.
- **Body** (400, 16px, line-height 1.55, max 62ch): paragraphs. **Body small** (15px) for panels and footers.
- **UI** (500, 14px): navigation, chips, menu items.
- **Label** (500, 13px, tabular figures): counts, timings, metadata, the locale switch.

Tailwind utilities: `text-label`, `text-ui`, `text-body-sm`, `text-body`, `text-title`, `text-subhead`, `text-lede`; display and headline use `font-display` / `font-headline` with their clamp sizes.

### Named Rules
**The Sentence Case Rule.** No uppercase display type and no tracked uppercase eyebrows. Turkish dotted and dotless i stay correct because nothing is case-transformed.

**The Width Rule.** Width carries hierarchy before size does: display is expanded, UI is normal width. Long Turkish words get the narrower width on small screens instead of a smaller size.

## Layout

- **Container:** `max-width: 1440px`, side padding 20px (mobile), 32px (tablet), 48px (desktop).
- **Section rhythm:** `clamp(96px, 14vw, 200px)` between landing sections; more space above a heading than below it.
- **Site header:** fixed, 64px, transparent over the hero stage and backstage-tinted once the page scrolls. Wordmark left, navigation next to it, locale switch and session action right. Below 768px the navigation moves into a right-hand sheet.
- **Landing hero:** the stage is full bleed under the header. On desktop the spotlight sits at 64% of the width and the copy is anchored bottom-left in the dark part of the frame; below 768px the spotlight centres in the upper part and the copy stacks below it.
- **Creator:** a fixed left panel, `clamp(420px, 34vw, 560px)` wide and full height, holds every option; the 3D stage fills the remaining width. Below 900px the stage stacks on top and the panel becomes a bottom sheet.
- **Talk:** the character full height on the left, the chat panel on the right.
- **Breakpoints:** Tailwind defaults (640, 768, 1024, 1280, 1536). Every page works at 390px with no horizontal scroll.

## Elevation & Depth

Depth comes from light and tonal layering, not drop shadows. Surfaces step up through Backstage, Raised and Lift. The stage gets depth from a spotlight cone, a floor pool, a vignette and haze. Menus and sheets use Backstage Raised with a 1px hairline and one soft shadow.

### Shadow Vocabulary
- **Lift** (`0 18px 40px rgb(5 5 4 / 0.55)`): the focused poster tile, open menus and sheets.
- **Press** (`0 1px 0 rgb(255 255 255 / 0.06) inset`): the top edge of raised controls.

## Shapes

Soft rounded rectangles throughout: tiles 10px, controls 12px. Swatches are circles, the primary action is a 12px rounded bar. No skews, italics, diagonal cuts or angled chrome. Lines are 1px hairlines; the only thicker line is the 3px amber rule under a title card.

## Components

### Buttons
- **Primary:** Marquee Amber fill, Backstage text, Title type, 52px high, 12px radius. Hover darkens to Marquee Deep and the button leans toward the pointer (magnetic, spring `stiffness 220, damping 22`); press scales to 0.98. One primary action per view.
- **Quiet:** Backstage Raised fill with a hairline border and Ink text, 40px high. Hover lifts to Backstage Lift.
- **Link:** Ink Muted text that becomes Ink on hover, with an underline that draws from the left.
- **Focus:** 2px Marquee Amber outline with 3px offset on every interactive element (`:focus-visible`).

### Navigation
- Wordmark "AI Sims" in Title weight with an expanded width; links in Label size Ink Muted; the active link is Ink with a 1px amber underline. Locale switch is a two-item segmented control ("TR" / "EN").
- A skip link ("İçeriğe geç") appears on first Tab.

### Stage (`HeroStage`, `CloseUpStage`)
- A frame that accepts children (the live 3D canvas) and shows a lit poster until then: cyclorama falloff, spotlight cone, floor pool, a small amber spike mark where the character stands, a slow light sweep and a vignette. The poster never shows a fake person.

### Chips and swatches
- Chips: Backstage Raised, 10px radius, 36px high, hairline border; selected chips get an amber inner border. Swatches: 28px circles with a 2px amber ring when selected.

### Toasts
- Bottom centre, Backstage Raised with a hairline, Title type for the message; errors carry an Alert icon. Used only for transient results (sign-in failed, saved), never for form validation.

### Loading
- Skeletons match the final layout's shape and carry a slow tungsten light sweep instead of a pulse. No spinners except inside a pressed button.

### Motion
- **Durations:** instant 120ms (press), quick 200ms (hover, focus), base 320ms (menus, sheets, small state changes), slow 640ms (reveals), cinematic 1200ms (lamps, title cards).
- **Easings:** `out-expo` (0.16, 1, 0.3, 1) for arrivals; `out-quint` (0.22, 1, 0.36, 1) for UI; `in-out-quart` (0.76, 0, 0.24, 1) for light sweeps and camera moves; `in-quart` (0.5, 0, 0.75, 0) for exits. Exits are faster than arrivals.
- **Tools:** Motion for UI state and the magnetic button; GSAP (ScrollTrigger, SplitText) for scroll choreography and title reveals; anime.js for SVG line drawing and staggered grids; CSS keyframes for ambient light. One tool per component.
- **Page transitions:** React `<ViewTransition>`: the old page fades out quickly, the new one rises 12px out of a slight blur; the header stays anchored.
- **Reduced motion:** content is visible by default and never waits on an animation. Under `prefers-reduced-motion: reduce`, CSS animations and transitions collapse to instant, Motion runs with `reducedMotion="user"`, GSAP and anime.js timelines are skipped and set their end state, marquees stop, the light sweep and grain freeze, and view transitions swap instantly. State changes (an active subtitle word, a selected chip) still update, without animation.

## Do's and Don'ts

- **Do** let the character and its light carry colour. Keep a single accent.
- **Do** compose each screen like a shot: light where the character is, copy in the dark.
- **Do** use subtitles synced to speech in conversation.
- **Don't** use purple, neon glows, gradient text, glassmorphism, gradients on chrome, or a second accent colour.
- **Don't** use uppercase tracked eyebrows, section numbers, icon-card grids or emoji.
- **Don't** skew or italicize anything, or reuse a streaming brand's red.
- **Don't** show fake person photos or placeholder grey tiles. Until a real render exists, show the lit, empty stage.
