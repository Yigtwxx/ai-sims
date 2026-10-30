# Faz 2 — Panel ve temel kıyafet (~60 sa)

> Kaynak: `docs/todo.md` "Sıra" tablosu, Faz 2 (2a → 2b → 2c → 2d → 2e). Kurallar o dosyanın "Çalışma kuralları" bölümünde; burada tekrar edilmez.
> Her adım tek başına biter: doğrulama, commit, push. Yarım adım push'lanmaz. Oturum kesilirse yenisi ilk açık kutudan devam eder.
> Süreler saat. "Tahmin" plan anındaki kaba tahmin, "Gerçek" adım bitince yazılır.
> Kullanıcı 2026-10-29'da yalnız 2a'yı istedi ("faz 2 a yı yap sadece"). 2b-2e sırası gelince adımlara bölünür.
> Sıra değişti (kullanıcı kararı, 2026-10-29): 2a'dan sonra **2e** ("evet 2e yi yap sadece"), sonra 2b → 2c → 2d. 2e'nin teknik bir bağımlılığı yok: 2b ile aynı cilt shader'ına dokunur, şortlar (2d) gelince uzun çorap bir kez kontrol edilir.
> Yeniden tahmin (2026-10-29, Faz 1 ve 2a'nın gerçek sürelerinden): 2b ~6, 2c ~1.5, 2d ~7, 2e ~2.5; kalan ~17 sa (aralık 12-25).
> Sıra yine değişti (kullanıcı kararı, 2026-10-29, "2cyi yap"): 2e'den sonra **2c**, sonra 2b → 2d. Bağımlılık yok: `/dev/thumbs` yalnız yüz, groom ve kıyafet çiziyor (dövme ve takının küçük resmi yok); 2d'nin yeni kıyafetleri küçük resimlerini kendi adımlarında alır.

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

## 2b — Dövme, takı (B3 → B4), tahmin ~16 (yeniden ~6) · gerçek ~5 (bitti 2026-10-30)

**Hedef:** Panelde seçilen küçük dövmeler deride, seçilen yerde ve doğru boyda; giysinin ve çorabın altında kalıyor. Küpe, kolye, bilezik, yüzük ve piercing'ler idle ve konuşma sırasında yerinde kalıyor, mesh'e girmiyor (todo B4'ün "bitti" tanımı).

**Mimari:** Yalnız web; Unreal, Blender ve pipeline gerekmez.
- Dövme: tasarımlar vektör (SVG yolu, ince çizgi), panel ve sahne aynı tanımı kullanır. Sahnede bir kez canvas'a çizilen 4×2'lik atlas. Cilt shader'ına katman eklenmez: kafa malzemesi 16 doku biriminin hepsini kullanıyor (`materials.ts:78`). Onun yerine **çıkartma yaması**: dövmenin altındaki deri üçgenleri kopyalanır (konum, normal, iskelet ağırlıkları, morph'lar; etkiler deriyle paylaşılır, `sockCuff.ts` deseni), deriyle aynı yerde çizilir (polygon offset), mürekkep çarpımlı karışımla deriyi koyulaştırır. Dövme koordinatı UV'den değil yamanın kendi izdüşümünden gelir (teğet düzlem, kiriş boyuyla), UV dikişi sorun olmaz. Yerleşim çalışma anında, dinlenme pozunda eklemlerden anatomik hedef ve en yakın deri noktasıyla bulunur. Gövde yaması `bodyHidden`'ı da kopyalar (giysi altında görünmez); çorap bileği örterse bilek dövmesi çizilmez.
- Takı: anime döneminden kalan `accessories/` (VRoid kulak arama, MToon'a göre malzeme seti, `rig.ts`'siz katalog) silinir, yeniden yazılır; prosedürel geometri yardımcıları (`geometry.ts`, `math.ts`) kalır. İki bağlama:
  - Halka parçalar (kolye, gerdanlık, bilezik, saat, yüzük): dinlenme pozunda boyun, bilek ya da parmak kesitine oturan merkez çizgisi, yüzeyden açıklıkla; her vertex en yakın deri noktasının iskelet ağırlıklarını alır (kafa ağırlıkları gövde iskeletine çevrilir), gövde iskeletine bağlı `SkinnedMesh`. Kaydırıcılar durunca yeniden kurulur (kıyafet katmanlama gibi). Giysi altında kalan kısım gövdenin `bodyHidden` maskesiyle gizlenir.
  - İğneli parçalar (küpe, piercing): kafa ya da gövde üçgenine barisentrik iğne (`SkinPin`), her karede morph ve iskeletle CPU'da; dudak senkronu ve ifadeleri izler. Sarkan küpeler yerçekimine asılı, kısa bir sarkaç gecikmesiyle.
- Katalog (kullanıcı, 2026-10-30: "anime dönemine ait bir şeyle karşılaşırsan silebilirsin"; handoff: "dövme ve piercing ölçülü"): gözlük C8'e gider (orada Fab'den gelecek), saç aksesuarları (fiyonk, çiçek, yıldız toka, çapraz toka) anime döneminin, silinir. Dudak halkası, Monroe, kaş halkası ve industrial ölçülü değil, silinir. Yeni `finger` yuvası: yüzük (düz alyans, tek taş, mühür). Kalan: kulak 6, boyun 6, bilek 4, parmak 3, burun 3, kaş 1, dudak 1 (labret), kıkırdak 3, göbek 1.

### Genel kısıtlar

- `CharacterConfig` değişmez (`tattoos` ve `accessories` şemada); bilinmeyen takı kimlikleri `reconcileAccessories` ile zaten düşer, migration yok.
- Seçim değişimi cilt malzemesini yeniden derletmez: dövme ve takı yalnız kendi mesh'lerini kurar.
- UI metinleri `web/messages/{tr,en}.json`.

- [x] **2b.1 Dövme tasarımları.** Tahmin 0.7 · Gerçek 0.3. `creator/tattoos.ts` `TATTOO_ART`: 8 ince çizgi tasarım (100×100 viewBox, stroke yolları); panel Phosphor ikonları yerine bu çizimleri gösteriyor; `avatar/mh/tattooAtlas.ts` atlası (4×2, hücre 512 px, kırmızı kanal kapsama, çizgi çevresinde hafif mürekkep yayılması) tarayıcıda bir kez çiziyor.
- [x] **2b.2 Dövme yaması ve yerleşim.** Tahmin 1.5 · Gerçek 2.5
  - `avatar/mh/restPose.ts`: `atRest` (iskelet kaydırıcılı dinlenme pozunda ölçer, pozu geri koyar), `sampleRest` (yüz morph'ları kapalı), `restJoint`/`faceJoint`.
  - `avatar/mh/tattoos.ts`: `placementRay` (eklemlerden ışın: iç bilek başparmağa 75° dönük, ön kol dış yüz, köprücüğün iç ucu, kulak kökünün arkası, dış ayak bileği, kürek kemiğinin üst dış köşesi, ense), `castToSkin`, `patchGeometry` (merkezi tasarımın 0.8 katı içinde, yüzü ±%20'den fazla dönmemiş ve teğet düzlemin 4 mm'den fazla üstüne çıkmayan üçgenler; konum, normal, iskelet, `bodyHidden`, `legHeight`, cilt UV'si ve morph'lar kopyalanır; tasarım koordinatı kiriş boyuyla izdüşüm), malzeme (çarpımlı mürekkep, polygon offset; giysi maskesi, çorap boyu ve deriye çizilen iç çamaşırı mürekkebi örter: iç çamaşırı uniform'ları deri malzemesiyle paylaşılır).
  - `MhCharacter`: `tattoos` prop'u; giysi değişince `syncTattooHide`; giysi gösterimi ayrı `dress` adımı. Oluşturucu: yerleşim seçimi `CreatorScreen`'de; dövme sekmesinde kamera noktayı her karede izliyor (`CameraRig` `spot`, `spotPose`: deri normali boyunca, sahnenin önüne doğru), sırt, ense, kulak ve ayak bileği için karakter dönüyor (`focusHeading`, `Turntable` `heading`), o dövmeyi örten giysiler (`hidesTattoo`, giysinin maskesi yamaya değiyorsa) ve bilekteki çorap önizlemede çıkıyor (kullanıcı isteği, 2026-10-30: "dövmeyi gösterecek şekilde ekran da zoom yapsın veya kıyafetin altını göstersin").
  - Bulgular: kafa mesh'i boynu ve omuz üstünü de kapsıyor, dikiş gövdeye takılı halde ~1.28-1.35 m'de; köprücük ve ense dövmeleri iki mesh'e bölünüyor ve kesintisiz. Yüz iskeletinin kendi kemikleri (`FACIAL_*`) gövdenin kafa kemiği altında santimlerce kayık duruyor (deri onlara bağlı değil); kulak gibi yüz noktaları kafa mesh'inin ters bind matrislerinden hesaplanıyor (`faceJoint`). Kafa dosyası tek başına yüklenince kulak 1.60 m'de, takılı karakterde 1.53 m'de: ölçümler tarayıcıda, takılı karakterde yapılmalı. Göğüsteki koyu dörtgen gölgeler dövmelerden bağımsız, önceden var (saç kartı gölgesi olabilir).
  - Kontrol: `/dev/mh?tattoo=all` (sabit poz) ve oluşturucu: yedi yerleşim yerinde ve dik; ay köprücükte kafa-gövde dikişini kesintisiz geçiyor; kazak giyiliyken kürek kemiği seçilince kazak çıkıyor, sekme değişince geri geliyor.
- [x] **2b.3 Takı altyapısı ve katalog.** Tahmin 1 · Gerçek 0.5. Anime döneminden kalan `accessories/anchors.ts`, `surface.ts`, `materials.ts` (MToon'a göre) silindi; `geometry.ts` ve `math.ts` kaldı. Katalog yeni yuvalarla (kulak, boyun, bilek, `finger`, burun, kaş, dudak, kıkırdak, göbek; 28 parça), gözlük (C8), saç aksesuarları, dudak halkası, Monroe, kaş halkası ve industrial çıktı. `accessories/materials.ts` yeniden: cilalı metal, kesme taş (geçirgen değil, faset + güçlü ortam yansıması), inci (sedef ve yanardönerlik), kadife. `accessories/pieces.ts`: parçaların prosedürel geometrisi.
- [x] **2b.4 Küpe, kolye, bilezik, yüzük.** Tahmin 1.5 · Gerçek 1.2
  - `mh/jewellery.ts`: iğneli parçalar dinlenme pozunda yüz iskeletinin noktalarına (kulak memesi `FACIAL_*_Ear4`, kıkırdak `Ear2/3`, burun deliği, burun ucu, alt dudak derisi, göz) en yakın ve dışa bakan deri üçgenine iğnelenir, her karede morph ve iskeletle o üçgenden okunur; "yukarı" kafa (göbekte `spine_01`) kemiğiyle taşınır. Halka küpeler, kristal damla, yıldız sallantı, burun halkası ve septum yerçekimine asılı, sönümlü sarkaçla sallanır; deriye doğru en çok boylarının %15'i kadar girebilirler.
  - Kolye: her açıda zincir çenenin altından boyun dibine ve trapeze bırakılır (aşağı ışın), önde göğüs boyunca aşağı kaydırılıp dışarıdan göğse oturtulur; böylece boyun dibinden kolye ucuna kadar sürekli. Gerdanlık boynun ortasında. Bilek ve yüzük: kol ya da parmak ekseninden dışa ışınlarla kesit; uzak isabetler (komşu parmak, uyluk) elenir, sert yuvarlak parçalar (bilezik, yüzük) kesitin %80'lik yarıçapını alır. Merkez çizgisinin her noktası altındaki derinin iskelet ağırlıklarını alır (kafa ağırlıkları gövde iskeletine adla çevrilir), parçalar gövde iskeletine bağlı `SkinnedMesh`; kaydırıcılar durunca yeniden kurulur. Giysi bir halka parçanın gövde derisinin %35'inden fazlasını örterse parça gizlenir.
- [x] **2b.5 Piercing'ler.** Tahmin 0.7 · Gerçek 0.3 (2b.4 ile aynı yol). Burun taşı kanatta, burun halkası ve septum asılı, kaş çubuğu kaşın dış ucunda dikey, labret alt dudağın hemen altında, kıkırdak halkası ve üç taş üst kenarda (eklemler kenarın arkasında, taşlar öne kaydırıldı), tragus, göbek halkası.
- [x] **2b.6 Doğrulama ve yayın.** Tahmin 0.5 · Gerçek 0.3
  - `/dev/mh?jewelry=` (sabit poz) ve `/dev/stage?jewelry=` (konuşma ve jestler): küpeler memede, halka memeden geçip sarkıyor; inci kolye ve kalpli zincir boyun dibinde, konuşurken ve el kaldırırken yerinde; burun halkası, septum ve labret dudak senkronunda deride; bilezik ve yüzük bilekte ve parmakta.
  - `pnpm typecheck`, `pnpm lint`, `pnpm test` (1033) temiz. Takı sekmesinin çerçevesi kafadan büste alındı (kolye görünsün).
  - Bilinen sınırlar: saat kayışı bileğin yanlarında biraz açıkta; saat kadranı düz koyu disk; yüzük taşı parmağın üstüne değil yanına dönebiliyor (elin sırtı parmak kemiğinden kestiriliyor). Takının küçük resmi yok, panel renk noktası gösteriyor.

## 2c — Küçük resimler (D1), tahmin ~5 (yeniden ~1.5) · gerçek ~0.8 (bitti 2026-10-29)

**Hedef:** Yüz, saç, kaş, sakal, bıyık ve kıyafet küçük resimleri açık fonda ve doğru pozda; sitede yenileri görünüyor.

**Mimari:** Kod değişikliği beklenmez. `/dev/thumbs` bugün sitenin kâğıt tonlu fonunda (`Stage` `light` backdrop) ve düzeltilmiş pozla (`motion.ts`) çiziyor; 21 Ekim'de çizilen ~90 görsel koyu fonda ve A-pozunda. Dosya yolları aynı kalır (`<öğe klasörü>/thumbnail.webp`), manifest yolları zaten içeriyor.

- [x] **2c.1 Örnek tur.** Tahmin 0.3 · Gerçek 0.1. Her türden bir iki öğe (yüz, saç, kaş, sakal, bıyık; üst, alt, ayakkabı, tek parça): kadraj, poz, fon ve oturma kontrol edilir. Sorun varsa bench düzeltilir.
  - Sonuç: 9 örnek hatasız, öğe başına ~17 sn. Kâğıt tonlu fon, ayakta doğal duruş; kadrajlar öğeye oturuyor. Bench'te değişiklik gerekmedi.
- [x] **2c.2 Hepsi.** Tahmin 0.7 · Gerçek 0.5 (çoğu bench'in kendi koşusu). "Render all"; hata verenler yeniden; hepsi bir temas sayfasında gözden geçirilir.
  - Sonuç: 99 görsel (23 yüz, 26 saç, 11 kaş, 14 sakal ve bıyık, 25 kıyafet) ~28 dakikada, hatasız ve yeniden denemesiz. Temas sayfasında bozuk, yarım yüklenmiş ya da A-pozlu görsel yok.
- [x] **2c.3 Yayın.** Tahmin 0.5 · Gerçek 0.2. Yalnız küçük resimler `r2-sync` ile; manifest eksik `thumbnail` alanı varsa `mh-convert --manifest`. Oluşturucu panellerinde yeni görseller; `docs/todo.md` D1 `[x]`, handoff "Durum"; commit + push.
  - Sonuç: 99 dosya R2'de (örneklerin md5'i yereldekiyle aynı); manifest değişmedi, yollar zaten içindeydi. R2 önbelleği bir saat (`max-age=3600`): açık sekmeler eski görseli bir süre gösterebilir.

## 2d — Tişört, şortlar (A4.2 → A4.3), tahmin ~13 (yeniden ~8)

**Hedef:** Kendi düz tişörtümüz (kadın ve erkek) ve üç şort (mini kot şort K, kumaş mini şort K, diz üstü kot şort E) sitede; A4'ün "bitti" tanımı: kumaş deriye girmiyor, altından cilt görünmüyor, kaydırıcı uçlarında kırılmıyor, idle ve talk'ta yırtılmıyor, renk presetleri çalışıyor.

**Mimari:** Kalem eteğin yolu (`asset-pipeline garment`: ölç, kalıp, Blender, paket, `mh-convert`). Ölçüm (2026-10-30): taban gövdede kollar yataydan 52.6° aşağıda (A-pozu); omuz eklemi kadında (0.151, 1.377), erkekte (0.203, 1.55); `is_arm_joint` köprücüğü de kol sayıyor, gövdenin yarısı (16.090 köşe, omuz üstü dahil) "kol". Etekteki ızgara yolu tüp parçalar içindir; kol ağzı ve omuz dikişi olan tişört ızgaraya sığmaz.
- Tişört: gerçek düz kalıp (ön, arka, iki kol; 2D çokgen, üçgenlenmiş). Parçalar gövdeye ve kola sarılı başlar, Blender'ın dikiş yayları (`use_sewing_springs`) yan, omuz, kol altı ve kol ağzı dikişlerini kapatır; sonra dikiş çiftleri kaynaklanır ve kumaş yerçekimiyle oturur. UV kalıbın düz koordinatı, dikiş çizgileri kalıp kenarlarından gelir.
- Şortlar: önce ızgara yolu (etek gibi, iki bacak + ağ); olmazsa tişörtün dikiş yolu.
- Kot: Epic kotunun ustası (`M_jeans_nrm_custom_master`) renk parametresi taşımıyor (OA_Jeans'te preset yok); kot şortlar `M_fabric_simpler` ile, kot döşeme haritalarıyla ve yıkama presetleriyle denenir.

- [x] **2d.1 Dikişli kalıp yolu.** Tahmin 2.5 · Gerçek ~2
  - `garments/flat.py`: düz parça (adlı kenar parçalarından saat yönü tersine çokgen), üçgen kafes + Delaunay (düz kenardaki eş doğrusal şeritler atılıyor; yoksa kaynakta üç yüzlü kenar çıkıyordu), dikişin iki yanı aynı sayıda örneklenir, yön başlangıç yerleşiminden seçilir, köşeler birleşim kümeleri (`welds`). Kalıbın düzü kumaşın dinlenme şekli (Blender `rest_shape_key`), UV atlası.
  - `garments/collider.py`: taban gövdenin boynu yok (kafa mesh'i boynu ve omuz üstünü taşıyor, gövdenin üst kenarı önde 1.35 m). Ada ve Victor'un kafası web gövdesine çalışma anındaki gibi takılıp (`fit_audit.place_head`) en yakın gövde derisinin farkıyla taban gövdeye taşınıyor; dikiş 0 mm oturuyor. Çenesiz, yalnız boyun.
  - `garment_sim.py`: dikiş yayları (gevşek kenarlar), yerçekimi dikişler kapanınca 10 karede açılıyor, sonra kaynak (küme ortalaması, `weld_verts`, bozuk üçgenler), deriye 4 mm'den yakın köşeleri dışarı itme (`push_out`), Solidify'da çift ofset kapalı ve sıkıştırma açık (köşelerden diken çıkıyordu).
  - `BaseBody.limb` (köprücüksüz kol) ve `joints` (bağlama konumları).
- [x] **2d.2 Düz tişört K/E.** Tahmin 2 · Gerçek ~2.5 (`AS_CrewTee`, "Düz tişört" / "Plain tee")
  - `garments/tee.py`: genişlikler gövde çevresi + bolluk (kadında belden hafif içeri, erkekte düz), boylar gövde ve boynun sagital kesitinin dışbükey zarfından (göğsü ve boyun çukurunu kumaş gibi köprüler), omuz noktası omuz ekleminin 4.5 cm dışı, kol çevresi kol derisinin kesit kutusundan (erkek taban gövdenin kolu ~44 cm). Kol kapağı yüksekliği kol oyuğu uzunluğuna eşitlenir.
  - Başlangıç: gövde parçaları her yükseklikte gövde kesitine (kesitin dörtte biri kalıbın yarı genişliği olacak kadar büyütülmüş) sarılı; kol oyuğu üstünde yalnız dış yarı daraltılıyor (tümü daraltılınca sırtta yatay kırışık ve %50 dikey gerilme kalıyordu); kollar kol ekseni etrafında. Jarse ayarı: bükülme 0.5 (0.05 buruşuk, 2.0 A kesim gibi açılıyor), çarpışma 5 mm.
  - Malzeme Crewneckt kalıbı ama tüy, boncuklanma ve melanj benek kapalı (kullanıcı, 2026-10-30: "bütün tişörtler tüylü gözükmek zorunda değil"). UV çeyrek dönük: örgü çizgileri dikey. Yakada 1x1 ribana izi, etek ve kol ucunda çift iğne çizgisi.
  - Erkekte kapsama "full" çıkıyordu: `CATEGORY_OVERRIDES` ile `top`. `fit_audit.CREW_NECKS`'e eklendi.
  - Kontrol: `gltf-transform validate` hatasız (uyarılar kalem etekle aynı). `mh-fit-audit`: yaka bütün yüzlerde ve kilo −1, omuz −1'de temiz; pozda deri taşması erkek konuşmada 2 köşe / 7.9 mm, boşta 2 / 4.7 mm (Epic Crewneckt: 5-11 köşe / 17-19 mm). `/dev/stage`'de Ada ve Victor; nötr, kilo ±1, göğüs +1, kas +1; önden ve arkadan.
  - Bilinen: kadında kol kapağının arkasında pozda küçük açık renkli benekler; sırtta kol ağzı yakınında yer yer kumaş kıvrımı.
- [x] **2d.3 Kumaş mini şort (K).** Tahmin 1.5 · Gerçek ~2 (`AS_MiniShorts`, "Pamuklu mini şort" / "Cotton mini shorts")
  - `garments/shorts.py`: dört parça (iki bacak × ön/arka), yan dikiş, iç bacak ve ağ (ön ve arka orta) dikişleri; genişlikler kalça (iki bacak tek zarfta), ağın hemen altında uyluk ve paça çevresinden, ön pay %47. Yan dikiş kalçadan aşağı içeri gelir, böylece bacak ağda kendi genişliğinde (önce kalçanın yarısı + ağ uzantıları kadardı, bacaklar balon gibi duruyordu).
  - Başlangıç: ağın üstünde satır kalçayı ön ortadan yan dikişe sarar, ağ uzantısı gövdenin altına, ağ noktasına giden kirişe katlanır; ağın 7 cm altına kadar bacağın kendi halkasına yumuşakça geçer. Halkalar ön/arka kalıp payına göre bölünür (x uçlarından bölününce paça %7 gerili ve buruşuk başlıyordu). Bel bandının yalnız üst 12 mm'si iğneli.
  - Dokuma ayarı (`TWILL`): bükülme 1, gerilme 30, çarpışma 2.5 mm (5 mm'de iki uyluk arasında kumaşa yer kalmıyor, iç paçalar fırfır gibi buruşuyordu), sürtünme 1. Malzeme `WI_OA_Shorts` şablonundan (`write_unit(template_unit=...)`), tüysüz.
  - Kontrol: validate hatasız; `mh-fit-audit` Epic `OA_Shorts`'la aynı düzeyde (konuşmada deri taşması 0-1 köşe / ≤2.3 mm). `/dev/stage`'de Ada: nötr, kalça +1, kilo +1, önden ve arkadan; tişörtle birlikte.
  - Bilinen: önde ağ hizasında, iki uyluk arasını köprüleyen hafif yatay kıvrım ve ağa doğru kıvrımlar.
- [x] **2d.4 Kot şortlar.** Tahmin 1.5 · Gerçek ~1.5 (`AS_DenimMiniShorts` "Kesik paça mini kot şort", K; `AS_DenimShorts` "Kıvrık paça kot şort", E, diz üstü)
  - Epic kotunun ustası (`M_jeans_nrm_custom_master`) web'de düz PBR ve renk parametresi yok; kot kumaş shader'ında: Epic kotunun dimi normal'i (`micro_jeans_tile_N`, ~2.5 mm döşeme) ve yıkama dalgalanması (`tile_overlay_D`, ~18 cm, makro varyasyon) başka birimden alınıyor (`pack.Look`). Dikişlerde ve paçada solma (`fades`), çift sıra dikiş, önde cep ağzı ve fermuar J'si, arkada roba ve cep (`to_uv`: kalıp noktası → UV), kesik paçada saçak iplikleri (`frays`), kıvrık paçada kat çizgisi. Presetler: açık, orta, koyu yıkama, siyah ve beyaz kot; dikiş rengi `diffuse_color_2` (altın).
  - Erkekte başlangıç tırtıklıydı: bacak dilimlerinde 12 mm'de ~35 köşe var, zarflar dilimden dilime zıplıyor, satırlar %290'a kadar gerili başlıyordu. Halkalar artık üçgenlerin düzlemle tam kesitinden (`shorts.Sections`); pamuklu mini şort da yeniden üretildi (gerilen kenar 237 → 137, gövdeye giren başlangıç noktası 0).
  - Kontrol: validate hatasız, manifest zod temiz; `mh-fit-audit` konuşmada deri taşması ≤3 köşe / ≤12 mm (Epic şortu düzeyinde). `/dev/stage`'de Ada ve Victor tişörtle.
  - Bilinen: erkekte arkada ağ dikişi boyunca konuşurken küçük bir yarık izi.
- [x] **2d.5 Küçük resim, doğrulama, yayın.** Tahmin 0.5 · Gerçek 0.4
  - `/dev/thumbs` "eksikleri çiz": dört yeni küçük resim (beyaz tişört, bej pamuklu şort, açık yıkama mini kot, orta yıkama erkek kot). Manifest küçük resimlerden önce yazılmıştı, panel baş harf gösteriyordu: `mh-convert --manifest` sonra; R2'de manifest, dört kıyafet klasörü ve `mobile-textures.json`.
  - `pnpm typecheck`, `pnpm lint` temiz, `pnpm test` 1018 geçti (15 atlandı); pipeline `ruff` temiz, `pytest` 436 geçti.
  - Kıyafet klasörlerinde önceki dönüşümlerden kalan, manifestin göstermediği eski `ktx2`'ler var (`AS_CrewTee`): `mh-prune` siler.

## Faz sonu kontrolü

- [x] 2026-10-30: landing (TR), oluşturucuda yeni kadın karakter, Alt'ta iki yeni kadın şortu ve beş yıkama preseti, tişört + kesik paça kot şort sahnede; "Bitti", kayıt, konuşma ekranında TR "Nasılsın?" (~4 sn) ve EN "How are you?" yanıtlandı; konsolda hata yok. Gerçek süreler: 2a ~1, 2b ~5, 2c ~0.8, 2d ~8, 2e ~1 (toplam ~16; tahmin ~60).

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
    - İkinci tur (kullanıcı: "parmaklar hâlâ belli", "dümdüz geçiyor, boyanmış gibi"): parmaklar en sonda 5 voksel bulanık kapalı yüzeye yansıtılıyor (`TOE_BOX_BLUR`), uçların ayrı tümsekleri tek bir çorap burnuna dönüyor; voksel düzeltmesi ince alanda kalıyor. Çorap deriden 1.5 mm kalkık (naylon 0.4 mm, vertex shader'da örtülü vertex'ler bağlama pozu normaliyle), kenar bir basamak; üstündeki deride 1 cm'de sönen temas gölgesi. Ayakkabı ağzında ve kot altında taşma yok. İlk "düzelmemiş" ekran görüntüsü deploy'dan önceki sayfaydı (deploy 13:14:50'de hazırdı).
    - Üçüncü tur (kullanıcı: "bilek kısmı yine tam olmamış", "uçtaki boğum boğum girintiler", "genel olarak iyi, minik dokunuşlarla mükemmel olsun"): vertex kabuğu kaldırıldı; kenarı kesen üçgenler 10-13 mm olduğu için hep rampa yapıyordu. Yerine **manşet halkası** (`web/src/features/avatar/mh/sockCuff.ts`): kenar çizgisi gövde üçgenlerinden çıkarılıyor, her kesişimde kıvrık bir ağız profili (pamuk ~2 mm, naylon ~1 mm, çorap yüzeyine inen) kuruluyor; UV, iskelet ağırlıkları, kaydırıcı morph'ları (etkiler gövdeyle paylaşılıyor) ve giysi maskesi üçgenden alınıyor, malzeme gövdenin cilt malzemesi. Külotlunun bel bandı alt giysi ya da tek parça varken kurulmuyor: maskeler bel ağzında temkinli, bant dar taytın içinden taşıyordu. Parmaklar: zarfın içinde kalan noktalar parmakların içinden geçen bir omurgadan dışarı itiliyor (`toe_spine`, `push_out`), çentiklerin yanları öne, kutunun ön yüzüne çıkıyor; yan yüzler %60'ta buluşup bindiriyor; ters dönen ve zarfın içine katlanan üçgenler (delik ve karanlık yarık) gevşetiliyor (`unfold`); zarf parmak köklerinde tam (`WEIGHT_FULL` 0.12). Kalan: başparmak kökünde çok hafif, yumuşak bir çukur.
    - Dördüncü tur (kullanıcı, 2026-10-29: "çorapların boğaz kısmı tam düzgün değil"): manşetin alt kenarı tırtıklıydı. Halkanın alt sıraları kenardan düz aşağı uzatılıyordu; bacak eğimli ve kavisli olduğu için incelen kısım deriye çok sığ bir açıyla giriyor, deri yüzleri halkanın içinden düzensiz bir çizgiyle çıkıyordu. Artık alt sıralar kendi yüksekliklerinde bacağın karşısına çizilen yatay doğrunun deriye değdiği noktaya oturuyor (`SkinBand.hit`); UV, iskelet ağırlıkları ve morph'lar o noktanın üçgeninden alınıyor. İncelme deriden 0.5 mm yukarıda bitiyor ve dik açıyla derinin altına giriyor. Her kesişen üçgen 4 sütuna bölünüyor, böylece uzun bir kiriş ortasında deriye batmıyor. Isabet yalnız kenarın UV adacığında sayılıyor (`UV_REACH`): belin ön ortasındaki UV dikişinde öbür adacığa oturan sütunlar bandın altında siyah parçalar bırakıyordu. Bilekte, diz altında (kilo +1 dahil) ve külotlunun bel bandında kontrol edildi; eski koddaki bel bandı çentiği ve ön orta dikiş çizgisi de kayboldu, ön ortada 1-2 piksellik bir iz kaldı. `/dev/stage`'e `focus` seçici ve konsoldan kamera yardımcısı (`devStage.look`, `devStage.at`) eklendi.
    - Beşinci tur (kullanıcı, 2026-10-29: çorap ucunda "sağa sola döndürdüğüm zaman bu oluyor", karanlık yarık): yarıkları `unfold` açıyordu. Ters dönen üçgenlerin köşelerini en sonda deriye geri çekiyor, köşeler parmak kutusunun 6 mm'ye kadar içine iniyordu (ayak başına ~260 köşe 1 mm'den derin, `unfold`'dan önce hiç yok). Ölçüm: altı-on açıdan ortografik ışınlar, GPU gibi ters yüzler atlanır, ilk ön yüz kutunun 1 mm'den içindeyse kusur. `unfold`'u kaldırmak bind pozunda daha da iyiydi, ama pozda parmak arası yapraklar dışarı taşıyordu (tarak eklemi ayağa göre ~3.7° bükülüyor, itilen köşeler eski ağırlıklarıyla bükülüyor); sarkan yüzleri dışarı kaldırmak da kanatçık çıkardı. Kalan çözüm: `unfold` kalıyor (yaprakları kutunun altına sokuyor), ama sonunda hiçbir köşe kutunun `PIT_DEPTH` (1 mm) altında kalmıyor (`hold_under`, sock-toes-v14). Kusurlu ışın oranı yayındaki %1.62 / %2.07'den (sol / sağ ayak) %0.57 / %0.67'ye indi, dışarı taşma aynı (en çok 1.9 mm). Tarayıcıda sol ayaktaki kök yarıkları kayboldu. Kalan: sağ ayakta büyük parmak kökünün üstünde, yalnız pozda açılan küçük bir delik (yayındakinde de vardı). Nedeni tarak bükülmesi; düzeltmesi itilen köşelere varış yerinin iskelet ağırlıklarını vermek (dosya biçimi ve web değişir).
- [x] **2e.3 Panel.** Tahmin 0.5 · Gerçek 0.2 (`2f00956`)
  - `OutfitPanel`: Ayakkabı bölümünde "Çorap": boy seçici (`ChipRadio`; erkekte külotlu yok), renkler (çorap: siyah, beyaz, gri melanj, lacivert, bej, bordo; külotlu: ten rengi, siyah, lacivert, antrasit), külotluda şeffaflık kaydırıcısı (Opak ↔ İnce). Boy değişince renk o boyun paletinde değilse paletin ilkine geçer.
  - `palettes.ts`: `SOCK_COLORS`, `TIGHTS_COLORS`; yeni renk adları (`greyMelange`, `beige`, `nude`).
  - Sonuç: `SocksSection.tsx`, boy değişimi `creator/socks.ts` `restyleSocks()`. e2e: Ayakkabı sekmesinde dört boy, külotluda şeffaflık ve ten rengi seçili, erkeğe geçince külotlu yok ve `none`. Ayakkabı sekmesinde kamera ayaklara iniyor, diz altı manşeti görünüyor.
- [x] **2e.4 Doğrulama ve yayın.** Tahmin 0.5 · Gerçek 0.1
  - `/dev/stage`: kadın ve erkek; çıplak ayak, ayakkabı, etek + külotlu (ince ve opak, ten ve siyah), pantolon (çorap görünmüyor), kaydırıcı uçları, idle ve konuşma. Oluşturucu: seçim, undo, autosave, kayıt, konuşma ekranı.
  - `pnpm typecheck && pnpm lint && pnpm test`; `docs/todo.md` A4.5 `[x]`, handoff "Durum"; commit + push.
  - Sonuç: typecheck ve lint temiz, `pnpm test` 993 geçti (mongod açık), yeni e2e geçti. Undo, autosave ve konuşma ekranı elle denenmedi: çorap sıradan bir config alanı (store'un `update`'i, repository'nin zod okuma/yazması testli); konuşma kamerası bacakları göstermiyor.
