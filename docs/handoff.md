# Devir notu (2026-10-26, kadın göğüs ve kalça şekli ile crop top oturması sonrası)

Yeni bir Claude Code oturumu bu dosyayı okuyarak kaldığı yerden devam eder. Kalıcı kurallar `CLAUDE.md`'de. Bu dosya güncel durumu, açık işleri, Mac'e taşımayı ve Mac'teki sıradaki işi anlatan tek sayfadır.

## Ürün

- Şirket içi demo/POC. İzleyici yönetim ve karar vericiler.
- Tarayıcıda gerçekçi 3D karakter oluşturucu. "Bitti" denince karakter AI ile sesli konuşur; ağız kelimelerle senkron oynar.
- Erkek ve kadın, TR ve EN.
- Ekranlar:
  - Oluşturucu: sol panelde kişiselleştirme, sağda sahne.
  - Konuşma: karakter solda tam boy, sohbet sağda. Zoom ve döndürme var, yüz yakın planı (PiP) yok.
- Kalite çıtası:
  - "Basit bir proje gibi durmayacak."
  - Karakter hiç dümdüz durmaz.
  - Dudak senkronu en kritik ölçüt.

## Yön

- Anime (VRoid) iptal; kod `d147f71`'de donduruldu.
- Gerçekçi rota **MetaHuman**:
  - Unreal yalnızca bu Windows PC'de çalışır. Dışa aktarım burada yapıldı.
  - Kütüphane dosya olarak dışa aktarıldı, web'e çevrildi ve LAN üzerinden Mac'e taşınır.
  - Sonraki her şey Mac'ten yapılır. Mac'te Unreal yok: `asset-pipeline ue` yalnız Windows'ta çalışır.

## Durum

- **2026-10-27 (PC, Faz 1, `docs/plans/faz-1.md`):** 4 Fab yüzü (Skotukeda, Mason, MHC_Seo, MHC_Frey; yüz kaynağı 4K) ve Long High Ponytail sitede. Kendi kıyafet yolu çalışıyor: `asset-pipeline garment` (gövdeden kalıp, Blender sim, arşiv birimi) ile kalem etek sitede. Dönüştürücü outfit-v7: bacak arasını köprüleyen kumaş iki bacağa birden asılıyor (`bridging`), bütün kıyafetler yeniden dönüştürüldü. Açık: Mason'da yaka taşması, 4 Fab saçında kart üretimi (Hair Card Generator), AO gürültüsü.

- **2026-10-28 (PC, Faz 1b kapandı):** Nomad Wave Undercut yayında: tıraşlı yanlar ve ense kart değil, paketin `.abc` tellerinden kafa UV'sine çizilen boyalı harita (`mh/strand_paint.py`, `mh/alembic.py`); uzun üst kartlar kalıyor. Bir saç girdisi artık hem `glb` hem `painted` taşıyabiliyor. A3 kapandı.

- **2026-10-28 (PC, Faz 1 bitti):** B5 kapandı. `asset-pipeline mh-fit-audit` oturma hatalarını ölçüyor (`build/fit/report_final.json`). Düzeltilenler: gizli derinin gölgesi (eteğin "AO gürültüsü"), preset kafaların alt boynunun yakadan taşması (dikiş ofseti 3 cm tam/9 cm'de sıfır, yaka itmesine kafa tarafı geçişi, halkaların gövde derisine karışması; Mason her durumda 0), tene yapışık kumaşta benek (polygon offset), gövde SRMF'inde iç çamaşırı bandı, kart saçlarda deri boşlukları, saç kartlarının farklı kafalara girmesi (tasarlanan derinlik korunuyor; groom-v4), `mh-prune`'un Fab yüz paketlerini silinecek sanması. Bilinen küçük kusur: tişört kol ağzında pozda 1-2 piksellik iz.

- **2026-10-29 (PC, Faz 2a bitti, `docs/plans/faz-2.md`):** Göz tonu sahnede (`543687b`): yalnız iris boyanır, irisin kendi parlaklığı ve lif dokusu korunur, doygunluk %75. Yüz karıştırma sahnede (`d81f1df`, `web/src/features/avatar/mh/faceBlend.ts`): 23 kafa aynı topolojide; konum, normal, 67 morph delta'sı, yüze özgü eklemler ve ters bind'lar karışır, karışık yüzde göz kırpma ve dudak senkronu bozulmuyor. Karışım dilimli hazırlanır (Suspense), kaydırıcı bırakınca uygulanır. Kaynak başına ~7 MB indirme ve ~+75 MB JS belleği. `/dev/mh?face=Ada&blend=Zuri:0.5&morph=eyeBlinkLeft` sabit kare kontrolü verir. Kullanıcı kararı: kaydırıcı bırakınca uygulanır, canlı önizleme yok.

- **2026-10-29 (PC, Faz 2e bitti, sıra kullanıcı kararıyla 2a → 2e → 2b):** Çorap ve külotlu sahnede ve Ayakkabı sekmesinde (`web/src/features/avatar/mh/socks.ts`, şema v3, `socks: { style, color, sheer }`). Mesh yok: gövde cilt shader'ında iç çamaşırından sonra çizilen katman; kesim nötr gövdenin dinlenme yüksekliğinden (`legHeight` özniteliği, kol vertex'leri dışarıda), bu yüzden kaydırıcılarla bacağı izliyor ve giysinin altında deriyle birlikte gizleniyor. Pamukta örgü, manşet fitili ve kenar; naylon bakış açısıyla şeffaf, ten rengi külotlu giyenin tenini alıyor. `/dev/stage`'de çorap seçici. Çıplak ayakta parmaklar kumaşın altında birleşik: zarf pipeline'da (`asset_pipeline/mh/sock_toes.py`, `mh-convert --bodies` → `bodies/<cinsiyet>/socks.bin`, manifest gövde alanı `socks`), web onu vertex shader'da ekliyor; külotlunun burnu takviyeli. Çorap kenarı gerçek geometri: gövde üçgenlerinden kurulan manşet halkası (`sockCuff.ts`, gövdenin cilt malzemesi, morph ve maskeyle).

- **2026-10-29 (PC, Faz 2c bitti, sıra kullanıcı kararıyla 2e → 2c → 2b → 2d):** 99 küçük resim (yüz, saç, kaş, sakal, bıyık, kıyafet) `/dev/thumbs` ile kâğıt tonlu fonda ve ayakta yeniden çizildi, R2'de. Çorap: manşetin alt sıraları kendi yüksekliklerindeki deriye oturuyor ve deriye dik giriyor (tırtıklı dikiş gitti, `SkinBand.hit`, UV adacığı korunuyor); parmak zarfında `unfold`'un açtığı 6 mm'lik çukurlar (döndürünce karanlık yarık) 1 mm'ye sınırlandı (`hold_under`, sock-toes-v14). Kalan bilinen: sağ ayakta büyük parmak kökünde pozda açılan küçük delik (tarak bükülmesi; itilen köşelere varış yerinin ağırlıkları gerekir).

- **2026-10-29 (PC, telefon dokuları):** Telefonda ilk karakter ~110 sn'de açılıyordu (Fast 4G taklidi, 70 MB). Artık telefon 1024 px'ten büyük her dokunun üst mip seviyeleri kesilmiş `*.1k.ktx2` kopyasını çekiyor (ilk karakter 26 MB); masaüstü 4K'da kalıyor. Kopyalar ve `mobile-textures.json` manifest her yazıldığında üretilir (`mh/mobile.py`, 673 kopya, 378 MB, hepsi `ktx validate` temiz); web `textureVariants.ts` + KTX2 yükleyicisinin URL modifier'ı. Kullanıcı kararı: sınır 1K (yüz kadrajında yüz ~120 px, fark görünmüyor).

### Unreal dışa aktarımı (Windows, `pipeline/unreal/mh_export/`)

- **Bitti.** Sayılar `MetaHumanArchive/raw/` altındaki `done.json` birimlerinden:

  | İş | Sonuç |
  |---|---|
  | inventory | 29 preset |
  | arkit | 66 poz, 274 kontrol |
  | characters | 29/29 preset (kaynak doku: yüz 8K, gövde 4K) |
  | bodies | 2 cinsiyet × 15 DNA varyantı (`neutral` + 7 slider × min/max) |
  | grooms | 95 birim: Hair 38, Eyebrows 18, Beards 16, Mustaches 16, Eyelashes 6, Peachfuzz 1; ayrıca groom kafası ve kirpik dokuları |
  | outfits | cinsiyet başına 47 öğe + taban vücut: DefaultGarment, 36 Epic `OA_*`, 10 Fab. **Fab: 20/20 birim** |
  | fab_import | 31 `.mhpkg` paketi |
  | lighting | 9 sahne |
  | statics, animations, wardrobe | bitti |
  | materials | parametreler (düğüm grafiği boş) |

- **Vampire atlandı:** eski tip BP MetaHuman (DNA asset + legacy dokular); `characters` işi okuyamıyor. Kullanıcı kararı.
- **Cinsiyet:** `raw/characters_genders.json`'daki masculine/feminine değerinden gelir. |değer| < 0.3 ise vücut şekli karar verir. Asha bu yüzden kadın.
- **Kıyafet bake düzeltmesi** (`dfe26c3`):
  - Bake boyutu sabit 4096. KhaosMDF322'nin UDIM dokusu 24576 px bildiriyordu ve editör assertion ile çöküyordu.
  - Editörün içinde öldüğü bake arşiv kökündeki `crashed.json`'a yazılır ve sonraki koşuda atlanır. Şu an boş.
  - UDIM dokular döşeme başına kaydedilir (`mh_export/udim.py`).

### Dönüştürücü (`asset-pipeline mh-convert`, `pipeline/src/asset_pipeline/mh/`)

- Komut `--all` ile artımlı çalışır; yalnızca değişen ya da yeni gelen birimleri çevirir. Çıktı `MetaHumanArchive/web/`.
- **Manifest v2** (`generatedAt` 2026-10-25T20:04Z, Clara body eklendikten sonra): 19 yüz, 20 cilt, 2 vücut, 49 groom, 24 kıyafet, 22 iris, 8 animasyon, 8 ışık. Kategori ayrıntısı ve klasör boyutları: `docs/metahuman-export.md` (prune öncesi sayılar).
- **Kürasyon:** `raw/pruned.json` silinmiş 201 id'yi tutar; `web/curation.json` aynı 201 id'yi gizler. Elenen yüzler: Bo, Bruce, Grace, Jorge, Lani, Lorenzo, Orlando, Sook-ja, Walter.
- Sıkıştırma:
  - Kendi meshopt encoder'ı; vertex sırası ve IBM'ler korunur.
  - Dokular GLB dışında, KTX2 UASTC + zstd. Normal haritalar OpenGL.
- Yüz:
  - ARKit 52 + 15 viseme morph.
  - Kırışıklık haritaları ve boyun dikişi verisi.
- **Çıplak cilt** (`258d56a`):
  - DCC'nin gömdüğü gri iç çamaşırı gövde albedo'sundan ve kafanın boyun flap'inden çevredeki ciltle dolduruldu.
  - Ortak iç çamaşırı maskesi, kumaş albedo ve normal bir kez yazılır (`web/skins/underwear/`). Web shader onu yalnızca kıyafetin örtmediği yerde çizer.
  - Askılar yalnızca kafa UV adasından doldurulur. Ada'nın omuzlarındaki açık renkli kamalar bundandı.
  - Kafadaki askılar DCC kafa bake'inin kendi askılarından tek RGBA harita olur (`face_underwear.ktx2`, 2K: R kumaş grisi, GB normal, A kaplama). Biye, örgü ve dikiş boyun dikişinden kesintisiz geçer (`30e7eab`). Önce tek düz gri renk + maskeydi.
- Groom:
  - Kart LOD0 ve LOD2.
  - Yüzey bağlaması (`_bind_*`) sayesinde her yüze oturur.
  - Kart köklerinden yoğunluk dokusu (head UV); kafa derisini saçın altında boyar.
  - **Kartsız 9 groom** (stubble, buzz cut) head-UV haritası olur; cilt shader'ı saç rengiyle boyar (`4f701bb`). Manifest'te 79 kartlı + 9 boyalı.
  - Boş skin slotları artık skin eklemi 0'a bakar. Önce `JOINTS_0` 65535 tutuyordu (glTF ihlali).
- **Kıyafet** (`895d68f`, `a79e9d1`):
  - Her cinsiyet için ayrı GLB, gövde slider morph'larıyla.
  - Morph'lar her slider ucunda deri normali boyunca dışarı itilir; deri kıyafetten çıkmaz. Kapalı ayakkabı tüm parmakları gizler.
  - Renk presetleri `mh/outfit_tints.json`'dan gelir; ilki kıyafetin varsayılan rengidir.
  - Tek cinsiyete ait saç ve kıyafet `mh/gender_compat.json`'dan gelir. Manifest anında okunur, yeniden dönüştürme gerekmez.
- Animasyon:
  - Gövde klipleri RigLogic twist'li GLB.
  - Yüz klipleri ARKit ağırlık JSON'u (`{fps, names, frames}`).
  - FBX klipleri `clips.json`'da rol taşır (`idle`, `talk`, `listen`). Manifest her klibin `tags` listesine önce rolü koyar.
- Doğrulama (2026-10-21 akşam): pytest **258 geçti, 1 atlandı**; `ruff check` ve `ruff format --check` temiz.

### Web (`web/`)

- **Sahne (`web/src/features/avatar/mh/`)**, sayfaların tek 3D giriş noktası `MhStage`'dir. İçinde:
  - Montaj:
    - Kafa gövde iskeletine bağlanır.
    - Boyun dikişi kaynaklanır. Kafa kenarı gövdenin ağırlıkları ve **ters bind matrisleriyle** skinlenir (kafa iskeletine eklenen girdiler), iki kenar animasyonda birlikte hareket eder (`ff99bb2`). Kenar 0.3 mm öteye ve 0.05 mm gövdenin altına uzanır; alt-piksel çatlak kalmaz.
    - Yüz veya gövde değişince yeni karakter ekran dışında kurulur ve tek karede eskisinin yerini alır. Boş ya da kel kare yok.
    - Kurulum sırasında kamera ekrandaki karakteri kadrajlar (`1c129d1`).
  - Cilt shader'ı:
    - SSS sarma, SRMF speküler (kırmızı kanal, roughness'ın okuduğu texel'den; `c4cb122`), gözenek mikro normali. Cavity haritası yok: DCC SRMF bake'i gözenek ve kırışıktaki speküler düşüşünü zaten taşıyor.
    - Gözenek döşemesi Unreal'ın değerleri: kafa 48 (Unreal 44), gövde 70 (`c4f1be7`). Gövde 36'dayken dikişin altında gözenekler ~1.8 kat iriydi.
    - Kırışıklık normalleri.
    - Groom yoğunluğuyla kafa derisi, kaş ve sakal tonu.
    - **İç çamaşırı shader'da** (`8968f4e`): alt ya da tek parça giyilmemişse külot; kadın gövdede üst giyilmemişse üst. Askılar kıyafetlerle aynı karede çizilir, değişimde çıplak cilt parlamaz.
    - Boyalı groom'lar (stubble, buzz cut) kafa materyalinde saç rengiyle çizilir.
  - Ton eşleme Neutral. AgX koyu tenleri açıp soldurduğu için kaldırıldı (`cdc9552`).
  - Göz: kornea, iris ve göz oklüzyonu.
  - Saç, kaş, sakal ve bıyık kartları (`hair.ts`, `grooms.ts`, `hairMaterial.ts`):
    - Yüze yeniden oturtma ve kafa eklemlerine skin.
    - Melanin/redness/dye renk modeli ve desenler (ombre, kökler, röfle, iç katman).
    - Kajiya-Kay çift lob.
    - Alpha-test çekirdek + harmanlanan saçak (MSAA yok, N8AO yüzünden).
  - Kıyafet (`garments.ts`, `outfits.ts`, `fabricMaterial.ts`):
    - `SkinnedMesh.bind` ile gövde iskeletine bağlanır, Unreal'ın kumaş shader'ının GLSL karşılığıyla çizilir.
    - Seçilen kıyafet ilk kürasyon rengiyle gelir (`882b74a`).
  - Canlılık (`characterLife.ts`, `motion.ts`):
    - Mocap idle klipleri: Fab crowd/stand döngüleri, `web/scripts/retarget-fbx.mjs` ile.
    - Prosedürel nefes ve kol katmanı. Rahat kollarda ön kol 45° döner, avuç içi bacağa bakar.
    - Kol-gövde çarpışması (`armCollision.ts`): klip ve katmanlardan sonra üst kol omuzdan, kol gövdenin dışında kalacak kadar döner (aşağıda, 2026-10-23).
    - Göz teması ve başın kısmen kullanıcıya dönmesi.
    - Sakkad, göz kırpma.
    - Yüz idle döngüsü ve hafif "nefes alan" gülümseme.
    - Vurgulu hecede baş onayı ve kaş kalkması.
  - Lip-sync (`web/src/features/lipsync/`):
    - Kaynak önceliği: TTS viseme olayı, kelime zamanı, metin hizalaması.
    - Görsel öncülük `VISUAL_LEAD` = 70 ms (`speechPlayer.ts`).
    - Zaman çizelgesi çözülmüş sesle ölçülen gecikme kadar kaydırılır. m/b/p kapanmaları duraklamanın sessiz kısmına oturur ve çevredeki ünlüleri bastırır (`2bbc450`).
    - **Canlı ölçüm (Edge TTS):** kapanma ağırlığı **0.99**, dudaklar sesteki kapanmadan **~30 ms** önde.
  - Konuşma kamerası: yakın planda başı takip eder, sallanan konuşmacı kadrajda kalır.
  - Gölge: PCF 16 örnek, sabit disk. Three'nin gürültülü 5 örneği kolda tanecik bırakıyordu.
  - Kalite katmanları (`web/src/features/avatar/quality.ts`): high / balanced / battery.
    - Varsayılan `auto`: high'tan başlar, kare düşünce **balanced'a kadar** iner ve toparlanınca geri çıkar.
    - Battery yalnızca elle seçilir: AO kapalı, hafif saç kartı, 30 fps.
- **Sayfalar** (hepsi commit'li):
  - Landing.
  - Karakterlerim.
  - Oluşturucu: autosave, undo, hazır yüz/saç/kıyafet panelleri. Düzenleme yalnızca değişen parçayı yeniden çizer.
  - Konuşma: sol sahne, sağ sohbet, altyazı. Her durumun (bağlanıyor, düşünüyor, yazıyor, konuşuyor, hata, çevrimdışı) kendi işareti var; gönder düğmesi cevap sırasında Durdur olur (Esc de çalışır).
  - Kürasyon: `/[locale]/curate`, yalnız dev.
    - Ön eleme: `asset-pipeline mh-similar` çok benzer öğeleri ölçer (saç/kaş/sakal/bıyık kart yüzeyi, kıyafet yüzeyi, yüz DNA'sı, gövde klibi). `--apply` bunları `curation.json`'da `auto` altına yazar ve gizler; ekran "Ön elemede gizlenenler" filtresiyle gösterir, kullanıcı geri açabilir. Rapor: arşivde `build/similar.json`.
    - Silme: `asset-pipeline mh-prune` deneme modunda planı, boşalacak yeri ve bir plan özeti yazar. Silmek için `--apply --plan <özet>`; plan o arada değiştiyse reddeder. `--unused-packages` hiçbir öğenin gelmediği Fab paketlerini de siler, ama bir export klasörü eksikken (export sürüyorsa) hiçbir paketi kullanılmıyor saymaz.
  - i18n anahtar testi ve Playwright e2e.
- Doğrulama (2026-10-25): `pnpm typecheck` ve `pnpm lint` temiz, `pnpm test` **823 geçti** (mongod açıktı; kapalıyken repository testleri atlanır). Pipeline (2026-10-22): `ruff` temiz, pytest **310 geçti, 2 atlandı** (atlananlar budanan stand idle ve body ROM klipleri). Yeniden üretilen GLB'ler `gltf-transform validate`'ten hatasız ve uyarısız geçti.
- **Dev sayfaları** (`next dev` dışında 404):
  - `/dev/stage`: gerçek manifest; yüz, saç, kıyafet ve kalite seçimi; `/api/tts` ile canlı TTS; zoom.
  - `/dev/mh`: tek preset görüntüleyici, `?face=<id>` ile.
  - `/dev/thumbs`: küçük resim üretici. `/api/dev/thumbnails` WebP'leri `web/public/assets/mh/` bağlantısı üzerinden arşive yazar.

### Konuşma jestleri

- Konuşma ekranı karakter konuşurken tam boy **talk** kliplerini oynatır (`e5df418`):
  - Klip hemen girer ve 1.5 sn'den kısa duraklamalarda kalır (`TALK_HOLD`). Cümle arası eller düşmez.
  - Dinlerken **listen** klipleri idle'larla karışır.
  - Gövde katmanlı idle'da prosedürel kollar, jest girerken jeste devreder.
- Jestler Unreal'sız, FBX'ten gelir. 2026-10-21 kararı: yalnızca ücretsiz paketler kullanılır. Fab'daki ücretsiz Unreal paketleri de en fazla ~3 konuşma klibi veriyor.
- Kullanılanlar (2026-10-21, hepsi ayakta, tam boy):
  - Mocap.in Realistic Acting (Fab, Personal lisans): `talking_normal` (talk). `listening` (eller arkada) 2026-10-23'te silindi.
  - ActorCore ücretsiz hareketleri: `stand_talk` (talk), `relax` (sakin idle). İndirme ayarı: hedef "Unreal (UE 5 Skeleton)", 60 fps; kemik adları zaten UE5. Zip'ler `MetaHumanArchive/gestures/actorcore/zips/`.
  - Elenenler: Female Idle-2 (kalça 17 cm kayıyor), Change Pose (61° dönüş, 38° eğilme), oturan ve yürüyen klipler.
- Hepsi `web/scripts/retarget-fbx.mjs` ile MetaHuman'a aktarılır:

  ```bash
  node web/scripts/retarget-fbx.mjs --target <body.glb> --out <dir> [--fps 30] [--role idle|talk|listen] <clip.fbx>...
  ```

  - `--role` verilmezse `idle`. Rol `clips.json`'a yazılır.
  - ActorCore FBX'leri önce hareketsiz bir A-pose take'i taşır; betik en çok hareket eden take'i seçer. Mixamo omurga adları da okunur.
- Kaynak FBX'ler arşivin `gestures/` klasöründe (Mocap.in ve ActorCore, ~216 MB). LAN aktarımı bu klasörü varsayılan olarak taşır.

### Kapı F (Windows'tan ayrılmadan önce)

- Bitti:
  - **P3** groom `JOINTS_0` düzeltmesi (`4f701bb`).
  - **P4** Edge TTS yeniden deneme (`387b4ae`): kopan bağlantı ve boş seste 300 ve 900 ms sonra tekrar. Önce erkek ses cevaplarının dörtte biri kelime zamanı olmayan Gemini TTS'e düşüyordu.
  - **P5** kadraj: kurulumda kamera ekrandaki karakteri izler (`1c129d1`); kıyafet küçük resimleri öğenin kendisine kadrajlanır (`9d8912d`).
  - **P6** Ada'nın askı kamaları (`258d56a`).

- **2026-10-30 (PC, Faz 2b, B3 dövme):** Sekiz ince çizgi dövme yedi yerde: deriden kesilen çıkartma yaması (kafa malzemesinde boş doku birimi yok), kafa-gövde dikişini kesintisiz geçiyor; giysi, çorap ve deriye çizilen iç çamaşırı mürekkebi örtüyor. Dövme sekmesinde kamera seçilen yere gidiyor, gerekirse karakter dönüyor, o yeri örten giysi önizlemede çıkıyor. Takı (B4) sırada.

## Site kontrolü (2026-10-22 sabah, PC)

- Landing, Karakterlerim, oluşturucu ve konuşma masaüstünde (1440×900) ve telefonda (390×844) gezildi. Yatay kaydırma yok, konsolda yalnız three'nin `THREE.Clock` uyarısı var.
- Konuşma uçtan uca çalışıyor: "Nasılsın?" ilk metne ~1.5 sn, Edge sesiyle konuşup Hazır'a dönüyor.
- Düzeltilenler:
  - **Kollar kıvrık görünüyordu** (`9b84d75`): ön kol dönüşü dirsek tarafındaki twist kemiğinde başlıyordu; 3/4 kolun ağzı orada makaslanıp buruşuyordu. Dönüş artık bileğe doğru (twist_01 yarım, el tam 45°), avuçlar hâlâ bacağa bakar.
  - **Bildirimler** (`16f1196`): 1024 px altında üstten gelir; telefonda taslak bildirimi Bitti çubuğunu kapatıyordu.
  - **Renk başlıkları** (`d73bba6`): kıyafet panelinde "diffuse_color_1/2" yazıyordu; artık Ana / İkincil / Detay / Aksesuar rengi, çok malzemeli kıyafette parça numarasıyla.
- Kullanıcının üç ekran görüntüsünden düzeltilenler (2026-10-22, Aera, topuz, crop top + tayt):
  - **Kırık bilek ve kol** (`retarget-fbx.mjs`): twist ve corrective kemikler, parmak uçları ve ayak parmakları zincir kemiğinin duruş düzeltmesini (`restFix`) almıyordu. Shibuya HumanIK klibinde kol twist'leri 27°, uyluk twist'leri 24.5° yan büküyordu; dirsekte kol ağzı da buruşuyordu. Artık en yakın atanın düzeltmesini alıyorlar. Arşivdeki 5 FBX klibi (shibuya, relax, listening, stand_talk, talking_normal) yeniden üretildi; Mocap.in parmak uçları ~55° düzeldi.
  - **Topuzda arka kafada çıplak kafa derisi** (`grooms.py`): `density` yalnız kart köklerinden geliyordu; topuzun kökleri saç çizgisinde kaldığı için tepe ve arka boyanmıyordu. Artık Unreal `baked` haritasının örtüsüyle birleşiyor (`groom_density`). `baked`'i olan 12 saç yeniden dönüştürüldü; sakal ve bıyıkların `baked`'i yok, değişmedi.
  - **Kazaktan taşan cilt** (`garments.ts`, `MhCharacter.tsx`): aynı gövde GLB'sinden kurulan karakterler gövde geometrisini, dolayısıyla `bodyHidden` maskesini paylaşıyor. Yüz değişince eski karakter kaldırılırken maskeyi sıfırlıyordu; yeni karakterin cildi kıyafetin altından görünür kalıyor, jestte omuzdan taşıyordu. Kaldırma artık yalnız maskeyi son yazan karakterse temizliyor (`releaseBodyHide`).
- Kullanıcının atlet ekran görüntüsünden düzeltilenler (2026-10-22 öğle, Jelena, iç çamaşırı):
  - **Askılar boyunda düz griydi** (`30e7eab`): kafanın göğüs flap'inde askılar tek renk + maskeyle çiziliyordu; biye ve örgü dikişte bitiyor, dikiş askılarda U çizgisi gibi görünüyordu. Artık DCC kafa bake'inin askıları (gri, normal, kaplama) tek haritada; 10 kadın cildi yeniden üretildi (her biri ~200 KB).
  - **Omuz silüetinde koyu çentik** (`ff99bb2`): kafa kenarı gövdenin ağırlıklarını alıyor ama kafanın kendi bind matrisleriyle skinleniyordu. Preset kafanın eklemleri bu gövdeninkinden 3-4.5 cm farklı; idle'da kenar omuzda 4 mm'ye kadar kayıyor, 1.5 mm skirt'i aşıyordu. Kenar artık gövdenin ters bind matrisleriyle skinleniyor: aralık animasyon boyunca 0.000 mm.
  - **Dikişte gözenek ölçeği** (`c4f1be7`): gövde döşemesi 36 → 70.
  - Dikişte albedo ve ışık ölçüldü: iki taraf arasındaki fark ≤5/255. "Göğüste ton farkı" diye görülen, askıların düz rengiyle gözenek farkıydı.
  - **Cilt speküleri hiç çalışmıyordu** (`c4cb122`, kullanıcı onayıyla): `createSkinMaterial` `material.defines`'ı baştan yazıp three'nin `PHYSICAL` tanımını siliyordu; her texel F0 0.04'teydi, SRMF kırmızısı ve boyalı saçın düşük speküleri uygulanmıyordu. Artık açık; kafa yine 15/16 sampler. Cavity haritaları kaldırıldı: SRMF bake'i onları zaten taşıyor (Jelena'da yüksek geçiren korelasyon -0.77 / +0.74; Unreal'ın baked materyali de cavity almıyor). Ciltler 1.2 GB → 1017 MB, `web` 2.0 GB.
- Kullanıcının terlik ekran görüntüsünden düzeltilenler (2026-10-22 öğleden sonra, Ada, terlik + tayt). Ayak platforma tam basmıyordu: topuk platformun içinde, parmak ucu havadaydı.
  - **Ayaklar eğikti** (`retarget-fbx.mjs`):
    - İskeletler hizalanırken "yukarı" pelvis→baş çizgisinden alınıyordu. Mocap.in klipleri ilk kareyi dinlenme pozu sayıyor ve gövde orada 7.5° öne eğik; bu eğim bütün bacaklara geçiyordu.
    - ActorCore'da ayak bileği→parmak eklemi çizgisi MetaHuman'ınkinden 12° yatık. Ayağın duruş düzeltmesi bu çizgiyi eşleyince parmaklar kalkıyordu.
    - Sonuç: relax ve listening'de ayak 7-13° parmak yukarı, topuk 3-4 cm platformun içinde.
    - Artık yukarı sahnenin dikey ekseni; ayağın düzeltmesi yalnız dikey eksen etrafında. Basma noktası tarağın yanında topuğu da (`ankle_bck` altındaki zemin) kullanıyor. Parmak ucu zeminin altına inerse parmaklar tarak ekleminden yukarı bükülüyor.
    - 5 klip yeniden üretildi (hedef yine kadın gövde). Çıplak ayağın en alçak noktası idle'larda zeminden en fazla 3 mm, stand_talk adımlarında 4.4 mm aşağıda (önce 4 cm). `crouch` 0.04-0.05'ten 0.006-0.026'ya indi; `standing` ve `calm` değişmedi.
  - **Ayakkabılar platforma gömülüyordu** (`garments.ts` `soleDepth`, `MhCharacter.tsx`):
    - Kıyafet GLB'lerinde ayakkabı tabanı çıplak ayağın 2-3.5 cm altında (terlik 2.5, bot 3.1, sokak setinin ayakkabısı 3.4 cm).
    - Karakter artık giydiği ayakkabının taban derinliği kadar kalkıyor. Kaldırma turntable gibi bir üst grupta; sonradan bağlanan skin'lerin bind matrisleri bozulmuyor.
    - Tek tük aykırı köşe sayılmıyor: kadın Oxford'da tabanın 1.6 cm altında 8 nokta var.
    - Terlikle taban idle'larda zeminden 0-2 mm, konuşmada en kötü 5 mm aşağıda. Erkek + botta ±5 mm, stand_talk'ta en kötü 1 cm (erkek gövdede klip pelvis ölçeği, aşağıdaki açık madde).
- Kullanıcının eğik duruş ekran görüntüsünden düzeltilen (2026-10-22 öğleden sonra, Ada, crop top + tayt + terlik, `listening` idle'ı):
  - **Gövde geriye yatık, çene yukarıdaydı** (`retarget-fbx.mjs`, `f6b3e9e`):
    - Pelvis, omurga, boyun ve baş dönüşlerini FBX rest'ine göre taşıyordu. Mocap.in klipleri ilk kareyi rest sayıyor; `listening`'de o karede gövde öne eğik, baş 19° önde.
    - O kare "dik" sayılınca gövde oyuncununkinden 10° geride, baş ortalama 9° (en çok 19°) yukarıda kaldı. Bacaklar yön taşıdığı için dizler oyuncununki gibi öndeydi; yandan bakınca karakter geriye yatık duruyordu.
    - Artık bu eklemler çekimin ortalama pozuna göre dönüyor ve o poz bind'in dik duruşuna denk geliyor. `listening`: gövde (pelvis→boyun) -9.0° → -4.5° (bind'inki), baş eğimi ortalama -8.6° → 0°. Bacak ve ayaklar değişmedi.
    - Diğer kliplerde de baş ortalamada düz bakıyor: önce shibuya 11.5° aşağı, stand_talk 9.7° yukarı bakıyordu.
    - 5 klip yeniden üretildi (hedef kadın gövde). `standing`/`calm` bayrakları değişmedi, manifest aynı. GLB'ler `gltf-transform validate`'ten hatasız ve uyarısız geçti.
  - **Dizler bükük, sol ayak havadaydı** (`retarget-fbx.mjs`, `5547e6d`, kullanıcı kararı: bacak IK'sı):
    - Bacaklar oyuncunun yönlerini kopyalıyor. `listening`'de oyuncu yumuşak dizlerle duruyor: destek dizi 20°, öteki 33° bükük. Bacak oranları yüzünden sol ayak da 1.5 cm havadaydı (kaynakta yerde).
    - Yeni 3. geçiş üç iş yapıyor. Pelvisi, düz olan bacağın tipik bükümü `STANCE_KNEE` (8°) olana kadar kaldırıyor. Oyuncununkinin tipik olarak `HOVER`'dan (5 mm) fazla üstünde duran ayağı çekim boyunca o kadar indiriyor. İki kemikli IK ile iki dizi çözüyor; ayaklar yerinde ve düz kalıyor.
    - IK hiçbir dizi `KNEE_MIN`'den (6°) fazla düzleştirmiyor. Tam açıklığa yakın 1 mm erişim dizi derecelerce çeviriyor; kare kare gürültü dizi titretiyordu. İlk denemedeki kare kare ayak hedefi relax ve stand_talk'ta dizleri 5-8° oynattığı için sabit indirmeye geçildi.
    - `listening`: dizler 8° ve 15°, iki ayak yerde (0-0.5 cm), çömelme 0.021 → 0.009. relax, shibuya ve talking_normal birebir aynı; stand_talk'ta destek dizi 8.6° → 8.0°. Erkek gövdede de sağ/sol ayak farkı 1.3 → 0.0 cm.
    - 5 klip yeniden üretildi ve arşivdekiler commit'teki betiğin çıktısıyla byte byte aynı. Bayraklar ve manifest değişmedi, GLB validate temiz.
    - Bilinen: çekimin son karesi ilk kareye sarıyor (eskiden de öyleydi). Klip bitmeden söndüğü için görünmüyor; dizdeki sıçrama 4.8° → 8.4°.
- Kullanıcının notlarından düzeltilenler (2026-10-23, "kollar hareket ederken vücudun içinden geçiyor", "varsayılan duruş düz olsun"):
  - **Kollar gövdeden geçiyordu** (`armCollision.ts`, `characterLife.ts`):
    - Retarget kemik yönlerini kopyalıyor, elin gövdeye nerede değdiğini değil. MetaHuman'ın kalça ve beli oyunculardan geniş: `listening`'de el kalçanın 8 cm içinde, konuşma kliplerinde ön kol bele 8 cm giriyordu. Ölçüm tam gövde köşeleriyle, kadın gövde, el/ön kol en derin: relax 35, listening 80, stand_talk 80, talking_normal 80 mm.
    - `ArmCollider` her karede klip ve prosedürel katmandan sonra çalışır. Gövde derisi 2 cm aralıkla örneklenir ve CPU'da skinlenir. Kol örnekleri gövdeye girerse üst kol omuzdan en küçük açıyla döner (4 geçiş). Gerek kalmayan itme 0.3 sn'de klibe söner (`RELEASE`).
    - Üst kol dirseğin 3 cm yukarısına kadar sayılmaz (`ELBOW`): sarkan kolda koltuk altı göğsün yanına gömülür. Sayılınca prosedürel rahat kollar 16° dışarı itiliyordu.
    - Kıyafet deri üstüne en çok 1 cm kalınlık ekler (`CLOTH`), kolda ve gövdede. Bol kumaş ezilir sayılır: kumaş yüzeyini sert sayınca bol ceketin eteği kolları 26-40° açıyordu (penguen duruşu), 2 cm'de sweatshirt 8°, 1 cm'de 4°.
    - Sonuç (kadın gövde, el/ön kol en derin): 80 → 0-10 mm. İtme medyanı idle'larda ~1°, konuşmada 5-10°. 60 fps'te kare başı ek el hızı 5 mm'yi aşan kare binde 1-2 (derin girişin ilk anları). Node'da ~0.6-0.9 ms/kare.
  - **Varsayılan duruşta eller arkadaydı** (`retarget-fbx.mjs`, `resolve.ts`):
    - `listening` elleri pelvisin ortalama 11 cm (en çok 17 cm) arkasında tutuyor. Sakin idle sayıldığı için varsayılan döngüdeydi.
    - Betik artık `handsBehind` ölçüyor: iki el pelvisin 6 cm'den fazla arkasında olan karelerin payı; 0.3'ü geçen klip `calm` değil. listening 0.75; relax ve shibuya 0, konuşma klipleri 0.02-0.11.
    - Arşivdeki 5 `clips.json` yenilendi (GLB'ler byte byte aynı), manifest yeniden yazıldı: tek değişiklik listening'in `calm` etiketini kaybetmesi.
    - `MIN_CALM_IDLES` 3 → 2: varsayılan duruş relax ve shibuya, tam gövde mocap, eller yanda. 2'nin altına düşülseydi kollar prosedürel katmana kalırdı.
    - Kullanıcı kararıyla listening silindi: kürasyonda gizlendi, `mh-prune --apply` yalnız `listening.glb`'yi sildi (~0 GB), id `raw/pruned.json`'da, manifest 8 animasyon. Kaynak FBX `gestures/mocapin/named/` içinde duruyor.
- Kullanıcının notundan düzeltilen (2026-10-25, "saç ayarlarken renkte de diğer kısımlarda da titriyor, düzgün durmuyor"; kadında görüldü):
  - **Ayar yaparken baş bir karede dönüyordu** (`d4aa8c1`, `MhCharacter.tsx`, `assembly.ts`):
    - Oluşturucu store'u her düzenlemede config'i `structuredClone` ile baştan kopyalıyor. Saç rengi değişince bile `MhCharacter`'a yeni ama eşit bir `sliders` nesnesi geliyordu.
    - Slider efekti nesnenin kimliğine bağlıydı. Her adımda `applyBodySliders` iskeleti dinlenme pozuna sıfırlayıp yeniden bind ediyor, 150 ms sonra kıyafetleri yeniden katmanlıyordu (50-150 ms'lik uzun görevler). Animasyonun ortasında baş bir karede yandan karşıya dönüyordu.
    - Efektler artık slider değerlerinden kurulan anahtara bağlı (`bodySliderKey`); yalnız vücut slider'ı değişince çalışıyor.
    - Ölçüm (kadın, saç rengi kaydırma): `applyBodySliders` 211 → 0 çağrı. Tuvalde ardışık kareler arasındaki en büyük fark 7-8'den 1.6'ya indi (boştaki salınım düzeyi). Ten, göz ve kıyafet rengi gibi diğer düzenlemeler de aynı yoldan geçiyordu; hepsi düzeldi. Erkekte görsel ölçülmedi, kod ortak.
  - **Kaydırırken kare hızı** (kod değişmedi): 144 Hz ekranda `next dev` boşta 121, kaydırırken 73 fps; production build'de 144 ve 125 fps. Production profilinde React adım başına ~1.6 ms harcıyor, gerisi her karede zaten çalışan WebGL render'ı. Dev'deki büyük düşüş React'in dev yükü (`console.createTask` vb.).
- Kullanıcının notundan düzeltilen (2026-10-26, "kalça ve göğüs şişkin olmak yerine güzel bir şekilde büyüsün"; crop top'ta "göğüs top şeklinde değil, alt kısmında ve iki göğsün ortasında hata var"):
  - **Kadın göğüs ve kalça slider'ları** (`pipeline/unreal/mh_export/bodies.py`, `SHAPED_ENDS`): parametrik vücutta yalnız Chest ya da Hip itilince çözücü gerisini serbest bırakıyordu. Göğüs büyürken göğüs altı +5.7 cm genişliyor, göğüs ucu 3.7 cm düşüyor, göğüsler 4.4 cm açılıyordu. Kalça büyürken bel altı (High Hip) kalçanın neredeyse kadar (+10.7/+12 cm) şişiyordu. Artık `chest_max` ve `hips_max` uçlarında izin verilen birkaç ölçü dışında tüm ölçüler nötrde tutuluyor: göğüs altı +1.5, göğüs ucu +1, göğüs arası +1.5; High Hip +4, uyluk +3, Rise +5. Yalnız birkaç ölçüyü tutmak fazlalığı omuza (+3.2 cm), boyuna (−4.6 cm) ve pazıya (+2.8 cm) kaydırıyordu. Nötr ve diğer uçlar aynı. Sıra: `ue bodies --args '{"genders": ["female"], "force": true}'` (~1.5 dk), `mh-convert --bodies --gender female`, `mh-convert --outfits --animations --manifest` (24 kadın kıyafeti, 15 dk).
  - **Crop top göğüse oturuyor** (`outfits.py`, `hug_torso`, `TOP_HUG`): Unreal örgüyü göğüs ucundan perde gibi düz indiriyordu; göğüs altında deriden 23-36 mm, karında 13-16 mm uzaktaydı. Listedeki kadın üstleri (şimdilik yalnız `OA_TCrop3QSlv`, 0.85) uyarlamadan önce gövdeye çekiliyor: önde geriye (−z) doğru, her yükseklikteki deri profilinin yatayda köprülenmiş üst zarfına (`front_hull`). Böylece göğüs arasında kumaş göğüsten göğse köprü kuruyor, göğüs altında ise kavisi izliyor. Yanlarda deri normali boyunca çekiliyor. Kollara ve boyuna yaklaştıkça çekme azalıyor. Kayma 8 mm Gauss ile ortalanıyor; önce dikiş payları ve yaka ribası dış yüzeyden taşıyordu. Sonuç: göğüs altından eteğe 5-7 mm. Algoritma değişince `HUG_VERSION` artırılır; fingerprint'te yalnız çekilen kıyafetlerde var.
  - Tayt (`OA_Yogaful`) zaten deriye yakın; yeni kalça şekli kumaştan belli oluyor, ayrıca bir şey gerekmedi.
  - Kullanıcı sonucu onayladı (2026-10-26); geçici yedek (`backup-2026-10-25-bodies/`, 93 MB) silindi. Aynı oturtmanın tişört, balıkçı yaka ve Clara body'ye uygulanması kullanıcı kararıyla yapılmadı.
- Bilinen notlar:
  - Ayakkabı küçük resimleri eski pozla (ayak parmak yukarı) çekildi. İstenirse `/dev/thumbs` ile yeniden üretilir.
  - `anim.stand_idle_loop` (Unreal'ın MetaHuman stand idle'ı) kolları yana açık ve parmakları kıvrık oynuyordu; kullanıcı kararıyla gizlendi ve `mh-prune --apply` ile silindi (2026-10-22, 0.01 GB; manifest yeniden yazıldı). 2026-10-23'ten beri sakin idle'lar relax ve shibuya (eller arkada duran listening silindi, yukarıda).
  - Yeşil mini elbise (`outfit.MiniDress01`, yalnız kadın) kullanıcı kararıyla gizlendi ve `mh-prune --apply` ile silindi (2026-10-25, 0.17 GB): web klasörü, iki cinsiyetin export birimi, `oa_minidress01_variant` Fab paketi ve içe aktarma kaydı. Etiketi ve cinsiyet kaydı kaldırıldı; manifest 23 kıyafet.
  - Clara body (`outfit.KhaosMDF479`, QuingKhaos, Fab'de ücretsiz, Standard License) kullanıcı isteğiyle eklendi (2026-10-25), yalnız kadın. Sıra: `.mhpkg` arşivin `fab/` klasörüne, `ue fab_import` (1 dk 53 sn), `ue outfits --args '{"genders": ["female"], "only": ["WI_KhaosMDF479"]}'` (6 dk 39 sn), `mh-convert --outfits --outfit KhaosMDF479 --manifest` (76 sn), `/dev/thumbs` ile küçük resim, sonra `mh-convert --manifest`. Kategori `full`; diğer Khaos kıyafetleri gibi renk parametresi ve preseti yok (krem beyaz). Etiket ve cinsiyet kaydı `outfit_labels.json` ve `gender_compat.json`'da.
  - Bu koşuda `outfits` işi kadın taban gövdesini (`raw/outfits/female/body`) de yeniden yazdı. GLB ve `body.json` byte byte aynı, yalnız FBX'in hash'i ve `done.json` değişti. Bu yüzden sonraki tam `mh-convert --outfits` kadın kıyafetlerini yeniden çevirebilir; çıktının aynı kalması beklenir.
  - Koyu renkli crew-neck yakalarda yakanın iç katmanı lekeli görünüyor (maske açık ya da kapalı fark etmiyor).
  - Kargo pantolonun ağındaki turuncu leke önden, haki renkte görülemedi. Doku ve dikiş maskelerinde de leke yok (`raw/outfits/*/WI_OA_Cargopants/textures/`). Görüldüğü renk, cinsiyet ve açı bilinirse yeniden bakılır.
  - `next dev`'de karakterin sahneye gelmesi ilk açılışta ~40 sn sürüyor (derleme + doku). Production build'de ölçülmedi.
  - **`pnpm build` (Turbopack) kırılıyor:** `public/assets/mh` junction'ı proje dışını (`C:\Users\Asus\MetaHumanArchive\web`) gösteriyor ve dev küçük resim route'u o klasörü izliyor ("symlink target leaves the filesystem root"). `next build --webpack` derleniyor ama Tailwind yalnız Turbopack'e bağlı olduğu için sayfa stilsiz çıkıyor. Ölçüm için `web/next.config.ts`'te `turbopack.root` geçici olarak `C:/Users/Asus` yapılıp derlendi ve hemen geri alındı (commit'lenmez). Kalıcı çözüm kullanıcı kararıyla ertelendi (2026-10-25); Mac'teki sembolik bağlantıda da aynısı beklenir.

## Açık işler (2026-10-22 sabah)

- Bitti ve arşive işlendi: Fab/UDIM kıyafetleri (`9d17339`, `eab344f`), çıplak cilt ve boyalı groom yeniden dönüştürmesi (tüm ciltler 21 Ekim 17:23-18:18), `/dev/thumbs` küçük resimleri (92 dosya), kürasyon ve prune (`raw/pruned.json`, 22:37).
- **Mac'e aktarım:** aşağıdaki "Mac'e taşıma". Plan: yalnız `web` klasörü (~2.0 GB), Wi-Fi ile. Ayrı bir "slim" kopya üretilmez; `serve-slim` arşiv klasörlerini olduğu gibi sunar.
- **Unreal temizliği (PC):** Mac çalışınca. Unreal önbellekleri (~165 GB), arşivde sunulmayan `fab/` (~11 GB), UE projesi `AISimsExport`; UE'yi kaldırmak kullanıcıda.

## Mac'e taşıma

Prova 2026-10-21'de bu PC'de yapıldı (sunucu + Windows'ta Python 3.9 istemci, WSL'de Linux istemci): yarıda öldürülen dosya Range ile kaldığı yerden sürdü, bozuk dosya sha256'da yakalanıp yeniden indi, `raw/` ikizleri hard link, `web/` ikizleri ayrı kopya oldu, ikinci çalıştırmada her şey atlandı.

### PC'den ayrılmadan önce

1. **Prune ve dönüştürme bitmiş olmalı.** Sunucu açılışta dosya listesini ve hash'leri bir kez çıkarır. Sonradan silinen ya da yeniden yazılan dosya Mac'te `FAILED ... changed on the PC` verir. Arşivde bir şey değiştiyse sunucuyu kapatıp yeniden aç (yeni token yazar).
2. **Git temiz olmalı:** `git status` boş, her şey `main`'e push'lanmış. PC'de kalan commit'lenmemiş iş kaybolur.
3. **`web/.env.local`** git'te yok. Dosyayı kendin taşı (USB bellek ya da şifre yöneticisi); git'e, sohbete, maile koyma. Kaybolursa anahtarlar sağlayıcı panellerinden yeniden alınır (`docs/setup-accounts.md`), `BETTER_AUTH_SECRET` için `openssl rand -base64 32`.
4. PC'nin dev veritabanı (`.data/mongo`) taşınmaz. İçindeki karakterler PC tarayıcısındaki anonim oturumlara bağlı; Mac'te boş DB ile başlanır.
5. **Ağ hızı:** PC şu an **USB Fast Ethernet adaptöründe (100 Mbit/s, ~11 MB/s)**; 20 GB ~30 dk sürer. Kabloyu laptopun kendi Gigabit portuna takmak (ya da Wi-Fi 6E'ye bağlanmak) bunu ~5-15 dk'ya indirir. Adres değişirse sunucu yenisini yazar.
6. PC şarjda kalsın, kapağı açık (şarjda uyku kapalı; pilde 5 dk sonra uyur).

### PC: sunucu

PowerShell ya da Git Bash, iki satır:

```bash
cd C:/Users/Asus/Desktop/ai-sims/pipeline
uv run asset-pipeline serve-slim --archive C:/Users/Asus/MetaHumanArchive --include web
```

- **Plan (2026-10-22): `--include web`.** Yalnız sitenin okuduğu web varlıkları (~2.0 GB); Wi-Fi'da birkaç dakika. Dönüştürme bittiği için Mac'te `raw/` gerekmez.
- `raw`, `fab_anims`, `gestures` ve `logs` yalnız Mac'te yeniden dönüştürmek ya da klip retarget etmek için lazım. Gerekirse sonra `--include` olmadan (varsayılan klasörler, ~20 GB) aynı adımlarla alınır; `fetch_slim.py` inmiş dosyaları atlar.

- Çıktı şöyle biter (prune sonrası ölçüm: 5076 dosya, 27.1 GB, **20.1 GB indirilecek**; adres ve token her açılışta kendi değerleri):

  ```text
  serving 5076 files, 27.1 GB (20.1 GB to download, identical files once) on http://192.168.1.104:8765
  on the Mac (same network), from the repo root (caffeinate keeps it awake):
    caffeinate -i python3 pipeline/scripts/fetch_slim.py --url http://192.168.1.104:8765 --token 0123456789abcdef --dest ~/MetaHumanArchive
  ```

  Son satırı Mac'te aynen yaz. Token 16 haneli küçük harf hex; sunucu kapanınca geçersizdir.
- Hash'ler arşiv kökündeki `.transfer-index.json`'da önbellekte; değişmeyen dosya yeniden hash'lenmez, açılış ~1 dk.
- Bayraklar: `--archive` (varsayılan `$MH_ARCHIVE`, yoksa `~/MetaHumanArchive`), `--include` (virgüllü klasör listesi), `--everything` (dönüştürücünün okumadığı dosyaları da sun), `--bind` (varsayılan PC'nin LAN adresi), `--port` (varsayılan 8765).
- Varsayılan klasörler: `web`, `raw`, `fab_anims`, `gestures`, `logs`. Fab `.mhpkg`'leri (`fab`) yalnız Unreal'da işe yarar; istenirse `--include web,raw,fab_anims,gestures,logs,fab`.
- **Okunmayan kaynaklar sunulmaz** (`UNUSED_SOURCES`, `transfer.py`). Liste, tam bir Ada dönüşümü ile her slottan bir groom, gövdeler, animasyonlar ve ışığın dosya açma izinden (audit hook) çıkarıldı: preset'lerin 8K `*_Animated_*` girdileri, göğüs haritaları ve 4K gövde albedo'su, groom ve kıyafet FBX'leri, KhaosMDF322'nin kullanılmayan UDIM karoları, Creator'ın deri bölge maskeleri. Bunlar olmadan Mac her web varlığını yeniden üretebilir.
- **Aynı içerik bir kez iner.** `fetch_slim.py` kopyaları Mac'te `raw/` altında hard link, `web/` altında gerçek kopya olarak üretir; dönüştürücü web dosyalarını yerinde yeniden yazar.
- Token istek loguna yazılmaz. Bitince **Ctrl+C** (ya da pencereyi kapat).

### Windows güvenlik duvarı

- Bu PC'de uv'nin Python 3.13.14'ü için **"Genel" ağda gelen bağlantıya izin veren kural zaten var** ve PC'nin ağı "Genel". Yani büyük ihtimalle **hiç soru çıkmaz.** WSL'den (ayrı alt ağ, güvenlik duvarından geçer) denendi: tokensız 401, token'la 200.
- **Soru çıkarsa** (başka ağa geçince ya da uv Python'u güncelleyince): "Windows Güvenlik Duvarı bu uygulamanın bazı özelliklerini engelledi", uygulama **python.exe**. Listelenen ağ türlerinin (Özel ve Genel) ikisini de işaretle, **"Erişime izin ver"**. Yönetici onayı isteyebilir.
- **Soru çıkmadı ama Mac bağlanamıyorsa:** Başlat → "Güvenlik duvarı üzerinden uygulamaya izin ver" → "Ayarları değiştir" → yolu `...\uv\python\cpython-3.13...` olan `python.exe` satırlarında **Özel** ve **Genel** kutularını işaretle → Tamam. Satır yoksa "Başka bir uygulamaya izin ver" ile `C:\Users\Asus\AppData\Roaming\uv\python\cpython-3.13.14-windows-x86_64-none\python.exe`'yi ekle.
- Mac'ten hızlı test: `curl -s -o /dev/null -w "%{http_code}\n" http://<pc>:8765/files.json` → **401** ulaşılıyor demek. Zaman aşımı: güvenlik duvarı, ya da Mac misafir ağında / router'da istemci yalıtımı açık (ikisi aynı ağda olmalı).

### Mac: indirme

Önce aşağıdaki "Mac kurulumu"nun 1-2. adımları (Homebrew ve repo). Sonra repo kökünde, sunucunun yazdığı satır:

```bash
cd ~/ai-sims
caffeinate -i python3 pipeline/scripts/fetch_slim.py --url http://<pc>:8765 --token <token> --dest ~/MetaHumanArchive
```

- Yalnız standart kütüphane; macOS'un `python3`'ü (Xcode araçlarıyla gelen 3.9) yeter, `uv` gerekmez. Python 3.9 ile prova edildi.
- `caffeinate -i` Mac'i indirme boyunca uyutmaz. Mac de şarjda ve kapağı açık kalsın.
- İlk satır indirilecek toplamı yazar (`... GB to download (+N identical copies made here)`), sonra her dosya için yüzde ve MB/s.
- Bayraklar: `--jobs` paralel indirme (varsayılan 6); `--only <önek>` yalnız o yolla başlayan dosyalar (tekrarlanabilir). Önce `--only web/` ile web varlıkları (~3 GB) alınabilir, kalanı için sonra aynı komut `--only` olmadan.
- Dosyalar `<dosya>.part`'a iner, Range ile kaldığı yerden sürer, her biri sha256 ile doğrulanır. **Yarıda kalırsa (Wi-Fi koptu, Ctrl+C) aynı komutu yeniden çalıştır**; bitmiş dosyalar doğrulanıp atlanır.
- `FAILED ... changed on the PC since serve-slim started` görürsen: PC'de sunucuyu kapatıp aç, yeni token'la aynı komut.
- Süre ≈ GB ÷ MB/s: 20 GB, 11 MB/s'de ~30 dk, 40 MB/s'de ~9 dk.
- **"all files verified"** yazınca PC'de Ctrl+C.

## Mac kurulumu

Sıfır bir Mac'te (Apple Silicon), Terminal'de:

1. **Homebrew** ([brew.sh](https://brew.sh)); Xcode komut satırı araçlarını (git, python3, clang) da kurar. Bitince yazdığı `eval "$(/opt/homebrew/bin/brew shellenv)"` satırlarını çalıştır. Sonra:

   ```bash
   brew install gh node@22 uv cmake
   brew tap mongodb/brew && brew install mongodb-community
   echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zprofile && source ~/.zprofile
   npm install -g pnpm@12.4.2
   ```

   - `node@22` keg-only olduğu için PATH satırı gerekir. `node -v` 22.x, `pnpm -v` 12.x vermeli.
   - `brew services start mongodb-community` **çalıştırma**: o 27017'de ayrı bir servis açar. Dev DB'yi `pnpm db:start` açar; Homebrew'un `mongod`'unu PATH'ten bulur (ya da `MONGOD_BIN`).
2. **Repo** (özel repo, önce GitHub girişi). iCloud'la eşitlenebilen Masaüstü/Belgeler yerine ev klasörüne:

   ```bash
   gh auth login                        # GitHub.com, HTTPS, tarayıcıyla giriş
   gh repo clone Yigtwxx/ai-sims ~/ai-sims
   ```

3. **Arşiv:** yukarıdaki "Mac: indirme". `~/MetaHumanArchive` da iCloud dışında kalır.
4. **Web**, repo kökünde (`~/ai-sims`):

   ```bash
   ln -s ~/MetaHumanArchive/web web/public/assets/mh     # web sahnesi buradan okur (gitignore'da)
   cp .env.example web/.env.local                        # ya da PC'den getirdiğin dosyayı buraya koy
   cd web && pnpm install
   pnpm db:start                                         # mongod 127.0.0.1:27018, veri .data/mongo
   pnpm dev                                              # http://localhost:3000
   ```

   - Bağlantı sembolik link; Next dev ve `/api/dev/thumbnails` onun içinden okur ve yazar. PC'deki junction Node'a da sembolik link olarak görünür, yani aynı yol PC'de zaten çalışıyor. Kontrol: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/assets/mh/manifest.json` → 200.
   - `pnpm db:start` `.data/mongo`'yu kendisi açar. Kullanıcının kendi mongod'una (27017) dokunulmaz.
- **`web/.env.local`:** PC'den getirdiğin dosyayı aşağıdaki adlarla karşılaştır; yoksa `.env.example`'dan doldur. Değerler hiçbir zaman loglanmaz ve commit edilmez. Anahtar alma adımları: `docs/setup-accounts.md`.
  - Veri ve oturum: `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.
  - AI: `GROQ_API_KEY`, `GROQ_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_PROVIDER_ORDER`.
  - TTS: `TTS_PROVIDER_ORDER`, `TTS_ENABLE_EDGE`, `GEMINI_TTS_MODEL`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_TTS_VOICE_TR_FEMALE`, `AZURE_TTS_VOICE_TR_MALE`, `AZURE_TTS_VOICE_EN_FEMALE`, `AZURE_TTS_VOICE_EN_MALE`.
  - Edge sesi ve lip-sync'in kelime zamanları için `TTS_ENABLE_EDGE=1` gerekir. Eski bir `.env.local`'da bu satır olmayabilir.
- **Dönüştürücü (yalnız yeniden dönüştürmek için; önce `raw/` da aktarılmış olmalı, bkz. "PC: sunucu"),** `pipeline/` içinde:

  ```bash
  uv sync
  git clone -b 5.8 https://github.com/EpicGames/OpenRigLogic.git vendor-src/OpenRigLogic
  uv run --no-sync python scripts/build_openriglogic.py   # macosx_arm64-cp313 modülleri
  uv run asset-pipeline mh-convert --outfits --manifest --archive ~/MetaHumanArchive   # örnek: yalnız kıyafetler
  ```

  - **Mac'te artımlılık yok:** damgalar (`build/stamps/`) kaynak `done.json`'ların mutlak yolunu içerir ve `build/` aktarılmaz. Mac'teki ilk `mh-convert` istenen her birimi baştan çevirir (yüz başına ~4-5 dk). `--all` yerine yalnız gereken bayrakları ver (`--outfits`, `--grooms`, `--character <ad>`, `--parts`).

  - OpenRigLogic modülleri platforma özgü ve gitignore'da (`vendor/openriglogic/<platform_tag>/`). PC'deki `win_amd64-cp313` Mac'te çalışmaz; Mac'te ilk kez derlenecek. Gerekenler: Xcode command line tools (Homebrew ile geldi), CMake (`brew install cmake`); SWIG `uv sync` ile, Python 3.13 `uv` ile gelir.
  - KTX-Software 4.4.2 gerekir (`$KTX_TOOLS`, PATH ya da `~/tools/ktx/4.4.2/bin`). Mac'te resmi paket `ktx`'i PATH'e kurar; `curl` ile inen dosyaya Gatekeeper takılmaz:

    ```bash
    curl -LO https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Darwin-arm64.pkg
    sudo installer -pkg KTX-Software-4.4.2-Darwin-arm64.pkg -target / && ktx --version
    ```
  - Manifest yazılınca web'in zod şemasıyla kontrol edilir; bunun için önce `web/`'de `pnpm install` yapılmış olmalı.
- **Donanım farkı:**
  - Web çalışma zamanı WebGL2'dir; CUDA ya da MPS'e bağlı değildir. Repoda torch kodu yok.
  - Dönüştürücü CPU'da çalışır (numpy, scipy, OpenRigLogic).
  - Kalite katmanları ve fps RTX 4070 laptopta ölçüldü. Mac'te (M4 Pro) `auto`'nun hangi katmanda durduğu yeniden ölçülmeli.

## Canlı demo (2026-10-26)

- https://ai-sims.pages.dev (Türkiye'den bu adres açılır; `*.vercel.app` 2026-10-27'den beri engelli, ayna `proxy/pages/`). Vercel'deki asıl adres https://ai-sims-zeta.vercel.app. `main`'e her push production deploy'u. Kurulum ve env listesi: `docs/deploy.md`.
- Varlıklar Vercel'de değil, R2 bucket'ı `ai-sims-mh`'de. Dönüştürücü ya da `mh-prune` çalıştıktan sonra değişen klasörleri `cd web && node scripts/r2-sync.mjs <klasör>` ile yükle.
- Veri Atlas M0'da (Frankfurt). Yerel geliştirme 27018'deki mongod'la devam eder.
- **Mac'te yalnızca UI işi için 20 GB aktarım gerekmez.** Repo'yu klonla, `.env.local`'ı elle taşı ve içine `NEXT_PUBLIC_MH_ASSET_ROOT=https://pub-3bc24e93f6b644a09830eee4f15bb5e0.r2.dev` ekle. Varlıklar R2'den gelir. Yüz, kıyafet, kürasyon ve thumbnail gibi varlık işleri `raw/` arşivi ve dönüştürücü ister; onlar PC'de kalır.

## Arayüz (2026-10-27, Mac)

- PC ve Unreal gerekmeden yapıldı; varlıklar R2'den (`NEXT_PUBLIC_MH_ASSET_ROOT`).
- Stil seçimi "AI Sims Stil Önerileri" canvas'ında (claude.ai artifact): landing E, oluşturucu C.
- Landing: `features/landing/` ham WebGL2, tek `drawArrays`, 7000 nokta (telefonda 3500). Kaydırma yumuşatılır, karede React render yok, kare yavaşlarsa önce DPR sonra nokta sayısı düşer. Sıra: dağınık → küre → dalga → viseme halkası → dudak → silüet. CTA'ya gelince silüet döner; basınca noktalar göğse toplanır ve oluşturucu oradan dairesel açılır (view transition). Landing'de footer yok. Demo ve Epic ticari marka satırı kullanıcı kararıyla tüm sitede kaldırıldı (2026-10-27).
- Silüet: `/dev/silhouette` gerçek montajla (Ada, bob, tişört + kot + spor ayakkabı, relax idle t=1 s) yüzeyden 8000 nokta örnekler. Kol 25°'den açıksa ya da yüz +z'ye bakmıyorsa kaydetmez. Bunu yaparken `thumbnail` modundaki A-pose hatası bulundu: durağan karede klip yalnız ilk karede uygulanıyordu (`motion.ts` düzeltildi). R2'deki küçük resimler bu hatayla çizildi; `/dev/thumbs` ile yeniden üretilmeli (PC ya da arşiv gerekir).
- Boş ve bekleme durumları: `StagePoster` noktalı silüeti (`DotPoster`), 404/hata ekranı dağınık noktaları (`DustField`) gösterir.
- UI cilası (2026-10-27, 3D'siz sayfalar): anime döneminden (şema v1) kalan karakterlerin anime küçük resmi artık gösterilmez, ilk MetaHuman kaydında silinir (`repository.ts`). Portresi olmayan kart noktalı silüet gösterir. `cn()` `text-kicker`'ı renk sınıfıyla birleşince siliyordu (landing bölüm listesi), düzeldi. Landing metni ve bölüm listesi başlığın kenar boşluğuna hizalı, marka kicker'ı "AI SIMS" (Türkçe İ değil). Kaydırınca üst bar tam opak. **Ertelendi (ısıtır):** oluşturucu ve konuşma ekranının görsel cilası 3D sahne ister; şarja takılıyken yapılacak.
- Turbopack dev önbelleği (`web/.next/dev`) Mac'te 20 Ekim'den kalma CSS servis etti; garip stil görülürse sunucuyu durdurup bu klasörü sil.

## Performans (2026-10-27, Mac)

- Cihaz: MacBook M4 Pro, 120 Hz ProMotion, DPR 2, pencere 1440×874 CSS. Local production build (`pnpm build && pnpm start`); build Mac'te 9 sn, PC'deki symlink kırığı burada yok (varlıklar R2'den). Ölçüm: çizilen kare sayısı (WebGL draw hook) ve `ioreg` "Device Utilization %" (sudo gerekmez). `EXT_disjoint_timer_query_webgl2` ANGLE/Metal'de kareler arası örtüşüyor (%294 meşgul), kullanılmaz.

  | Ölçüm | Sonuç |
  |---|---|
  | Boş masaüstü / landing | GPU %10 / 120 fps, GPU %20 |
  | Oluşturucu `high` (önce) | **53 fps (18.7 ms), GPU %99.** `auto` 120 Hz'de drei'nin [50, 90] bandında kaldığı için inmiyordu |
  | `high`, AO kapalı / AO medium / **AO yarım çözünürlük** | 120 / 81 / **92.6 fps (10.8 ms)** |
  | `balanced` | 120 fps, GPU %98 (iki kat kare) |
  | İlk yükleme (oluşturucu, Jelena) | 47 dosya, **73 MB** (KTX2 55, GLB 14.5). ~21 sn; bağlantı 3.3 MB/s, darboğaz ağ. Önbellekle 2.6 sn |
  | R2 `Cache-Control` | dokular 1 saat, manifest 60 sn |

- Yapılan:
  - N8AO DPR > 1.5'te yarım çözünürlükte (`PostEffects.tsx`). Yüz yakın planında fark görülmedi.
  - Boşta 30 fps (`IDLE_FPS`, `frameCap`, `useInputIdle`): 3 sn girdi yoksa (pointer, wheel, tuş) sahne 30 fps'e iner; konuşurken (`speaking` → Stage `lively`) tam hızda kalır. `PerformanceMonitor` yalnız sınırsızken ölçer, yoksa 30 fps'i yavaşlık sanardı.
  - Sonuç (LPM kapalı, `auto`): oluşturucu boşta **30 fps, GPU %57** (önce %99), etkileşimde **92 fps** ve `high`'da kalıyor (önce 53). Konuşma ekranı: karakter konuştuğu sürece ~100 fps (girdi penceresi dolduktan sonra da), bitince hemen 30. Asset gelirken ve kamera kayarken bileşenlerin `invalidate`'i 30'un üstüne çıkarır; bu istenen bir şey.
- Yerel `.env.local` PC'den kopyalandı ve `TTS_ENABLE_EDGE=1` eksikti; yerelde ses "could not be generated" veriyordu. 2026-10-27'de eklendi.

- **Günlük kota** (2026-10-27, Mac): `/api/chat` ve `/api/tts` anonim oturumla sınırsız çağrılabiliyordu. Artık kullanıcı başına (100 mesaj, 40 bin TTS karakteri) ve tüm site için (2000 mesaj, 400 bin karakter) günlük sınır var; Claude günde en çok 200 cevap verir, sonra zincirden çıkar. Sohbet ekranı TR/EN bildirim gösterir, ses yazıya düşer. Ayrıntı `CLAUDE.md` "AI sohbet ve TTS".

## Kendi kıyafetimiz (plan, PC'de yapılacak; 2026-10-27)

- **Güncelleme (2026-10-27, Mac):** varsayılan yol artık Unreal değil, Blender'dan doğrudan arşiv birimi. Parça listesi (iş seti, tişört, şortlar, günlük çeşit, çorap ve külotlu, iç giyim, mayo ve bikini, ek parçalar, topuklu, gece ve seksi çizgi, spor, ev, ayakkabı çeşitleri, varyantlar, meslek, uzun parçalar), yöntem ve sıra `docs/todo.md` A4'te. Aşağıdaki Unreal adımları yalnız A4.0 başarısız olursa kullanılır.
- **Karar (kullanıcı):** Fab'den tek tek kıyafet alınmaz. Kıyafetleri kendimiz üretiriz; iş PC'de ve Unreal üzerinden yapılır. Hedef: yapabildiğimizin en kalitelisi (kullanıcı, 2026-10-27; önceki "iyi, AAA değil" hedefinin yerine). Araçlar ücretsiz olmalı. Fab'de abonelik yok; Blender'ın dikiş eklentileri (Garment Tool, Simply Cloth) ve Marvelous Designer / CLO ücretli, bu yüzden elendi.
- **Bizim için kolaylaştıran şey:** `mh-convert` kemik ağırlıklarını ve vücut slider morph'larını kıyafete vücuttan kendisi aktarıyor (`pipeline/src/asset_pipeline/mh/outfits.py`, adım 3). `ue outfits` yalnızca nötr gövdeyi kuruyor. Yani Unreal'ın kıyafeti yalnızca her cinsiyetin **nötr** gövdesine oturtması yeterli. Epic'in birden çok kaynak bedenli resizable kurulumu (slider uçlarında bozulmayı önlemek için) bizde gerekmeyebilir; önce tek kaynak bedenle denenir.
- **Araçlar:**
  - Blender: render mesh ve UV. Kumaş simülasyonu yerleşik ve ücretsiz.
  - z-weave Free: kalıptan giysi çıkarır, OBJ/FBX/glb dışa aktarır. Düz parçalarda (tişört, elbise) Blender'dan hızlı.
  - Dokular CC0: [ambientCG](https://ambientcg.com/), [Poly Haven](https://polyhaven.com/).
- **Epic dokümanları:**
  - [Parametric clothing başlangıç](https://dev.epicgames.com/documentation/metahuman/getting-started-for-creating-parametric-clothing-in-metahuman)
  - [Outfit Asset oluşturma](https://dev.epicgames.com/documentation/metahuman/create-a-metahuman-parametric-outfit-asset)
  - [Test ve ayar](https://dev.epicgames.com/documentation/metahuman/testing-and-configuring-your-parametric-outfit-asset)
  - [MetaHuman Manager ile paketleme](https://dev.epicgames.com/documentation/metahuman/packaging-your-outfit-asset-with-metahuman-manager)
  - [Kendi wardrobe item'ın](https://dev.epicgames.com/documentation/metahuman/tailoring-your-own-wardrobe-items)
- **Eğitimler:**
  - [Nils Gallist, UE 5.6, Blender](https://dev.epicgames.com/community/learning/tutorials/b6EZ/custom-clothing-for-metahuman-2-0-in-ue5-6-step-by-step)
  - [z-weave + UE 5.8](https://dev.epicgames.com/community/learning/tutorials/qzpo2/unreal-engine-create-metahuman-clothing-for-free-z-weave)
  - [İndirilmiş modelden resizable kıyafet](https://www.youtube.com/watch?v=y8228NM-GHs)
- **Adımlar** (ilk parça: düz tişört, tek cinsiyet):
  1. Kaynak beden: `OutfitBase_<cinsiyet>`'in nötr gövdesi (`ue outfits`'in kurduğu karakter) Blender'a FBX olarak alınır; kıyafet onun üstünde modellenir.
  2. UE'de Cloth Asset (`CA_`), sonra `Physics > Outfit Asset` (şablon "Resizable Outfit", ad klasör adıyla aynı `OA_`), Dataflow'da "Sized Outfit Source" (Size Name, Source Asset, Source Body Parts), "Evaluate Dataflow Graph". MetaHuman Creator'da slider'larla bakılır.
  3. Malzeme `M_fabric_simpler`'ın instance'ı olursa web onu kendi kumaş shader'ıyla kurar (`NATIVE_MASTERS`, `pipeline/unreal/mh_export/outfits.py:37`) ve renk presetleri çalışır. Başka bir master'da da bake'lenir, ama düz PBR olur.
  4. Wardrobe item `/Game/Custom/<ad>/WI_<ad>` altına konur, **`/Game/Fab` altına değil**: `mh-prune --unused-packages` `/Game/Fab/<paket>/`'i Fab paketi sayar (`src/asset_pipeline/mh/prune.py:55`). `ROOTS`'a `/Game/Custom` eklenir (`pipeline/unreal/mh_export/outfits.py:35`).
  5. Sonrası Clara body ile aynı: `ue outfits --args '{"genders": ["female"], "only": ["WI_<ad>"]}'`, `mh-convert --outfits --outfit <ad> --manifest`, etiket `outfit_labels.json`, cinsiyet `gender_compat.json`, renk `outfit_tints.json`, `/dev/thumbs`, `node scripts/r2-sync.mjs`.
- **Süre (tahmin, kaynaksız):** tişört 1-2 gün, kot ve elbise 2-4 gün, blazer 4-7 gün, öğrenme 1-2 hafta. En zor kısım blazer ve kot gibi katmanlı parçaların Outfit Asset'te düzgün warp etmesi.
- **Lisans:** kullanıcı kararı (2026-10-27), bu araçlar ve Epic'in hazır kıyafetlerini değiştirmek için ayrıca sorulacak bir şey yok.

## Sıradaki iş (Mac)

0. **PC işleri `docs/todo.md`'de** (2026-10-27): Fab'den 4 yüz ve 5 saç, sahnede çalışmayan ayarlar (göz tonu, yüz karıştırma, dövme, takı), yeni özellikler (kişilik, ses, ifade önizleme, makyaj, cilt detayları, kaş ve kirpik, yüz ince ayarı, gözlük ve şapka, kat kat giyim), kendi kıyafetlerimiz (A4: iş seti, tişört, şortlar, günlük çeşit, çorap ve külotlu, iç giyim, mayo ve bikini, ek parçalar, topuklu, gece ve seksi çizgi, spor, ev, ayakkabı çeşitleri, varyantlar, meslek, uzun parçalar), küçük resimler. Kullanıcı telefondan "yapılacakları yap" der.
1. Aktarımı doğrula ("all files verified"), bağlantıyı kur, `pnpm dev` ile `/dev/stage` ve oluşturucuyu aç.
2. İlk açılış kontrolü: landing, yeni karakter (kadın ve erkek), bir kıyafet ve renk değişikliği, Bitti, konuşma ekranında "Nasılsın?" (ses ve dudak). Konsolda `THREE.Clock` uyarısından başka hata olmamalı.
3. Kürasyonu bitir; gizlenenleri kullanıcı `mh-prune --apply --plan <özet>` ile siler.
4. Kalan kalite notları:
   - Erkek ve slider'lı gövdede klip pelvis ölçeği (`extras.mh.retarget.leg_lengths_m`).   - CC BY atfı: crowd idle klipleri (Vernac Studios, CC BY 4.0) için UI'da kredi satırı. Henüz yok.
5. Lip-sync'in TR + EN cümlelerle yeniden kontrolü (performans bitti, yukarıda).

## AI ve ses

- **AI sırası:** groq → gemini → anthropic (`AI_PROVIDER_ORDER`). Modeller `web/src/lib/env.ts`'te.
- **TTS sırası:** azure → edge → gemini (`TTS_PROVIDER_ORDER`).
  - Azure yapılandırılmamış.
  - Edge anahtarsızdır ama `TTS_ENABLE_EDGE=1` ister; kelime zamanı verir, lip-sync bunu kullanır. Kopan bağlantıda iki kez yeniden dener.
  - Gemini TTS kelime zamanı vermez; o cevapta lip-sync yalnız metin hizalamasıyla çalışır.
- **Anahtarlar** `web/.env.local`'da (git'te yok). Değerleri hiçbir zaman loglanmaz.

## Ortam

- Geliştirme DB'si: `cd web && pnpm db:start` (mongod 127.0.0.1:27018), durdurmak için `pnpm db:stop`. Kullanıcının kendi mongod'una (27017) **dokunma**.
- Komutlar, doğrulama ve git kuralları `CLAUDE.md`'de. Bu projede küçük Conventional Commit + push yetkisi var.
- Kullanıcının kişisel kuralları `~/.claude/CLAUDE.md` ve `~/.claude/rules/` içinde:
  - Yanıtlar Türkçe; kod İngilizce.
  - Gövde ≤80 kelime; sonda `Kısaca:` ve gerekiyorsa `Senin Kararın:`.

## Kararlar (kullanıcı onaylı)

- **Demo cihazı:** MacBook (M4 Pro, 48 GB). Kalite en üste çekilir.
- **Kapsam:** Windows'ta seçim yapılmaz; her şey dışa aktarılır. Ayıklama Mac'teki kürasyon ekranında yapılır.
- **Kaynak dokular** 8K; web için yüz 4K, diğerleri 2K, KTX2.
- **Tasarım (2026-10-27, eskisinin yerine):** tek açık tema "Paper and Ink" (`DESIGN.md`). Landing E (kaydırmalı mürekkep parçacıkları, sonda MetaHuman silüeti), oluşturucu C "Kontrol Odası" düzeni, 3D sahne açık kâğıt stüdyo. Mor gradyan ve glassmorphism yasak. Eski karanlık sinematik/amber tasarım kaldırıldı.
- **Dil (2026-10-27):** ana dil İngilizce (`/` → `/en`), Türkçe ikinci dil; tarayıcı dili algılanmaz.
- **Repo:** 2026-10-27'den beri public. Secret, gerçek token ya da `.env` değeri commit'lenmez.
- **Dövme ve piercing:** ölçülü.
- **Kıyafet:** iş ve günlük karışık; 2026-10-27 itibarıyla gece ve seksi çizgi, seçilebilir iç giyim, mayo ve bikini de var.
- **İçerik:** ücretli içerik alınmaz. Fab'den yalnız $0 öğeler (onaylı liste: 20 Epic kıyafeti, 6 saç, Vampire, 2 Nyanpasinka gömleği, 2026-10-25'te kullanıcının seçtiği Clara body, 2026-10-27'de seçilen 4 yüz: Skotukeda, Mason, Seo, Frey ve 5 saç: Long High Ponytail, Ponytail MessyWavy, Hairstyle Male 11, Nomad Wave Undercut, PonytailGroom; arşivde 2026-10-25'te 24 `.mhpkg` var: 21 `oa_*`, 3 `khaosmdf*`). Fab liste sayfası fiyatı eski gösterebiliyor: Romantic Casual Overalls listede "Free" iken 2026-10-25'te ücretliye dönmüştü ve alınmadı. İndirmeden önce öğenin kendi sayfasındaki lisans kutusuna bakılır. Animasyonlar da yalnız ücretsiz paketlerden.
- **Lisans:** UE EULA MetaHuman'ların AI eğitimi/testi için kullanımını yasaklıyor. LLM ile konuşturmak için ürünleşmeden önce hukuki kontrol gerekli.
