---
version: 1
slug: "web-src-app-locale-site-page-tsx"
primary_target: "web/src/app/[locale]/(site)/page.tsx"
related_targets: ["web/src/features/landing"]
---

## Scope and mode
Landing (`/[locale]`, `web/src/features/landing/`). Mode: **Persuade**: management and the presenter should understand in seconds that they will build a photoreal person who talks back, then press "Karakterini oluştur" / "Create your character".

## Audience, task and constraints
- Company management watching a live demo on a MacBook; English is the default locale, Turkish the peer (`/tr`).
- One primary action, at the end of the story: the ink CTA (signs in anonymously if needed, then opens the creator). No secondary CTA, no footer on the landing.
- No character render and no fake person photos on this page; never invent metrics. Must hold up at 390px with no horizontal scroll.
- Heat and battery: one WebGL2 `drawArrays` of 7000 points (3500 below 820px), CPU writes only uniforms per frame, the loop stops off screen or in a hidden tab, adaptive pixel ratio then point count.

## Chosen direction and memorable moment
- "Paper and Ink" (DESIGN.md), direction E "Ses Parçacıkları": ink and a few cobalt dots on warm paper tell the product in five chapters as the page scrolls (Fikir, Ses, Viseme, Dudak, Başla): dust, sphere, wave, viseme ring with mono codes, lips, then a human silhouette sampled from a real MetaHuman (`/dev/silhouette`).
- Copy sits bottom-left on the header's gutter (max 540px); the chapter list is a mono kicker column on the right gutter. The first kicker is the brand and keeps Latin capitals ("AI SIMS").
- Memorable moment: on the last chapter the silhouette turns to face the visitor when the CTA is hovered; on submit the dots gather into its chest and the creator opens as a circle from there (view transition).

## Unresolved
- None blocking. Reduced motion: no autonomous particle movement, no gather.
