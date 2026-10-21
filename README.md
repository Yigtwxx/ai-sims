# AI Sims

A photorealistic, customizable 3D character creator that runs in the browser. The characters are MetaHumans, exported once from Unreal Engine and converted to web assets. After a character is created it talks to you: LLM chat with voice and word-synced lip-sync, in Turkish and English. Internal demo / POC.

> Status (2026-10-21): the MetaHuman library is exported and converted; creator, character list, talk screen and dev curation all work. Current state, open work and the Mac move: [`docs/handoff.md`](docs/handoff.md) (Turkish).

## Features

- **Creator:** male and female MetaHuman bases, face presets and face blending, body sliders, skin sets and tone, irises, hair with melanin/redness/dye and patterns, eyebrows, beards and moustaches, outfits with curated colours. Autosave and undo.
- **Realistic stage:** skin with SSS wrap, wrinkle and micro normals; eyes with cornea and occlusion; hair cards with Kajiya-Kay shading; Unreal's fabric shader for garments; quality tiers that step down when frames drop.
- **Always alive:** mocap idles, talk and listen gestures from free FBX packs, breathing, gaze, saccades and blinks.
- **Talk screen:** full-body character on the left, chat on the right, zoom and drag-to-rotate. Lip-sync from TTS visemes or word timings, aligned to the decoded audio.
- **Profiles:** each user's characters are saved to MongoDB; the demo uses one-click anonymous login.
- **AI:** Groq, then Gemini, then Claude Haiku as the paid last resort. TTS: Azure Speech, Edge voices, Gemini TTS.
- **i18n:** Turkish and English (`/tr`, `/en`).

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Next.js (App Router), React 19, TypeScript (strict) |
| 3D | three.js, React Three Fiber, drei, postprocessing; GLB with meshopt, KTX2 textures |
| UI | Tailwind CSS v4, shadcn/ui, Motion, GSAP |
| State | zustand + zundo |
| i18n | next-intl |
| Data / auth | MongoDB (official driver) + Better Auth (anonymous plugin) |
| Asset pipeline | Unreal Engine 5.8 (MetaHuman export, Windows only), Python (uv), OpenRigLogic, KTX-Software |
| Tests | Vitest, Playwright, pytest |

## Repository layout

```
web/        Next.js app (UI, 3D renderer, route handlers)
pipeline/   MetaHuman export (Unreal) and conversion to web GLB/KTX2 assets
docs/       Handoff, export notes, account setup, design specs
```

The MetaHuman assets are not in git. They live in an archive folder (`~/MetaHumanArchive`, tens of GB) and the web app reads them through a link at `web/public/assets/mh` (gitignored).

## Getting started

Prerequisites: Node 22+, pnpm 12, MongoDB Community Server (`mongod` on PATH, or `MONGOD_BIN`), and Python 3.13+ with [uv](https://docs.astral.sh/uv/) for the asset pipeline.

### macOS

On a fresh Mac, after installing [Homebrew](https://brew.sh): `brew install gh node@22 uv cmake`, `brew tap mongodb/brew && brew install mongodb-community` (don't start it as a service), put `/opt/homebrew/opt/node@22/bin` on PATH, `npm install -g pnpm@12.4.2`, then `gh repo clone Yigtwxx/ai-sims ~/ai-sims` (private repo; `gh auth login` first). Full steps: [`docs/handoff.md`](docs/handoff.md), "Mac kurulumu".

```bash
ln -s ~/MetaHumanArchive/web web/public/assets/mh   # the converted MetaHuman assets
cp .env.example web/.env.local                      # then fill in; see docs/setup-accounts.md
cd web
pnpm install
pnpm db:start                                       # mongod on 127.0.0.1:27018, data in .data/mongo
pnpm dev                                            # http://localhost:3000
```

Getting the archive from the Windows PC over the local network: [`docs/handoff.md`](docs/handoff.md), "Mac'e taşıma".

### Windows (Git Bash or PowerShell)

```bash
cp .env.example web/.env.local
cd web
pnpm install
pnpm db:start                                       # also finds a portable mongod under ~/tools/mongodb
pnpm dev
```

On the export PC `web/public/assets/mh` is a link to `C:\Users\Asus\MetaHumanArchive\web`. On another Windows machine create it with `mklink /J web\public\assets\mh <archive>\web` (cmd).

### Database

- Dev data lives in `.data/mongo` (dedicated instance on port 27018, separate from any other MongoDB you run). `pnpm db:start` creates the folder.
- Browse it with MongoDB Compass using `mongodb://localhost:27018`, database `ai-sims`.
- Collections: `characters`, `thumbnails` (app) and `user`, `session`, `account`, `verification` (Better Auth).
- Stop the dev instance with `pnpm db:stop`.
- Without the database variables the app still builds and the landing page renders; the login button shows a "Database not configured" message.

### AI chat and voice (optional)

- Keys go into `web/.env.local`, never into code. Variable names: [`.env.example`](.env.example). Step-by-step setup for every account, free-tier limits and how to verify each key: [`docs/setup-accounts.md`](docs/setup-accounts.md) (Turkish).
- Edge voices need no key but must be switched on with `TTS_ENABLE_EDGE=1`; they give word timings for lip-sync.
- Without keys the app still runs: `POST /api/chat` answers `503 ai_not_configured` and `POST /api/tts` answers `503 tts_not_configured`.
- In development, `curl localhost:3000/api/health` reports which services are configured (booleans only; the route returns 404 in production).

### Asset pipeline

```bash
cd pipeline
uv sync
uv run asset-pipeline --help              # ue, mh-convert, mh-prune, mh-similar, serve-slim
uv run asset-pipeline mh-convert --all    # archive exports -> web assets, incremental
```

- Incremental only on the machine that built the assets: build stamps (`<archive>/build/stamps/`) record absolute archive paths, so on a moved archive the first run rebuilds every unit it is asked for.
- `asset-pipeline ue <job>` runs the Unreal export jobs and works only on the Windows PC with UE 5.8. Jobs and archive layout: [`docs/metahuman-export.md`](docs/metahuman-export.md) (Turkish).
- `mh-convert` needs the OpenRigLogic bindings for this platform (`uv run --no-sync python scripts/build_openriglogic.py`) and KTX-Software 4.4.2 (`$KTX_TOOLS` or PATH).
- Asset contract between export, converter and web: [`docs/specs/2026-10-20-metahuman-web-assets.md`](docs/specs/2026-10-20-metahuman-web-assets.md).

## Quality checks

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test   # repository tests need `pnpm db:start`, they skip otherwise
pnpm test:e2e                                        # Playwright
cd pipeline && uv run ruff check && uv run ruff format --check && uv run pytest
```

## License

Proprietary. Internal demo, all rights reserved. MetaHuman assets are used under the Unreal Engine EULA, which forbids using them to train or test AI; check this before productising.
