# AI Sims — Photoreal Character Creator + AI Chat (Design & Plan)

## Context

Şirket içi demo/POC: Sims tarzı bir **karakter oluşturucu**. Erkek + Kadın base, saç, göz rengi, cilt tonu, yüz, üst/alt kıyafet, ayakkabı. Karakter mouse ile sürüklenip 360° döndürülebilecek. Kullanıcı "Bitti/Onayla" deyince karakter (sonraki fazda) LLM ile genel amaçlı sohbet edecek. Konuşurken **ağzı kelimelerle senkron oynayacak** (TTS + lip-sync). **En kritik gereksinim gerçekçilik**: kalite hedefi Holoxone tanıtım videosundaki adam.

Araştırma bulguları (Ekim 2026):
- Holoxone karakteri 3D değil, After Effects ile kurgulanmış sabit açılı bir MP4. Kalite hedefi olarak alınıyor; tarayıcıda gerçek zamanlı render buna "olabildiğince yaklaşacak".
- Ready Player Me kapandı (Netflix, Ocak 2026). Avaturn ~$800/ay. Reallusion CC5 lisansı karakter oluşturucu kullanımını yasaklıyor. Bunlar elendi.
- Seçilen yol: **tarayıcıda Three.js (React Three Fiber)** + kendi asset pipeline'ımız. Gerçekçilik tavanı tahminen ~7/10.
  - Kaçış yolu: Unreal MetaHuman + Pixel Streaming.
  - Karakter ayarları render'dan bağımsız JSON'da tutulduğu için bu geçişte UI, DB ve AI değişmez.

Kullanıcı kararları:
- Three.js, önce spike.
- Erkek + Kadın.
- Hedef: demo/POC.
- Önce web; masaüstü uygulaması sonra.
- Dil: TR + EN.
- Backend: sadece Next.js.
- Veri: MongoDB (yerel dev instance 27018) + Better Auth. Önce Supabase seçilmişti, free-tier proje limiti nedeniyle değişti.
- Asset bütçesi ve 3D artist yok. Geliştirme MacBook'ta, Windows yedekte.
- GitHub: private `ai-sims` reposu, parça parça commit + push.

## Mimari

```
ai-sims/
├── CLAUDE.md, README.md, .gitignore, .gitattributes (LFS), .env.example
├── docs/specs/2026-10-20-character-creator-design.md   # bu planın spec kopyası
├── docs/realism-spike.md                               # spike sonuçları + ekran görüntüleri
├── web/            # Next.js (App Router, TS strict, pnpm)
│   ├── src/app/[locale]/           # landing+login, characters, create, characters/[id]/edit, (chat: faz 3)
│   ├── src/features/avatar/        # R3F renderer: Stage, Avatar, materials, TurntableControls, CameraRig
│   ├── src/features/creator/       # zustand store (+zundo undo/redo), panels, swatches, randomize
│   ├── src/lib/character/          # CharacterConfig zod schema, defaults, migrations
│   ├── src/lib/{db,auth,characters}/ # mongo client, Better Auth, repository (userId filtreli)
│   ├── messages/{tr,en}.json       # next-intl
│   └── public/assets/              # optimize GLB (KTX2+meshopt) + manifest.json
├── pipeline/       # Python (uv, ruff, pytest): Blender headless (bpy) scriptleri
│   └── scripts/ build_base.py, export_glb.py, optimize.py, make_thumbnails.py, build_manifest.py
```

**Stack:**

| Katman | Seçim |
|---|---|
| Uygulama | Next.js (güncel sürüm, sürüm detayları context7 ile doğrulanacak), React 19, TS `strict`, prettier |
| UI | Tailwind v4, shadcn/ui (Radix), Motion (`motion/react`), GSAP + SplitText (seçici), React Bits (seçici), next/font |
| i18n | next-intl, locale prefix `/tr`, `/en` |
| 3D | three, @react-three/fiber v9, drei, postprocessing (N8AO, SMAA), camera-controls |
| State | zustand + zundo (undo/redo) |
| Asset işleme | Blender (brew cask) + MPFB2 eklentisi, bpy scriptleri; @gltf-transform/cli (KTX2, meshopt, validate) |
| Test | Vitest, Playwright, pytest |
| Backend | Yok, sadece Next.js. Python yalnızca asset pipeline'ında. |

## Veri modeli (MongoDB + Better Auth)

Supabase free-tier proje limiti ve Compass ile veriye bakma isteği nedeniyle MongoDB + Better Auth'a geçildi.

- **Auth:** Better Auth, `anonymous` plugin. "Giriş" butonu `auth.api.signInAnonymous` çağırır; `user` ve `session` koleksiyonlarında gerçek kayıt oluşur. E-posta/şifre şimdilik kapalı; sonradan açılıp anonim kullanıcı yükseltilecek. Oturum cookie'si `nextCookies` plugin'i ile yazılır, proxy `getSessionCookie` ile iyimser kontrol yapar, sayfalar oturumu sunucuda doğrular.
- **`characters` koleksiyonu:**
  - `_id: ObjectId`, `userId: string` (Better Auth user id)
  - `name` (1..40), `style: 'anime'|'realistic'`, `base: 'male'|'female'`
  - `config` (CharacterConfig), `schemaVersion`, `status: 'draft'|'finalized'`
  - `hasThumbnail: boolean`, `createdAt`, `updatedAt`
  - İndeks: `{ userId: 1, updatedAt: -1 }` (`ensureIndexes()` ile, süreç başına bir kez, idempotent)
- **`thumbnails` koleksiyonu:** `_id` = karakterin `_id`'si, `userId`, `contentType: 'image/webp'`, `data: Binary` (en çok 512 KB), `updatedAt`. Karakter silinince birlikte silinir. `GET /api/characters/[id]/thumbnail` oturum ve sahiplik kontrolü yapar, `private` cache header'ı ve ETag verir.
- **Yetkilendirme:** RLS yok. Repository'deki **her sorgu `userId` ile filtrelenir**; başkasının kaydı "yok" gibi davranır. `userId` yalnızca sunucuda oturumdan okunur.
- **Yerel geliştirme:** ayrı mongod `127.0.0.1:27018` (auth yok), veri `.data/mongo` (gitignored), `pnpm db:start`. Compass bağlantısı: `mongodb://localhost:27018`.
- Env: `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. Eksikse build ve landing çalışır, login "Database not configured" gösterir.
- `profiles` ve sohbet koleksiyonları eklenmiyor (YAGNI). Sohbet verisi faz 3'te gelecek.

**CharacterConfig (zod, render'dan bağımsız):**
```ts
{ schemaVersion: 1, style: 'anime'|'realistic', base: 'male'|'female',
  face: { preset: string, blend: Record<string, number> },   // morph blend between face presets
  skin: { tone: number },                                      // 0..1 along melanin ramp
  eyes: { color: string },                                     // hex
  hair: { style: string, color: string },
  facialHair: { style: string | null, color: string },
  outfit: { top: Item, bottom: Item, shoes: Item } }           // Item = { id, color? }
```
`manifest.json` pipeline tarafından üretilir. Her item şu alanları taşır: `id`, `base`, `category`, `glb`, `thumbnail`, `tintable`, `hidesBodyRegions[]`, `i18nKey`. Config yalnızca manifest ID'lerine referans verir.

## Faz 0 — Repo + İskelet (spike'tan önce)

1. Proje klasörü:
   - `git init`
   - `gh repo create Yigtwxx/ai-sims --private`
   - `.gitignore`: `.env*` (`.env.example` hariç), `*.pem`, `*.key`, `secrets/`, `node_modules`, `.next`, `pipeline/.venv`, `pipeline/out/`
   - `.gitattributes`: Git LFS ile `*.blend`, `*.fbx`, `pipeline/source/**`
2. Dokümanlar:
   - `CLAUDE.md` (TR). İçerik: stack, komutlar, dil kuralları (kod/yorum EN), doğrulama komutları, asset pipeline akışı, commit kuralları.
   - `README.md` (EN). İçerik: overview, setup, env, scripts.
   - `.env.example`: `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, faz 3 için AI key adları. Gerçek değer yok.
   - Bu planın spec kopyası `docs/specs/` altına.
3. `web/` scaffold: create-next-app, Tailwind, shadcn init, prettier, ESLint, Vitest, Playwright. `pipeline/` için uv projesi, ruff, pytest, fake-bpy-module.
4. Çalışma doğrudan `main` üzerinde (tek kişilik POC). Her adım ayrı Conventional Commit olacak ve push edilecek. Commit sırası: `chore: init repo` → `docs: add CLAUDE.md and README` → `chore(web): scaffold next.js` → …

## Faz 1 — Gerçekçilik Spike'ı (KARAR KAPISI)

Amaç: MacBook'ta tarayıcıda ulaşılabilir gerçekçilik tavanını ve asset yolunu kanıtlamak. Spike `/spike` route'unda yapılacak.

1. **Stüdyo sahnesi:**
   - Holoxone benzeri beyaz ışık kutusu / cyclorama.
   - Işık: Poly Haven CC0 stüdyo HDRI (IBL) + key/rim directional ışık + yumuşak gölge (AccumulativeShadows/ContactShadows).
   - Render: AgX tonemapping, MSAA + SMAA, N8AO, hafif bloom ve vignette.
2. **Turntable kontrol:**
   - Sürükleyince ışığı değil **karakteri** Y ekseninde döndür (atalet + damping). Böylece stüdyo ışığı hep yüze göre sabit kalır.
   - Zoom sınırlı.
   - Kategoriye göre kamera odağı: saç ve göz → yüz, ayakkabı → ayak.
3. **Karakter A — MPFB2 (CC0), tamamen scriptlenebilir:**
   - `blender -b -P build_base.py` ile M/F base üretilir.
   - "Export Copy" ile ARKit 52 + viseme morph'ları eklenir. Bunlar faz 3 lip-sync için şimdiden gerekli.
   - Skin/eyebrow/eyelash asset'leri, hair card'lar, GLB export, gltf-transform ile optimize.
4. **Karakter B (Mac'te mümkünse) — MetaHuman → GLB:**
   - UE 5.6+ macOS'ta MetaHuman Creator destekleniyor mu, önce doğrula.
   - Desteklenmiyorsa bu adım atlanır ve Windows opsiyonu olarak not edilir.
5. **Malzeme deneyleri:**
   - Cilt: MeshPhysicalMaterial + wrap/pre-integrated SSS (`onBeforeCompile`) ile separable SSS post-pass karşılaştırması; detail normal (gözenek).
   - Göz: cornea clearcoat/refraction, eye-occlusion kabuğu, tearline.
   - Saç: card'lar için alpha-to-coverage, opak + şeffaf iki geçiş, anisotropy.
   - Kumaş: sheen + detail normal.
6. **Canlılık:**
   - Idle animasyon (Mixamo "Breathing Idle", retarget).
   - Prosedürel göz kırpma (ARKit `eyeBlink`), sakkadlar, imlece hafif bakış.
7. **Lip-sync smoke test:**
   - Önceden kaydedilmiş Türkçe bir TTS cümlesi + zaman damgalı viseme dizisiyle ağız animasyonu oynatılır.
   - Amaç: viseme/ARKit morph'larının (jaw, mouth, dil) gerçekçi göründüğünü faz 4'ten önce kanıtlamak.
8. **Ayakkabı denemesi:** Meshy/Tripo free tier veya Hunyuan3D ile AI üretimi. Ayakkabı sadece ayak kemiğine skinlendiği için AI asset'e uygun.
9. **Çıktı:** Yan yana ekran görüntüleri, FPS ölçümü (hedef: M serisi Mac'te 1440p'de 60 fps) ve `docs/realism-spike.md`.

**→ DUR: sen ve şirket ekran görüntülerini değerlendirir. Seçenekler:**
- **Go:** Three.js ile devam.
- **Bütçe:** saç/kıyafet için ~$100–300 lisanslı asset al.
- **Escalate:** Windows + MetaHuman/Pixel Streaming'e geç.

Dürüst risk: asset bütçesi olmadan en zayıf halka saç ve kıyafet kalitesi olacak. Yüz ve cilt tarafı shader işçiliğiyle iyi bir seviyeye çekilebilir.

## Faz 2 — Temel (spike ile paralel yürütülebilir, en fazla 2–3 agent)

1. next-intl: `[locale]` routing, `messages/tr.json`, `messages/en.json`, dil değiştirici.
2. MongoDB + Better Auth:
   - `mongodb` client singleton, tipli koleksiyonlar, `ensureIndexes()`.
   - Better Auth (anonymous + nextCookies). Proxy next-intl ile birlikte `getSessionCookie` ile iyimser kontrol yapar.
   - Yerel mongod: `pnpm db:start` (27018).
3. Landing/Login:
   - Animasyonlu hero ve "Giriş" butonu (anonim giriş).
   - Korunan route'lar giriş yapılmamışsa landing'e yönlendirir.
4. Tasarım sistemi:
   - Implementasyonda `impeccable` / `frontend-design` / `design-taste-frontend` skill'leri kullanılacak.
   - Yön: "atölye/stüdyo" estetiği. Sıcak kırık beyaz + grafit renkler, editoryal display font + temiz grotesk.
   - Mor gradyan ve her yerde glassmorphism yok.
   - Motion ile mikro etkileşimler, sayfa geçişleri, panel stagger animasyonları.

## Faz 3 — Karakter Oluşturucu

1. **Asset seti** (gender başına):
   - 3–4 yüz preseti (aynı topoloji, morph olarak blend edilir)
   - 4–6 saç
   - 3–4 üst, 3 alt, 3 ayakkabı
   - Erkek için 2–3 sakal
   - Sürekli parametreler: cilt tonu, göz rengi, saç rengi
   - Pipeline thumbnail'ları Blender'da render eder, `build_manifest.py` manifest'i üretir.
2. **Runtime montaj:**
   - Base GLB içinde iskelet + vücut + baş + göz + diş bulunur.
   - Her giysi/saç GLB'si aynı iskelete skinlenir; yüklenince `SkinnedMesh.bind(baseSkeleton)` ile bağlanır.
   - Vücut bölgelere ayrılır (torso/arms/legs/feet). Giysinin `hidesBodyRegions` listesindeki bölgeler gizlenir, böylece vücut kıyafetin içinden taşmaz.
   - Asset'ler lazy load edilir; o anki seçimin komşuları preload edilir.
3. **UI:**
   - Sol: kategori rayı. Orta: 3D sahne. Sağ: seçenek paneli (thumbnail'lar, renk swatch'ları, slider'lar).
   - Ek kontroller: Rastgele, Geri al/İleri al, isim alanı.
   - "Bitti" tıklanınca onay dialog'u açılır, sonra `status='finalized'` kaydedilir ve canvas'tan thumbnail alınıp storage'a yüklenir.
4. **Kayıt:**
   - Taslak otomatik kaydedilir (debounce).
   - "Karakterlerim" listesi kartlar halinde; düzenle/sil.
   - Config yüklenirken zod ile doğrulanır ve gerekirse schema migration uygulanır.

## Faz 4 — AI Sohbet (sonra, ayrı planlanacak)

- Vercel AI SDK `streamText`, provider'lar `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/groq`.
- Hata veya 429 durumunda zincirleme fallback.
- Karakterden üretilen persona system prompt'u.
- Model ID'leri o zaman `claude-api` skill'inden alınacak.
- Key'ler yalnızca server tarafında env'de tutulacak.
- Sohbet tabloları: `conversations`, `messages`.

**Konuşma + kelime senkron lip-sync (zorunlu gereksinim):**
- **Akış:** LLM cümle cümle stream eder → her cümle TTS'e gider (ses + kelime/viseme zaman damgaları) → istemci sesi çalar ve aynı zaman çizelgesinde viseme morph'larını sürer.
  - Morph geçişleri coarticulation ile yumuşatılır.
  - Konuşurken kafa hareketi, göz kırpma ve kaş jestleri eklenir.
- **TTS adayları** (Türkçe + zaman damgası şartı):
  - Azure Speech: F0 free tier, Türkçe neural sesler, native viseme event'leri. Birincil aday.
  - ElevenLabs: free tier; karakter düzeyinde alignment döndürür.
  - Google Cloud TTS: timepoint desteği.
  - Seçim faz 4'te maliyet ve ses kalitesine göre yapılacak.
- **Türkçe viseme modülü:**
  - TalkingHead'in Türkçe modülü yok. Türkçe yazım neredeyse fonetik olduğu için grapheme → viseme kural tablosunu kendimiz yazacağız (kolay, test edilebilir).
  - Ses-tabanlı yedek: ses analiziyle (ör. wawa-lipsync) her TTS'le çalışır.
- **Gereksinim şimdiden:** base mesh'te ARKit 52 + Oculus 15 viseme morph'ları faz 1'den itibaren zorunlu. Yeni eklenen her yüz preseti de bu morph'ları taşımalı.

## Doğrulama

- **web:** `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test` temiz olmalı.
- **Vitest kapsamı:** schema, store, randomize, manifest doğrulaması.
- **Playwright E2E:** giriş → oluştur → saçı değiştir → Bitti → sayfayı yenile → aynı config ile listede görünmeli.
- **RLS testi:** iki ayrı anonim oturum birbirinin karakterini göremez.
- **pipeline:** `ruff check`, `ruff format --check`, `pytest`; bir asset headless build edilir ve `gltf-transform validate` hatasız geçer.
- **Görsel:** chrome-devtools MCP ile `/spike` ve `/create` ekran görüntüleri; performance trace ile FPS kontrolü.
- **Git:** her doğrulanmış adımdan sonra küçük bir Conventional Commit + push (attribution satırları dahil).
- **Onaydan sonra hafızaya kaydedilecekler:** git yetkisi (bu projede parça parça commit/push) ve proje kararları (memory).
