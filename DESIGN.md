---
name: AI Sims
description: Anime character creator and talking companion, staged like a premiere
colors:
  backstage: "#121113"
  backstage-raised: "#1b1a1d"
  backstage-lift: "#252328"
  hairline: "#2e2c32"
  ink: "#f4f1ec"
  ink-muted: "#a39fa8"
  ink-faint: "#6e6a74"
  marquee: "#ffb547"
  marquee-deep: "#e8962a"
  stage-floor: "#1c1a1d"
  stage-glow: "#3b3236"
  alert: "#ff6b5e"
typography:
  display:
    fontFamily: "Big Shoulders, Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 4vw, 3.5rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "0.01em"
    fontVariation: "'opsz' 72"
  title:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.25
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
components:
  poster-tile:
    backgroundColor: "{colors.backstage-raised}"
    rounded: "{rounded.tile}"
    width: "112px"
    height: "150px"
  poster-tile-selected:
    backgroundColor: "{colors.backstage-lift}"
    rounded: "{rounded.tile}"
  button-done:
    backgroundColor: "{colors.marquee}"
    textColor: "{colors.backstage}"
    typography: "{typography.display}"
    rounded: "{rounded.control}"
    height: "56px"
  button-icon:
    backgroundColor: "{colors.backstage-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    size: "40px"
  swatch:
    rounded: "{rounded.pill}"
    size: "28px"
---

# Design System: AI Sims

> Status: **seed**. Direction is chosen and tokens are provisional; they are carbonized after the first build of the creator.

## Overview

**Creative North Star: "The Premiere Wall"**

AI Sims treats every character as the star of a premiere. The interface is a backstage catalog wall: a deep neutral ground in which the options are poster artwork, laid out in horizontally scrolling rows, one row per category. The character stands lit on its own stage beside the wall, and the poster thumbnails provide all the colour. Chrome stays quiet so the character and the art stay loud.

The wall follows the grammar of a streaming catalog that management already reads fluently:
- Rows of fixed-ratio tiles.
- The focused tile grows and reveals its name and colours.
- The active row lifts while the rest of the wall dims.

The anime identity comes from the character and the artwork, not from decorative chrome.

The signature moment is the premiere. When the user presses "Bitti", the house lights dim, the stage light finds the character, and the character's name lands as a title card before the conversation begins. In conversation, the character's words appear as subtitles synced to its lip movement.

**Key Characteristics:**
- A dark neutral backstage ground. Colour comes only from artwork and from the single marquee-amber accent.
- Rows of 3:4 poster tiles. Focus enlarges and reveals; selection is marked in amber.
- One accent, used for focus, selection and the primary action, never as decoration.
- Display type has marquee and poster energy (Big Shoulders, uppercase). UI type is a precise workhorse grotesk (Schibsted Grotesk, sentence case).
- Motion is cinematic and purposeful: lifts, glides, title cards and a premiere sequence. No idle wobble in the chrome.

## Colors

The palette is restrained: tonal graphite neutrals plus one marquee amber. All other colour belongs to the artwork and the character.

- **backstage** is the page and panel ground. **backstage-raised** and **backstage-lift** are tonal layers for tiles, controls and the active row.
- **ink**, **ink-muted** and **ink-faint** are the three text tiers.
- **marquee** marks focus rings, the selected tile border, the selected state and the "Bitti" fill. **marquee-deep** is its hover and pressed state.
- **stage-floor** and **stage-glow** are the 3D studio's floor and the warm backlight behind the character.
- **alert** is used for errors only.

## Typography

- **Display:** Big Shoulders at optical size 72, weight 800, uppercase. Used for the character's name, title cards and the "Bitti" action. Never for paragraphs.
- **Title:** Schibsted Grotesk 600, sentence case, for row headings ("Saç", "Üst").
- **Body / label:** Schibsted Grotesk 400/500. Counts and values use tabular figures.
- Every face carries latin-ext for Turkish (ç ğ ı İ ö ş ü).

## Layout

- **Creator:**
  - A fixed left wall panel, `clamp(420px, 34vw, 560px)` wide and full height, holds every customization option.
  - The 3D stage fills the remaining width.
  - The panel scrolls vertically through rows; each row scrolls horizontally with snap.
  - The name field sits at the top as the title of the character. The action bar (undo, redo, randomize, Bitti) stays pinned to the bottom of the panel.
- **Breakpoints:** desktop first. Below 900px the stage stacks on top and the wall panel becomes a bottom sheet.

## Elevation & Depth

Depth comes from tonal layering, not shadows. The focused tile alone gets a lifted shadow (`0 18px 40px rgba(0,0,0,.55)`). The active row lifts by keeping full opacity while other rows dim to about 55%.

## Shapes

Tiles and controls have soft rounded rectangles (10–12px). Swatches are circles. There are no skews, italics, diagonal cuts or angled chrome.

## Components

- **Poster tile:**
  - 3:4 artwork on backstage-raised.
  - Hover or keyboard focus scales it to 1.06 with a spring and reveals the label (and colour dots if any).
  - The selected tile has a 2px marquee inner border and a small check badge.
- **Row:** a title-weight heading with a muted count, a horizontal snap scroller and edge fades showing more content. The active row lifts.
- **Swatch row:** circular colour chips. The selected chip has a marquee ring. A "custom" chip opens a picker.
- **Slider (height):** a thin track with a marquee thumb and a tabular readout.
- **Done ("Bitti"):** a marquee-filled bar with display type. A press triggers the premiere sequence.
- **Icon buttons:** undo, redo and randomize on backstage-raised, each with a tooltip and a keyboard shortcut.

## Do's and Don'ts

- **Do** let artwork and the character carry colour. Keep a single accent.
- **Do** dim inactive rows and lift the active one. Glide the camera to the category in focus.
- **Do** use subtitles synced to speech in conversation.
- **Don't** use neon glows, glassmorphism, gradients on chrome, purple, or a second accent colour.
- **Don't** skew or italicize anything, or reuse a streaming brand's red.
- **Don't** ship placeholder grey tiles. Every option tile shows real rendered artwork.
