@AGENTS.md

Project-wide rules live in the root `CLAUDE.md`.

## Veri ve auth (web)

- Server-only modüller: `src/lib/env.ts`, `src/lib/db/*`, `src/lib/auth/*`, `src/lib/characters/repository.ts`. Env okumaları import anında değil çağrı anında yapılır; `getAuth()` lazy'dir.
- Sayfalarda oturum okumak (`getSession`, `requireUserId`) `<Suspense>` içinde olmalı (Cache Components).
- Repository fonksiyonları ilk argüman olarak `userId` alır ve her sorguda filtreler.
- Test: `pnpm test`. Repository testleri `127.0.0.1:27018` kapalıysa skip edilir (`pnpm db:start`).
