# Yapılacaklar

Windows PC'de yürüyen iş listesi (kullanıcı kararı, 2026-10-27: hepsi PC'de, Mac yorulmaz). Kullanıcı PC'deki oturuma telefondan Remote Control ile "yapılacakları yap" diye yazar; oturum bu dosyadan ilerler.

## Çalışma kuralları

- **Başlarken:** önce `git pull` (liste Mac'te de güncellenebilir), sonra `CLAUDE.md`, `docs/handoff.md` ve bu dosya. Kararları tekrar sorma.
- **Sıra: fazlar** (kullanıcı onaylı, 2026-10-27). Bölüm harfleri konuyu gösterir, sırayı fazlar belirler. Bir faz bitmeden sonrakine geçilmez; faz içinde yazılan sırayla gidilir. Saatler kaba tahmindir (ölçüm yok); A4.0'dan sonra gerçek süreye göre güncellenir. Saatler toplam iştir; 1 subagent'la geçen süre yaklaşık %25-35 kısalır (toplam ~480 saatlik iş ~335 saatte biter).

  | Faz | Alt faz | İçerik | Görev | Saat |
  |---|---|---|---|---|
  | **1 Temel** (~30 sa; gerçek ~30, bitti 2026-10-28) | 1a | Fab ve yüzler; Unreal işleri arka planda | A1 → A2 | ~6 (gerçek 3.3) |
  |  | 1b | Saçlar | A3 → A3b | ~8 (gerçek ~9) |
  |  | 1c | Kalem etek, Blender yolu ve paketleyici | A4.0 | ~10 (gerçek 5.4) |
  |  | 1d | Oturma hataları; düzeltmeler dönüştürücüde kalır, sonraki kıyafetlerin hepsine geçer | B5 | ~6 (gerçek ~12) |
  | **2 Panel ve temel kıyafet** (~60 sa) | 2a | Göz tonu, yüz karıştırma | B1 → B2 | ~14 (gerçek ~1) |
  |  | 2b | Dövme, takı | B3 → B4 | ~16 |
  |  | 2c | Küçük resimler; A-pozlu eski görseller gider | D1 | ~5 (gerçek ~0.8) |
  |  | 2d | Tişört, şortlar | A4.2 → A4.3 | ~13 |
  |  | 2e | Çorap ve külotlu, file çorap hariç (şema v3) | A4.5 | ~12 (gerçek ~1) |
  | **3 İş seti ve karakter** (~55 sa) | 3a | Kumaş pantolon, gömlek; blazer 7b'de | A4.1 | ~13 |
  |  | 3b | Polo, chino, kravatlı gömlek, sıvanmış kol | A4.6 → A4.15 | ~12 |
  |  | 3c | Kişilik ve ses | C1 → C2 | ~22 |
  |  | 3d | İfade önizleme | C3 | ~8 |
  | **4 Günlük** (~65 sa) | 4a | Elbise, hafif ceket | A4.4 | ~10 |
  |  | 4b | Desenler: çizgili tişört, ekose gömlek, keten pantolon | A4.4 | ~10 |
  |  | 4c | Atlet, düz eşofman altı, A kesim etek, biker şort | A4.6 | ~16 |
  |  | 4d | Triko balıkçı, hırka | A4.6 | ~12 |
  |  | 4e | Resort yakalı kısa kollu gömlek, gömlek elbise, salopet; kot ceket 7b'de | A4.6 | ~17 |
  | **5 Görünüm** (~70 sa) | 5a | Makyaj | C4 | ~12 |
  |  | 5b | Cilt detayları | C5 | ~12 |
  |  | 5c | Kaş ve kirpik | C6 | ~8 |
  |  | 5d | Yüz ince ayarı | C7 | ~20 |
  |  | 5e | Gözlük ve şapka | C8 | ~14 |
  |  | 5f | Yüz küçük resimlerinde ten | C10 | ~4 |
  | **6 Spor, ev, ayakkabı, meslek** (~60 sa) | 6a | Eşofman üstü, tayt + sütyen seti, tenis eteği | A4.12 | ~14 |
  |  | 6b | Pijama, kimono | A4.13 | ~10 |
  |  | 6c | Çizme, sandalet, loafer; yöntem yeni (kumaş simülasyonu yok), süre ilk ayakkabıdan sonra düzeltilir | A4.14 | ~22 |
  |  | 6d | Scrubs, aşçı ceketi | A4.16 | ~14 |
  | **7 Zor parçalar** (~85 sa) | 7a | Kat kat giyim | C9 | ~25 |
  |  | 7b | Blazer + gömlek, kot ceket | A4.1 → A4.6 | ~20 |
  |  | 7c | Topuklu ve ayak pozu: stiletto, topuklu bilek botu | A4.10 | ~22 |
  |  | 7d | Maksi etek, uzun palto | A4.7 | ~18 |
  | **8 Hot ve sexy, kapanış** (~55 sa) | 8a | Bodycon mini elbise, slip elbise, açık sırtlı ya da V yaka üst, korse üst | A4.8 | ~16 |
  |  | 8b | Deri mini etek, yırtmaçlı etek, deri pantolon, erkek saten gömlek, file çorap | A4.8 | ~14 |
  |  | 8c | İç giyim | A4.9 | ~10 |
  |  | 8d | Mayo, bikini, deniz şortu | A4.11 | ~10 |
  |  | 8e | Son kontrol | D2 | ~5 |
  | **Toplam** | 37 alt faz | | | **~480** (1 subagent'la ~335) |

  - **Sıra istisnası** (kullanıcı kararı, 2026-10-29): Faz 2'de 2a'dan sonra 2e, sonra 2c yapılır, sonra 2b → 2d. Gerekçe ve yeni tahminler `docs/plans/faz-2.md`'nin başında.
  - **Faz içi bölme** (kullanıcı kararı, 2026-10-27): fazlar yukarıdaki tablodaki alt fazlara bölünmüştür (1a, 1b, ...) ve alt fazlar tablodaki sırayla yapılır. Her fazın başında oturum her alt fazı adımlara böler ve `docs/plans/faz-<n>.md` dosyasına alt faz başlıklarıyla yazar (`superpowers:writing-plans`).
    - Bir alt adım en çok ~4-6 saatlik iştir ve kendi başına bitebilir: doğrulama, commit, push. Yarım alt adım push'lanmaz.
    - Plan dosyasında her adımın kutusu, tahmini süresi ve gerçek süresi tutulur. Gerçek süreler sonraki fazların tahminlerini düzeltir; bu dosyadaki faz saatleri de güncellenir.
    - Faz planı kullanıcıya telefondan kısa bir liste olarak gönderilir; onay beklenmeden başlanır.
    - Oturum kesilirse yenisi plan dosyasındaki ilk açık adımdan devam eder.
  - Her faz sonunda kısa bir kontrol yapılır: landing, yeni karakter, o fazın eklediği şeyler ve konuşma ekranı. Kullanıcıya kısa bir metin özeti verilir; ekran görüntüsü gönderilmez (kullanıcı kararı, 2026-10-28).
  - Görevi birden çok faza ya da alt faza bölünmüş maddelerin (A4.1, A4.4, A4.5, A4.6, A4.8) kutusu son parçası bitene kadar açık kalır; yanına bitenler not edilir.
  - Unreal ya da Blender arka planda çalışırken aynı fazdaki engelsiz bir web görevine geçilebilir; iş bitince sıraya geri dönülür.
- **Engel:** bir görev kullanıcıya bağlıysa (indirme, seçim, karar) soruyu aşağıdaki "Kullanıcıya sorular" bölümüne yaz, kullanıcıya kısaca sor ve beklemeden sıradaki engelsiz göreve geç.
- **Unreal işleri uzun sürer** (yüz başına ~11 dk). `asset-pipeline ue ...` komutlarını arka planda başlat, beklerken web görevlerine devam et. Aynı anda tek editör açılır (RAM yetmiyor).
- **Paralellik** (kullanıcı kararı, 2026-10-27): ana oturumun yanında aynı anda **en fazla 1 subagent** çalışır. Workflow ya da birden çok agent başlatılmaz.
  - Subagent'a aynı fazdan, ana oturumla dosyaları çakışmayan bağımsız bir iş verilir. Örneğin ana oturum Blender'da kıyafet yaparken subagent bir web görevini yapar.
  - Unreal'ı yalnız biri açar. İki Blender simülasyonu aynı anda koşmaz, çünkü CPU'yu paylaşırlar ve ikisi de yavaşlar.
  - Subagent commit ya da push yapmaz. Değişikliğini ana oturum doğrular ve commit'ler.
- **Büyük görevlerde** (B2, B5, C1, C2, C7, C9) önce tasarım: `superpowers:brainstorming` + `superpowers:writing-plans`. Kullanıcıya en fazla 2-3 seçenekli, telefondan cevaplanabilir soru sor.
- **Her görevde:**
  - Küçük adımlar.
  - Doğrulama: `pnpm typecheck && pnpm lint && pnpm test`; pipeline'da `uv run ruff check && uv run ruff format --check && uv run pytest`; üretilen GLB `gltf-transform validate`'ten temiz geçmeli; görsel değişiklik tarayıcıda ekran görüntüsüyle kontrol edilir.
  - Conventional Commit + push. `main`'e her push production'a çıkar; yarım iş push'lanmaz.
- **Bitince:** kutuyu `[x]` yap, yanına tarih ve commit hash'i yaz, `docs/handoff.md` "Durum"a bir iki satır ekle. Oturum kesilirse yenisi buradan devam eder.
- **Proje kuralları:**
  - `CharacterConfig` değişirse `schemaVersion` artar ve migration yazılır.
  - UI metinleri `web/messages/{tr,en}.json`'da durur.
  - Yalnız $0 varlık alınır; fiyat ve lisans Fab API'sinden doğrulanır (`/i/listings/<id>/prices-infos`).
  - Sırlar yalnız env'de durur.
  - Kullanıcının yazdığı metin system prompt'a girecekse sanitize edilir ve uzunluğu sınırlanır.
- **Rapor:** kullanıcı telefondan okuyor. Ara mesajlar kısa olsun, sonda `Kısaca:` ve gerekiyorsa `Senin Kararın:`.
- **Context:** her büyük görevden sonra context'e bak. Dolmak üzereyse bu dosyayı güncelle ve dur.

## A. Varlıklar (Unreal)

- [x] **A1. Fab indirmeleri: 4 yüz + 5 saç.** (2026-10-27: 9 paket `fab\`, ek zip'ler `fab_extras\`; ayrıntı `docs/plans/faz-1.md` 1a.1) Her ilanda $0 lisansı seç, kütüphaneye ekle, `.mhpkg`'yi indir ve arşivin `fab\` klasörüne koy. Chrome'da Fab oturumu açıksa Claude in Chrome ile yapılabilir; değilse kullanıcıdan iste. Fiyatlar 2026-10-27'de Fab API'sinden okundu.

  | Öğe | Tür | Seçilecek lisans | Fab'in yazdığı UE | İlan |
  |---|---|---|---|---|
  | Skotukeda | yüz, kadın | herhangi biri ($0) | 5.7 | https://www.fab.com/listings/41e1b941-3b4e-468d-b6a7-2ce3e8ef1e32 |
  | Mason | yüz, erkek | $0 olan (öteki $29.99) | 5.6–5.8 | https://www.fab.com/listings/a8d33031-627b-4904-86b5-a7bb76805e9b |
  | Seo | yüz, kadın | Personal ($0) | 5.6–5.8 | https://www.fab.com/listings/3693be83-9054-4fd3-9b2e-0b6d5b45fe22 |
  | Frey (TOKYO Metahuman) | yüz, erkek | $0 olan (öteki $50.99) | 5.6–5.7 | https://www.fab.com/listings/18777d2f-a05a-4509-80ea-ad87dc555f68 |
  | Long High Ponytail (Epic) | saç | herhangi biri ($0) | 5.6–5.8 | https://www.fab.com/listings/d48ad98a-e343-4a2c-abb3-08730c3bf7d9 |
  | Ponytail MessyWavy (WhiteCap) | saç | herhangi biri ($0) | 5.8 | https://www.fab.com/listings/a3425afb-5801-455e-a6a1-e27632d493db |
  | Hairstyle Male 11 (Superior Content) | saç | Personal ($0) | 5.7 | https://www.fab.com/listings/eb7f2500-56d2-49ed-bbf4-ce48f639b373 |
  | Nomad Wave Undercut (Quang Phan) | saç | herhangi biri ($0) | 5.7 | https://www.fab.com/listings/0d3d4066-49b8-4c7c-a416-a0b5c12ba7d0 |
  | PonytailGroom (DropBear) | saç | herhangi biri ($0) | 5.6 | https://www.fab.com/listings/d8c790ae-3b8c-4238-b520-1db8a99cac0f |

- [x] **A2. Yüzleri ekle** (2026-10-27, `13dfb5f` + R2 manifest: Skotukeda, Mason, MHC_Seo, MHC_Frey; 4K yüz kaynağı. Mason'ın yaka taşması B5'te.) (A1'den sonra; komutlar `pipeline/` içinde):
  1. `uv run asset-pipeline ue fab_import`. Bitmiş paketleri atlar, yalnız yenileri alır.
  2. Karakter adı her paketin `raw/fab_import/<paket>/import.json` dosyasında: `created` içindeki `MetaHumanCharacter` sınıflı asset'in son adı.
  3. `uv run asset-pipeline ue characters --args '{"only": ["<ad1>", "<ad2>", "<ad3>", "<ad4>"]}'`. **`only` şart:** `characters` işi `pruned.json`'a bakmaz (yalnız `outfits` bakar). `raw/characters/` klasörü silinmiş budanan preset'leri baştan dışa aktarır; her biri ~11 dk ve ~860 MB.
  4. `uv run asset-pipeline ue probe --args '{"script": "C:/Users/Asus/Desktop/ai-sims/pipeline/unreal/probes/preset_genders.py"}'` (mutlak yol; göreli yol editörde bulunmuyor). Fab karakterlerini de `raw/characters_genders.json`'a yazar; kayıt olmazsa dönüştürücü cinsiyeti gövde şeklinden tahmin eder.
  5. `uv run asset-pipeline mh-convert --character <ad> ... --manifest`.
  - Paketlerin kendi saç ve sakalı gelmez (`grooms` işi yalnız Epic'in groom klasörünü tarar); saç kütüphaneden seçilir.
  - UE 5.8 riski: Skotukeda ve Frey 5.8'i listelemiyor. `fab_import` "created no assets" derse sebep bu olabilir.
  - **Bitti sayılır:** 4 yüz manifest'te doğru cinsiyetle duruyor ve `/dev/stage`'de konuşurken dudak senkronu çalışıyor.

- [x] **A3. Saçları ekle** (2026-10-28, `bff8ccd`, `caec056`: 5 saç sitede; Nomad'ın tıraşlı kısmı tellerden kafa derisine boyanıyor. Bilinen küçük kusurlar: Ponytail'de alnın üstüne biraz saç düşüyor, Nomad'ın tepe girdabında küçük bir açık nokta) (A1'den sonra):
  - `grooms` işi Fab paketlerini bugün görmüyor:
    - `style_folders()` yalnız `/MetaHumanCharacter/Optional/Grooms/GroomAssets/<slot>/<style>` klasörünü tarar (`pipeline/unreal/mh_export/grooms.py:148`). Paketler `/Game/Fab/<paket>/` altına iniyor.
    - `related_assets()` yalnız `/MetaHumanCharacter/` önekli bağımlılıkları alır (`PLUGIN_PREFIX`).
  - Önce `probe` ile her paketin klasör düzenini, `GroomAsset` adını ve kart LOD'larını (`*_CardsMesh_Group<g>_LOD<n>`) oku. Sonra keşif kodunu değiştir.
  - Kartı olmayana editörde Hair Card Generator ile kart üret. MessyWavy'nin elle yapılmış kartları ayrı FBX olarak geliyorsa groom'un kart LOD'una ata.
  - Sonra: `ue grooms --args '{"only": [...]}'` ve `mh-convert --grooms --groom <stil> --manifest`. Tek cinsiyete özgü saç varsa `mh/gender_compat.json`'a yaz.
  - **Bitti sayılır:** 5 saç oluşturucuda seçilebiliyor; her yüze oturuyor ve kafa derisi açıkta kalmıyor.

- [x] **A3b. Üç saçı kaldır** (kullanıcı kararı, 2026-10-27). Bitti (2026-10-27): kullanıcı onayıyla `mh-prune --apply --plan 0b529ff0a6` (0.15 GB); manifest 50 saç, R2'de. R2'deki eski dosyaları `r2-sync` silmiyor; manifest artık göstermiyor. Silinen bir saçı giyen karakterde `reconcile.ts` saçı ilk uygun saçla değiştiriyor (`reconcile.test.ts:66`). `mh-prune` dry run'ı 4 yeni yüzün Fab paketlerini "kullanılmayan" diye listeliyor; muhtemelen yanlış tespit, `--unused-packages` çalıştırılmamalı (B5'te bakılır).
  - "Kısa, alnı açık / Short receding" (`groom.hair.Hair_S_HairLoss`) yalnız erkek saçı (`gender_compat.json:19`). Erkekten kalkması tamamen silinmesi demek: Medium layered ile aynı yol (curate'te gizle, onayla prune).
  - "Orta boy katlı kesim / Medium layered" (`groom.hair.Hair_M_Layered`) yalnız kadın saçı (`pipeline/src/asset_pipeline/mh/gender_compat.json:7`). Kadından kalkması tamamen silinmesi demek: `/[locale]/curate`'te gizle, sonra kullanıcı onayıyla `mh-prune --apply --plan <özet>`.
  - "Uzun dağınık / Long messy" (`groom.hair.Hair_L_MessyClumps`) unisex. İki cinsiyetten de tamamen silinir (kullanıcı kararı): Medium layered ile aynı yol.
  - Üçü tek prune planında silinebilir.
  - Sonra `mh-convert --manifest`, `node scripts/r2-sync.mjs`. Bu saçları giyen kayıtlı karakterleri `reconcile.ts` boşa düşürmeli; denenir.
- [ ] **A4. Kendi kıyafetlerimiz** (kullanıcı kararı, 2026-10-27: aşağıdaki listenin hepsi; sıra yukarıdaki "Sıra" listesinde, B5 A4.0 ile A4.1 arasında). Bağlam ve kaynaklar `docs/handoff.md` "Kendi kıyafetimiz" bölümünde. Kararlar verildi, tekrar sorma. Büyük görev kuralı gereği önce `superpowers:writing-plans` ile plan yazılır; tasarım bu maddedir.
  - **Yöntem (Mac oturumunun önerisi, 2026-10-27):** Unreal atlanır. Kıyafet Blender'da kurulur ve doğrudan arşiv birimi olarak yazılır. Kemik ağırlıklarını, slider morph'larını, deri payını ve `body_hide`'ı `mh-convert` zaten kendisi üretiyor (`pipeline/src/asset_pipeline/mh/outfits.py` docstring, adım 1-5). Handoff'taki Unreal Outfit Asset yolu ("Adımlar") yalnız A4.0 başarısız olursa kullanılır.
  - **Teknik:**
    - Blender headless çalışır (`blender --background --python ...`); kurulum `winget install BlenderFoundation.Blender`.
    - Kıyafet 2D kalıp parçalarından dikilir: bpy ile poligon parçalar, gövdenin etrafına yerleştirme, dikiş kenarları (Cloth modifier "Sewing"), taban gövdeyle çarpışma, simülasyon, uygula, Solidify (~2 mm).
    - UV, kalıbın düz koordinatıdır; kumaş deseni ve dokusu düz akar.
    - z-weave elle kullanılan bir araç, otomatikleşmiyor; kullanılmaz.
  - **Kod:**
    - Kalıplar ve sim script'i repo'da durur (`pipeline/blender/`, ruff + tip anotasyonu). Her parçanın parametrik bir kalıbı olur, çıktı yeniden üretilebilir.
    - Paketleyici bir CLI komutu (örneğin `asset-pipeline garment-pack`) `raw/outfits/<cinsiyet>/WI_AS_<Ad>/` birimini yazar: `OutfitBase_<cinsiyet>_Outfits.glb` (tek mesh, malzeme adı `MI_AS_<Ad>`), `outfit.json`, `textures/` ve `done.json` (dosyalar + sha256). Biçim `_is_unit` ve `OutfitUnit` (`outfits.py:200`) ile, ayrıca mevcut bir Epic biriminin (örneğin `raw/outfits/female/WI_OA_Crewneckt/`) `outfit.json`'u ile birebir aynı olur.
    - Kaynak gövde `raw/outfits/<cinsiyet>/body/SKM_OutfitBase_<cinsiyet>_BodyMesh.glb` (`base_body_path`). Kıyafet bunun üstünde kurulur, web gövdesinin üstünde değil; dönüştürücü farkı kendisi taşır.
    - Malzeme `M_fabric_simpler` instance'ı olarak yazılır (kot için `M_jeans_nrm_custom_master`), dokular Epic'in kumaş haritalarından (yün, pamuk, denim) gelir. Böylece web kendi kumaş shader'ını kurar ve renk presetleri çalışır (`NATIVE_MASTERS`, `pipeline/unreal/mh_export/outfits.py:37`).
    - `AS_` öneki bizim öğelerimizi Epic'inkilerden ayırır. `ue outfits` yalnız kendi birim klasörlerini siler (`archive.py` `run_units`), bunlara dokunmaz.
  - **Her parça için:** `mh-convert --outfits --outfit AS_<Ad> --manifest`, `gltf-transform validate`. Etiket `outfit_labels.json`'a (TR/EN), tek cinsiyetse `gender_compat.json`'a, renkler `outfit_tints.json`'a (ilk preset varsayılan) yazılır. `/dev/stage`'de iki cinsiyet × nötr ve slider uçları × idle ve talk kontrol edilir. Sonra `/dev/thumbs`, `node scripts/r2-sync.mjs`, commit + push (yalnız bitmiş parça). Kullanıcıya telefondan önden ve yandan birer ekran görüntüsü gönderilir.
  - **Bitti sayılır (her parça):** kumaş deriye girmiyor, altından cilt görünmüyor, slider uçlarında kırılmıyor, idle ve talk'ta kol ve bacak hareketiyle yırtılmıyor, renk presetleri çalışıyor.
  - **Ayrı görevler:** uzun parçalar (maksi etek, uzun palto) en sonda deneme olarak A4.7'de; topuklu ayakkabı A4.10'da.
  - **Çıkarılanlar** (kullanıcı kararı, 2026-10-27; ekleme, önerme): doktor önlüğü, reflektörlü iş yeleği, atkı, eldiven; jogger, tulum, koşu şortu, espadril; gece serisinden erkek dar atlet, erkek vücuda oturan tişört ve yüksek bel mini şort; pijamanın şortlu varyantı, açık burun terlik; gömlekte içe sokulu ve yaka düğmesi açık/kapalı varyantları; trençkot, kaban; ince bantlı topuklu sandalet, kalın topuklu ayakkabı; sweatshirt, platform spor ayakkabı, ev terliği, şişme mont (A4.17 Kış tamamen).

  - [x] **A4.0 Yol denemesi: kalem etek (kadın).** (2026-10-27, `7c691dc`, `3df9de4`, `1010c10`: `asset-pipeline garment --item AS_PencilSkirt`, sitede. Açık: AO gürültüsü ve kalça −1'deki gri leke B5'te.) En basit kalıp (ön + arka, bel bandı, arka yırtmaç); iş setini de açar. Zincir uçtan uca çalışınca paketleyici ve kalıp altyapısı hazır sayılır. Blender'da sim ya da otomasyon 2-3 denemede yürümezse dur, nedenini "Kullanıcıya sorular"a yaz, Unreal yoluna geçmeyi sor ve beklerken B görevlerine geç.
  - [ ] **A4.1 İş seti:**
    - Kumaş pantolon, kadın ve erkek (düz paça, bel bandı; ütü çizgisi normal haritada).
    - Uzun kollu düz gömlek, kadın ve erkek (yaka, düğme patı, manşet; düğmeler dokuda). Budanan `OA_Shirt_04`'ün yerini alır.
    - Blazer + gömlek, kadın ve erkek, tek `top` öğe: C9'daki `outer` slotu gelene kadar gömlek blazer'ın içinde modellenir. Tek düğme, çentik yaka. En zor parça olduğu için sona kalır.
    - Renkler: lacivert, antrasit, siyah, deve tüyü, bej; gömlekte beyaz, açık mavi, pudra.
  - [ ] **A4.2 Düz tişört,** kadın ve erkek (eski A4). Desen varyantlarının tabanıdır.
  - [ ] **A4.3 Şortlar** (kullanıcı isteği, 2026-10-27):
    - Mini kot şort, kadın (denim, kesik ya da kıvrık paça).
    - Mini şort, kadın (kumaş, denim olmayan).
    - Kot şort, erkek (diz üstü, kıvrık paça).
    - Kalıpları basit, A4.0 altyapısıyla hızlı çıkar. Mevcut `OA_Shorts`'tan ayırt edilmeleri için etiketler net olsun.
  - [ ] **A4.4 Günlük çeşit:**
    - Diz boyu elbise, kadın (kısa kol ya da kolsuz, belden oturan). Hem iş hem günlük.
    - Hafif ceket (overshirt / chore ceket), kadın ve erkek; tek başına `top`.
    - Desen varyantları ayrı katalog öğeleri olur, şema değişmez: çizgili tişört (A4.2), ekose gömlek (A4.1), keten pantolon. Paketleyici aynı mesh'ten ikinci bir birim yazar. `M_fabric_simpler`'ın iki renk maskesi (`diffuse_color_1/2`) desen maskesi olarak kullanılabiliyorsa desen iki renkli ve renk presetli olur; olmuyorsa dokusu bake'lenmiş düz PBR. Desen dokuları CC0 (ambientCG, Poly Haven) ya da script'le çizilir.
  - [x] **A4.5 Çorap: kısa ve uzun, renk seçilebilir** (2026-10-29, `87738c0`, `1503838`, `2f00956`; ayrıntı `docs/plans/faz-2.md` 2e. Maske yerine nötr gövdenin yüksekliğinden kesim; ten rengi külotlu giyenin tenini alır; parmak zarfı `b2a29a9`, `b3d12d3`) (kullanıcı isteği, 2026-10-27). Blender gerekmez; web işidir.
    - Mesh değil, cilt shader'ında bir katman olur, iç çamaşırıyla aynı yoldan: gövde UV'sinde maske, kumaş albedo ve normal, renk (`web/src/features/avatar/mh/materials.ts`, `skinTextures.ts`; iç çamaşırı maskesi `web/skins/underwear/`). Böylece ayakkabının içinden taşmaz ve slider'larla bozulmaz.
    - Boylar: kısa (bilek) ve uzun (diz altı). Maskeler gövde UV'sinde ayak bileği ve diz yükseklik çizgilerinden script'le üretilir; kenarda ince bir lastik bandı (normal haritada).
    - Görünürlük: alt giysi ya da ayakkabının örttüğü yerde zaten çizilmez (`body_hide`); çıplak ayakta ve terlikte çorap görünür.
    - **Külotlu çorap** (kullanıcı isteği, 2026-10-27), kadın: aynı katman, maske belden ayak ucuna kadar. İç çamaşırının üstünde çizilir. Şeffaflık (denye) ayarlanabilir: ince olanda cilt alttan görünür, opak olanda görünmez. Renkler: ten rengi, siyah, lacivert, antrasit.
    - Şema: `CharacterConfig`'e `socks: { style: 'none' | 'ankle' | 'knee' | 'tights', color, sheer }` eklenir, `schemaVersion` 2 → 3, migration `none` yazar (`web/src/lib/character/`). Panelde Ayakkabı'nın yanında boy seçici, renk presetleri (siyah, beyaz, gri melanj, lacivert, bej, bordo; külotluda yukarıdaki dört renk) ve külotlu için şeffaflık kaydırıcısı olur. Metinler `web/messages/{tr,en}.json`'da.
    - **Bitti sayılır:** iki cinsiyette iki boy, kadında külotlu, her renk; idle ve talk'ta çorap bacakla birlikte hareket ediyor; ayakkabı, pantolon ve etekle doğru katmanlanıyor; ince külotluda cilt doğal görünüyor; eski kayıtlı karakterler migration'la açılıyor.
  - [ ] **A4.6 Ek parçalar** (kullanıcı isteği, 2026-10-27: hepsi). Kolaydan zora:
    - Kolay: polo tişört (K/E), chino pantolon (K/E), atlet ya da askılı bluz (K/E), A kesim diz üstü etek (K), biker şort (K).
    - Kolay: düz eşofman altı (K/E; kullanıcı isteği, 2026-10-27). Düz paça, manşetsiz, lastikli bel ve bağcık; desensiz pamuklu örgü. Renkler: gri melanj, siyah, lacivert, antrasit, haki.
    - Kolay: kravatlı gömlek, A4.1 gömleğinin varyantı (E, isteğe bağlı K). Kravat gömleğin içinde modellenir, ayrı renk parametresi olur.
    - Orta: triko balıkçı kazak (K/E), düğmeli hırka (K/E), kot ceket (K/E), salopet (K, `full`), gömlek elbise (K), kısa kollu gömlek (E; rahat, açık resort yaka; ofis tipi düz yakalı kesim değil, kullanıcı kararı 2026-10-27).
    - Takım elbise ayrı parça değildir: A4.1'in blazer'ı ve kumaş pantolonu aynı renk presetleriyle (lacivert, antrasit, siyah) çıkar. İkisi aynı ada ve sıraya sahip olsun ki kullanıcı takımı kolayca eşleştirsin.
  - [ ] **A4.8 Gece ve seksi çizgi** (kullanıcı isteği, 2026-10-27). Yetişkin işi, şık ve açık parçalar, müstehcen değil. İç giyim A4.9'da, mayo A4.11'de.
    - Kadın: bodycon mini elbise, saten askılı (slip) elbise (diz üstü), açık sırtlı ya da derin V yaka üst, korse (bustier) üst, deri mini etek, yırtmaçlı diz boyu etek, dar deri pantolon.
    - Erkek: yakası açık saten gömlek (A4.1 gömlek kalıbından).
    - File çorap, kadın: A4.5 katmanında desenli bir maske, külotlu ve diz üstü boy.
    - Saten ve deri parlak malzemeler: önce kumaş shader'ının parlama ayarları denenir, yetmezse bake'lenmiş PBR kullanılır.
    - Kalıplar diz boyunu geçmez. Daha uzun yırtmaçlı ya da maksi parçalar A4.7'deki bacak arası sorununa girer.
  - [ ] **A4.9 İç giyim, seçilebilir** (kullanıcı isteği, 2026-10-27). Bugünkü sabit iç çamaşırı seçilebilir hale gelir. Mesh olmaz, cilt shader'ındaki katman olarak kalır (`web/skins/underwear/`, `web/src/features/avatar/mh/materials.ts`, `skinTextures.ts`).
    - Kadın: bugünkü basic takım (varsayılan), dantel sütyen + külot, bralet, spor sütyeni + külot, yüksek bel külot.
    - Erkek: bugünkü takım (varsayılan), slip, boxer brief.
    - Dantel: alfa maskeli desen + normal haritası, gövde UV'sinde; script'le çizilir ya da CC0 dokudan gelir. Askılar ve kenar bantları normal haritada.
    - Renkler: siyah, beyaz, ten rengi, bordo, lacivert, pudra.
    - Görünürlük bugünkü kuralla aynı: kıyafetin örtmediği yerde çizilir. Külotlu çorap iç giyimin üstünde durur.
    - Sınır: çıplaklık yok. Her stil göğüs ucunu ve kasığı opak örter.
    - Şema: `underwear: { style, color }`. A4.5 ile aynı şema sürümüne (v3) sığarsa birlikte yapılır; migration bugünkü takımı yazar.
    - **Bitti sayılır:** iki cinsiyette her stil ve renk idle ve talk'ta doğru; kıyafetle ve külotluyla doğru katmanlanıyor.
  - [ ] **A4.10 Topuklu ayakkabı ve ayak pozu** (kullanıcı onayı, 2026-10-27). Büyük görev: önce `superpowers:writing-plans`.
    - Parçalar, kadın: stiletto (pump) ve topuklu bilek botu. Topuk 5-10 cm.
    - Ayak pozu: her ayakkabının `footPose`'u (ayak bileği ve parmak kökü açısı, topuk yüksekliği) manifest'e girer (zod `web/src/lib/assets/manifest.ts`, pipeline `manifest.py`). Web her karede animasyondan sonra bu açıları ayak eklemlerine ekler (`web/src/features/avatar/mh/motion.ts` sonrası) ve karakteri topuk yüksekliği kadar kaldırır. Bunun için mevcut `soleDepth` mekanizması (`garments.ts`, `MhCharacter.tsx`) genişletilir.
    - Modelleme: Blender'da taban gövdenin ayağı bu pozla bükülür ve ayakkabı onun üstünde modellenir. Paketlemeden önce ayak eklemlerinin ters dönüşümüyle bind pozuna geri çevrilir; böylece dönüştürücü ağırlıkları her zamanki gibi aktarır.
    - Çıplak ayak ve düz ayakkabılar etkilenmez (`footPose` yoksa sıfır).
    - **Bitti sayılır:** idle ve talk'ta topuk platforma basıyor, ayak ayakkabının içinden çıkmıyor, ayak bileği doğal duruyor; düz ayakkabıya geçince poz sıfırlanıyor.
  - [ ] **A4.11 Mayo ve bikini** (kullanıcı isteği, 2026-10-27).
    - Vücuda yapışık parçalar A4.9'daki katmana ek stiller olarak girer; iç giyimin yerine giyilir (aynı alan, panelde "İç giyim ve mayo"):
      - Kadın: üçgen bikini, bandeau bikini, yüksek bel bikini, klasik tek parça mayo, açık sırtlı tek parça mayo.
      - Erkek: slip mayo.
    - Bol parça Blender'da A4.3 şort kalıbından yapılır: erkek deniz şortu (diz üstü, lastikli bel, bağcık), kadın için isteğe bağlı plaj şortu.
    - Malzeme: likra, hafif parlak. Bağcıklar ve dikişler normal haritada.
    - Renkler: siyah, beyaz, lacivert, kırmızı, haki, pudra; desen varyantı (çizgili ya da çiçekli) A4.4'teki desen yöntemiyle.
    - Sınır A4.9 ile aynı: çıplaklık yok, her stil göğüs ucunu ve kasığı opak örter.
    - **Bitti sayılır:** iki cinsiyette her stil ve renk idle ve talk'ta doğru; deniz şortu A4.0 ölçütlerini karşılıyor.
  - [ ] **A4.12 Spor** (kullanıcı isteği, 2026-10-27): fermuarlı eşofman üstü (K/E), spor tayt + spor sütyeni seti (K), pileli tenis eteği (K). Malzeme teknik örgü, hafif parlak.
  - [ ] **A4.13 Ev** (kullanıcı isteği, 2026-10-27): pijama takımı (K/E; uzun kollu üst + uzun alt), diz boyu kimono sabahlık (K/E, kuşaklı; iç giyimin ya da pijamanın üstüne tek başına giyilir).
  - [ ] **A4.14 Ayakkabı çeşitleri** (kullanıcı isteği, 2026-10-27): diz boyu çizme (K), düz sandalet (K/E), loafer (K/E; Epic'inki budanmıştı).
    - Ayakkabılar kumaş simülasyonuyla yapılmaz. Taban ayak izinden ekstrüde edilir, üst kısım ayak yüzeyinin ofset kabuğundan kesim çizgileriyle çıkar. Dikiş, bağcık ve taban dokusu normal haritaya bake'lenir. Çizmenin konçu baldırın ofset kabuğudur.
    - Kapalı ayakkabıda parmaklar mevcut kuralla gizlenir (`hide_closed_toes`); sandalette ayak görünür, `soleDepth` doğru ölçülmeli.
  - [ ] **A4.15 Varyantlar** (kullanıcı isteği, 2026-10-27). Aynı kalıptan ayrı katalog öğeleri, şema değişmez: gömlek ve tişörtte sıvanmış kol.
  - [ ] **A4.16 Meslek kıyafetleri** (kullanıcı isteği, 2026-10-27).
    - Hemşire / sağlık forması (scrubs; V yaka üst + alt, K/E), aşçı ceketi (kruvaze, K/E).
    - C1'de rol veya meslek seçilince ilgili kıyafet önerilebilir. Bu bir öneridir, zorunlu değil; C1 yapılırken değerlendirilir.
  - [ ] **A4.7 Uzun parçalar (deneme, en son):** maksi etek (K), uzun palto (K/E).
    - Sorun: bacak arasındaki kumaş en yakın bacağın ağırlığını alıyor ve adım ya da jestte yırtılıyor. Önce maksi etekle dene: bacak arasındaki vertex'lere iki uyluğun ağırlıklarının karışımı (`build_transfer`'ın Gauss ortalamasını genişleterek, `outfits.py:705`). İdle ve talk'ta temiz değilse dur ve kullanıcıya ekran görüntüsüyle sor.
    - Palto tek başına `top` olarak bile gövdenin üstüne giyilir. İç kıyafet içinden çıkacağı için C9'daki (`outer` slotu ve iç giysi gizleme) çözüm gerekir. C9 bitmeden başlanmaz.

## B. Panelde olan ama sahnede çalışmayan ayarlar

`web/src/features/avatar/mh/resolve.ts` bu ayarların hiçbirini okumuyor. Config yazılıyor, ama sahnede bir şey değişmiyor.

- [x] **B1. Göz rengi tonu** (2026-10-29, `543687b`) (`eyes.color`, `EyesPanel.tsx:47`). Iris shader'ında seçilen ton uygulanır; `null` doğal renk demektir.
- [x] **B2. Yüz karıştırma** (2026-10-29, `d81f1df`; ayrıntı `docs/plans/faz-2.md` 2a) (`face.blend`, `FacePanel.tsx`; `randomize.ts` de yazıyor). MetaHuman kafalarının topolojisi ortak: vertex konumları, morph delta'ları (ARKit + viseme) ve kafa eklemleri (göz, çene) ağırlıkla karıştırılır. Cilt seçili kalır. C7 bu altyapıyı kullanacak. **Bitti sayılır:** karışık yüz konuşurken dudak senkronu ve göz kırpma bozulmuyor.
- [ ] **B3. Dövme** (`tattoos`, `schema.ts:103`, `TattooPanel.tsx`, `web/src/features/creator/tattoos.ts`). Cilt shader'ında gövde ve kafa UV'sine bir katman eklenir. Tasarımlar küçük ve ölçülü kalır; yerleşim UV'leri gövde GLB'sinden ölçülür.
- [ ] **B4. Takı** (`accessories`, `JewelryPanel.tsx`, `web/src/features/avatar/accessories/`). Bu kod anime döneminden kalma (VRoid kulak arama vb.); MetaHuman kafa ve gövde mesh'ine ve eklemlerine bağlanır. **Bitti sayılır:** küpe, kolye ve yüzük idle ve konuşma sırasında yerinde kalıyor ve mesh'e girmiyor.

- [x] **B5. Oturma hataları: kıyafet ve saç** (2026-10-28, `edc5198`, `c0afe0e`, `a676190`, `cbf0a83`, `373806d`, `e497f3a`, `7a6f2a2`; ölçüm aracı `mh-fit-audit` `b6de10f`; ayrıntı `docs/plans/faz-1.md` 1d. Bilinen küçük kusur: tişört kol ağzının koltuk altı kenarında pozda 1-2 piksellik iz.) (kullanıcı şikâyeti, 2026-10-27; sırası A4.0'dan hemen sonra, bkz. "Sıra").
  - Belirtiler:
    - Kıyafetler hâlâ yer yer vücudun içine giriyor, tam oturmuyor.
    - Gövde kaydırıcıları değişince kıyafet bozulabiliyor.
    - Saçlar düzgün durmuyor.
    - "Genel olarak bu tarz hatalar" da düzeltilecek.
  - Önce `superpowers:systematic-debugging`. Tahminle düzeltme yapma, önce kanıt topla:
    - Dev sayfasında ekran görüntüsü matrisi: her kıyafet × iki cinsiyet × gövde presetleri ve her kaydırıcının uçları × idle ve talk karesi.
    - Saç için: her saç × birkaç yüz (kısa/uzun boyun, geniş/dar kafa) × önden, yandan, arkadan.
    - Mümkünse sayısal ölçüm de: kıyafetin altında görünen cilt vertex'i, kafanın içine giren kart sayısı.
  - En kötü vakalar `docs/handoff.md`'ye kaydedilir; kullanıcıya telefondan 3-4 ekran görüntüsüyle önce/sonra gösterilir.
  - Bilinenler:
    - **Mason (2026-10-27, A2):** kafa mesh'inin boyun ve göğüs parçası diğer erkek yüzlerden ~3.5 cm önde (z 0.130, diğerleri ~0.095); paylaşılan gövdeye takılınca tişört ve kazak yakasından ten taşıyor. Kafa parçası boyun dikişinden aşağıda gövdeye uydurulmalı (dönüştürücü ya da montaj), ya da kıyafet altında kalan kafa köşeleri de gizlenmeli.
    - **Kalem etek (2026-10-27, A4.0):** kalça ±1'de bacak arasını köprüleyen kumaş iç uyluk morph'unu izliyordu; `3df9de4` (`bridging`, outfit-v7) düzeltti, bütün kıyafetler yeniden dönüştürüldü.
    - **AO gürültüsü (2026-10-27):** ~~N8AO~~ Düzeldi (2026-10-28, `edc5198`): AO değilmiş, `battery`'de de vardı. Kıyafet altındaki gizli deri gölge düşürüyordu; gövde artık gölgesini de `bodyHidden` maskesiyle çiziyor.
    - Kıyafet morph'ları her kaydırıcı ucunda deri normali boyunca dışarı itiliyor (`pipeline/src/asset_pipeline/mh/outfits.py`: `stack_push` :787, `clear_morphs` :956).
    - Cildi gizleyen maske `body_hide` (:1117). Web'de bağlama `web/src/features/avatar/mh/garments.ts` (`bindGarment` :30).
    - Birden çok kaydırıcının birlikte morph toplamı ayrıca denenmeli (her biri tek başına temiz olsa da).
    - Saç: `web/src/features/avatar/mh/grooms.ts` (`refitPositions` :52, `fitCards` :154, `bindToHead` :194). Yoğunluk/kafa derisi `groomDensity.ts`.
  - Düzeltme pipeline'daysa etkilenen kıyafet ve saçlar yeniden dönüştürülür, GLB'ler `gltf-transform validate`'ten geçer, R2'ye yüklenir.
  - **Bitti sayılır:** matristeki hiçbir karede kıyafetin altından cilt görünmüyor, kaydırıcı uçlarında kıyafet kırılmıyor, saç kartları kafanın içine girmiyor ve havada durmuyor.

## C. Yeni özellikler (kullanıcı seçimi, 2026-10-27: listedeki 1-8)

- [ ] **C1. Kişilik ve konuşma tarzı.**
  - Bugün persona yalnız isim, taban ve stil alıyor (`web/src/lib/ai/persona.ts`).
  - Eklenecekler: rol veya meslek, kişilik özellikleri (sabit listeden çoklu seçim), hitap (TR'de sen/siz, EN'de rahat/resmi), ilgi alanları, kısa geçmiş.
  - Serbest metinler `sanitizeCharacterName` gibi temizlenir ve uzunlukları sınırlanır.
  - Prompt `prompts/persona.template.ts`'te kalır; `PERSONA_PROMPT_VERSION` 4'ten 5'e çıkar.
  - Persona görünüm değil: config yerine karakter belgesinde, `name` alanının yanında durması önerilir (`web/src/lib/characters/repository.ts`). Oluşturucuda kendi paneli olur.
- [ ] **C2. Ses seçimi ve önizleme.**
  - Bugün yalnız `voice.gender` var (`TalkScreen.tsx:79`; ses `web/src/lib/tts/providers.ts:49`'da dil ve cinsiyetten seçiliyor).
  - Eklenecekler: dil ve cinsiyet başına birkaç ses, perde ve hız, oluşturucuda "Dinle" düğmesi (`/api/tts` ile örnek cümle).
  - Dikkat: `tr-TR-AhmetNeural` 2026-10-27'den beri sesi kesiyor ve `en-US-BrianMultilingualNeural`'a yönleniyor (`web/src/lib/tts/edge.ts:26`). Multilingual sesler TR için değerli.
  - Gemini TTS'te karşılık gelen ses eşlemesi gerekir. Lip-sync bozulmamalı.
- [ ] **C3. İfade önizleme.** Oluşturucuda gülümse, üzgün, şaşkın ve konuşurken düğmeleri. Yüz klipleri manifest'te var (`expression` + `happy`/`sad`/`surprise`); `faceClipSet` (`resolve.ts`) bugün yalnız idle ve smile'ı alıyor. "Konuşurken" C2'nin önizlemesiyle birleşebilir.
- [ ] **C4. Ek makyaj: ruj, far, eyeliner, allık;** her biri için renk ve yoğunluk.
  - Bugün yalnız preset'in kendi makyajı açılıp kapanıyor (`skin.makeup`, `makeupAlbedo`).
  - Unreal'ın makyaj maskeleri `statics` işiyle dışa aktarıldı (`pipeline/unreal/mh_export/statics.py:4`) ve `raw/statics/` altında; KTX2'ye çevrilip manifest'e girer.
  - Yüz UV'sinde renk + opaklık katmanı olur. Varsayılanlar ölçülü ve gerçekçi.
- [ ] **C5. Cilt detayları.**
  - Çil: Unreal'ın çil maskeleri, `raw/statics/`.
  - Ben: UV'de küçük lekeler.
  - Yaş: kırışıklık haritalarını (wm1–3) sabit küçük bir ağırlıkla açmak + kır saç oranı (saç, kaş, sakal).
  - Yaş sonucu gerçekçi durmazsa kullanıcıya ekran görüntüsüyle sor.
- [ ] **C6. Ayrı kaş rengi ve kirpik seçimi.**
  - Kaş rengi bugün saç rengini izliyor. `eyebrows.color` eklenir; `null` saç rengi demektir.
  - Kirpikler groom olarak dışa aktarıldı (Eyelashes, 6 stil, `raw/grooms/`), ama dönüştürücüde ve manifest'te kirpik slotu yok. Önce web'in kirpiği bugün nasıl çizdiğine bakılır.
- [ ] **C7. Yüz ince ayarı** (B2'den sonra). Burun, çene, dudak, göz, elmacık ve kaş bölgeleri. Seçenekler: bölge maskeli preset karışımı (MetaHuman Creator'ın eski yöntemi) ya da bölge başına PCA kaydırıcıları. Eklemler de izlenir. Tasarım kullanıcıya sorulur.
- [ ] **C8. Gözlük ve şapka.**
  - Önce Fab'de ücretsiz, MetaHuman uyumlu gözlük ve şapkaları listele (yöntem: Fab API'si, `asset_formats=metahuman`, `is_free=1`). Linkli kısa listeyi kullanıcıya telefondan seçtir.
  - Gözlük kafa eklemine sabitlenebilir.
  - Şapka saçla çakışır; saç gizleme ya da kısaltma kuralı gerekir.
- [ ] **C9. Kat kat giyim** (üst üstüne ceket veya blazer).
  - Yeni `outer` slotu (şema değişir).
  - Sorun: iç parça dış parçanın içinden çıkar. Seçenekler: iç giysi için `body_hide` benzeri bir gizleme maskesi ya da iç parçayı içeri itmek.
  - Önce tek bir çiftle (tişört + ceket) prototip yapılır. **Bitti sayılır:** idle ve konuşmada parçalar birbirinin içinden çıkmıyor.

- [ ] **C10. Yüz seçicide ten** (kullanıcı kararı, 2026-10-27). Koyu tenli yüz küçük resimlerinde yüz hatları seçilmiyordu. Karar:
  1. **Yüz seçmek teni değiştirmez.** Bugün yüze tıklayınca ten o yüzün kendi cildine geçiyor (`FacePanel.tsx:45-46`); bu kalkar, seçili cilt korunur. Ten yalnız Cilt panelinden değişir.
  2. **Yüz küçük resimleri o anki tenle görünür.** Kullanıcı teni değiştirdiyse yüz seçeneklerinin hepsi o tende görünür.
  3. **Varsayılan açık ten.** Yeni karakter bugün de en açık tenle başlıyor (`web/src/lib/character/defaults.ts:9`: kadın Jelena 0.22, erkek Victor 0.38, ikisi de cinsiyetinin en açık cildi). A2'den sonra yeni ciltler gelince bu yeniden kontrol edilir.
  - Önerilen yol:
    - Her yüz × aynı cinsiyetteki her cilt seti için küçük resim önceden üretilir (`/dev/thumbs`; `web/src/components/dev/thumbConfig.ts` bugün `wearing()` içinde yüzün kendi cildini kullanıyor).
    - A2 sonrası ~12×12 + 11×11 ≈ 265 görsel; biri ~8 KB, toplam ~2 MB.
    - Manifest'te yüz başına cilt → küçük resim eşlemesi olur (zod: `web/src/lib/assets/manifest.ts`, pipeline: `pipeline/src/asset_pipeline/mh/manifest.py`). Panel `config.skin.set`'e göre seçer, yoksa varsayılan açık tene düşer.
    - `skin.tone` kaydırıcısı küçük resme yansımaz; set yeterli.
    - Tarayıcıda her yüzü canlı çizmek ağır (yüz başına ~11 MB kafa) ve elendi.
  - **Bitti sayılır:** yeni karakterde tüm yüz küçük resimleri açık tende; Cilt panelinden koyu bir set seçilince yüz küçük resimleri o tene geçiyor; yüze tıklamak teni değiştirmiyor.

## D. Kapanış

- [x] **D1. Küçük resimler** (2026-10-29; 99 görsel kâğıt tonlu fonda ve ayakta, R2'de; ayrıntı `docs/plans/faz-2.md` 2c). Yüz, saç ve kıyafet küçük resimleri `/dev/thumbs` ile yeniden üretilir (A-pose hatası `motion.ts`'te düzeldi; eski görseller A-pozunda ve koyu fonda). Açık fon düşünülebilir. Sonra `cd web && node scripts/r2-sync.mjs`.
- [ ] **D2. Son kontrol.** Landing, yeni kadın ve erkek karakter, yeni özellikler, Bitti, konuşma ekranında TR ve EN birer cümle (ses ve dudak). Konsolda `THREE.Clock` uyarısından başka hata olmamalı. Sonuç kullanıcıya ekran görüntüleriyle bildirilir.

## Kullanıcıya sorular

(Bekleyen soru yok.)

- Cevaplanan (2026-10-29, B2): yüz karışımı kaydırıcı bırakınca güncellenir (seçenek A). Sürüklerken canlı önizleme (B) yapılmayacak.

- Cevaplanan (2026-10-28, B5): açık kalan vakalar Faz 1 içinde bitirildi (kullanıcı: "faz 1i tamamen bitir").

- Cevaplanan (2026-10-27, A2): Mason'ın 8K yüz dokuları belleği tıkadı, Claude Code dışa aktarımı durdurdu. Kullanıcı kararı: web için 8K gerekmez, 4K ya da daha düşüğü olur ("sen karar ver"). Yeni Fab yüzleri `"face": "res4k"` ile dışa aktarılır: web yüzü zaten 4096 px (`textures.py` `FACE_SIZE`, en az 4096 ister), 1080 gözenek detayını kaybettirir. Gövde 4K kalır.
