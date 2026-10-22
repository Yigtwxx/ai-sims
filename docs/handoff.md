# Devir notu (2026-10-22 sabah)

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
- **Manifest v2** (`generatedAt` 2026-10-21T20:26Z, prune sonrası): 19 yüz, 20 cilt, 2 vücut, 49 groom, 24 kıyafet, 22 iris, 10 animasyon, 8 ışık. Kategori ayrıntısı ve klasör boyutları: `docs/metahuman-export.md` (prune öncesi sayılar).
- **Kürasyon:** `raw/pruned.json` silinmiş 115 id'yi tutar; `web/curation.json` 191 id'yi gizler. Elenen yüzler: Bo, Bruce, Grace, Jorge, Lani, Lorenzo, Orlando, Sook-ja, Walter.
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
    - Boyun dikişi kaynaklanır. Kafa kenarı gövdenin altına 1.5 mm uzanır, böylece çatlak kalmaz.
    - Yüz veya gövde değişince yeni karakter ekran dışında kurulur ve tek karede eskisinin yerini alır. Boş ya da kel kare yok.
    - Kurulum sırasında kamera ekrandaki karakteri kadrajlar (`1c129d1`).
  - Cilt shader'ı:
    - SSS sarma, SRMF speküler, gözenek mikro normali, cavity.
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
- Doğrulama (2026-10-22 sabah): `pnpm typecheck` ve `pnpm lint` temiz, `pnpm test` **805 test geçti** (81 dosya).
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
  - Mocap.in Realistic Acting (Fab, Personal lisans): `talking_normal` (talk), `listening` (sakin idle).
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

## Site kontrolü (2026-10-22 sabah, PC)

- Landing, Karakterlerim, oluşturucu ve konuşma masaüstünde (1440×900) ve telefonda (390×844) gezildi. Yatay kaydırma yok, konsolda yalnız three'nin `THREE.Clock` uyarısı var.
- Konuşma uçtan uca çalışıyor: "Nasılsın?" ilk metne ~1.5 sn, Edge sesiyle konuşup Hazır'a dönüyor.
- Düzeltilenler:
  - **Kollar kıvrık görünüyordu** (`9b84d75`): ön kol dönüşü dirsek tarafındaki twist kemiğinde başlıyordu; 3/4 kolun ağzı orada makaslanıp buruşuyordu. Dönüş artık bileğe doğru (twist_01 yarım, el tam 45°), avuçlar hâlâ bacağa bakar.
  - **Renk başlıkları** (`d73bba6`): kıyafet panelinde "diffuse_color_1/2" yazıyordu; artık Ana / İkincil / Detay / Aksesuar rengi, çok malzemeli kıyafette parça numarasıyla.
- Bilinen notlar:
  - Kargo pantolonun ağındaki turuncu leke önden, haki renkte görülemedi. Doku ve dikiş maskelerinde de leke yok (`raw/outfits/*/WI_OA_Cargopants/textures/`). Görüldüğü renk, cinsiyet ve açı bilinirse yeniden bakılır.
  - `next dev`'de karakterin sahneye gelmesi ilk açılışta ~40 sn sürüyor (derleme + doku). Production build'de ölçülmedi.
  - Telefonda "İsimsiz taslağın geri yüklendi" bildirimi birkaç saniye alt çubuğun (Bitti) üstünde duruyor.

## Açık işler (2026-10-22 sabah)

- Bitti ve arşive işlendi: Fab/UDIM kıyafetleri (`9d17339`, `eab344f`), çıplak cilt ve boyalı groom yeniden dönüştürmesi (tüm ciltler 21 Ekim 17:23-18:18), `/dev/thumbs` küçük resimleri (92 dosya), kürasyon ve prune (`raw/pruned.json`, 22:37).
- **Mac'e aktarım:** aşağıdaki "Mac'e taşıma". Plan: yalnız `web` klasörü (~2.25 GB), Wi-Fi ile. Ayrı bir "slim" kopya üretilmez; `serve-slim` arşiv klasörlerini olduğu gibi sunar.
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

- **Plan (2026-10-22): `--include web`.** Yalnız sitenin okuduğu web varlıkları (~2.25 GB); Wi-Fi'da birkaç dakika. Dönüştürme bittiği için Mac'te `raw/` gerekmez.
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

## Sıradaki iş (Mac)

1. Aktarımı doğrula ("all files verified"), bağlantıyı kur, `pnpm dev` ile `/dev/stage` ve oluşturucuyu aç.
2. İlk açılış kontrolü: landing, yeni karakter (kadın ve erkek), bir kıyafet ve renk değişikliği, Bitti, konuşma ekranında "Nasılsın?" (ses ve dudak). Konsolda `THREE.Clock` uyarısından başka hata olmamalı.
3. Kürasyonu bitir; gizlenenleri kullanıcı `mh-prune --apply --plan <özet>` ile siler.
4. Kalan kalite notları:
   - Erkek ve slider'lı gövdede klip pelvis ölçeği (`extras.mh.retarget.leg_lengths_m`).
   - Baş ve gövde cildi arasında göğüste hafif ton farkı.
   - CC BY atfı: crowd idle klipleri (Vernac Studios, CC BY 4.0) için UI'da kredi satırı. Henüz yok.
5. Mac'te performans ölçümü (fps, boşta 30) ve lip-sync'in TR + EN cümlelerle yeniden kontrolü.

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
- **Tasarım:** karanlık sinematik. Grafit zemin, tek amber vurgu. Mor gradyan ve her yerde glassmorphism yasak.
- **Dövme ve piercing:** ölçülü.
- **Kıyafet:** iş ve günlük karışık.
- **İçerik:** ücretli içerik alınmaz. Fab'den yalnız $0 öğeler (onaylı liste: 20 Epic kıyafeti, 6 saç, Vampire, 2 Nyanpasinka gömleği; arşivde bugün 31 `.mhpkg` var: 27 `oa_*`, 4 `khaosmdf*`). Animasyonlar da yalnız ücretsiz paketlerden.
- **Lisans:** UE EULA MetaHuman'ların AI eğitimi/testi için kullanımını yasaklıyor. LLM ile konuşturmak için ürünleşmeden önce hukuki kontrol gerekli.
