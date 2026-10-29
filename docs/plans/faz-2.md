# Faz 2 — Panel ve temel kıyafet (~60 sa)

> Kaynak: `docs/todo.md` "Sıra" tablosu, Faz 2 (2a → 2b → 2c → 2d → 2e). Kurallar o dosyanın "Çalışma kuralları" bölümünde; burada tekrar edilmez.
> Her adım tek başına biter: doğrulama, commit, push. Yarım adım push'lanmaz. Oturum kesilirse yenisi ilk açık kutudan devam eder.
> Süreler saat. "Tahmin" plan anındaki kaba tahmin, "Gerçek" adım bitince yazılır.
> Kullanıcı 2026-10-29'da yalnız 2a'yı istedi ("faz 2 a yı yap sadece"). 2b-2e sırası gelince adımlara bölünür.

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
  - Yapılmadı: sürüklerken canlı önizleme (seçenek B, kullanıcıya soruldu, cevap bekleniyor).

## 2b — Dövme, takı (B3 → B4), tahmin ~16

Sırası gelince adımlara bölünür.

## 2c — Küçük resimler (D1), tahmin ~5

Sırası gelince adımlara bölünür.

## 2d — Tişört, şortlar (A4.2 → A4.3), tahmin ~13

Sırası gelince adımlara bölünür.

## 2e — Çorap ve külotlu (A4.5), tahmin ~12

Sırası gelince adımlara bölünür.
