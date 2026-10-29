# Faz 2 — Panel ve temel kıyafet (~60 sa)

> Kaynak: `docs/todo.md` "Sıra" tablosu, Faz 2 (2a → 2b → 2c → 2d → 2e). Kurallar o dosyanın "Çalışma kuralları" bölümünde; burada tekrar edilmez.
> Her adım tek başına biter: doğrulama, commit, push. Yarım adım push'lanmaz. Oturum kesilirse yenisi ilk açık kutudan devam eder.
> Süreler saat. "Tahmin" plan anındaki kaba tahmin, "Gerçek" adım bitince yazılır.
> Kullanıcı 2026-10-29'da yalnız 2a'yı istedi ("faz 2 a yı yap sadece"). 2b-2e sırası gelince adımlara bölünür.
> Sıra değişti (kullanıcı kararı, 2026-10-29): 2a'dan sonra **2e** ("evet 2e yi yap sadece"), sonra 2b → 2c → 2d. 2e'nin teknik bir bağımlılığı yok: 2b ile aynı cilt shader'ına dokunur, şortlar (2d) gelince uzun çorap bir kez kontrol edilir.
> Yeniden tahmin (2026-10-29, Faz 1 ve 2a'nın gerçek sürelerinden): 2b ~6, 2c ~1.5, 2d ~7, 2e ~2.5; kalan ~17 sa (aralık 12-25).

**Hedef (2a):** Göz panelindeki ton ve Yüz panelindeki karıştırma sahnede çalışıyor; karışık yüz konuşurken dudak senkronu ve göz kırpma bozulmuyor.

**Mimari:** İkisi de yalnız web. Unreal, Blender ve dönüştürücü gerekmez: 23 kafanın hepsi aynı topolojide (9 primitive, head 24408 vertex, 67 morph, 870 eklemli tek skin; isimler ve sıra aynı, ölçüm 2026-10-29). Karıştırma kaynakları mevcut `faces/<ad>/head.glb` dosyalarıdır.

## Genel kısıtlar

- Doğrulama: `pnpm typecheck && pnpm lint && pnpm test`; görsel değişiklik `/dev/stage`'de ekran görüntüsüyle kontrol edilir.
- `CharacterConfig` değişmez (`eyes.color` ve `face.blend` şemada zaten var), migration yok.
- UI metinleri `web/messages/{tr,en}.json`'da.
- Her alt faz sonunda `docs/todo.md` kutusu `[x]` + tarih + commit, `docs/handoff.md` "Durum"a bir iki satır.

---

## 2a — Göz tonu, yüz karıştırma (B1 → B2), tahmin ~14 · gerçek ~1 (bitti 2026-10-29)

- [x] **2a.1 Göz tonu (B1).** Tahmin 1.5 · Gerçek 0.4 (plan dahil; `543687b`)
  - İris dokusu UV merkezli (ölçüm, 2048 px kaynak, yarıçap UV biriminde): göz bebeği r < 0.04, iris 0.045-0.13, koyu limbus halkası 0.13-0.15, sklera 0.155'ten sonra.
  - `eyeMaterials.ts`: göz küresi malzemesine `onBeforeCompile` ile ton. `map_fragment`'tan sonra iris maskesi (göz bebeği ve sklera dışarıda), texel parlaklığının irisin kendi ortalamasına oranı (lif detayı) × ton rengi, maskeyle karıştırılır. Referans parlaklık manifest'teki `iris.swatch`'tan (pipeline'ın halka medyanı).
  - `resolve.ts`: `irisTint` (lineer RGB ya da null). `MhStage` → `MhCharacter` prop'u; değişince doku yeniden yüklenmez, yalnız uniform.
  - Testler: CPU aynası (maske ve renk), `resolve` testi.
  - Kontrol: `/dev/stage`'de koyu (Zuri) ve açık iris üzerinde 6 ton; ton yokken görüntü değişmemiş.
  - Sonuç: tam doygunlukta mavi ve yeşil lens gibi duruyordu; ton rengin doygunluğunun %75'iyle çiziliyor (`IRIS_TINT_CHROMA`), parlaklık aynı. Kahverengi, ela, amber ve gri doğal.

- [x] **2a.2 Karıştırma çekirdeği (B2).** Tahmin 3 · Gerçek 0.2 (`d81f1df`)
  - Yeni saf modül `web/src/features/avatar/mh/faceBlend.ts`: taban kafa + en çok 3 kaynak kafa ve ağırlıklar → her primitive için konum ve normal, 67 morph'un konum ve normal delta'ları, göz eklemlerinin (`FACIAL_L_Eye`, `FACIAL_R_Eye`) yerel konumu ve ters bind matrisi.
  - Ağırlık: `p = p_taban + Σ wᵢ (pᵢ − p_taban)`; toplam 1'i geçerse ağırlıklar toplama bölünür (taban sıfıra iner, aşırı uç yok).
  - Morph delta'ları int16 normalize; bütün kafalarda aynı ölçek, karıştırma doğrudan bu uzayda yapılır. Normaller karıştırılıp normalize edilir.
  - Kafanın canlı eklemleri yalnız 11 (`skin.live_joints`): omurga, köprücük, boyun ve kafa gövdeden gelir; yüze özgü canlı eklem yalnız iki göz. Çene morph'larda pişmiş durumda, ayrıca eklem gerekmez.
  - Yükleyici önbelleğindeki geometriye yazılmaz: karışım kendi kopyasına yazılır (`ownSeamAttributes` deseni).
  - Vertex sırası her kafada aynı olmalı: test `_DNA_POSITION` eşitliğini de kontrol eder; değilse karıştırma yapılmaz ve uyarı yazılır.
  - Testler: sentetik iki-üç geometriyle ağırlık 0/1/ara, toplam > 1, morph delta, eklem.
  - Bulgu: dönüştürücü bazı morph hedeflerini float32, bazılarını int16 yazıyor ve aynı hedef yüzden yüze farklı tipte olabiliyor (Kelvin'in `cartilage`'ı). Tipler aynıysa ham birimde, değilse değer biriminde float'a karıştırılıyor. Tamamen sıfır hedefler atlanıyor.

- [x] **2a.3 Sahneye bağlama (B2).** Tahmin 3 · Gerçek 0.2 (`d81f1df`)
  - `resolve.ts`: `blend: { headUrl, weight }[]` (manifest'te olmayan ya da başka cinsiyetten yüzler atlanır, ağırlığı 0 olanlar da).
  - `MhCharacter`: karışım montajda, boyun dikişi bağlanmadan önce uygulanır; dikiş, saç oturtma ve sınırlar karışık kafayı görür.
  - `MhStage`: karakter anahtarı karışımı da içerir; ağırlık değişince yeni karakter mevcut yüz değiştirme yolundan ekran dışında kurulup tek karede yer değiştirir. Kaydırıcı sürüklenirken her değerde yeniden kurulmaz (bırakınca ya da kısa bir duraklamada).
  - Kaynak kafalar kullanılmadığında önbellekten düşer (`evictMhGltf`); konuşma ekranında karışım bir kez kurulur.
  - `randomize.ts` zaten ağırlık yazıyor; davranışı kontrol edilir.
  - Sonuç: kaydırıcı bırakınca uygulanıyor (`LabeledSlider.onCommit`). Karışım tek seferde ~0.5 sn ana iş parçacığını kilitliyordu (profil: yarısından fazlası morph'lu `computeBoundingBox/Sphere`). Sınırlar kafaların hazır sınırlarından birleştiriliyor, karışım 6 ms'lik dilimlerle hazırlanıyor ve karakter o sırada Suspense'te bekliyor (`prepareFaceBlend`, `use()`). Hazırlama hata verirse yüz karışımsız çizilir.

- [x] **2a.4 Doğrulama ve yayın (B2).** Tahmin 2.5 · Gerçek 0.2
  - `/dev/stage`: Ada + Zuri %50, Victor + Mason %100, üç kaynaklı karışım. Her biri: idle, `/api/tts` ile TR ve EN konuşma (dudak kapanmaları m/b/p), göz kırpma, göz teması (göz küresi dönerken kapaktan çıkmıyor), boyun dikişi, saç ve sakal oturması.
  - Bellek ve süre: karışım hesap süresi ve kaynak başına ek bellek ölçülür, handoff'a yazılır.
  - Oluşturucu: kaydırıcı, kaldırma, undo, autosave; karakter kaydedilip konuşma ekranında açılıyor.
  - `docs/todo.md` B1, B2 `[x]`; handoff "Durum"; commit + push.
  - Sonuç (2026-10-29): `/dev/mh?blend=` ile sabit karede Ada + Zuri %50 ve Victor + Mason %100'de `eyeBlinkLeft` kapağı tam kapatıyor, `viseme_PP`'de dudaklar kapalı, `jawOpen`'da diş ve dil yerinde; Victor → Mason %100 şekli Mason'la aynı. Konuşan karışık yüzde (Victor + Mason %50, TR örneği) m/b/p kapanıyor. Konuşma modunda göz teması sırasında göz küreleri yuvasında. Oluşturucuda karışım ekleme ve kaydırıcı çalışıyor, konsolda hata yok.
  - Ölçüm: hazırlama ~0.43 sn duvar saati (iki kaynak), dilimli; en uzun ana iş parçacığı görevi düz yüklemede 395 ms, karışımla 482 ms (shader ve morph dokusu). JS belleği tek kaynakla +75 MB, üç kaynakla +180 MB (kaynak GLB'ler önbellekte kalır).
  - Kullanıcı kararı (2026-10-29): kaydırıcı bırakınca uygulanır (A); sürüklerken canlı önizleme (B) yapılmayacak.

## 2b — Dövme, takı (B3 → B4), tahmin ~16

Sırası gelince adımlara bölünür.

## 2c — Küçük resimler (D1), tahmin ~5

Sırası gelince adımlara bölünür.

## 2d — Tişört, şortlar (A4.2 → A4.3), tahmin ~13

Sırası gelince adımlara bölünür.

## 2e — Çorap ve külotlu (A4.5), tahmin ~12 (yeniden ~2.5) · gerçek ~1 (bitti 2026-10-29)

**Hedef:** Ayakkabı bölümünde çorap boyu (yok, bilek, diz altı, külotlu), rengi ve külotluda şeffaflık seçiliyor. Çorap çıplak ayakta ve ayakkabının üstünde görünüyor, giysinin ve ayakkabının altında çizilmiyor, kaydırıcılarla bozulmuyor.

**Mimari:** Yalnız web. Mesh yok, cilt shader'ında gövde katmanı (iç çamaşırının yanında, ondan sonra çizilir). `docs/todo.md` A4.5'teki "gövde UV'sinde script'le maske" yerine **kesim nötr gövdenin yüksekliğinden**: gövdenin `position` özniteliği kaydırıcısız gövdedir (kaydırıcılar morph), yani her vertex'in dinlenme yüksekliği anatomik bir koordinattır. Ölçüm (2026-10-29, `bodies/*/body.glb`): metre, Y yukarı, ayak tabanı y≈0; kadın ayak bileği eklemi 0.076, diz 0.459, `spine_01` 0.92; erkek 0.085, 0.486, 0.956. Bacaklar UV'de dikey (dv/dy ≈ 0.65 UV/m), çevre de ~0.65 UV/m. A-pozunda eller bel hizasında (kadın `hand_l` y 0.958): kesim düzlemi kolları da keserdi, bu yüzden ağırlığının yarısından fazlası kol zincirinde olan vertex'ler (`clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky`, `*toe*` hariç) katmanın dışında kalır. Doku dosyası, pipeline ve R2 yükü yok; kesim kenarı üçgen içinde doğrusal ve `fwidth` ile kenar yumuşatılır.

### Genel kısıtlar

- Şema v2 → v3 (`CURRENT_SCHEMA_VERSION`), migration v2'ye `socks: { style: 'none', ... }` yazar; v1 → v3 de çalışır.
- Külotlu çorap yalnız kadın gövdede; erkekte `reconcileConfig` onu `none` yapar. Gövde değişince çorap seçimi taşınır.
- Renk ve şeffaflık değişimi yeniden derleme ve yeniden kurulum istemez (uniform). Çorap karakter anahtarına girmez.
- UI metinleri `web/messages/{tr,en}.json`; renk adları `Creator.colors`.

- [x] **2e.1 Şema v3 ve migration.** Tahmin 0.5 · Gerçek 0.2 (`87738c0`)
  - `schema.ts`: `SOCK_STYLES = ['none', 'ankle', 'knee', 'tights']`, `socks: { style, color: #RRGGBB, sheer: 0..1 }` (0 opak, 1 en ince). `defaults.ts`: `none`, siyah, 0.5.
  - `legacy.ts`: `CharacterConfigV2Schema` (v3'ün `socks`'suz hali, `schemaVersion: 2`); `migrations.ts`: v2 → v3, v1 → v2 → v3.
  - `reconcile.ts`: erkek + külotlu → `none`. `store.ts` `setBase`: `socks` taşınır.
  - Testler: şema, migration (v2 ve v1 belgesi), reconcile; `repository.test.ts` artık 3 bekler.
- [x] **2e.2 Shader katmanı ve sahne.** Tahmin 1 · Gerçek 0.6 (`1503838`)
  - Yeni `web/src/features/avatar/mh/socks.ts`: `legHeights()` (dinlenme y'si, kolda büyük değer), `ensureLegHeights(body)` (paylaşılan geometriye bir kez), `sockWear()` (stil + cinsiyet → kesim, manşet, kumaş), GLSL parçaları, `createSockUniforms()`, `setSocks()`.
  - `materials.ts`: `SkinTuning.socks` (yalnız gövde). Harita aşamasında iç çamaşırından sonra renk; pürüzlülük, speküler ve sheen kumaşa; SSS sarma ve saçılma kumaşın altında söner; normal: opak çorapta örgü (manşette dikey fitil), ince külotluda cildin normali kalır ama gözenekler kapanır; manşetin hemen üstündeki deride ince bir lastik gölgesi.
  - Külotlu: opaklık `mix(1 - 0.75·sheer, 1, (1 - N·V)²)`, yani kenarda koyulaşır; bel bandı opak.
  - `resolve.ts`: `socks: SockWear | null`; `MhCharacter` prop'u (uniform, irisTint gibi); `MhStage` geçirir. `/dev/stage`'e çorap seçici.
  - Testler: kol maskesi ve yükseklikler (sentetik geometri), `sockWear`, CPU aynası (kenar, manşet, şeffaflık), shader enjeksiyonu.
  - Sonuç: kesim yükseklikleri bilek eklemi +5 cm, diz −6 cm, `spine_01` +3 cm; manşet 1.5 / 3 / 2.5 cm. İlk denemede ince külotlu tamamen opaktı: three'nin `vViewPosition`'ı zaten yüzeyden göze bakıyor, eksiyle çarpınca N·V hep 0 çıkıyordu. Düz renk "boyanmış bacak" gibi duruyordu; pamuğa 3.5 mm fitil, üst kenarda 3 mm'lik yukarı bakan normal (kenar kalınlığı) ve ~4 mm iplik benekleri eklendi. Şeffaflık eğrisi `sheer^1.5` (yarıda ~%72 örtü). **Ten rengi külotlu** (`NUDE_TIGHTS_COLOR`) sabit bej değil, giyenin kendi teni: gövde albedosunun 4 mip aşağısı ×0.9; koyu tende bej boya gibi duruyordu. Renkli naylonun altında cilt %30 solar.
  - Kontrol (Playwright, GPU'lu ANGLE D3D11; chrome-devtools profili başka oturumdaydı): Ada ve Jelena'da bilek, diz altı, külotlu (opak, 0.5, 0.9; ten, siyah, lacivert), çıplak ayak, spor ayakkabı, babet, Oxford, bilekli; kalem etek ve şort altında görünüyor, kot altında yok; kalça +1, kilo +1, boy −1'de çorap bacağı izliyor; Victor'da diz altı ve bilek; külotlu elleri boyamıyor. D3D'nin iki `X3595`/dört `X4122` shader uyarısı katman kapalıyken de aynı sayıda: eskiden beri var. Etekteki siyah benekler çorapsız da var (A4.0'dan kalan).
  - ~~Bilinen sınır: çıplak ayakta parmaklar ayrı görünür.~~ Düzeldi (kullanıcı geri bildirimi, 2026-10-29: "parmaklar çok belli oluyor", manşette çizgiler, doku; "bütün çoraplar için, kaliteli dursunlar"; `b2a29a9`, `b3d12d3`):
    - Parmak zarfı pipeline'da: `asset_pipeline/mh/sock_toes.py` her ayağı 1 mm vokselleyip 18 mm'lik topla kapatıyor (morfolojik closing). Komşu parmağa bakan yan yüzler ortada buluşuyor (yarık ön ağzına kadar kapanıyor), oluk duvarları kapalı yüzeye gradyanla yansıtılıyor; vokselin kendi kayması (yarım voksel) aynı yansıtmanın kapanmamış katıdaki sonucu çıkarılarak siliniyor. Normaller 6 voksel bulanık kopyadan. Çıktı `bodies/<cinsiyet>/socks.bin` (taşınan ~4.600 vertex, ofset + normal farkı, ~130 KB) ve manifest'te gövdenin isteğe bağlı `socks` alanı; `body.glb` ve 48 kıyafet aynı kalıyor (kıyafet parmak izi `body.glb` baytlarını içeriyor). `mh-convert --bodies` adımı.
    - Web: dosya çorap ilk giyildiğinde yükleniyor, vertex shader'da bağlama pozunda ekleniyor (`skinSockToes`), bütün boylarda. Külotlunun burnu takviyeli (`toeWeight`, %92 örtü). Manşet fitili kaldırıldı; iplik benekleri yerine 1.4 × 6 mm'lik ince iplik izleri; kumaşın altında kırmızı saçılma yerine nötr, yumuşak bir sarma.
    - `r2-sync.mjs` `.bin`'i tanımıyordu (atlıyordu): `application/octet-stream` eklendi; iki dosya ve manifest R2'de.
- [x] **2e.3 Panel.** Tahmin 0.5 · Gerçek 0.2 (`2f00956`)
  - `OutfitPanel`: Ayakkabı bölümünde "Çorap": boy seçici (`ChipRadio`; erkekte külotlu yok), renkler (çorap: siyah, beyaz, gri melanj, lacivert, bej, bordo; külotlu: ten rengi, siyah, lacivert, antrasit), külotluda şeffaflık kaydırıcısı (Opak ↔ İnce). Boy değişince renk o boyun paletinde değilse paletin ilkine geçer.
  - `palettes.ts`: `SOCK_COLORS`, `TIGHTS_COLORS`; yeni renk adları (`greyMelange`, `beige`, `nude`).
  - Sonuç: `SocksSection.tsx`, boy değişimi `creator/socks.ts` `restyleSocks()`. e2e: Ayakkabı sekmesinde dört boy, külotluda şeffaflık ve ten rengi seçili, erkeğe geçince külotlu yok ve `none`. Ayakkabı sekmesinde kamera ayaklara iniyor, diz altı manşeti görünüyor.
- [x] **2e.4 Doğrulama ve yayın.** Tahmin 0.5 · Gerçek 0.1
  - `/dev/stage`: kadın ve erkek; çıplak ayak, ayakkabı, etek + külotlu (ince ve opak, ten ve siyah), pantolon (çorap görünmüyor), kaydırıcı uçları, idle ve konuşma. Oluşturucu: seçim, undo, autosave, kayıt, konuşma ekranı.
  - `pnpm typecheck && pnpm lint && pnpm test`; `docs/todo.md` A4.5 `[x]`, handoff "Durum"; commit + push.
  - Sonuç: typecheck ve lint temiz, `pnpm test` 993 geçti (mongod açık), yeni e2e geçti. Undo, autosave ve konuşma ekranı elle denenmedi: çorap sıradan bir config alanı (store'un `update`'i, repository'nin zod okuma/yazması testli); konuşma kamerası bacakları göstermiyor.
