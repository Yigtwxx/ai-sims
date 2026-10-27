---
version: 1
slug: "web-src-app-locale-app-create-page-tsx"
primary_target: "web/src/app/[locale]/(app)/create/page.tsx"
related_targets: ["web/src/app/[locale]/(app)/characters/[id]/edit/page.tsx","web/src/features/creator"]
---

## Scope and mode
Creator (`/[locale]/create`, `/[locale]/characters/[id]/edit`; `web/src/features/creator/`). Mode: **Operate**: the presenter customizes a character in one sitting and finishes with "Bitti".

## Audience, task and constraints
- Management watches a live demo on a MacBook (desktop first; below 1024px the stage stacks on top and the panel takes the bottom 64dvh).
- Task: name, base, face (presets and blends), body and height, skin, eyes, hair and colour, brows, lashes, beard and moustache, top, bottom, shoes with colours, jewellery and piercings, small tattoos; then "Bitti".
- Every option sits in the LEFT panel (user requirement); the 3D character fills the rest. TR/EN; no hardcoded strings.
- The stage is the heat budget: idle caps at 30 fps, the quality menu (auto, high, balanced, battery) lives in the stage top bar. Visual checks of this surface run the 3D stage; do them on the charger.

## Chosen direction and memorable moment
- Direction C "Kontrol Odası" drawn in "Paper and Ink" (DESIGN.md): a paper-raised panel `clamp(440px,32vw,500px)` with a 72px icon rail beside the controls, header (back, name, save status), footer (undo, redo, random with key hints, the ink "Bitti" pill). The stage is a light paper studio with viewfinder corners and framing presets (Tam boy, Büst, Yüz); every category moves the camera.
- Controls: list rows with 44×56 thumbnails and a cobalt check, pills for segmented choices, 28px swatches, 2px sliders with a slim cobalt handle and mono readouts. Cobalt stays under 5% of the screen; a selected state is an ink fill.
- Memorable moment: "Bitti" frames a portrait through the viewfinder, the still flashes into the card, and the premiere repeats the landing's last frame with the real character ("Sahne senin.", then "Sohbete başla" / "Düzenlemeye dön").

## Unresolved
- Part thumbnails in R2 were rendered in A-pose on a dark ground; regenerate with `/dev/thumbs` on the PC (light ground considered).
- Visual polish pass of the panel and stage chrome, deferred until the Mac is on the charger.
