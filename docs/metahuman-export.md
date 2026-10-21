# MetaHuman dışa aktarımı (Windows, bir kez)

Bu belge, MetaHuman kütüphanesinin Windows PC'de **bir kez** ve **otomatik** olarak nasıl dışa aktarıldığını ve neyin çıktığını anlatır. Hedef: bu iş bittikten sonra Unreal'a hiç dönmemek. Güncel durum ve kararlar `docs/handoff.md` içinde; web'in beklediği dosya sözleşmesi `docs/specs/2026-10-20-metahuman-web-assets.md` içinde.

- **Durum (2026-10-21 akşam):** tüm işler bitti. Fab kıyafetlerinin 20/20 birimi dışa aktarıldı. Açık kalan tek dönüştürme işi KhaosMDF255, 322 ve 503'ün UDIM atlasları.
- Araştırma tarihi 2026-10-20, UE **5.8.4**. Kaynaklar en altta.
- Sayılar 2026-10-21 akşamı arşivden salt okunur ölçüldü, kürasyon silmesinden sonra (`raw/pruned.json`: 115 id).

## Ne dışa aktarıldı

| Parça | Kaynak | Çıktı | Ham arşivde |
|---|---|---|---|
| Hazır yüzler | `/MetaHumanCharacter/Optional/Presets` | DCC Export: `head.dna`, `body.dna`, 2K PNG haritalar, `ExportManifest.json`; ayrıca tam çözünürlüklü kaynak dokular ve `settings.json` | 29 preset. Yüz 8K, gövde 4K: 8K gövde isteği Epic tarafında "Server Error" veriyor |
| ARKit 52 eşlemesi | `PA_MetaHuman_ARKit_Mapping` + `AS_MetaHuman_ARKit_Mapping` | `arkit/arkit_mapping.json` | 66 poz → 274 `CTRL_expressions_*` kontrolü |
| Groom kartları | `Optional/Grooms/GroomAssets/<slot>/<stil>/` | Kart mesh LOD'ları, atlaslar, `cards.json` | 95 birim: Hair 38, Eyebrows 18, Beards 16, Mustaches 16, Eyelashes 6, Peachfuzz 1; ayrıca `groom_head` ve `eyelash_textures` |
| Kıyafet | `WI_DefaultGarment` + Fab `.mhpkg` | Cinsiyetin nötr vücuduna oturtulmuş SkeletalMesh: GLB (dönüştürücü girdisi) + FBX, materyal parametreleri, dokular | Cinsiyet başına 47 öğe + taban vücut: DefaultGarment, 36 Epic `OA_*`, 10 Fab |
| Fab paketleri | `MetaHumanArchive/fab/*.mhpkg` | Projeye içe aktarma kaydı | 31 paket: 27 `oa_*`, 4 `khaosmdf*` |
| Vücut tabanı | Parametrik vücut (`get_body_constraints`) | Her varyant için body DNA + `bodies.json` | 2 cinsiyet × 15 varyant (`neutral` + 7 slider × min/max) |
| Statik dokular | Göz, diş, kirpik, mikro normal, makyaj/çil maskeleri, ışık cubemap'leri, referans mesh'ler | PNG, TGA, EXR, HDR, GLB/FBX + JSON ayarlar | `raw/statics/` |
| Materyaller | MaterialInstance zinciri ve parametreleri | JSON | Parametreler var, düğüm grafiği boş |
| Işık | `LightingEnvironments` seviyeleri | Işık aktörleri, sky, post-process (JSON) | 9 sahne |
| Animasyon | `TemplateAnimations`, `UEFNAnimPreset` | Gövde: kare başına kemik dönüşümü; yüz: kontrol eğrileri; FBX yedek | `Expression_Loops`, `Facial_Poses`, `Technical_Loops`, `Locomotion` |
| Gardırop | Groom, kıyafet ve Fab öğeleri | Instance parametre tanımları (ad, tip, varsayılan) | `raw/wardrobe/` |

- **Vampire atlandı:** eski tip BP MetaHuman (DNA asset + legacy dokular). `characters` işi okuyamıyor; kullanıcı kararı.
- **Konuşma jestleri** Unreal'dan değil, ücretsiz FBX paketlerinden gelir (`web/scripts/retarget-fbx.mjs`). Kaynaklar arşivin `gestures/` ve `fab_anims/` klasörlerinde; ayrıntı `docs/handoff.md`.

## Ön koşullar (kurulumda kullanılanlar)

1. UE 5.8.4, **MetaHuman Creator Temel Verileri** kurulu.
2. Proje: `C:\Users\Asus\Documents\Unreal Projects\AISimsExport\AISimsExport.uproject` (Blank, C++ yok).
3. Eklentiler: **MetaHuman Creator**, **Python Editor Script Plugin**, **Editor Scripting Utilities**, **glTF Exporter**. Remote Execution projede açık ama hiçbir iş onu kullanmıyor.
4. Editörde **Epic hesabıyla oturum açık** olmalı. Doku indirme ve auto-rig "MetaHuman Cloud" servisidir. Giriş yeniden açılışta korunuyor, bu yüzden her iş ayrı editör sürecinde koşar.

## Arşiv yapısı ve boyutlar

Arşiv repoda değil, PC'de durur (`MH_ARCHIVE`, varsayılan `~/MetaHumanArchive`, yani `C:\Users\Asus\MetaHumanArchive`). Mac'e aynı yapıyla `~/MetaHumanArchive` olarak gider. Boyutlar `du -sh` ile:

```
MetaHumanArchive/
  raw/          45 GB   Unreal output; each unit has done.json (files, sizes, sha256)
    characters/   25 GB   <preset>/dcc, dcc_makeup, textures, settings.json
    outfits/      14 GB   <female|male>/<WI_item>/ and the base body unit
    statics/      3.0 GB
    grooms/       2.8 GB  <Slot>/<style>/, groom_head/, eyelash_textures/
    animations/   267 MB
    bodies/       131 MB  <female|male>/<variant>/, bodies.json
    arkit/, materials/, lighting/, wardrobe/, fab_import/   < 3 MB together
    inventory.json, characters_genders.json, pruned.json
  web/          3.0 GB  converter output, served as /assets/mh (see below)
  fab/          16 GB   Fab .mhpkg packages, Unreal only, not transferred by default
  fab_anims/    140 MB  free Fab animation FBX sources and LICENSES.md
  gestures/     216 MB  Mocap.in and ActorCore FBX sources for the talk gestures
  logs/         1.3 MB  <job>-<timestamp>.jsonl progress, <job>-<timestamp>-result.json
  build/        1.4 MB  converter caches and stamps, similar.json (curation pre-pass); not transferred
  crashed.json          outfit bakes the editor died in; skipped on the next run (now empty)
```

- Ayrı bir küçültülmüş (`slim/`) kopya yok. Dokular dönüştürücüde küçülür: yüz 4K, gövde ve diğerleri 2K, KTX2.
- Mac'e aktarım LAN üzerinden: `asset-pipeline serve-slim` (PC) + `pipeline/scripts/fetch_slim.py` (Mac). Varsayılan klasörler `web`, `raw`, `fab_anims`, `gestures`, `logs`; toplam ~48 GB. Komutlar `docs/handoff.md`'de.

## Web çıktısı (`MetaHumanArchive/web/`)

Manifest v2 (`manifest.json`, `generatedAt` 2026-10-21T13:57Z, zod şeması `web/src/lib/assets/manifest.ts`):

| Kategori | Sayı | Ayrıntı |
|---|---|---|
| `faces` | 20 | 10 kadın, 10 erkek. Elenenler: Bo, Bruce, Grace, Jorge, Lani, Lorenzo, Orlando, Sook-ja, Walter |
| `skins` | 29 | Her preset'in cildi her yüze giyilebilir |
| `bodies` | 2 | Cinsiyet başına 7 slider. Kadın: slim/average/athletic/curvy; erkek: slim/average/athletic |
| `grooms` | 88 | hair 38, eyebrows 18, beard 16, mustache 16. 79 kartlı, 9 boyalı (head-UV haritası). Uyum: 37 unisex, 40 erkek, 11 kadın |
| `outfits` | 37 | top 18, bottom 8, shoes 9, full 2. Hepsinde kadın + erkek GLB; 31'inde tint preset; 34 unisex, 3 yalnız kadın. 10 Fab öğesi henüz yok |
| `irises` | 29 | |
| `animations` | 14 | 10 gövde (2 talk, 8 idle), 4 yüz (3 ifade, 1 idle) |
| `lighting` | 8 | studio, portrait, fireside, moonlight, red_lantern, split, texture_booth, tungsten |

- **Klasör boyutları:** skins 1.7 GB, grooms 619 MB, outfits 367 MB, faces 211 MB, irises 128 MB, bodies 7.1 MB, animations 5.8 MB, shared 2.5 MB, lighting 36 KB, manifest 224 KB.
- **Dosya sayıları:** 185 GLB, 1322 KTX2, 145 WebP küçük resim.
- `curation.json`: 191 gizli id, 2 ön eleme önerisi (`auto`).
- `READY.txt`: dönüştürücünün yazdığı GLB listesi (boyut, morph ve eklem sayısı).

## Çalıştırma modeli

- Betikler `pipeline/unreal/` altında. Unreal'ın gömülü Python'unda çalışırlar (`import unreal`). Saf yardımcılar (`archive.py`, `udim.py` gibi) `unreal`'a bağımlı değildir ve pytest ile test edilir.
- Başlatıcı, `pipeline/` içinde:

  ```bash
  uv run asset-pipeline ue <job> [--args '<JSON>'] [--keep-open] [--until-done]
  ```

  - Editörü `UnrealEditor.exe <proje> -ExecutePythonScript=pipeline/unreal/run_job.py -nosplash` ile açar. İş adı ve seçenekler ortam değişkenleriyle geçer (`MH_JOB`, `MH_JOB_ARGS`, `MH_ARCHIVE`, `MH_RESULT`, `MH_QUIT`).
  - Yollar: `UE_ROOT` (varsayılan `C:\Program Files\Epic Games\UE_5.8`), `UE_PROJECT`, `MH_ARCHIVE`.
  - `--keep-open` editörü açık bırakır. `--until-done`, iş ertelenen birim bildirdikçe editörü yeniden açar (`limit` seçeneğiyle kullanılır).
  - İlerleme `logs/<job>-<timestamp>.jsonl`'a satır satır, sonuç `logs/<job>-<timestamp>-result.json`'a yazılır.
- **Kaldığı yerden devam:** her birim önce `<ad>.partial` klasörüne yazılır. `done.json` (dosya listesi, boyut, sha256) yazılınca son adına taşınır. Yeniden çalıştırma tamamlananları atlar; `force` seçeneği yeniden yapar. Bulut hatası birimi başarısız işaretler, işi durdurmaz.

### İşler (`pipeline/unreal/mh_export/jobs.py`)

| İş | Ne yapar | Seçenekler (`--args`) |
|---|---|---|
| `inventory` | `/MetaHumanCharacter` altındaki her asset'i sınıfına göre sayar. Önce asset registry eşzamanlı taranır; Optional içerik açılışta indekslenmiyor | |
| `arkit` | ARKit 52 → rig kontrol eşlemesini döker. Eğriler `AnimationLibrary` ile okunur; FBX dışa aktarma boş çıkıyor | |
| `characters` | Preset kopyası, doku çözünürlüğü, auto-rig (Joints + Blend Shapes), doku indirme, makyajsız ve makyajlı DCC Export, tam çözünürlüklü kaynak dokular, `settings.json` | `only`, `face` (varsayılan `res8k`), `body` (`res4k`), `fab`, `limit`, `force` |
| `bodies` | Parametrik vücuttan cinsiyet başına nötr vücut ve her slider'ın alt/üst ucunu çözer, body DNA yazar | `genders`, `force` |
| `grooms` | Her groom'un kart mesh'lerini, atlaslarını ve `cards.json`'unu yazar; groom kafasını da | `slots`, `only`, `force` |
| `outfits` | Her cinsiyet için taban karakteri bir kez rig'ler, nötr vücuda ayarlar; her öğeyi "Outfits" slotuna koyup karakteri derler ve oturan kıyafeti GLB + FBX olarak, materyal ve dokularıyla yazar. Bake boyutu sabit 4096; çöken bake `crashed.json`'a girer | `genders`, `only`, `limit`, `force` |
| `wardrobe` | Gardırop öğelerinin instance parametrelerini, öğeyi bir preset kopyasına ekleyip okur | `only`, `force` |
| `fab_import` | `.mhpkg` paketlerini etkileşimsiz `AssetImportTask` ile projeye alır; oluşan asset'leri kaydeder | `dir`, `force` |
| `statics` | Materyal ve rig'lerin kullandığı tüm dokular ve referans mesh'ler | `only`, `force` |
| `materials` | MaterialInstance parent zinciri ve parametreleri; temel materyallerin ifade grafiği | `force` |
| `lighting` | `LightingEnvironments` seviyelerindeki ışık, sky light, post-process ve arka plan aktörleri | `force` |
| `animations` | Gövde kliplerini kare başına kemik dönüşümü, yüz kliplerini kontrol eğrisi olarak örnekler; FBX yedek | `only`, `force` |
| `probe` | Geçici bir keşif betiğini editörde çalıştırır ve çıktısını tutar (API keşfi) | `script` (`.py` yolu) |

## Nasıl yapıldı

1. **Envanter ve ARKit:** 29 preset, 66 poz, 274 kontrol. MouthClose pozu yok; `LipsTogether = SafeDivide(MouthClose, JawOpen)` kuralı JSON'a not edilir.
2. **Tek karakter testi (Ada):** 860 MB, 11 dk. DCC haritaları 2K'ya pişmiş geliyor; 8K kaynaklar materyal dışa aktarmasından alınıyor.
3. **Uçtan uca dönüşüm:** Blender yerine OpenRigLogic (MIT) Python bağlamaları kullanıldı (`pipeline/scripts/build_openriglogic.py`). DNA okunur, ARKit pozları RigLogic'te değerlendirilir ve morph olarak yazılır; 15 viseme kontrol uzayında ARKit kombinasyonlarından üretilir.
4. **Toplu dışa aktarma:** gece boyunca tek editörle sıralı zincir; RAM ikinci editöre yetmedi.
5. **Fab kıyafetleri:** `fab_import` → `outfits`. KhaosMDF322'nin UDIM dokusu 24576 px bildiriyor, otomatik bake boyutu editörü çökertiyordu; bake sabit 4096'ya alındı (`dfe26c3`).
6. **Dönüştürme:** `asset-pipeline mh-convert --all` (artımlı). Çıktı `web/`, ayrıntı `docs/specs/2026-10-20-metahuman-web-assets.md`.

## Windows'tan ayrılmadan önce kontrol listesi

- [x] `inventory.json` ve 29 preset için `done.json`
- [x] `arkit_mapping.json`: 66 poz, 274 kontrol
- [x] Yüzler ARKit 52 + 15 viseme ile glTF'e çevrildi ve tarayıcıda canlı lip-sync ile doğrulandı
- [x] Tüm groom'lar: kart mesh'leri, atlaslar, `cards.json`; groom kafası
- [x] Vücut tabanı (2 × 15 DNA) ve her cinsiyet için kıyafetler (Fab dahil 20/20)
- [x] Her karakter için `settings.json`
- [ ] Fab UDIM kıyafetlerinin (KhaosMDF255, 322, 503) dönüşümü
- [ ] Cilt ve groom yeniden dönüştürme, ardından `/dev/thumbs` ile küçük resimler
- [ ] LAN aktarımı bitti ve Mac'te "all files verified"
- [x] Bu belge ve `handoff.md` gerçek sayılarla güncel

## Bilinen riskler

- **Bulut servisi:** doku ve rig istekleri Epic hesabı ister. Birimler bağımsız ve devam edebilir olduğu için tekrar denenir. Artık yeni bulut isteği gerekmiyor.
- **Saç oturtma** Unreal'da GroomBinding ile yapılır. Burada kartlar groom kafasında dışa aktarılır, dönüştürücü yüzey bağlamasıyla (`_bind_*`) her yüze oturtur. Tüm MetaHuman kafaları aynı topolojide olduğu için bu deterministik.
- **Kıyafet boyutlandırma** yalnızca Unreal'da. Kıyafetler cinsiyetin nötr vücudunda dışa aktarıldı; slider'lar gövdeden aktarılan morph'larla kıyafeti taşır. Mac'te yeni boyutlandırma yok.
- **UDIM dokular:** Fab Khaos kıyafetleri dokularını döşeme başına (`<stem>.<tile><ext>`, Mari numaralandırması: 1001 + u + 10 × v) yazar. Dönüştürücü desteği sürüyor.
- **Yüz + vücut birleşimi:** boyun dikişi verisiyle kafa kenarı gövdeye kaynaklanır.
- **glTF Exporter** morph adlarını `target_N` yapıyor ve tek LOD veriyor; yalnızca yedek yol.
- **EULA:** MetaHuman'lar AI eğitimi/testi için kullanılamaz. Seat lisansı şirket kararıyla gerekmiyor.

## Kaynaklar

- Python API ve örnek betikler (`Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Python/examples/`): https://dev.epicgames.com/documentation/metahuman/metahuman-creator-python-scripting-in-unreal-engine
- Export tool (DCC Export 5.8'de buraya taşındı): https://dev.epicgames.com/documentation/metahuman/metahuman-creator-export-tool-in-unreal-engine
- Montaj: https://dev.epicgames.com/documentation/metahuman/assembly
- 5.8 sürüm notları: https://dev.epicgames.com/documentation/metahuman/metahuman-5-8-release-notes-in-unreal-engine
- Doku kaynakları (2K/4K/8K): https://dev.epicgames.com/documentation/metahuman/skin-material-tools
- Saç ve kıyafet: https://dev.epicgames.com/documentation/metahuman/hair-and-clothing-tools
- Kıyafet boyutlandırma: https://dev.epicgames.com/documentation/metahuman/tailoring-your-own-wardrobe-items
- DNA ve rig tanımı: https://dev.epicgames.com/documentation/metahuman/metahuman-dna-rig-definition-and-rig-operation
- OpenRigLogic (MIT): https://github.com/EpicGames/OpenRigLogic
- Poly Hammer Character DNA (GPL-3.0, macOS arm64): https://github.com/poly-hammer/character-dna-addon
- ARKit eşleme bulguları: https://github.com/Dylanyz/ARKitRemap
- Referans hat (MIT, UE 5.7): https://github.com/creategamecharacters/metahuman-to-glb
- TalkingHead ARKit → viseme: https://github.com/met4citizen/TalkingHead
- Lisans: https://www.metahuman.com/en-US/license
