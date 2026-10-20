---
version: 1
slug: "web-src-app-locale-site-page-tsx"
primary_target: "web/src/app/[locale]/(site)/page.tsx"
related_targets: ["web/src/components/landing"]
---

## Scope and mode
Landing (`/[locale]`). Mode: **Persuade**: management and the presenter should understand in seconds that they will build a photoreal person who talks back, then press "Karakterini oluştur".

## Audience, task and constraints
- Company management watching a live demo on a MacBook; TR first, EN peer.
- One primary action everywhere: "Karakterini oluştur" (signs in anonymously if needed, then opens the creator). Secondary: "Konuşmayı dinle" jumps to the talking demo.
- No fake person photos, no invented metrics. Must hold up at 390px with no horizontal scroll.

## Chosen direction and memorable moment
- "Karanlık sinematik": full-bleed lit, empty stage (HeroStage slot) with an amber spike mark where the character will stand; title card bottom-left.
- Story: realism close-up (procedural eye macro in CloseUpStage, gaze follows the cursor) -> customization board (tablist + lit preview) -> talking demo (real waveform, karaoke subtitle, 15-cell viseme meter, scroll scrub pinned on desktop) -> closing spot on the CTA.
- Memorable moment: the lamps warm up on load and the title rises out of a mask; later the eye looks back at you.

## Unresolved
- Mount the live MetaHuman into `HeroStage` and a face close-up into `CloseUpStage` (main session).
- Replace the transcript-and-syllable timing in the talk demo with TTS viseme/word events once available.
