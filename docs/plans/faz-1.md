# Faz 1 — Temel (~30 sa)

> Kaynak: `docs/todo.md` "Sıra" tablosu, Faz 1 (1a → 1b → 1c → 1d). Kurallar o dosyanın "Çalışma kuralları" bölümünde; burada tekrar edilmez.
> Her adım tek başına biter: doğrulama, commit, push. Yarım adım push'lanmaz. Oturum kesilirse yenisi ilk açık kutudan devam eder.
> Süreler saat. "Tahmin" plan anındaki kaba tahmin, "Gerçek" adım bitince yazılır.

**Hedef:** 4 yeni yüz ve 5 yeni saç sahnede; 3 saç silinmiş; Blender'dan arşiv birimine giden kıyafet yolu kalem etekle uçtan uca çalışıyor; kıyafet ve saç oturma hataları ölçülüp düzeltilmiş.

**Mimari:** Unreal işleri (`asset-pipeline ue ...`) arka planda koşar, aynı anda tek editör. Dönüştürücü (`mh-convert`) arşivin `web/` klasörünü yazar, site R2'den okur (`node scripts/r2-sync.mjs <klasör>`). Kıyafet yolu Unreal'ı atlar: Blender headless → `garment-pack` → `raw/outfits/<cinsiyet>/WI_AS_<Ad>/` → `mh-convert --outfits`.

**Araçlar:** UE 5.8 (`C:\Program Files\Epic Games\UE_5.8`, proje `AISimsExport`), uv + Python 3.13, KTX-Software 4.4.2, Blender (1c'de kurulur), Next.js dev (`/dev/stage`, `/dev/thumbs`, `/[locale]/curate`).

## Genel kısıtlar

- Yalnız $0 varlık; lisans ve fiyat Fab API'sinden (`/i/listings/<id>/prices-infos`).
- Arşiv kökü `C:\Users\Asus\MetaHumanArchive`. `fab\` klasörüne yalnız `.mhpkg` konur: `mh-prune --unused-packages` oradaki her girdiyi paket sayar. Ek zip'ler `fab_extras\` altında.
- Silme (`mh-prune --apply`) kullanıcı onayıyla; plan özeti kullanıcıya gönderilir.
- Doğrulama: `pnpm typecheck && pnpm lint && pnpm test`; `uv run ruff check && uv run ruff format --check && uv run pytest`; üretilen GLB'ler `gltf-transform validate` temiz.
- Her alt faz sonunda `docs/todo.md` kutusu `[x]` + tarih + commit, `docs/handoff.md` "Durum"a bir iki satır.

---

## 1a — Fab ve yüzler (A1 → A2), tahmin ~6

- [x] **1a.1 Fab indirmeleri (A1).** Tahmin 1 · Gerçek 0.3
  - 9 ilan Chrome'da (Fab oturumu açık) $0 lisansla indirildi: Mason, Seo, Frey ve Hairstyle Male 11'de Personal; Skotukeda, MessyWavy, Nomad Wave, PonytailGroom tek ücretsiz lisans; Long High Ponytail zaten kütüphanedeydi. UE 5.8 sürümü olan pakette 5.8 seçildi.
  - Paketler `fab\`: `skotukeda`, `mason`, `mhc_seo`, `mhc_frey`, `hair_l_highponytail`, `hair_f_ponytail_messywavy_01`, `sc_hairstyle_male_11`, `gb_nomadwaveundercut`, `gb_ponytail` (`.mhpkg`, toplam ~2.2 GB).
  - Ek dosyalar `fab_extras\`: `hair_f_ponytail_messy_wavy_01.zip` (MessyWavy elle yapılmış kartlar olabilir, A3), `sc_hairstyle_male_11.zip`, `gr_nomadwaveundercut.zip`.
- [x] **1a.2 İçe aktarma.** Tahmin 0.5 · Gerçek 0.2 (9 paket ~1 dk; karakter adları Skotukeda, Mason, MHC_Seo, MHC_Frey)
  - `cd pipeline && uv run asset-pipeline ue fab_import` (arka planda). Yalnız yeni 9 paketi alır.
  - Kontrol: her yeni paketin `raw/fab_import/<paket>/import.json`'u var. "created no assets" çıkarsa sebep UE sürümü olabilir (Skotukeda yalnız 5.7 listeliyor): o paket için sonucu "Kullanıcıya sorular"a yaz, diğerleriyle devam et.
- [x] **1a.3 Yüzleri dışa aktar.** Tahmin 1.5 (çoğu bekleme) · Gerçek 0.9 (4K'da yüz başına 5.5-6.5 dk; cinsiyetler Skotukeda 0.76 K, Mason −1.27 E, Seo 0.40 K, Frey −0.81 E)
  - Karakter adları: dört yüz paketinin `import.json` `created` alanındaki `MetaHumanCharacter` sınıflı asset'in son adı.
  - `uv run asset-pipeline ue characters --args '{"only": ["Skotukeda", "Mason", "MHC_Seo", "MHC_Frey"], "face": "res4k"}'`. `only` şart. 8K ile ilk deneme Mason'da belleği tıkadı ve Claude Code işi durdurdu; kullanıcı kararıyla yüz kaynağı 4K (web yüzü zaten 4096 px).
  - Ardından `uv run asset-pipeline ue probe --args '{"script": "C:/Users/Asus/Desktop/ai-sims/pipeline/unreal/probes/preset_genders.py"}'` (yol mutlak olmalı: editör başka klasörde çalışıyor, göreli yol `FileNotFoundError` verdi); dört ad `raw/characters_genders.json`'da olmalı.
  - Beklerken (editör meşgul): 1b.2'nin kod okuması ana oturumda yapılır.
- [x] **1a.4 Dönüştür ve manifest.** Tahmin 1 · Gerçek 0.4 (12 birim ~18 dk, her yüz 67 morph; manifest 23 yüz, zod temiz; head GLB'ler validate'te hatasız, Ada'yla aynı tanjant uyarısı)
  - `uv run asset-pipeline mh-convert --character <ad1> --character <ad2> --character <ad3> --character <ad4> --manifest`.
  - `gltf-transform validate` her yeni `faces/<ad>/*.glb` ve gövde/cilt GLB'si için.
  - Manifest'te 4 yüzün cinsiyeti beklenenle aynı: Skotukeda K, Mason E, Seo K, Frey E. Yanlışsa `characters_genders.json` değerine bak, eşik kuralı (`|değer| < 0.3` gövde şekli) handoff "Cinsiyet" maddesinde.
- [x] **1a.5 Sahnede kontrol, küçük resim, yayın.** Tahmin 2 · Gerçek 1.5 (R2 manifest 2026-10-27: 23 yüz, 25 kıyafet, 50 saç; yeni dosyalar herkese açık adreste 200)
  - Durum (2026-10-27): dört yüz `/dev/stage`'de tişört + kot + spor ayakkabıyla açılıyor; Skotukeda'da konuşurken ağız ve dişler sese göre oynuyor. Dönüştürücünün yazdığı küçük resimler Unreal önizlemesiydi (kel, gri), `/dev/thumbs`'ta yeniden çizildi. Yüz, cilt ve iris klasörleri R2'ye yükleniyor. **Manifest bekliyor:** içinde henüz düzeltilmemiş kalem etek var (1c.5).
  - **Mason'da yaka taşması:** kafa mesh'inin boyun ve göğüs parçası diğer erkeklerden ~3.5 cm önde (z 0.130, diğerleri ~0.095), paylaşılan gövdeye takılınca tişört ve kazak yakasından taşıyor. B5'e (1d) ilk vaka olarak yazıldı.
  - `pnpm db:start`, `pnpm dev`; `/dev/stage`'de her yeni yüz: idle, konuşma (`/api/tts` ile TR ve EN birer cümle), dudak senkronu ve göz kırpma; boyun dikişi; ekran görüntüsü.
  - `/dev/thumbs` ile 4 yüzün küçük resmi; oluşturucunun Yüz panelinde görünüyorlar.
  - `web/scripts/r2-sync.mjs` bugün yalnız klasör alıyor (`walk()` dosyada çöker); argüman dosyaysa doğrudan kuyruğa koyacak şekilde düzeltilir. Sonra `cd web && node scripts/r2-sync.mjs faces skins irises manifest.json` (yalnız değişenler; argümansız çağrı tüm ağacı yükler).
  - Sitede (https://ai-sims.pages.dev) yeni yüzlerden biri açılıyor.
  - `docs/todo.md` A1, A2 `[x]`; handoff "Durum"; `docs: ...` commit + push. Kullanıcıya telefondan 4 yüzün ekran görüntüsü.

## 1b — Saçlar (A3 → A3b), tahmin ~8

- [x] **1b.1 Paket düzenini oku.** Tahmin 1 · Gerçek ~1
  - `pipeline/unreal/probes/` altına bir probe: her yeni saç paketinin `/Game/Fab/<paket>/` altındaki `GroomAsset`, `GroomBindingAsset`, kart mesh'leri (`*_CardsMesh_Group<g>_LOD<n>`), doku ve malzeme yolları, bağımlılıkların öneki. Çıktı `raw/fab_grooms_layout.json`.
  - `fab_extras\*.zip` içerikleri listelenir (FBX kart var mı).
  - Sonuç (2026-10-27, `raw/fab_grooms_layout.json`, probe `unreal/probes/fab_grooms.py`):

    | Paket | Kartlar | Not |
    |---|---|---|
    | `hair_l_highponytail` | Epic düzeni: `CardsMesh_Group0/1_LOD0-4`, helmet LOD5-6, atlaslar | Yalnız klasör keşfi gerekiyor |
    | `sc_hairstyle_male_11` | Tek mesh `SC_Hairstyle_Male_11_LOD0` + `T_SC_Hairstyle_Male_11`, groom'da 1 kart girdisi | Ad kalıbı `CardsMesh` değil; dönüştürücü `CARD_MESH` regex'i genişler ya da ad eşlenir |
    | `hair_f_ponytail_messywavy_01` | Groom'da 5 kart girdisi ama pakette mesh yok; zip'te `LODs/Female_Adult_001_HairCard_LOD0-7.fbx`, `fiber_Tangent.tga`, `fiber_Attribue.png`, kafa ve scalp FBX | Kartlar zip'ten alınır (FBX → GLB, atlas zip'ten) |
    | `gb_nomadwaveundercut` | Yok (yalnız tel; zip'te `.abc`) | Kart üretilmeli |
    | `gb_ponytail` (PonytailGroom) | Yok (yalnız tel, zip yok) | Kart üretilmeli |

    Frey paketinin kendi saçı (`Middle_part`) da tel; kullanılmıyor. Kart üretimi (Hair Card Generator headless mi, yoksa telden kendi kart üreticimiz mi) 1b.2'nin başında karar verilir.
  - 1b.2 sırası: (A) `grooms.py` `/Game/Fab/<paket>/` altındaki groom'ları bulur (karakter paketleri hariç); stil adı wardrobe item'ın adı (`WI_` öneki atılır: `Hair_L_HighPonytail`, `SC_Hairstyle_Male_11`, `Hair_F_Ponytail_MessyWavy_01`, `NomadWaveUndercut`, `Ponytail`); binding ve WI paketin kendi klasöründen. (B) Dönüştürücü: `TEXTURE_ROLES` Epic'in `CardsAltas_Attribute` yazım hatasını da tanır. (C) MessyWavy: zip'teki kart FBX'leri Blender'la GLB'ye, `fiber_Tangent`/`fiber_Attribue` atlas rollerine. (D) Male 11'in tek mesh'i ve dokusu incelenir. (E) Nomad ve PonytailGroom: Hair Card Generator.
- [x] **1b.2 Keşif kodunu genişlet.** Tahmin 2.5 · Gerçek ~4.5 (kart üretimi dahil)
  - Kart üretimi bitti (2026-10-27, `bff8ccd`): `ue groom_cards` Hair Card Generator'ı Dataflow düğümleriyle pencere açmadan sürüyor (LOD başına iki değerlendirme: üretim, sonra mesh + atlas). Ponytail, Male 11 ve Nomad üretildi; MessyWavy'de sanatçının FBX kartları seçildi (üretilen sürüm kalın tutamlı). Dönüştürücü Fab saçını paketin kendi groom başına bağlıyor (ortak baştan 4-19 mm farklı; Ponytail kök p95 17.3 → 1.6 mm), root-UV atlası yoksa kafa derisi `density` haritasını kartlardan hesaplıyor. MessyWavy'nin tanjant atlası aslında Epic kodlamasında (önceki "G≈0 / 0.43" ölçümü yanlıştı).
  - Hair Card Generator'ın Python paketleri (torch cu124) projenin `Intermediate/PipInstall`'ında 4.9 GB; yeniden üretim için duruyor.
  - Durum (2026-10-27, `8ee8fbb`): (A) ve (B) bitti. `ue grooms` beş Fab stilini dışa aktardı; Long High Ponytail dönüştü (4.7 MB, LOD0 56k köşe), Seo'da önden ve yandan temiz, küçük resmi çizildi, R2'de (manifest bekliyor). Kalan dördünde kart atlası yok: Male 11'in tek kart mesh'i var ama doku slotları boş (pakettteki `T_SC_Hairstyle_Male_11` yalnız önizleme resmi); MessyWavy, Nomad ve Ponytail'de kart da yok. MessyWavy'nin zip'teki tanjant atlası Epic kodlamasından farklı (Epic G≈0, burada 0.43). Kart üretimi Hair Card Generator (UE 5.8, `Plugins/Experimental/HairCardGenerator`, torch + Dataflow; projede kapalı) ile, ayrı bir subagent işi.
  - Dönüştürücünün yazdığı saç ve yüz küçük resimleri Unreal önizlemesi; `/dev/thumbs`'ta tek tek "Render" ile değiştirilmeli ("Render missing only" onları var sayıyor).
  - `pipeline/unreal/mh_export/grooms.py`: `style_folders()` (:148) Epic'in `GroomAssets/<slot>/<style>` klasörüne ek olarak `/Game/Fab/<paket>/` altındaki groom'ları bulur; slot (`Hair`) ve stil adı paketten türetilir. `related_assets()` `PLUGIN_PREFIX` dışında paketin kendi klasörünü de alır.
  - Saf fonksiyonlar (yol → slot/stil eşlemesi, önek filtresi) editörsüz test edilebilir hale getirilir; testler `pipeline/tests/`.
  - Kartı olmayan pakete editörde Hair Card Generator; MessyWavy'nin zip'teki kartları FBX ise groom'un kart LOD'una atanır.
- [x] **1b.3 Dışa aktar ve dönüştür.** Tahmin 2 · Gerçek ~0.5 (1b.2'nin içinde)
  - `uv run asset-pipeline ue grooms --args '{"only": [<5 stil>]}'`.
  - `uv run asset-pipeline mh-convert --grooms --groom <stil> ... --manifest`; GLB validate.
  - Tek cinsiyete özgü saç `pipeline/src/asset_pipeline/mh/gender_compat.json`'a; etiketler (TR/EN) saçların etiket dosyasına.
- [x] **1b.4 Sahnede kontrol ve yayın.** Tahmin 1.5 · Gerçek ~2.5 (Nomad'ın boyalı fade'i dahil)
  - `/dev/stage`: 5 saç × en az 3 yüz (iki cinsiyet, kısa/uzun boyun) önden, yandan, arkadan; kafa derisi açıkta değil, kartlar kafaya girmiyor.
  - `/dev/thumbs`, `node scripts/r2-sync.mjs grooms`, manifest. Commit + push. A3 `[x]`.
  - Bitti (2026-10-28, `caec056`): **Nomad yayında.** Fab paketinin `.abc` tel dosyası (`fab_extras/gr_nomadwaveundercut.zip`) okunuyor (`mh/alembic.py`, kütüphanesiz Ogawa okuyucu). İki grup var: LongHair 34280 tel (2-8 cm), ShavedHair 37578 tel (2.5-14 mm). Tıraşlı gruptan üretilmiş 1122 kart atılıyor (karta en yakın tel grubu, %98.5 saflık), o teller ve uzun tellerin kökleri kafa UV'sine tel tel çiziliyor; uzun kartların yumuşak örtüsü de altına konuyor (`mh/strand_paint.py`). Manifest girdisinde hem `glb` hem `painted` var; web kodu değişmedi. Harita Epic'in buzz cut `baked`'iyle aynı yerleşimde (örtü payı 0.24 / 0.23). Victor (önden, arkadan) ve Seo'da (yandan) temiz; tepe girdabında tek küçük açık nokta kaldı. R2'de, manifest 51 saç.
  - Durum (2026-10-27): Ponytail, Male 11 ve MessyWavy yayında (R2 manifest 53 saç; GLB'ler validate'te temiz, küçük resimler yeniden çizildi). **Nomad tutuldu:** tıraşlı arka ve yanlar yamalı tutam ve yatay çizgi gibi görünüyor, tepe girdabında açık deri lekesi var. Web çıktısı silindi (manifest atlıyor); düzeltme subagent'ta: uzun üst kart kalır, kısa fade deriye boyanır. Bilinen küçük kusurlar: Ponytail'de önden alnın üstüne biraz saç düşüyor; Male 11'in paketteki eski kart mesh'i dışa aktarımda duruyor, dönüştürücü yok sayıyor.
- [x] **1b.5 Üç saçı kaldır (A3b).** Tahmin 1 · Gerçek ~0.3
  - `/[locale]/curate`'te gizle: `groom.hair.Hair_S_HairLoss`, `groom.hair.Hair_M_Layered`, `groom.hair.Hair_L_MessyClumps`.
  - `uv run asset-pipeline mh-prune` (deneme) → plan özeti kullanıcıya; onayla `mh-prune --apply --plan <özet>`.
  - `mh-convert --manifest`, `node scripts/r2-sync.mjs`. Bu saçları giyen kayıtlı karakter açılınca `reconcile.ts` saçı boşa düşürüyor (dev'de denenir). A3b `[x]`.

## 1c — Kalem etek, Blender yolu ve paketleyici (A4.0), tahmin ~10

> Ayrıntılı TDD planı (dosya yapısı, kod, testler) 1c'nin başında bu bölüme yazılır (`superpowers:writing-plans`): Blender kurulmadan ve bir Epic biriminin `outfit.json`'u okunmadan yazılırsa tahmin olur. 2-3 denemede sim ya da otomasyon yürümezse dur, nedeni `docs/todo.md` "Kullanıcıya sorular"a yaz, Unreal yolunu sor, beklerken Faz 2'ye geçme (faz kuralı) ama 1d'ye geç.

- [x] **1c.1 Keşif ve ayrıntılı plan.** Tahmin 1.5 · Gerçek 0.7
  - `winget install BlenderFoundation.Blender`; `blender --background --python-expr "import bpy; print(bpy.app.version)"`.
  - Oku: `pipeline/src/asset_pipeline/mh/outfits.py` docstring (adım 1-5), `_is_unit`, `OutfitUnit` (:200), `base_body_path`; `raw/outfits/female/WI_OA_Crewneckt/outfit.json`, `done.json`; `raw/outfits/female/body/SKM_OutfitBase_female_BodyMesh.glb`.
  - Bu bölümün altına 1c.2-1c.5 için dosya yapısı ve adım adım TDD planı.
  - Bulgular (2026-10-27, Faz 1a beklerken):
    - Blender 5.2.3 LTS (Python 3.13) taşınabilir zip'ten `C:\Users\Asus\tools\blender-5.2.3-windows-x64\blender.exe`, sha256 doğrulandı; winget kurulumu UAC istediği için kullanılmadı. Headless çalışıyor.
    - Epic birimi (`WI_OA_Crewneckt`): `OutfitBase_female_Outfits.glb` (UE 5.8.4 glTF, Y yukarı, metre, A-pozu; tek mesh, 342 eklemli skin, `TEXCOORD_0/1`, `TANGENT`), `outfit.json` (`gender`, `item`, `item_properties`, `materials`, `meshes`, `parameters`, `textures`), `done.json`, `textures/*.png`.
    - Dönüştürücü kıyafet GLB'sinden yalnız `POSITION`, indeksler, `NORMAL`, `TEXCOORD_0` ister; `JOINTS_*`/`WEIGHTS_*` isteğe bağlı (`_primitive`, `outfits.py:268`). Ağırlık ve morph'ları gövdeden kendisi aktarır. Blender skinsiz, transform'u uygulanmış tek mesh yazabilir.
    - `M_fabric_simpler` instance'ının okunan doku slotları `fabric_slots()` (`outfits.py:1293`): her zaman `normalmap`, `AO`, `Masks`, `CustomStitch`; diğerleri static switch'lere bağlı döşenen haritalar. Kalem etek için Crewneckt'in instance'ı şablon alınır; kıyafete özgü dört harita kalıp UV'sinde üretilir.
    - Taban gövde `SKM_OutfitBase_female_BodyMesh.glb`: 32334 köşe, kafasız, A-pozu, y 0-1.44 m.
- **Tasarım (1c.1 sonucu).** Geometri uv ortamında (numpy/scipy, pytest'li), Blender yalnız simülasyon ve GLB yazımı. Böylece kalıp ve yerleşim editörsüz test edilir; Blender betiği ince kalır.
  - `pipeline/src/asset_pipeline/garments/` (yeni paket):
    - `body.py`: taban gövde GLB'sini okur (`outfits._primitive` yolu), yükseklik başına kesit (iki bacak + kalça tek kesit, dışbükey zarf) ve çevre profili; bel, kalça, diz yüksekliği. Saf fonksiyon: `profile(positions, heights) -> list[Section]`.
    - `pattern.py`: `Panel` (2D dış çizgi, metre; adlı kenar parçaları), `triangulate(panel, edge) -> PanelMesh` (iç ızgara + kenar örnekleri, `scipy.spatial.Delaunay`, dışarı taşan üçgen elenir), `Seam` (iki panelin adlı kenarı, eşlenen köşe çiftleri), kalıp UV atlası (paneller sabit ölçekle 0-1'e dizilir).
    - `skirt.py`: kalem etek kalıbı gövde ölçüsünden: ön panel, iki arka yarım (orta arka dikiş, altta yırtmaç açık), bel bandı; bolluk (ease) parametre. Yerleşim: her panel kesit zarfının ilgili yayına sarılır (ön: yan dikişten yan dikişe, arka: yan dikişten orta arkaya), zarf bolluk kadar dışarıda.
    - `blender.py`: Blender'ı bulur (`$BLENDER`, yoksa `~/tools/blender-*/blender.exe`), `blender --background --factory-startup --python pipeline/blender/garment_sim.py -- <job.json>` çalıştırır.
    - `pack.py`: arşiv birimi: GLB (`OutfitBase_<cinsiyet>_Outfits.glb`), `outfit.json` (Crewneckt instance'ı şablon, ad `MI_AS_<Ad>`), `textures/` (döşenen Epic haritaları kopya + kıyafete özgü `Masks`, `AO`, `normalmap`, `CustomStitch` PIL ile kalıp UV'sinde: dikiş ve etek ucu çizgileri), `done.json` (dosya + sha256). `.partial` klasörde yazılır, sonda yeniden adlandırılır.
    - CLI `asset-pipeline garment --item AS_PencilSkirt --gender female [--keep-work]`: ölç → kalıp → yerleştir → `job.json` → Blender → paketle.
  - `pipeline/blender/garment_sim.py` (bpy, `unreal/` gibi pytest dışında): gövdeyi glTF'ten içe al, Collision; kumaş mesh'i `job.json`'dan kur (UV, pin grubu bel bandının üstü, dikiş çiftleri gevşek kenar), Cloth + Sewing, N kare sim, uygula, Solidify 2 mm (dışa), üçgenle, malzeme `MI_AS_<Ad>`, GLB yaz (Y yukarı, transform uygulanmış, skinsiz).
  - Testler `pipeline/tests/test_garments_*.py`: kesit profili (sentetik silindirde çevre 2πr), panel üçgenlemesi (alan korunur, kenar köşeleri sırada), dikiş eşlemesi (iki kenarda eşit köşe sayısı), sarma (yerleşen panel zarfın dışında, dikiş köşeleri ±1 mm çakışık), paket (`outfits._is_unit` true, `OutfitUnit.load().materials()` adı `MI_AS_PencilSkirt`, `done.json` hash'leri dosyalarla aynı).
- **Uygulamada değişen (2026-10-27):** paneller Delaunay'lı düz kalıp yerine gövde kesitine sarılmış düzenli ızgaralar (satır = yükseklik, sütun = çevre boyunca eşit yay). Dikişler Blender "Sewing" yerine ortak sütunla kaynaklı: paneller zaten dikiş yerinde buluşuyor, yay kuvveti gereksizdi. Kalıbın açılmış koordinatı (yay uzunluğu × meridyen uzunluğu) UV olur. Blender kumaşın dinlenme şekli olarak bu mesh'i alıyor; sim yerçekimi ve gövdeyle çarpışmayla oturtuyor. Kesit ölçüsünde kol kemikleri ayıklanıyor; ayak parmakları ("ringtoe" vb.) kol sayılmıyor.
- [x] **1c.2 Ölçü, kalıp ve yerleşim (uv tarafı).** Tahmin 3 · Gerçek 1
  - `garments/body.py`, `pattern.py`, `skirt.py` + `tests/test_garments_pattern.py`. Kadın gövdede bel 1.113, kalça 0.844, diz 0.483 m; 69 satır, 6639 köşe, deriden en az 2.9 mm. Yumuşatma hızlı değişen kesitte noktayı içeri çekebiliyordu (test yakaladı), büyütülmüş kesitin dışına geri itiliyor.
- [x] **1c.3 Blender simülasyonu.** Tahmin 3 · Gerçek 0.5
  - `pipeline/blender/garment_sim.py` + `garments/blender.py`. 40 kare 12 sn; kalça altında arka bacak arasına en çok 3.3 cm sarkıyor, etek ucu 8 mm iniyor, deriden en az 2.95 mm. Solidify 2 mm dışa; 13662 köşe.
- [x] **1c.4 Paketleyici ve CLI.** Tahmin 2 · Gerçek 0.7
  - `garments/pack.py`, `garments/cli.py` (`asset-pipeline garment --item AS_PencilSkirt`), `tests/test_garments_pack.py`. Uçtan uca 21 sn. Döşeme haritaları Crewneckt'ten, yalnız `fabric_slots()`'un örnekledikleri; döşeme ölçeği 1.48/0.99 m/UV. `DoPill` kapalı (takım kumaşı).
  - `mh-convert --outfits --outfit AS_PencilSkirt --manifest` 28 sn: kategori `bottom`, 3495 gövde köşesi gizli, 0.9 MB GLB + 3.2 MB harita; `gltf-transform validate` hatasız (Crewneckt'le aynı bilgi satırları).
- [x] **1c.5 Dönüştür, kontrol, yayın.** Tahmin 1.5 · Gerçek 2.5 (kalça düzeltmesi ve 48 kıyafetin yeniden dönüşümü dahil; R2'de)
  - Durum (2026-10-27): `/dev/stage`'e `body` seçici eklendi (nötr ve her kaydırıcının ±1 ucu). Ada'da nötr, idle ve konuşma temiz; arkada yırtmaç açılıyor, yırtılma yok; kilo ±1 temiz. **Kalça ±1 bozuk:** bacak arasını köprüleyen kumaş iç uyluk ve kasık derisinin morph'unu izliyor (+1'de ön ortada "Y" kat ve dikey kıvrım, −1'de kasıkta çukur ve etek ucunda çentik). Düzeltme dönüştürücünün aktarımında (A4.7 ile aynı aile).
  - Düzeldi (`3df9de4`, xhigh subagent): neden `build_transfer`'ın 32 komşu sınırıydı; bacak arasındaki kumaş (deriden 6-10 cm) her yanda tek uyluğu izliyordu. Bacak arasını köprüleyen kumaş artık iki bacağı kapsayan geniş bir Gauss'a karışıyor (`bridging`, `BodyFit.limbs`). Etekte en büyük morph gerilmesi %439 → %38, nötrde orta çizgi %62 → %27; tayt ve kot kasıkta en çok ~2 mm değişti, crop top ve ayakkabılar aynı. `OUTFITS_VERSION` v7: bütün kıyafetler yeniden dönüştürülüyor. Kalan: kalça −1'de eteğin önünde sol altta küçük gri leke (v6'da da vardı).
  - `mh-convert --outfits --outfit AS_PencilSkirt --manifest`, validate; `outfit_labels.json` (TR/EN), `gender_compat.json` (yalnız kadın), `outfit_tints.json` (lacivert, antrasit, siyah, deve tüyü, bej).
  - `/dev/stage`: nötr ve her slider ucu × idle ve talk; kumaş deriye girmiyor, cilt görünmüyor, yırtılmıyor, renk presetleri çalışıyor.
  - `/dev/thumbs`, `node scripts/r2-sync.mjs outfits`, commit + push; kullanıcıya önden ve yandan ekran görüntüsü. A4.0 `[x]`.

## 1d — Oturma hataları (B5), tahmin ~6 · gerçek ~12

> `superpowers:systematic-debugging`: önce kanıt, sonra düzeltme. Düzeltmeler dönüştürücüde kalır ki sonraki kıyafetlere de geçsin.

- [x] **1d.1 Kanıt matrisi.** Tahmin 2 · Gerçek ~1.5 (subagent ~67 dk)
  - `asset-pipeline mh-fit-audit` (`b6de10f`, `pipeline/src/asset_pipeline/mh/fit_audit.py`): görünür her kıyafet × iki gövde × nötr, her kaydırıcı ucu, presetler ve birkaç birleşik uç × dinlenme pozu + idle ve talk kareleri; ölçülenler: kumaştan taşan deri, görünen deriye batan kumaş, çaprazlanan katmanlar, gizli derinin açıkta kaldığı delikler, yakadan taşan kafa derisi. Saçta her saç × birkaç yüz: kafaya giren kart köşesi ve kafadan >5 mm uzak kök. Runtime'ın dikiş snap'i, yaka itmesi ve yeniden skinleme numpy'a taşındı. 1049 kıyafet + 304 saç vakası 6 dk 17 sn. Rapor `<arşiv>/build/fit/report.json`.
  - Sınır: pozlu kareler yalnız nötr kaydırıcıda; üst+alt birlikte ölçülmüyor; uzun saçın omuza girmesi ölçülmüyor; dikiş snap'i yaklaşık (Mason'ın pozdaki taşmasını gerçekte olduğundan küçük ölçüyor, aşağıda).
- [x] **1d.2 Kıyafet düzeltmesi.** Tahmin 2 · Gerçek ~7
  - **Eteğin kara noktaları** (`edc5198`): AO değilmiş, AO'suz (battery) da vardı. Gövdenin gölge geçişi `bodyHidden` maskesini uygulamıyordu; kıyafet altındaki gizli deri gölge düşürüyor, pozda deri altına birkaç mm giren kumaş o gölgede kapkara görünüyordu. Gövde artık gölgesini de maskeyle çiziyor.
  - **Yakadan taşan alt boyun** (`5f7eb94`, `e497f3a`): her preset kafa paylaşılan gövdenin boynunu 1-4 cm ıskalıyor, dikiş ofseti ~2 cm'lik 4 halkada sönüyordu. Ofset artık ilk 3 cm'de tam, 9 cm'de sıfır (yüz dikişten en az 11.6 cm uzakta). Yaka itmesi kafa tarafından da bakıyor: kafa derisi kumaştan sık olduğu için iki kumaş köşesinin arasından taşan deri hiçbir kumaş köşesinin "en yakını" olmuyor ve itme istemiyordu (Mason dinlenmede 28 köşe). Boşluk 6 mm, erişim 5 cm. Dikiş halkaları sönümle birlikte gövde derisine karışıyor (`blendRingSkin`), alt boyun pozda tişörtle birlikte dönüyor.
  - **Tene yapışık kumaşta benek** (`e497f3a`): kumaş bir derinlik adımı öne çiziliyor (polygon offset); Clara body askısı kilo +1'de temiz.
  - **Bacak ağzında mat bant** (`373806d`): gövde SRMF'inde gömülü iç çamaşırı (pürüzlülük 1, speküler 0.5) doldurulmamıştı; albedo gibi çevredeki deriden dolduruluyor, 24 cilt yeniden üretildi (skin-v7).
  - `mh-prune` 4 Fab yüzünün paketini (1.9 GB) "kullanılmıyor" sayıyordu (`c0afe0e`).
  - Denetim (önce → sonra, `build/fit/report_final.json`): yakadan taşan kafa derisi 19.279 → 1.015 köşe, en derin 36.7 → 13.6 mm; Mason + tişört her durumda 0. Gövde ölçüleri aynı kaldı (kumaştan taşan deri 3.098 → 3.117).
  - Denetimin geri kalan "delik" ve "katman" bulguları görsel kontrolde görünmüyor: kolun gövdeye bakan alt yüzü, kayışın iç yüzleri gibi gizli yerler (kapüşonlu kilo +1, Street_Wear_01 talk, flipflops kas +1, techwear ve Clara kilo +1 bakıldı).
  - Denenip geri alınanlar: kumaşın örttüğü kafa derisini gizlemek (yakada kara delik açtı); kol ağzı payını torsoya bakan kenarda korumak (`548e255`, `2d471c2` ile geri alındı: hedeflediği izi gidermedi, kol ve ayakkabı ağzında görünen deri altına batan kumaşı %15 artırdı).
  - Bilinen küçük kusur: tişört kol ağzının koltuk altına bakan kenarında pozda 1-2 piksellik arka plan izi.
- [x] **1d.3 Saç düzeltmesi.** Tahmin 1 · Gerçek ~3 (subagent ~2.3 sa dahil)
  - Kart kaynaklı yoğunlukta kartlar arası 8 mm'ye kadar boşluklar kapanıyor (`a676190`): Ponytail'in tepesi ve tokası, Nomad'ın girdabı artık pembe değil. Fab saçları boy filtresinde (`cbf0a83`). Ponytail'in alnına düşen saç sanatçının tasarımı (Fab görselinde perçem var).
  - **Kartlar her kafada tasarlandıkları derinlikte** (`7a6f2a2`, groom-v4): dönüştürücü her kart köşesinin yazar kafasındaki en yakın deri noktasını ve normal boyunca derinliğini (`_SURFACE_DEPTH`), kökten uca hangi köşeyi izlediğini (`_SURFACE_PARENT`) yazıyor; runtime kök refit'inden sonra tasarımdan derine giren köşeyi dışarı itiyor, kartın kalanı izliyor, hiç içeri çekmiyor. Referans yüzden derine giren köşe 81.801 → 10.911, 100'ü aşan vaka 115 → 15, en derin 37.8 → 19.2 mm. `web/grooms` %2 büyüdü.
  - Kartsız Epic kaş, sakal ve bıyıklar kart kaynaklı yoğunluk almıyor (Unreal'ın `baked`'i kalıyor); yeniden dönüşümde 15'ine eklenmişti, kaldırıldı.
- [x] **1d.4 Yayın ve rapor.** Tahmin 1 · Gerçek ~1
  - Ciltler, saçlar, kıyafetler ve manifest R2'de; kod `main`'de.

## Faz sonu kontrolü

- [x] Landing, yeni kadın ve erkek karakter, yeni yüzler ve saçlar, kalem etek, konuşma ekranı (TR + EN birer cümle). Kullanıcıya kısa özet (kullanıcı kararı, 2026-10-28: ekran görüntüsü gerekmez). Gerçek sürelerle `docs/todo.md` faz saatleri güncellenir.
  - 2026-10-28: landing (TR), oluşturucuda yeni erkek karakter + Dalgalı undercut, "Bitti", konuşma ekranında TR "Nasılsın?" (konuşma ~2 sn'de başladı) ve EN "How are you?" (~2.5 sn) çalışıyor; konsolda yalnız `THREE.Clock` uyarısı. Kadın karakter /dev/stage'de (Ada, Jelena, Seo) kontrol edildi.
