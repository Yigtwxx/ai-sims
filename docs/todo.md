# Yapılacaklar

Windows PC'de yürüyen iş listesi (kullanıcı kararı, 2026-10-27: hepsi PC'de, Mac yorulmaz). Kullanıcı PC'deki oturuma telefondan Remote Control ile "yapılacakları yap" diye yazar; oturum bu dosyadan ilerler.

## Çalışma kuralları

- **Başlarken:** önce `git pull` (liste Mac'te de güncellenebilir), sonra `CLAUDE.md`, `docs/handoff.md` ve bu dosya. Kararları tekrar sorma.
- **Sıra:** işaretlenmemiş (`[ ]`) ilk görev. Bir görev kullanıcıya bağlıysa (indirme, seçim, karar) soruyu aşağıdaki "Kullanıcıya sorular" bölümüne yaz, kullanıcıya kısaca sor ve beklemeden sıradaki engelsiz göreve geç.
- **Unreal işleri uzun sürer** (yüz başına ~11 dk). `asset-pipeline ue ...` komutlarını arka planda başlat, beklerken web görevlerine devam et. Aynı anda tek editör açılır (RAM yetmiyor).
- **Büyük görevlerde** (B2, C1, C2, C7, C9) önce tasarım: `superpowers:brainstorming` + `superpowers:writing-plans`. Kullanıcıya en fazla 2-3 seçenekli, telefondan cevaplanabilir soru sor.
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

- [ ] **A1. Fab indirmeleri: 4 yüz + 5 saç.** Her ilanda $0 lisansı seç, kütüphaneye ekle, `.mhpkg`'yi indir ve arşivin `fab\` klasörüne koy. Chrome'da Fab oturumu açıksa Claude in Chrome ile yapılabilir; değilse kullanıcıdan iste. Fiyatlar 2026-10-27'de Fab API'sinden okundu.

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

- [ ] **A2. Yüzleri ekle** (A1'den sonra; komutlar `pipeline/` içinde):
  1. `uv run asset-pipeline ue fab_import`. Bitmiş paketleri atlar, yalnız yenileri alır.
  2. Karakter adı her paketin `raw/fab_import/<paket>/import.json` dosyasında: `created` içindeki `MetaHumanCharacter` sınıflı asset'in son adı.
  3. `uv run asset-pipeline ue characters --args '{"only": ["<ad1>", "<ad2>", "<ad3>", "<ad4>"]}'`. **`only` şart:** `characters` işi `pruned.json`'a bakmaz (yalnız `outfits` bakar). `raw/characters/` klasörü silinmiş budanan preset'leri baştan dışa aktarır; her biri ~11 dk ve ~860 MB.
  4. `uv run asset-pipeline ue probe --args '{"script": "unreal/probes/preset_genders.py"}'`. Fab karakterlerini de `raw/characters_genders.json`'a yazar; kayıt olmazsa dönüştürücü cinsiyeti gövde şeklinden tahmin eder.
  5. `uv run asset-pipeline mh-convert --character <ad> ... --manifest`.
  - Paketlerin kendi saç ve sakalı gelmez (`grooms` işi yalnız Epic'in groom klasörünü tarar); saç kütüphaneden seçilir.
  - UE 5.8 riski: Skotukeda ve Frey 5.8'i listelemiyor. `fab_import` "created no assets" derse sebep bu olabilir.
  - **Bitti sayılır:** 4 yüz manifest'te doğru cinsiyetle duruyor ve `/dev/stage`'de konuşurken dudak senkronu çalışıyor.

- [ ] **A3. Saçları ekle** (A1'den sonra):
  - `grooms` işi Fab paketlerini bugün görmüyor:
    - `style_folders()` yalnız `/MetaHumanCharacter/Optional/Grooms/GroomAssets/<slot>/<style>` klasörünü tarar (`pipeline/unreal/mh_export/grooms.py:148`). Paketler `/Game/Fab/<paket>/` altına iniyor.
    - `related_assets()` yalnız `/MetaHumanCharacter/` önekli bağımlılıkları alır (`PLUGIN_PREFIX`).
  - Önce `probe` ile her paketin klasör düzenini, `GroomAsset` adını ve kart LOD'larını (`*_CardsMesh_Group<g>_LOD<n>`) oku. Sonra keşif kodunu değiştir.
  - Kartı olmayana editörde Hair Card Generator ile kart üret. MessyWavy'nin elle yapılmış kartları ayrı FBX olarak geliyorsa groom'un kart LOD'una ata.
  - Sonra: `ue grooms --args '{"only": [...]}'` ve `mh-convert --grooms --groom <stil> --manifest`. Tek cinsiyete özgü saç varsa `mh/gender_compat.json`'a yaz.
  - **Bitti sayılır:** 5 saç oluşturucuda seçilebiliyor; her yüze oturuyor ve kafa derisi açıkta kalmıyor.

- [ ] **A3b. Üç saçı kaldır** (kullanıcı kararı, 2026-10-27):
  - "Kısa, alnı açık / Short receding" (`groom.hair.Hair_S_HairLoss`) yalnız erkek saçı (`gender_compat.json:19`). Erkekten kalkması tamamen silinmesi demek: Medium layered ile aynı yol (curate'te gizle, onayla prune).
  - "Orta boy katlı kesim / Medium layered" (`groom.hair.Hair_M_Layered`) yalnız kadın saçı (`pipeline/src/asset_pipeline/mh/gender_compat.json:7`). Kadından kalkması tamamen silinmesi demek: `/[locale]/curate`'te gizle, sonra kullanıcı onayıyla `mh-prune --apply --plan <özet>`.
  - "Uzun dağınık / Long messy" (`groom.hair.Hair_L_MessyClumps`) unisex. İki cinsiyetten de tamamen silinir (kullanıcı kararı): Medium layered ile aynı yol.
  - Üçü tek prune planında silinebilir.
  - Sonra `mh-convert --manifest`, `node scripts/r2-sync.mjs`. Bu saçları giyen kayıtlı karakterleri `reconcile.ts` boşa düşürmeli; denenir.
- [ ] **A4. Kendi kıyafetimiz: düz tişört.** Plan `docs/handoff.md` "Kendi kıyafetimiz" bölümünde.

## B. Panelde olan ama sahnede çalışmayan ayarlar

`web/src/features/avatar/mh/resolve.ts` bu ayarların hiçbirini okumuyor. Config yazılıyor, ama sahnede bir şey değişmiyor.

- [ ] **B1. Göz rengi tonu** (`eyes.color`, `EyesPanel.tsx:47`). Iris shader'ında seçilen ton uygulanır; `null` doğal renk demektir.
- [ ] **B2. Yüz karıştırma** (`face.blend`, `FacePanel.tsx`; `randomize.ts` de yazıyor). MetaHuman kafalarının topolojisi ortak: vertex konumları, morph delta'ları (ARKit + viseme) ve kafa eklemleri (göz, çene) ağırlıkla karıştırılır. Cilt seçili kalır. C7 bu altyapıyı kullanacak. **Bitti sayılır:** karışık yüz konuşurken dudak senkronu ve göz kırpma bozulmuyor.
- [ ] **B3. Dövme** (`tattoos`, `schema.ts:103`, `TattooPanel.tsx`, `web/src/features/creator/tattoos.ts`). Cilt shader'ında gövde ve kafa UV'sine bir katman eklenir. Tasarımlar küçük ve ölçülü kalır; yerleşim UV'leri gövde GLB'sinden ölçülür.
- [ ] **B4. Takı** (`accessories`, `JewelryPanel.tsx`, `web/src/features/avatar/accessories/`). Bu kod anime döneminden kalma (VRoid kulak arama vb.); MetaHuman kafa ve gövde mesh'ine ve eklemlerine bağlanır. **Bitti sayılır:** küpe, kolye ve yüzük idle ve konuşma sırasında yerinde kalıyor ve mesh'e girmiyor.

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

## D. Kapanış

- [ ] **D1. Küçük resimler.** Yüz, saç ve kıyafet küçük resimleri `/dev/thumbs` ile yeniden üretilir (A-pose hatası `motion.ts`'te düzeldi; eski görseller A-pozunda ve koyu fonda). Açık fon düşünülebilir. Sonra `cd web && node scripts/r2-sync.mjs`.
- [ ] **D2. Son kontrol.** Landing, yeni kadın ve erkek karakter, yeni özellikler, Bitti, konuşma ekranında TR ve EN birer cümle (ses ve dudak). Konsolda `THREE.Clock` uyarısından başka hata olmamalı. Sonuç kullanıcıya ekran görüntüleriyle bildirilir.

## Kullanıcıya sorular

(Bekleyen soru yok.)
