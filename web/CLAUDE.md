@AGENTS.md

Project-wide rules live in the root `CLAUDE.md`.

## Veri ve auth (web)

- Server-only modüller: `src/lib/env.ts`, `src/lib/db/*`, `src/lib/auth/*`, `src/lib/characters/repository.ts`, `src/lib/ai/providers/*`, `src/lib/ai/router.ts`, `src/lib/tts/azure.ts`. Env okumaları import anında değil çağrı anında yapılır; `getAuth()` lazy'dir. Tarayıcıda da kullanılan saf modüller: `src/lib/ai/types.ts`, `src/lib/tts/{types,speechText}.ts`.
- Route handler'larında oturum için `getSession()` (401 JSON döner), `requireUserId()` yalnızca sayfa ve action içindir (redirect eder).
- Sayfalarda oturum okumak (`getSession`, `requireUserId`) `<Suspense>` içinde olmalı (Cache Components).
- Repository fonksiyonları ilk argüman olarak `userId` alır ve her sorguda filtreler.
- Test: `pnpm test`. Repository testleri `127.0.0.1:27018` kapalıysa skip edilir (`pnpm db:start`).
