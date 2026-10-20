# AI Sims

A photorealistic, customizable 3D character creator that runs in the browser. After the character is created, it can talk to you: LLM chat with voice and word-synced lip-sync.

> Status: **Phase 0, scaffolding.** Next is a realism spike. See [`docs/specs`](docs/specs/2026-10-20-character-creator-design.md) for the full design.

## Features (planned)

- **Character creator:** male and female bases, face presets, skin tone, eye color, hairstyles and hair color, facial hair, tops, bottoms and shoes.
- **Turntable viewer:** drag to rotate the character 360°. The camera focuses on the face or the feet depending on the category.
- **Realistic rendering:** studio HDRI lighting, skin subsurface approximation, eye and hair shading, idle animation, procedural blinking.
- **Profiles:** each user's characters are saved to Supabase. For now the demo uses anonymous login with one click.
- **AI chat (phase 4):** multi-provider LLM (Anthropic, Gemini and Groq, with fallback) and TTS with viseme-driven lip-sync, including Turkish.
- **i18n:** Turkish and English.

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Next.js (App Router), React 19, TypeScript (strict) |
| 3D | three.js, React Three Fiber, drei, postprocessing |
| UI | Tailwind CSS v4, shadcn/ui, Motion, GSAP |
| State | zustand + zundo |
| i18n | next-intl |
| Data / auth | Supabase (Postgres + RLS, anonymous auth, storage) |
| Asset pipeline | Python + Blender (headless `bpy`), MPFB2, glTF-Transform |
| Tests | Vitest, Playwright, pytest |

## Repository layout

```
web/        Next.js app (UI, 3D renderer, route handlers)
pipeline/   Python scripts that build and optimize character assets with Blender
supabase/   Database migrations and Supabase CLI config
docs/       Design specs and spike reports
```

## Getting started

Prerequisites: Node 22+, pnpm, Python 3.12+ with [uv](https://docs.astral.sh/uv/), Blender 4.2+ (asset pipeline only), and Git LFS (the Supabase CLI runs via `pnpm dlx supabase`).

```bash
git lfs install
cp .env.example web/.env.local   # fill in Supabase URL + anon key

cd web
pnpm install
pnpm dev                          # http://localhost:3000
```

Supabase setup:
1. Create a project.
2. Enable **Authentication → Providers → Anonymous**.
3. Apply the migrations:

```bash
pnpm dlx supabase link --project-ref <ref>
pnpm dlx supabase db push
```

Asset pipeline:

```bash
cd pipeline
uv sync
uv run asset-pipeline base          # runs Blender headless (MPFB), writes GLBs to pipeline/out
```

## Quality checks

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test
cd pipeline && uv run ruff check && uv run ruff format --check && uv run pytest
```

## License

Proprietary. Internal demo, all rights reserved.
