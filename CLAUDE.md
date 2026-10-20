# AI Sims — Proje Talimatları

Tarayıcıda çalışan, fotogerçekçi ve kişiselleştirilebilir 3D karakter oluşturucu. Karakter sonradan LLM ile sesli konuşacak ve ağız hareketleri kelimelerle senkron olacak. Şirket içi demo/POC.

Tasarım ve kararlar: `docs/specs/2026-10-20-character-creator-design.md`. Bu dosyadaki kararları tekrar sorma.

## Öncelikler
1. **Gerçekçilik** en kritik gereksinim. Kalite hedefi Holoxone tanıtım videosu (2D video, kalite çıtası olarak alındı).
2. Kişiselleştirme: Erkek + Kadın base, yüz, cilt, göz, saç, sakal, üst, alt, ayakkabı.
3. UI modern ve bol animasyonlu olacak, ama "AI yapmış gibi" durmayacak. Mor gradyan ve her yerde glassmorphism yasak.

## Stack
- `web/`: Next.js App Router, React 19, TypeScript `strict`, Tailwind v4, shadcn/ui, Motion, GSAP, next-intl (`/tr`, `/en`), zustand + zundo.
- 3D: three.js, @react-three/fiber, drei, postprocessing. Render tarayıcıda (WebGL2).
- Veri: Supabase cloud. Postgres + RLS, anonim giriş, `thumbnails` storage bucket. Migration'lar `supabase/migrations/` altında.
- `pipeline/`: Python (uv) + headless Blender (`bpy`) + MPFB2. Çıktı `web/public/assets/` + `manifest.json`.
- Ayrı backend yok. Sunucu işleri Next.js route handler'larında; AI için Vercel AI SDK (faz 4).

## Mimari kuralları
- `CharacterConfig` (zod, `web/src/lib/character/`) render'dan bağımsızdır ve yalnızca manifest ID'lerine referans verir. Şema değişirse `schemaVersion` artırılır ve migration yazılır.
- Tüm giysi ve saç GLB'leri base iskelete skinlenir; runtime'da `SkinnedMesh.bind` ile bağlanır.
- Base mesh'te ARKit 52 + Oculus 15 viseme morph'ları **zorunlu** (lip-sync için).
- Turntable: sürükleyince kamerayı değil karakteri döndür. Stüdyo ışığı yüze göre sabit kalmalı.
- Secret'lar yalnızca env'de durur. `NEXT_PUBLIC_` önekini sadece Supabase URL ve anon key alır. AI ve TTS key'leri yalnızca server tarafında kullanılır.

## Komutlar
```bash
# web
cd web && pnpm dev            # localhost:3000
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e                 # Playwright

# pipeline
cd pipeline && uv sync
uv run ruff check && uv run ruff format --check && uv run pytest

# supabase
pnpm dlx supabase db push     # migration'ları cloud projeye uygular
```

## Dil ve stil
- İletişim Türkçe. Kod, identifier ve yorumlar İngilizce.
- UI metinleri hardcode edilmez; `web/messages/{tr,en}.json` dosyalarında tutulur.
- TS: prettier + ESLint. Python: tip anotasyonu zorunlu, ruff.

## Git
- Bu projede küçük, doğrulanmış adımlar halinde `main`'e Conventional Commit + push yapılır (kullanıcı onaylı).
- Force push, history rewrite ve repo silme işlemleri her zaman önce sorulur.

## Doğrulama (işi bitirmeden önce)
- `pnpm typecheck`, `pnpm lint`, `pnpm test` temiz olmalı.
- Görsel değişiklikleri tarayıcıda ekran görüntüsüyle kontrol et (chrome-devtools MCP).
- Pipeline: `ruff` ve `pytest` temiz olmalı; üretilen GLB `gltf-transform validate` kontrolünden hatasız geçmeli.
