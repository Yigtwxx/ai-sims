---
name: AI Sims
description: Photoreal character creator and talking companion, drawn in ink on warm paper
colors:
  paper-deep: "#dedad2"
  paper: "#eceae4"
  paper-raised: "#f4f2ee"
  paper-lift: "#e6e3dc"
  hairline: "#d3cfc6"
  input: "#8e8a80"
  ink: "#171a21"
  ink-muted: "#4a4e58"
  ink-faint: "#5a5e68"
  cobalt: "#2d4bd3"
  cobalt-deep: "#2440b8"
  ok: "#2e7d4f"
  alert: "#b3261e"
  studio-backdrop: "#e6e3dc"
  studio-cyc: "#eceae4"
typography:
  display:
    fontFamily: "Geologica, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 4.4vw, 4.25rem)"
    fontWeight: 560
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Geologica, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.4vw, 3.25rem)"
    fontWeight: 540
    lineHeight: 1.04
    letterSpacing: "-0.025em"
  subhead:
    fontFamily: "Geologica, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 0.8vw, 1.75rem)"
    fontWeight: 540
    lineHeight: 1.15
  title:
    fontFamily: "Geologica, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  lede:
    fontFamily: "Geologica, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.0625rem, 0.95rem + 0.45vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Geologica, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  ui:
    fontFamily: "Geologica, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.35
  kicker:
    fontFamily: "Azeret Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.12em"
    textTransform: "uppercase"
  readout:
    fontFamily: "Azeret Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "'tnum'"
rounded:
  hairline-box: "2px"
  tile: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.title}"
    rounded: "{rounded.pill}"
    height: "52px"
    padding: "0 24px"
  button-quiet:
    backgroundColor: "transparent"
    borderColor: "rgb(23 26 33 / 0.25)"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "40px"
  segmented:
    rounded: "{rounded.pill}"
    selectedBackground: "{colors.ink}"
    selectedText: "{colors.paper}"
  list-row:
    height: "64px"
    thumbnail: "44x56"
    selectedBackground: "{colors.paper-lift}"
    check: "{colors.cobalt}"
  slider:
    track: "2px {colors.paper-deep}"
    fill: "{colors.ink}"
    handle: "2x14px {colors.cobalt}"
  swatch:
    rounded: "{rounded.pill}"
    size: "28px"
  site-header:
    textColor: "{colors.ink}"
    height: "64px"
---

# Design System: AI Sims

> Status: **current** (2026-10-27). Replaces "The Lit Stage" (dark graphite, amber), which management found too cinematic. Chosen from the "AI Sims Stil Önerileri" canvas: landing **E · Ses Parçacıkları**, creator layout **C · Kontrol Odası** drawn in E's look.

## Overview

**Creative North Star: "Paper and Ink"**

AI Sims reads like a precise instrument drawn on warm paper. The ground is a warm off-white, text and controls are near-black ink, and one cobalt blue marks the few things that are live or chosen. The photoreal character stands in a photo studio of the same paper tone, so page and stage are one surface.

The landing has no character at all: thousands of ink dots tell the product in five chapters as the page scrolls and end as a human silhouette sampled from a real MetaHuman. The creator is a control room: a vertical category rail, list rows, numeric slider readouts and a viewfinder around the stage.

**Key characteristics:**
- Warm paper ground, near-black ink. Never pure white, never pure black.
- One accent, cobalt, used sparingly: focus ring, check marks, slider handles, the active rail mark, a few accent dots. Primary actions are ink, not cobalt.
- Geologica for everything people read, Azeret Mono for kickers, readouts and keyboard hints.
- Pills for actions and segmented controls; hairline lists and boxes for data.
- Motion is purposeful and smooth: particles morph with scroll, controls settle with springs. Nothing wobbles for its own sake.

## Colors

- **Paper** (#eceae4): page ground and the landing canvas.
- **Paper raised** (#f4f2ee): panels (the creator panel, cards, menus).
- **Paper lift** (#e6e3dc): hover and selected row backgrounds; also the 3D studio backdrop.
- **Paper deep** (#dedad2): sunken areas, slider tracks.
- **Hairline** (#d3cfc6): decorative 1px lines. **Input** (#8e8a80): outlines of form controls, which need 3:1 on paper.
- **Ink** (#171a21), **Ink muted** (#4a4e58), **Ink faint** (#5a5e68): the three text tiers. Ink faint still passes 4.5:1 on paper, paper raised, paper lift and paper deep.
- **Cobalt** (#2d4bd3), **Cobalt deep** (#2440b8): the accent and its pressed state.
- **Ok** (#2e7d4f): the saved status dot only, never text. **Alert** (#b3261e): errors.

### Named rules
**The One Accent Rule.** Cobalt stays well under 5% of a screen. A selected state is an ink fill; cobalt only adds the mark.

**The Skin Truth Rule.** Neutrals stay warm so photoreal skin reads right next to them. No cool blue-greys, no violet.

## Typography

- **Geologica** (variable, SIL OFL, `latin` + `latin-ext` for ç ğ ı İ ö ş ü, self-hosted by `next/font`): display, headline, body and UI.
- **Azeret Mono** (variable, SIL OFL, same subsets): kickers (`text-kicker`: 12px, 0.12em tracking, uppercase), numeric readouts, keyboard hints, the viseme codes on the landing.

### Hierarchy
- **Display** (560, `clamp(2.5rem, 4.4vw, 4.25rem)`, line-height 1, -0.03em): landing chapter titles, the character's name on the premiere card.
- **Headline** (540, `clamp(2rem, 3.4vw, 3.25rem)`): page titles (Karakterlerim, talk).
- **Title** (600, 17px), **Lede** (400, 17-20px), **Body** (16px), **UI** (500, 14px).
- **Kicker** (mono, 12px, uppercase): chapter numbers ("01 · Ses"), section labels in the creator panel ("SAÇ MODELİ · 24"), status ("● KAYDEDİLDİ").

### Named rules
**The Mono Is Data Rule.** Mono type is for labels, numbers and keys, never for sentences.

**The Turkish Case Rule.** Uppercase only through CSS `text-transform` on short mono labels, with `lang` set, so dotted and dotless i stay right.

## Layout

- **Container:** `max-width: 1440px`, side padding 20px (mobile), 32px (tablet), 40-48px (desktop).
- **Site header:** fixed, 64px. Wordmark left, navigation next to it, locale switch and an ink "Giriş" pill right. Transparent at the top; once scrolled, solid paper with a hairline (never blurred). Over the landing story it stays transparent.
- **Landing:** one 650svh section with a sticky full-screen canvas. Copy sits bottom-left (max 540px), the shapes right of it at 60% of the width (centred above the copy below 820px), the chapter list on the right edge. The landing has no footer.
- **Creator:** left panel `clamp(440px, 32vw, 500px)`, full height, paper raised. Header row (back, name, save status), body (72px icon rail + scrolling content), footer (undo, redo, random with key hints; the ink "Bitti" pill). The stage fills the rest, with a top bar (camera presets Tam boy / Büst / Yüz, quality) and viewfinder corners. Below 1024px the stage stacks on top and the panel takes the bottom 64dvh with a horizontal category strip.
- **Talk:** the character full height on the left, the chat on the right.
- Every page works at 390px with no horizontal scroll.

## Elevation & Depth

Flat: depth comes from tonal steps (paper, raised, lift, deep) and hairlines, not shadows. The 3D studio is a paper-toned cyclorama with real light and contact shadow. Menus and sheets use paper raised with a hairline and one soft shadow (`0 18px 40px rgb(23 26 33 / 0.12)`).

## Components

### Buttons
- **Primary:** ink pill, paper text, 52px (landing CTA 60px). Hover lightens the ink slightly; press scales to 0.97. One per view.
- **Quiet:** transparent pill with a 25% ink outline. **Ghost:** text button with a faint hover ground.
- **Focus:** 2px cobalt outline with 3px offset on every interactive element.

### Segmented controls and chips
- Pills. The selected item is an ink fill with paper text; the others are ink muted and darken on hover.

### Lists (creator)
- Rows with a 44×56 thumbnail, a name, a mono meta line and a cobalt check when selected. Hairline separators, paper lift on hover and selection. Arrow keys move, Home/End jump.

### Sliders
- 2px paper-deep track, ink fill, a slim cobalt handle (2×14px) with an invisible 24px hit area, a mono readout in a fixed column.

### Swatches
- 28px circles; the selected one gets a 2px ink ring with a paper gap.

### Stage
- The 3D studio uses the light backdrop (`MhStage backdrop="light"`). While it loads, `StagePoster` shows the same paper studio with a contact shadow and the landing's dot silhouette (`DotPoster`), so the dots seem to become the character.

### Landing particles
- One WebGL2 program, one `drawArrays(POINTS)` of 7000 points (3500 below 820px). Shapes: dust, sphere, wave, viseme ring (with mono codes), lips, silhouette. Static shapes are buffers; moving ones are computed in the vertex shader. Per frame the CPU writes only uniforms and the copy's opacity; scroll is smoothed (`approach`, rate 9 per second) so coarse wheel steps still morph smoothly. Adaptive quality steps the pixel ratio (max 2), then the point count, if frames average over 22ms. The loop stops when the story is off screen or the tab is hidden.
- The silhouette sways ±30° and breathes; when the start button is hovered or focused it turns to face the visitor and calms. On submit the dots gather into its chest.
- The silhouette file (`public/assets/landing/silhouette.bin`) is sampled from a real MetaHuman by `/dev/silhouette`.

### Toasts
- Paper raised with a hairline; errors carry an Alert icon. Only for transient results.

### Motion
- **Durations:** instant 120ms (press), quick 200ms (hover), base 320ms (menus, small changes), slow 640ms (reveals).
- **Easings:** `out-expo` for arrivals, `out-quint` for UI, `in-out-quart` for camera moves, `in-quart` for exits.
- **Tools:** Motion for UI state and layout (the sliding rail mark), CSS for small transitions, raw WebGL2 for the landing particles, anime.js only in `Viewfinder`.
- **Reduced motion:** content never waits on an animation. Under `prefers-reduced-motion: reduce` transitions are instant, the particles have no autonomous movement (no drift, spin, breathing or shimmer) and follow the scroll without smoothing, and nothing gathers on start.

## Do's and Don'ts

- **Do** keep page and stage one paper surface; let the character carry colour.
- **Do** use mono kickers for numbers, labels and keys.
- **Don't** use purple, gradients on chrome, glassmorphism or backdrop blur, neon glows or a second accent.
- **Don't** set sentences in mono, or uppercase anything but short mono labels.
- **Don't** show fake people. Before the real render arrives, show the dot silhouette.
