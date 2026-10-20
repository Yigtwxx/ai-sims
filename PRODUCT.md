# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary audience: company management and decision makers.** They watch a live demo in a laptop browser, either in a meeting or over screen share. They are evaluating whether the idea deserves budget and a team, so the demo must create a clear "wow" moment and run without friction.
- **End user inside the demo** (often the presenter): signs in with one click, creates an anime-style 3D character, names it, then talks to it by text and hears it answer with a voice and word-synced mouth movement.

## Product Purpose

AI Sims is a character creator joined to a conversational AI. The user shapes a personal 3D character in a Sims-like creator, presses "Bitti", and the character becomes a companion who can talk about anything: small talk ("nasılsın?") as well as general questions.

Success for this phase: management sees a polished, believable flow in one sitting (create, customize, talk) and approves further investment.

## Positioning

- Customization and conversation in one product. The character you build is the one that talks back, with mouth shapes synced to Turkish speech (TR first, EN second). Few demos combine a deep creator, live 3D and word-level Turkish lip-sync.
- The anime (VRoid/VRM) style is the main experience. A realistic (MPFB) style exists as a secondary option that users can switch to.

## Operating Context

- Shown on a laptop browser (desktop first). A desktop app wrapper may follow later; mobile is not a goal now.
- Sign-in is a single "Giriş" button (anonymous session); real accounts come later.
- Each user's characters are saved to their profile (MongoDB) and can be reopened.
- The working name is "AI Sims" and may change.

## Capabilities and Constraints

- **Creator options:**
  - Name, gender, face (base model), body type (slim / average / athletic / curvy, plus height), skin tone.
  - Eyes (colour and style), hair (style and colour).
  - Top, bottom and shoes (with colours), jewellery, tattoos.
  - The character turns 360° by drag. The camera focuses per category.
- **Conversation:** general-purpose LLM with provider fallback (Anthropic, Gemini, Groq). Azure TTS supplies voice plus viseme and word timings; a Turkish rule-based viseme engine is the fallback. Replies are short and spoken in style.
- **UI language:** Turkish and English (next-intl). No UI string is hardcoded.
- **Constraints:**
  - No asset budget and no 3D artist; development happens on a MacBook.
  - Anime parts come from VRoid models. Their licence forbids character creators without pixiv permission. The user accepted this risk for the internal demo; a public release needs a licence or replacement parts.
- **Undecided:** final product name, the post-demo account model, and production hosting.

## Brand Commitments

- Working name "AI Sims". No logo or brand palette has been provided yet.
- The interface must feel premium and professional, be rich in purposeful motion, and **must not look AI-generated or templated** (the user's explicit requirement).
- In the creator, all customization options sit in a left panel and the character fills the rest of the screen (the user's explicit requirement).

## Evidence on Hand

- Live renders of anime VRM characters with lip-sync, part swapping, body types and tints: `docs/spike/04-vrm-anime-body.jpeg` and the `/spike` bench.
- Realism spike report: `docs/realism-spike.md`.
- No testimonials, customers, metrics or press exist; never fabricate them.

## Product Principles

1. **The character is the hero.** Every screen serves the moment someone meets and talks to their character.
2. **Craft over feature count.** A smaller set of options that look and move beautifully beats a long list that feels cheap.
3. **Talking must feel alive.** Lip-sync, gaze, blinking and idle motion are core product quality, not polish.
4. **Turkish-first and bilingual.** Copy, speech and mouth shapes work natively in Turkish; English is a full peer.
5. **Demo-proof.** Fast loads, graceful fallbacks when a key is missing, and no dead ends in the flow.
