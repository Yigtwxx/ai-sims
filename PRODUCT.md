# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary audience: company management and decision makers.** They watch a live demo on the presenter's MacBook, in a meeting room or over screen share. They are deciding whether the idea deserves budget and a team, so the demo must create a clear "wow" moment and run without friction.
- **End user inside the demo** (often the presenter): signs in with one click, builds a photoreal 3D character, names it, presses "Bitti", then talks to it by text and hears it answer with a natural voice and word-synced mouth movement.

## Product Purpose

AI Sims is a character creator joined to a conversational AI. The user shapes a personal, photoreal 3D character in a Sims-like creator, presses "Bitti", and the character becomes a companion who can talk about anything: small talk ("nasılsın?") as well as general questions.

Success for this phase: management sees a polished, believable flow in one sitting (create, customize, talk) and approves further investment.

## Positioning

- Customization and conversation in one product. The character you build is the one that talks back, with mouth shapes synced to Turkish speech (TR first, EN second). Few demos combine a deep creator, live photoreal 3D in the browser and word-level Turkish lip-sync.
- **Photoreal only.** Characters are MetaHumans (Epic Games) exported once from Unreal Engine and rendered live in the browser with three.js. The company rejected the earlier anime (VRoid/VRM) style as not serious enough; it is frozen and is being removed from the UI.

## Operating Context

- Shown on a MacBook (M4 Pro) browser, desktop first. Public pages (landing) must also hold up down to a 390px phone width; the creator and talk screens are desktop-first.
- Sign-in is a single "Giriş" action (anonymous session); real accounts come later.
- Each user's characters are saved to their profile (MongoDB) and can be reopened, edited and deleted.
- The working name is "AI Sims" and may change.

## Capabilities and Constraints

- **Creator options** (all in a left panel, character on the right):
  - Name, base (male / female), face (MetaHuman presets plus blending between them), body type (slim / average / athletic, plus curvy for the female body) and height.
  - Skin (preset skin sets sorted by tone), eyes (iris and colour).
  - Hair style, colour (melanin / redness / dye) and dye patterns (ombre, roots, highlights, underlayer); eyebrows, eyelashes, beard and moustache.
  - Top, bottom and shoes with colours; small jewellery and piercings; small, minimal tattoos.
  - The character turns 360° by drag, the camera focuses per category, and the character always moves naturally (idle, breathing, gaze, blinks); it never stands frozen.
- **Conversation screen:** the character stands full height on the left, the chat panel sits on the right. The user can zoom in and out and turn the character. There is no picture-in-picture face close-up.
- **Speech:** general-purpose LLM with provider fallback (Groq, Gemini, Anthropic). TTS supplies the voice plus viseme and word timings (Azure first; alternatives are being evaluated). **Lip-sync quality is the most critical quality criterion**; voice and motion must feel natural.
- **UI language:** Turkish and English (next-intl). No UI string is hardcoded.
- **Constraints:**
  - No asset budget and no 3D artist. Unreal runs only on a Windows PC; the whole MetaHuman library is exported once and moved to the Mac. Later additions (colours, patterns, jewellery, new garments) happen on the Mac.
  - Licence: MetaHumans are used under the Unreal Engine licence. The UE EULA restricts using MetaHumans for AI training or testing; a legal review is required before productization.
- **Undecided:** final product name, the post-demo account model, production hosting and the final TTS provider.

## Brand Commitments

- Working name "AI Sims". No logo or brand palette has been provided; the wordmark is set in type.
- The interface must feel premium, cinematic and professional, be rich in purposeful motion, and **must not look AI-generated or templated** (the user's explicit requirement). No purple gradients, no glassmorphism everywhere, no generic icon-card grids, no emoji decoration.
- In the creator, all customization options sit in a left panel and the character fills the rest of the screen (the user's explicit requirement).

## Evidence on Hand

- MetaHuman export pipeline and browser renderer are in progress (see `docs/handoff.md`). No browser render of a MetaHuman exists yet; until it does, pages show lit stage posters, never fake person photos.
- A Turkish speech sample for demos: `web/public/assets/samples/tr-greeting.wav` with its transcript.
- No testimonials, customers, metrics or press exist; never fabricate them.

## Product Principles

1. **The character is the hero.** Every screen serves the moment someone meets and talks to their character.
2. **Craft over feature count.** A smaller set of options that look and move beautifully beats a long list that feels cheap.
3. **Talking must feel alive.** Lip-sync, gaze, blinking and idle motion are core product quality, not polish.
4. **Turkish-first and bilingual.** Copy, speech and mouth shapes work natively in Turkish; English is a full peer.
5. **Demo-proof.** Fast loads, graceful fallbacks when a key is missing, and no dead ends in the flow.
