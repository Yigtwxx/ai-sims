# AI Sims

A photorealistic, customizable 3D character creator that runs in the browser. After the character is created, it can talk to you: LLM chat with voice and word-synced lip-sync.

> Status: **Phase 0, scaffolding.** Next is a realism spike. See [`docs/specs`](docs/specs/2026-10-20-character-creator-design.md) for the full design.

## Features (planned)

- **Character creator:** male and female bases, face presets, skin tone, eye color, hairstyles and hair color, facial hair, tops, bottoms and shoes.
- **Turntable viewer:** drag to rotate the character 360°. The camera focuses on the face or the feet depending on the category.
- **Realistic rendering:** studio HDRI lighting, skin subsurface approximation, eye and hair shading, idle animation, procedural blinking.
- **Profiles:** each user's characters are saved to MongoDB. For now the demo uses anonymous login with one click.
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
| Data / auth | MongoDB (official driver) + Better Auth (anonymous plugin) |
| Asset pipeline | Python + Blender (headless `bpy`), MPFB2, glTF-Transform |
| Tests | Vitest, Playwright, pytest |

## Repository layout

```
web/        Next.js app (UI, 3D renderer, route handlers)
pipeline/   Python scripts that build and optimize character assets with Blender
docs/       Design specs and spike reports
```

## Getting started

Prerequisites: Node 22+, pnpm, Python 3.12+ with [uv](https://docs.astral.sh/uv/), Blender 4.2+ (asset pipeline only), Git LFS, and a local `mongod` (MongoDB Community Server).

```bash
git lfs install
cp .env.example web/.env.local   # then set BETTER_AUTH_SECRET (openssl rand -base64 32)

mkdir -p .data/mongo            # local database files, gitignored
cd web
pnpm install
pnpm db:start                   # mongod on 127.0.0.1:27018, no auth
pnpm dev                        # http://localhost:3000
```

Database:
- Dev data lives in `.data/mongo` (dedicated instance on port 27018, separate from any other MongoDB you run).
- Browse it with MongoDB Compass using `mongodb://localhost:27018`, database `ai-sims`.
- Collections: `characters`, `thumbnails` (app) and `user`, `session`, `account`, `verification` (Better Auth).
- Stop the dev instance with `mongod --dbpath .data/mongo --shutdown`.
- Without these env vars the app still builds and the landing page renders; the login button shows a "Database not configured" message.

Asset pipeline:

```bash
cd pipeline
uv sync
uv run asset-pipeline base          # runs Blender headless (MPFB), writes GLBs to pipeline/out
```

## Quality checks

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test   # repository tests need `pnpm db:start`, they skip otherwise
cd pipeline && uv run ruff check && uv run ruff format --check && uv run pytest
```

## License

Proprietary. Internal demo, all rights reserved.
