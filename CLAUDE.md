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
- Veri: MongoDB (resmi `mongodb` driver) + Better Auth (`anonymous` plugin). Geliştirmede yerel mongod: `127.0.0.1:27018`, veri `.data/mongo` (gitignored). Compass: `mongodb://localhost:27018`.
- `pipeline/`: Python (uv) + headless Blender (`bpy`) + MPFB2. Çıktı `web/public/assets/` + `manifest.json`.
- Ayrı backend yok. Sunucu işleri Next.js route handler'larında. AI için resmi SDK'lar: `@anthropic-ai/sdk` (Claude), `@google/genai` (Gemini), `groq-sdk` (Groq); TTS için `microsoft-cognitiveservices-speech-sdk`. Vercel AI SDK kullanılmaz.

## Mimari kuralları
- `CharacterConfig` (zod, `web/src/lib/character/`) render'dan bağımsızdır ve yalnızca manifest ID'lerine referans verir. Şema değişirse `schemaVersion` artırılır ve migration yazılır.
- Tüm giysi ve saç GLB'leri base iskelete skinlenir; runtime'da `SkinnedMesh.bind` ile bağlanır.
- Base mesh'te ARKit 52 + Oculus 15 viseme morph'ları **zorunlu** (lip-sync için).
- Turntable: sürükleyince kamerayı değil karakteri döndür. Stüdyo ışığı yüze göre sabit kalmalı.
- Secret'lar yalnızca env'de durur. Şu an hiçbir değişken `NEXT_PUBLIC_` almaz. `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, AI ve TTS key'leri yalnızca server tarafında kullanılır. Env eksikse build ve landing çökmez; login "Database not configured" gösterir.

## Komutlar
```bash
# web
cd web && pnpm dev            # localhost:3000
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e                 # Playwright
# repository testleri 27018'deki mongod'a karşı `ai-sims-test` DB'sinde çalışır, mongod yoksa skip edilir

# pipeline
cd pipeline && uv sync
uv run ruff check && uv run ruff format --check && uv run pytest

# veritabanı (yerel MongoDB, port 27018)
cd web && pnpm db:start       # mongod'u arka planda başlatır; önce `mkdir -p .data/mongo`
```

## Veri kuralları
- **Her repository sorgusu `userId` ile filtrelenir** (RLS yok, tek yetki katmanı bu). `userId` yalnızca `requireUserId()`'den gelir, client'tan asla.
- `web/src/lib/db/` mongo client + `ensureIndexes()`; `web/src/lib/characters/repository.ts` tek veri erişim noktası. Config okunurken ve yazılırken zod ile doğrulanır; `style`, `base`, `schemaVersion` config'ten türetilir.
- Thumbnail ayrı `thumbnails` koleksiyonunda (`_id` = karakter `_id`, WebP, en çok 512 KB). Sadece `/api/characters/[id]/thumbnail` üzerinden, oturum + sahiplik kontrolüyle servis edilir.
- Proxy yalnızca iyimser cookie kontrolü yapar; sayfa ve action'lar `requireUserId()` ile oturumu sunucuda doğrular.
- Stil (2026-10-20 güncel): şirket anime (VRoid/VRM) yönünü reddetti; **ciddi, gerçekçi görünüm zorunlu** ve MacBook'ta geliştirilebilir olmalı. Gerçekçi rota (MetaHuman / Microsoft Rocketbox) kullanıcı kararını bekliyor. Anime kodu (`d147f71`'e kadar) dondurulmuş durumda; üzerinde çalışılmaz. Stilden bağımsız katmanlar (parça montajı ve fit, lip-sync, canlılık, takı ve piercing, oluşturucu arayüzü) yeni rotada yeniden kullanılır.

## AI sohbet ve TTS
- Hesap, anahtar ve doğrulama adımları: `docs/setup-accounts.md`. Anahtarların hepsi isteğe bağlıdır; yoksa `POST /api/chat` `503 ai_not_configured`, `POST /api/tts` `503 tts_not_configured` döner ve uygulama çalışır. `GET /api/health` yalnızca dev'de, değer değil boolean döner (production'da 404).
- `web/src/lib/ai/`: `providers/` (groq, gemini, anthropic), `router.ts` (`streamWithFallback`, sıra `AI_PROVIDER_ORDER`, varsayılan **groq → gemini → anthropic**: önce ücretsizler, ücretli Claude en sonda), `persona.ts` + `prompts/persona.template.ts` (prompt'lar şablon modülünde durur, kodda inline yazılmaz; metin değişince `PERSONA_PROMPT_VERSION` artırılır, şu an 2). Sağlayıcıdan sonrakine **yalnızca ilk token'dan önce** geçilir; metin başladıktan sonra sağlayıcı asla değişmez. İlk token zaman aşımı sağlayıcı başınadır (`FIRST_TOKEN_TIMEOUT_MS`): groq ve gemini 10 sn, zincirin sonundaki anthropic 25 sn.
- Varsayılan modeller `web/src/lib/env.ts` içindedir ve 2026-10-20'de ölçüme göre seçildi (gerekçe ve ölçüm tablosu: `docs/setup-accounts.md`): Groq `openai/gpt-oss-120b` (`reasoning_effort: low`, gizli), Gemini `gemini-3.5-flash-lite` (sabit id, `-latest` alias'ı kullanılmaz), Claude `claude-haiku-5-5` (tarih eki yok). Groq ve Gemini ücretsiz katmandır: büyük Flash modelleri (`gemini-3.7-flash`, `gemini-3.8-flash`) aşırı yük ve 429 verdi, Flash-Lite vermedi. Gemini `thinkingLevel` modele göre `thinkingLevelFor()` ile seçilir: Flash-Lite ile 3.5/3.6 Flash için `MINIMAL`, diğer 3.x için `LOW` (3.7/3.8-flash `MINIMAL`'i 400 ile reddeder); 2.x modellere ve alias'lara gönderilmez.
- Claude yalnızca `@anthropic-ai/sdk` ile çağrılır. `claude-haiku-5-5` için: standart `client.messages.stream`, `thinking` gönderilmez (adaptive varsayılan açık, kol `effort`), `output_config.effort: 'low'`, `temperature`/`top_p`/`top_k` yok (400), prefill yok (400), `max_tokens` 4096 (düşünme token'ları da sayılır). Haiku 5.5'te sunucu tarafı refusal fallback **yoktur**: `fallbacks` ve `server-side-fallback-2026-07-01` beta'sı gönderilmez; `stop_reason === 'refusal'` ve boş cevap her zaman `ProviderError` olur. `ANTHROPIC_MODEL=claude-opus-5-5` verilirse `supportsServerSideFallback()` true döner: beta endpoint ve `fallbacks: 'default'` kullanılır (`thinking: disabled` orada da 400). Listeye model eklemeden önce claude-api skill'indeki model rehberine bak.
- Anahtar ve ham sağlayıcı hata gövdesi asla loglanmaz: hatalar `ProviderError`'a (sağlayıcı, tür, status) indirgenir.
- `web/src/lib/tts/`: Azure Speech (bellekte MP3, viseme ve kelime olayları; tr-TR için viseme ID desteklenir). Lip-sync adaptörleri `web/src/features/lipsync/azureVisemes.ts` ve `wordAlign.ts`; `SpeechPlayer.load()` önceliği: events, words, text.
- Route handler'larda `runtime` export'u yoktur: Cache Components altında desteklenmez, Node tek runtime'dır.

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
