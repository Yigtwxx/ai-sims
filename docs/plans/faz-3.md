# Faz 3 — İş seti ve karakter (~55 sa)

> Kaynak: `docs/todo.md` "Sıra" tablosu, Faz 3 (3a → 3b → 3c → 3d). Kurallar o dosyanın "Çalışma kuralları" bölümünde; burada tekrar edilmez.
> Her adım tek başına biter: doğrulama, commit, push. Yarım adım push'lanmaz. Oturum kesilirse yenisi ilk açık kutudan devam eder.
> Süreler saat. "Tahmin" plan anındaki tahmin (Faz 2'nin gerçek sürelerine göre: kıyafette tahminin ~%60'ı), "Gerçek" adım bitince yazılır.
> Kullanıcı 2026-10-31'de yalnız 3a'yı istedi ("Sadece 3a yı yap şimdi. Sırayla gidicez."): Mac ile PC paralel çalışmıyor, alt fazlar tablodaki sırayla. 3b-3d sırası gelince adımlara bölünür.

## 3a — Kumaş pantolon, gömlek (A4.1), tahmin ~13 (yeniden ~10)

**Hedef:** Kendi kumaş pantolonumuz ve uzun kollu gömleğimiz kadın ve erkekte sitede. A4'ün "bitti" tanımı her parça için: kumaş deriye girmiyor, altından cilt görünmüyor, kaydırıcı uçlarında kırılmıyor, idle ve talk'ta yırtılmıyor, renk presetleri çalışıyor. Blazer 7b'de (A4.1'in kutusu açık kalır).

**Mimari:** Tişört ve şortların düz kalıp yolu (`asset-pipeline garment`: ölç, kalıp, Blender dikiş yayları, kaynak, paket, `mh-convert`). Unreal gerekmez.
- Pantolon: şortun dört parçalı kalıbı (`garments/shorts.py`) uzun paçaya genişler. Kalıba diz kontrol noktası ve eğri iç bacak eklenir; paça ayak bileği ekleminin hemen üstünde (Epic kotunun paçası kadında y 0.081, erkekte 0.091, `foot_l` eklemiyle aynı). Bacak halkaları paçaya kadar gövde kesitlerinden (`Sections`). Ağ çarpışma dolgusu (`crotch_filled`) şortlardaki gibi.
- Gömlek: tişörtün kalıbı (`garments/tee.py`) dokuma kumaşa uyarlanır: uzun kol + manşet, gömlek eteği (yanlarda yüksek, önde ve arkada uzun), kadında yan göğüs pensi (aynı parçanın iki kenarı dikiş), yaka. Ölçüm (2026-10-31): A-pozunda dirsek kadında ~37° bükük ve ön kol öne gidiyor (`lowerarm_l` → `hand_l`: z +0.16), bu yüzden düz kol silindiri yetmez; kol omuz → dirsek → bilek eğrisinde başlar.
- Haritalar (`garments/pack.py`): ütü çizgisi (`creases`, ince sırt) ve dokuda düğme (`buttons`: kubbe, dört delik, ikinci renk maskesi; `Masks` G kanalı `diffuse_color_2`) eklenir. Böylece düğme rengi preset'le ayrı verilebilir.
- Kumaşlar: pantolon yün suiting (Epic'in düz dokuma normal'i `weave_plain_normal`, hafif `macro_heather_04`), gömlek pamuk poplin (Crewneckt şablonunun `micro_poplin_N`'i, tişörtteki ızgara görüntüsü olmasın diye ince döşeme ve düşük güç).

### Genel kısıtlar

- Adlar: `AS_TailoredTrousers` ("Kumaş pantolon" / "Tailored trousers"), `AS_Shirt` ("Klasik gömlek" / "Classic shirt"). İkisi de K/E; `gender_compat.json`'a girmez.
- Renkler (`outfit_tints.json`, ilki varsayılan): pantolon lacivert, antrasit, siyah, deve tüyü, bej; gömlek beyaz, açık mavi, pudra.
- Gömlek `CATEGORY_OVERRIDES`'ta `top` (etek kalçayı örttüğü için `full` çıkabilir); `fit_audit.CREW_NECKS`'e girer (yaka bütün yüzlerde ölçülür).
- Kıyafet başına: `mh-convert --outfits --outfit AS_<Ad> --manifest`, `gltf-transform validate`, `mh-fit-audit`, `/dev/stage`'de iki cinsiyet × nötr ve slider uçları × idle ve talk, önden, arkadan, yandan; `/dev/thumbs`, `node scripts/r2-sync.mjs`.
- Pipeline: `uv run ruff check && uv run ruff format --check && uv run pytest`. Web değişmezse web testleri koşulmaz.

- [x] **3a.1 Uzun paça ve harita altyapısı.** Tahmin 1.5 · Gerçek ~1 (plan dahil)
  - `shorts.py` `LegPattern`: isteğe bağlı diz noktası (`knee_v`, `knee_width`, `side_share`). Ağdan dize daralmanın %35'i yan dikişte (`KNEE_SIDE_SHARE`), gerisi iç bacakta; dizden paçaya iki dikiş düz boy çizgisinin (`grain_u()`) iki yanında eşit iner. İç bacak dizliyken PCHIP eğrisi. `ShortsSpec` yeni adıyla değil, alanlarla genişledi: `above_ankle` (paça `foot_l` ekleminin üstünde), `knee_ease`, `hem_girth` (paça çevresi doğrudan), `knee_side_share`. `ShortsMeasures`: `knee`, `girth_knee`.
  - Şortlar birebir aynı: iki şortun dökümden önceki kalıp kafesinin (konum, düz, sert bant) sha256'sı değişiklikten önce ve sonra aynı.
  - `pack.py` `GarmentLines`: `creases` (ince sırt, biraz aşınma), `raised` (kapalı çevre: dolu, kabarık, çevresinde gölge; kemer köprüsü, fleto dudakları) ve `buttons` (`(u, v, r)` UV biriminde: yuvarlak kenarlı disk, çukur orta, dört delik, çevresine düşen gölge, `Masks` G = 1 yani `diffuse_color_2`, `AO` G'de %45 daha parlak). Yeni çizgi yoksa haritalar eskisiyle aynı.
  - Testler: dizsiz bacağın iç dikişi düz, dizli bacak kapalı ve saat yönü tersine, dizde genişlik, boy çizgisi çevresinde simetri, daralmanın çoğu iç bacakta; ütü çizgisi sırt, kabarık parça ve gölgesi, düğmede renk 2, parlaklık, gölge ve delikler.
- [x] **3a.2 Kumaş pantolon K/E.** Tahmin 3 · Gerçek ~4.5 (`AS_TailoredTrousers`, "Kumaş pantolon" / "Tailored trousers")
  - `garments/trousers.py`: şortun dört parçalı kalıbı (`TROUSERS_FEMALE`, `TROUSERS_MALE`). Paça `foot_l` ekleminin 0.8 / 0 cm üstünde (Epic kotuyla aynı), paça çevresi 38 / 44 cm, diz bolluğu 9 / 11 cm. Diz noktası diz ekleminde (`calf_l`), genişliği dizin ve altındaki baldırın en kalını üstüne: erkek taban gövdede "en dar yer" dizin üstünde çıkıyordu, baldır (44 cm) kumaşa 2 cm bolluk kalıyor ve paça baldırı sarıyordu.
  - Başlangıç: dizin altında halka, o yükseklikten dize kadar bacağın zarfı (`shin`); her yüksekliğin kendi kesitinden başlayınca kumaş baldırın şeklinde kalıyordu, şimdi dizden düz iner. Uylukta tüp dışa kaydırılarak başlar (bolluk dışa, iç duvar kendi uyluğuna `gap` kadar): iki uyluğun arası (erkekte 2.6 cm) iki duvara ancak yetiyor; kadında kaydırma ağın 4 cm altında söner (`thigh_shift_crotch`), yoksa arkada kalçanın altında yatay sıkışma oluyordu.
  - Çarpışma gövdesinde kalça arası yarık da doluyor (`seat`, `back_reach` 15 cm, ağın 22 cm üstüne kadar): erkekte kumaş yarığın içinden başlıyor ve arkada çentik kalıyordu. Sert bantlar: ön ağ 7 / 9 cm (düz fermuar önü), arka ağ 3.5 / 7 cm, yan dikiş 1.5 cm (ütülü dikiş payı; ön ve arka yan dikiş 1.7 / 0.8 cm farklı uzunlukta, yün farkı dalgalanarak alıyordu).
  - Paça kendi bacağını izler: yeni `_LEG` özniteliği (kalıp → Blender → dönüştürücü, `_ARM`'ın karşılığı; ağın 2 cm altından 10 cm altına kadar dolar). Dönüştürücü `limb_blend` (kol ve bacak ortak), `leg_masks`, `leg_transfer`; tişört birebir aynı çıkıyor. Ölçüm: önce sol paçanın 41 / 96 köşesi sağ bacaktan %77'ye kadar ağırlık alıyordu, Epic kotunda 0.
  - Kumaş ayarı `WOOL` (bükülme 6, bant 18, gerilme 40, 90 kare). Görünüm `wool_look`: Epic denim dimisinin normal'i 3 mm döşemede ve zayıf (suiting dimisi), hafif melanj (`macro_heather_04`), tüysüz. Dikişler kumaş renginde (`stitch_strength` 0; ikinci renk görünmediği için preset'te yok).
  - Detaylar (haritada): ön ve arka ütü çizgisi (`creases`), bel bandı dikişi, 6 kemer köprüsü (`raised` + punteriz), eğik yan cep ağzı ve dikişi, arka fleto cep (iki dudak), fermuar J'si. Renkler kalem etekle aynı ton: lacivert, antrasit, siyah, deve tüyü, bej.
  - Kontrol: validate hatasız (uyarılar tişörtle aynı). `mh-fit-audit` (Epic kotu ve kargoyla): bütün kaydırıcı durumlarında deri taşması ≤1 köşe / 2 mm; konuşma klibinin adım tepesinde kadında taşma 0, batma 2 köşe / 5.9 mm; erkekte taşma 4 / 4.2 mm, batma 25 / 8.5 mm (iki uyluğun arası). Epic kotu orada 0-1 / ≤2.5 mm. `/dev/stage`'de Ada ve Victor; Oxford ve spor ayakkabıyla paça temiz.
  - Bilinen: botla bağcıklar paçadan taşıyor (Epic kotunda da var, katmanlama sınırı); erkekte önde ağ belirgin; yan dikişte hafif dalga; kıyafet klasöründe önceki dönüşümlerden kalan eski `ktx2`'ler (`mh-prune` siler).
- [ ] **3a.3 Gömlek kalıbı.** Tahmin 2.5
  - `shirt.py` (tişörtün `torso_rings`, `torso_place`, `surface_length`, `arm_share`'ini kullanır): ön (tek parça; pat ve düğmeler haritada), arka (roba dikişi haritada), iki uzun kol, iki manşet, yaka.
  - Kol: omuz → dirsek → bilek eğrisi boyunca dönmeyen çerçeveyle sarılı başlar (`bent_sleeve_place`); kol kapağı tişörtteki gibi kol oyuğuna eşitlenir; manşet bilek çevresi + bolluk, sert bant.
  - Etek: yanlarda kısa, önde ve arkada uzun yuvarlak gömlek eteği; pantolonun bel bandını örtecek kadar uzun.
  - Kadın: yan göğüs pensi (yan dikişten göğüs ucuna doğru, aynı parçanın iki kenarı `Seam`), dokuma kumaş göğüste gerilmediği için.
  - Yaka: kullanıcı kararına göre (aşağıda soru). Yaka ayağı ve yaka kanadı ön şekilli ve iğneli (`pin` = 1) başlar, yaka oyuğu dikiş yaylarıyla ona dikilir; böylece kanat simülasyonda katlanmaya çalışmaz.
  - Testler: kol yerleşiminin omuz, dirsek ve bilekten geçmesi, manşetin dikiş sayısının kol ağzıyla eşit olması, pensin dikiş çiftleri, etek eğrisinin simetrisi.
- [ ] **3a.4 Gömlek K/E.** Tahmin 3
  - Poplin ayarı (`POPLIN`): bükülme ~1, gerilme ~40; kol ve manşet `_ARM` ile yalnız kolu izler (tişörtteki yol).
  - Detaylar: düğme patı (iki dikiş çizgisi), 6-7 düğme ve iliği, manşette düğme, yaka ve manşet kenar dikişi, arkada roba, erkekte sol göğüs cebi.
  - `CATEGORY_OVERRIDES` (`top`), `CREW_NECKS`, etiket, renkler (düğme rengi `diffuse_color_2`); dönüşüm, validate, fit-audit (yaka bütün yüzlerde temiz), `/dev/stage`: Ada ve Victor; nötr, göğüs +1, kilo ±1, kas +1; idle ve talk; pantolon, şort ve kalem etekle.
  - Küçük resim, R2, commit + push.
- [ ] **3a.5 Kapanış.** Tahmin 0.3
  - `docs/todo.md`: A4.1'e biten parçalar notu (kutu blazer 7b'ye kadar açık), saat tablosunda 3a'nın gerçek süresi; `docs/handoff.md` "Durum"; bu dosyada gerçek süreler.

### Kullanıcıya soru (3a.3'ten önce)

- Gömleğin yakası: **A** en üst düğme açık (doğal, kravatsız ofis görünümü; kapalı yaka 3b'deki kravatlı gömlekte gelir) ya da **B** en üst düğme kapalı (daha basit, yaka boyna oturur; kravatsız resmi durur). Öneri A. Cevap gelene kadar 3a.1 ve 3a.2 (pantolon) yapılır.
