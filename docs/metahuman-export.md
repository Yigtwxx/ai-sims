# MetaHuman dışa aktarma planı (Windows, bir kez)

Bu belge, MetaHuman kütüphanesinin Windows PC'de **bir kez** ve **otomatik** olarak dışa aktarılmasını anlatır. Hedef: bu iş bittikten sonra Unreal'a hiç dönmemek. Kararlar `docs/handoff.md` içinde; burada nasıl yapılacağı ve neyin doğrulanacağı var.

Araştırma tarihi 2026-10-20, UE **5.8.4**. Kaynaklar en altta. `[doğrula]` etiketli maddeler kurulumdan sonra yerel motor dosyalarıyla kontrol edilecek.

## Ne dışa aktarılıyor

| Parça | Kaynak | Çıktı | Not |
|---|---|---|---|
| Hazır yüzler (~28-29) | `/MetaHumanCharacter/Optional/Presets` | Export tool → **DCC Export**: `head.dna`, `body.dna`, PNG dokular, JSON | 8K doku + auto-rig (**Joints + Blend Shapes**) bulut servisiyle üretilir |
| ARKit 52 eşlemesi | `PA_MetaHuman_ARKit_Mapping` + `AS_MetaHuman_ARKit_Mapping` | `arkit_mapping.json` | DNA'da yok; yalnızca Unreal'da. 66 poz → 274 `CTRL_expressions_*` kontrolü |
| Saç, kaş, kirpik, bıyık, sakal, ayva tüyü | `/MetaHumanCharacter/Optional/Grooms/GroomAssets/<slot>/<stil>/` | Kart StaticMesh LOD'ları FBX + atlaslar (PNG) + `cards.json` | DCC Export saç içermez. Kartlar groom kafasına göre; Mac'te kafaya wrap edilir |
| Groom kafası | `Optional/Grooms/GroomMesh/SKM_Groom_Head_Legacy01` | FBX | Mac'teki wrap'in kaynak mesh'i |
| Kıyafet | `Optional/Clothing/WI_DefaultGarment` + Fab | Montajdan çıkan, vücuda göre boyutlanmış SkeletalMesh → FBX + dokular | Boyutlandırma yalnızca Unreal'da; **her vücut varyantı için ayrı** dışa aktarılır |
| Vücut varyantları | Parametrik vücut (`set_body_constraints`) | Her varyant için `body.dna` | Mac'te vücut tipi + boy için morph tabanı |
| Malzeme ayarları | Her karakterin skin/eyes/makeup ayarı | `settings.json` | Mac'te shader parametreleri için |

## Ön koşullar

1. UE 5.8.4, **MetaHuman Creator Temel Verileri** kurulu.
2. Proje: `C:\Users\Asus\Documents\Unreal Projects\AISimsExport` (Blank, C++ yok).
3. Eklentiler: **MetaHuman Creator**, **Python Editor Script Plugin**, **glTF Exporter** (yedek yol için). Python ayarında **Enable Remote Execution** açık.
4. Editörde **Epic hesabıyla oturum açık** olmalı. Doku indirme ve auto-rig "MetaHuman Cloud" servisidir.
5. Disk: ham arşiv için 200+ GB. C: üzerinde ~416 GB boş.

## Arşiv yapısı

Ham arşiv repoda değil, PC'de durur (`MH_ARCHIVE`, varsayılan `C:\Users\Asus\MetaHumanArchive`). Küçültülmüş set Mac'e gider ve orada `pipeline/source/metahuman/` altına konur (gitignore'da).

```
MetaHumanArchive/
  raw/
    inventory.json                 # every asset under /MetaHumanCharacter, by class
    arkit/arkit_mapping.json       # pose -> {control: value}, plus MouthClose rule
    characters/<preset>/
      dcc/                         # DCC Export output (DNA, PNG, ExportManifest.json)
      settings.json                # skin/eyes/makeup/body settings as committed
      done.json                    # resume marker: file list + sizes + sha256
    bodies/<variant>/...
    grooms/<slot>/<style>/
      *_LOD<n>.fbx, *_CardsAtlas_*.png, cards.json
    groom_head/SKM_Groom_Head_Legacy01.fbx
    outfits/<item>/<body>/...
  slim/                            # web-ready reduced copy (see "Küçültme")
  logs/<job>-<timestamp>.jsonl
```

## Çalıştırma modeli

- Betikler `pipeline/unreal/` altında. Unreal'ın gömülü Python'unda çalışırlar (`import unreal`). Saf yardımcılar `unreal`'a bağımlı değildir ve pytest ile test edilir.
- **Kısa işler** (envanter, API keşfi): açık editöre Remote Execution ile gönderilir.
- **Uzun işler** (toplu dışa aktarma): `UnrealEditor.exe <proje> -ExecutePythonScript=<betik>` ile tam editörde çalışır. İlerleme `logs/*.jsonl` dosyasına satır satır yazılır; bitince editör kapanır.
- **Kaldığı yerden devam:** her birim (karakter, groom, kıyafet) bitince `done.json` yazar. Yeniden çalıştırma tamamlananları atlar. Bulut hatası birimi başarısız işaretler, işi durdurmaz.

## Aşamalar

0. **Kurulum:** proje, eklentiler, Remote Execution, Epic oturumu.
1. **Envanter:** `/MetaHumanCharacter` altındaki her asset sınıfına göre sayılır. Önce `scan_paths_synchronous` çağrılır; Optional içerik açılışta indekslenmiyor. Gerçek preset, groom ve kıyafet sayıları buradan gelir.
2. **ARKit eşlemesi:** `AS_MetaHuman_ARKit_Mapping`'deki her float eğri okunur (kare i = poz i). Poz adları `PA_MetaHuman_ARKit_Mapping`'den alınır. MouthClose pozu yok; `LipsTogether = SafeDivide(MouthClose, JawOpen)` kuralı JSON'a not edilir. FBX ile dışa aktarma boş çıkıyor, kullanılmaz.
3. **Tek karakter testi:**
   1. Preset kopyalanır: `duplicate_asset`, Epic'te "preset uygula" çağrısı yok.
   2. `request_texture_sources` ile 8K dokular indirilir (`blocking=True`).
   3. `request_auto_rigging` çalışır (`MetaHumanRigType.JOINTS_AND_BLENDSHAPES`, `blocking=True`).
   4. `MetaHumanCharacterExportBlueprintLibrary.export_dcc` çağrılır (zip kapalı, makeup bake kapalı).
   5. Dosya listesi ve boyutu ölçülür; toplam boyut tahmini buna göre güncellenir.
4. **Uçtan uca dönüşüm testi (bu PC'de):**
   1. Blender (Character DNA eklentisinin desteklediği sürüm) + Poly Hammer **Character DNA** kurulur.
   2. `head.dna` okunur. ARKit eşlemesindeki her poz için RigLogic kontrolleri ayarlanır, değerlendirilir ve sonuç shape key olarak kaydedilir.
   3. Oculus 15 viseme'ler ARKit kombinasyonlarından ve kontrol uzayında üretilir.
   4. glTF yazılır ve `gltf-transform validate` hatasız geçer.
   5. Tarayıcıda açılıp yüz, göz, dişler ve dudak senkronu gözle kontrol edilir.
   - **Bu adım geçmeden toplu dışa aktarma başlamaz.**
5. **Toplu dışa aktarma** (gece boyu, devam edebilir):
   - Tüm preset'ler.
   - Groom kartları ve atlasları, groom kafası.
   - Vücut varyantları ve her vücut için kıyafetler.
   - Fab kıyafetleri (eklendiğinde).
6. **Doğrulama:** envanterdeki her birim için `done.json` var, dosya sayıları ve boyutları beklenen aralıkta, rastgele 3 karakter Mac yoluyla tekrar çevrilir.
7. **Küçültme** (bu PC'de, ham arşiv yerinde kalır):
   - Yalnızca web'in kullandığı haritalar alınır.
   - Yüz haritaları 8K kalır; vücut ve ikincil haritalar 4K'ya iner.
   - Kayıpsız PNG'ler yüksek kaliteli sıkıştırılmış formata çevrilir. Renk ve veri haritaları için ayrı ayar kullanılır: normal ve roughness gibi haritalar sRGB değildir.
   - DNA ve JSON aynen kopyalanır.
8. **Mac'e taşıma:** `slim/` → USB disk → Mac'te `pipeline/source/metahuman/`.

## Windows'tan ayrılmadan önce kontrol listesi

- [ ] `inventory.json` ve tüm preset'ler için `done.json`
- [ ] `arkit_mapping.json`: 66 poz, kontrol adları DNA'daki raw control adlarıyla eşleşiyor
- [ ] En az bir yüz bu PC'de ARKit 52 + 15 viseme ile glTF'e çevrildi ve tarayıcıda doğru göründü
- [ ] Tüm groom'lar: her LOD için kart FBX + atlaslar + `cards.json` (layout, `bInvertUV`, sRGB, sıkıştırma ayarı)
- [ ] Groom kafası FBX
- [ ] Vücut varyantları ve her vücut için kıyafet
- [ ] Her karakter için `settings.json`
- [ ] `slim/` üretildi, boyutu Mac'teki boş yere sığıyor
- [ ] Bu belge ve `handoff.md` güncel, gerçek sayılarla

## Bilinen riskler

- **Bulut servisi:** doku ve rig istekleri Epic hesabı ister; kota veya hata olabilir. Birimler bağımsız ve devam edebilir olduğu için tekrar denenir.
- **Saç oturtma** yalnızca Unreal'da (GroomBinding, RBF). Kartlar groom kafasında dışa aktarılır; Mac'te hedef kafaya wrap edilir. Tüm MetaHuman kafaları aynı topolojide olduğu için bu deterministik bir işlem.
- **Kıyafet boyutlandırma** yalnızca Unreal'da. Her vücut varyantı için montaj yapılıp dışa aktarılır; Mac'te yeniden boyutlandırma yok.
- **Atlas kanal düzeni** (coverage hangi kanalda) doğrulanmadı. `cards.json` texture ayarlarını kaydeder; Mac'te ilk saçta kontrol edilir.
- **Yüz + vücut birleşimi:** farklı preset yüzü farklı vücut varyantıyla birleşince boyun dikişi kayabilir. Mac'te boyun sınır vertex'leri vücuda sabitlenir.
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
