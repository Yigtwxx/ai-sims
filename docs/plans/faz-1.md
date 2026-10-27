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
- [ ] **1a.2 İçe aktarma.** Tahmin 0.5 · Gerçek —
  - `cd pipeline && uv run asset-pipeline ue fab_import` (arka planda). Yalnız yeni 9 paketi alır.
  - Kontrol: her yeni paketin `raw/fab_import/<paket>/import.json`'u var. "created no assets" çıkarsa sebep UE sürümü olabilir (Skotukeda yalnız 5.7 listeliyor): o paket için sonucu "Kullanıcıya sorular"a yaz, diğerleriyle devam et.
- [ ] **1a.3 Yüzleri dışa aktar.** Tahmin 1.5 (çoğu bekleme) · Gerçek —
  - Karakter adları: dört yüz paketinin `import.json` `created` alanındaki `MetaHumanCharacter` sınıflı asset'in son adı.
  - `uv run asset-pipeline ue characters --args '{"only": ["<ad1>", "<ad2>", "<ad3>", "<ad4>"]}'` (yüz başına ~11 dk, ~860 MB). `only` şart.
  - Ardından `uv run asset-pipeline ue probe --args '{"script": "unreal/probes/preset_genders.py"}'`; dört ad `raw/characters_genders.json`'da olmalı.
  - Beklerken (editör meşgul): 1b.2'nin kod okuması ana oturumda yapılır.
- [ ] **1a.4 Dönüştür ve manifest.** Tahmin 1 · Gerçek —
  - `uv run asset-pipeline mh-convert --character <ad1> --character <ad2> --character <ad3> --character <ad4> --manifest`.
  - `gltf-transform validate` her yeni `faces/<ad>/*.glb` ve gövde/cilt GLB'si için.
  - Manifest'te 4 yüzün cinsiyeti beklenenle aynı: Skotukeda K, Mason E, Seo K, Frey E. Yanlışsa `characters_genders.json` değerine bak, eşik kuralı (`|değer| < 0.3` gövde şekli) handoff "Cinsiyet" maddesinde.
- [ ] **1a.5 Sahnede kontrol, küçük resim, yayın.** Tahmin 2 · Gerçek —
  - `pnpm db:start`, `pnpm dev`; `/dev/stage`'de her yeni yüz: idle, konuşma (`/api/tts` ile TR ve EN birer cümle), dudak senkronu ve göz kırpma; boyun dikişi; ekran görüntüsü.
  - `/dev/thumbs` ile 4 yüzün küçük resmi; oluşturucunun Yüz panelinde görünüyorlar.
  - `web/scripts/r2-sync.mjs` bugün yalnız klasör alıyor (`walk()` dosyada çöker); argüman dosyaysa doğrudan kuyruğa koyacak şekilde düzeltilir. Sonra `cd web && node scripts/r2-sync.mjs faces skins irises manifest.json` (yalnız değişenler; argümansız çağrı tüm ağacı yükler).
  - Sitede (https://ai-sims.pages.dev) yeni yüzlerden biri açılıyor.
  - `docs/todo.md` A1, A2 `[x]`; handoff "Durum"; `docs: ...` commit + push. Kullanıcıya telefondan 4 yüzün ekran görüntüsü.

## 1b — Saçlar (A3 → A3b), tahmin ~8

- [ ] **1b.1 Paket düzenini oku.** Tahmin 1 · Gerçek —
  - `pipeline/unreal/probes/` altına bir probe: her yeni saç paketinin `/Game/Fab/<paket>/` altındaki `GroomAsset`, `GroomBindingAsset`, kart mesh'leri (`*_CardsMesh_Group<g>_LOD<n>`), doku ve malzeme yolları, bağımlılıkların öneki. Çıktı `raw/fab_grooms_layout.json`.
  - `fab_extras\*.zip` içerikleri listelenir (FBX kart var mı).
- [ ] **1b.2 Keşif kodunu genişlet.** Tahmin 2.5 · Gerçek —
  - `pipeline/unreal/mh_export/grooms.py`: `style_folders()` (:148) Epic'in `GroomAssets/<slot>/<style>` klasörüne ek olarak `/Game/Fab/<paket>/` altındaki groom'ları bulur; slot (`Hair`) ve stil adı paketten türetilir. `related_assets()` `PLUGIN_PREFIX` dışında paketin kendi klasörünü de alır.
  - Saf fonksiyonlar (yol → slot/stil eşlemesi, önek filtresi) editörsüz test edilebilir hale getirilir; testler `pipeline/tests/`.
  - Kartı olmayan pakete editörde Hair Card Generator; MessyWavy'nin zip'teki kartları FBX ise groom'un kart LOD'una atanır.
- [ ] **1b.3 Dışa aktar ve dönüştür.** Tahmin 2 · Gerçek —
  - `uv run asset-pipeline ue grooms --args '{"only": [<5 stil>]}'`.
  - `uv run asset-pipeline mh-convert --grooms --groom <stil> ... --manifest`; GLB validate.
  - Tek cinsiyete özgü saç `pipeline/src/asset_pipeline/mh/gender_compat.json`'a; etiketler (TR/EN) saçların etiket dosyasına.
- [ ] **1b.4 Sahnede kontrol ve yayın.** Tahmin 1.5 · Gerçek —
  - `/dev/stage`: 5 saç × en az 3 yüz (iki cinsiyet, kısa/uzun boyun) önden, yandan, arkadan; kafa derisi açıkta değil, kartlar kafaya girmiyor.
  - `/dev/thumbs`, `node scripts/r2-sync.mjs grooms`, manifest. Commit + push. A3 `[x]`.
- [ ] **1b.5 Üç saçı kaldır (A3b).** Tahmin 1 · Gerçek —
  - `/[locale]/curate`'te gizle: `groom.hair.Hair_S_HairLoss`, `groom.hair.Hair_M_Layered`, `groom.hair.Hair_L_MessyClumps`.
  - `uv run asset-pipeline mh-prune` (deneme) → plan özeti kullanıcıya; onayla `mh-prune --apply --plan <özet>`.
  - `mh-convert --manifest`, `node scripts/r2-sync.mjs`. Bu saçları giyen kayıtlı karakter açılınca `reconcile.ts` saçı boşa düşürüyor (dev'de denenir). A3b `[x]`.

## 1c — Kalem etek, Blender yolu ve paketleyici (A4.0), tahmin ~10

> Ayrıntılı TDD planı (dosya yapısı, kod, testler) 1c'nin başında bu bölüme yazılır (`superpowers:writing-plans`): Blender kurulmadan ve bir Epic biriminin `outfit.json`'u okunmadan yazılırsa tahmin olur. 2-3 denemede sim ya da otomasyon yürümezse dur, nedeni `docs/todo.md` "Kullanıcıya sorular"a yaz, Unreal yolunu sor, beklerken Faz 2'ye geçme (faz kuralı) ama 1d'ye geç.

- [ ] **1c.1 Keşif ve ayrıntılı plan.** Tahmin 1.5 · Gerçek —
  - `winget install BlenderFoundation.Blender`; `blender --background --python-expr "import bpy; print(bpy.app.version)"`.
  - Oku: `pipeline/src/asset_pipeline/mh/outfits.py` docstring (adım 1-5), `_is_unit`, `OutfitUnit` (:200), `base_body_path`; `raw/outfits/female/WI_OA_Crewneckt/outfit.json`, `done.json`; `raw/outfits/female/body/SKM_OutfitBase_female_BodyMesh.glb`.
  - Bu bölümün altına 1c.2-1c.5 için dosya yapısı ve adım adım TDD planı.
- [ ] **1c.2 Parametrik kalıp.** Tahmin 2 · Gerçek —
  - `pipeline/blender/patterns/pencil_skirt.py`: ön + arka panel, bel bandı, arka yırtmaç; ölçüler (bel, kalça, boy) parametre; dikiş kenarı çiftleri ve kalıp UV'si çıktı. bpy'siz saf Python, ruff + tip anotasyonu, pytest.
- [ ] **1c.3 Blender simülasyonu.** Tahmin 3 · Gerçek —
  - `pipeline/blender/sim.py` (headless): kalıbı gövdenin etrafına yerleştir, Cloth "Sewing", gövdeyle çarpışma, sim, uygula, Solidify ~2 mm; tek mesh, malzeme adı `MI_AS_PencilSkirt`; GLB çıktı.
- [ ] **1c.4 Paketleyici.** Tahmin 2 · Gerçek —
  - `asset-pipeline garment-pack`: `raw/outfits/female/WI_AS_PencilSkirt/` → `OutfitBase_female_Outfits.glb`, `outfit.json` (Epic biriminin biçimiyle birebir), `textures/` (Epic kumaş haritaları, `M_fabric_simpler`), `done.json` (dosyalar + sha256). Biçim testi `_is_unit` + `OutfitUnit` ile.
- [ ] **1c.5 Dönüştür, kontrol, yayın.** Tahmin 1.5 · Gerçek —
  - `mh-convert --outfits --outfit AS_PencilSkirt --manifest`, validate; `outfit_labels.json` (TR/EN), `gender_compat.json` (yalnız kadın), `outfit_tints.json` (lacivert, antrasit, siyah, deve tüyü, bej).
  - `/dev/stage`: nötr ve her slider ucu × idle ve talk; kumaş deriye girmiyor, cilt görünmüyor, yırtılmıyor, renk presetleri çalışıyor.
  - `/dev/thumbs`, `node scripts/r2-sync.mjs outfits`, commit + push; kullanıcıya önden ve yandan ekran görüntüsü. A4.0 `[x]`.

## 1d — Oturma hataları (B5), tahmin ~6

> `superpowers:systematic-debugging`: önce kanıt, sonra düzeltme. Düzeltmeler dönüştürücüde kalır ki sonraki kıyafetlere de geçsin.

- [ ] **1d.1 Kanıt matrisi.** Tahmin 2 · Gerçek —
  - Dev sayfası (ör. `/dev/fit`): her kıyafet × iki cinsiyet × nötr ve her slider ucu (ayrıca birkaç slider birlikte) × idle ve talk karesi; her saç × birkaç yüz × üç açı. Ekran görüntüleri arşivin `build/fit/` altına.
  - Sayısal ölçüm: kıyafet altında görünen cilt vertex'i (`body_hide` dışı ve kumaşın dışına çıkan deri), kafaya giren kart sayısı.
  - En kötü vakalar `docs/handoff.md`'ye.
- [ ] **1d.2 Kıyafet düzeltmesi.** Tahmin 2 · Gerçek —
  - Kök neden `outfits.py` (`stack_push` :787, `clear_morphs` :956, `body_hide` :1117) ya da web (`garments.ts` `bindGarment` :30); önce başarısız test, sonra düzeltme. Etkilenen kıyafetler yeniden dönüştürülür, validate.
- [ ] **1d.3 Saç düzeltmesi.** Tahmin 1 · Gerçek —
  - `grooms.ts` (`refitPositions` :52, `fitCards` :154, `bindToHead` :194), `groomDensity.ts`; testle.
- [ ] **1d.4 Yayın ve rapor.** Tahmin 1 · Gerçek —
  - Matris yeniden: hiçbir karede cilt görünmüyor, slider uçlarında kırılma yok, kartlar kafaya girmiyor ve havada değil.
  - `node scripts/r2-sync.mjs outfits grooms`, commit + push, kullanıcıya 3-4 önce/sonra ekran görüntüsü. B5 `[x]`.

## Faz sonu kontrolü

- [ ] Landing, yeni kadın ve erkek karakter, yeni yüzler ve saçlar, kalem etek, konuşma ekranı (TR + EN birer cümle). Kullanıcıya telefondan ekran görüntüleriyle faz özeti. Gerçek sürelerle `docs/todo.md` faz saatleri güncellenir.
