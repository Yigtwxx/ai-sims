# Gerçekçilik Spike'ı — Ara Rapor (2026-10-20)

Amaç: MacBook'ta, tarayıcıda (Three.js / R3F) ulaşılabilir gerçekçilik tavanını ve asset yolunu ölçmek. Spike `http://localhost:3000/spike` adresinde çalışır.

## Yapılanlar

| Alan | Durum |
|---|---|
| Stüdyo | Kesintisiz beyaz fon (high-key), CC0 stüdyo HDRI, sıcak key / soğuk rim / fill ışıkları, yumuşak gölge + contact shadow |
| Render | AgX ton eşleme, N8AO (ambient occlusion), SMAA, hafif bloom, vignette |
| Kontrol | Karakteri döndüren turntable (atalet ile), kategoriye göre kamera odağı (vücut, gövde, yüz, bacak, ayak) |
| Cilt | `MeshPhysicalMaterial` + wrap-lighting tabanlı SSS yaklaşımı (`materials/skin.ts`) |
| Canlılık | Nefes alma, mikro kafa hareketi, prosedürel göz kırpma (ARKit `eyeBlink`), göz sakkadları |
| Asset pipeline | Headless Blender + MPFB: M/F base, `mixamo_unity` rig (göz ve çene kemikli), 52 ARKit + 15 viseme morph, kıyafet + ayakkabı, GLB export |

## Ekran görüntüleri

- `spike/01-mpfb-male-body.jpeg`
- `spike/02-mpfb-male-face.jpeg`
- `spike/03-mpfb-female-body.jpeg`

## Bulgular (dürüst değerlendirme)

**Mevcut sonuç ~4/10** (2010'ların oyun karakteri). Holoxone seviyesinin (videodaki gerçek insan) çok altında.

Sorun render tarafında değil, **asset kalitesinde**:
- MPFB/MakeHuman cilt texture'ı 2K, normal ve roughness detayı yok. Bu yüzden yüz pürüzsüz ve "plastik" görünüyor.
- Saç, kafaya oturan tek parça bir kask mesh'i; gerçek saç kartı değil.
- Kıyafetlerde MakeHuman logosu var, kumaş detayı zayıf.
- Göz asset'i export sonrası yanlış eşleniyor (gözler pembe görünüyor; bilinen hata). Oluşturucu için zaten iris rengi parametreli, kendi göz shader'ımızı yazacağız.

Render tarafı (ışık, SSS, AO, ton eşleme) iyi asset geldiğinde işini yapacak durumda. Kalite tavanını belirleyen şey asset.

**Lip-sync altyapısı hazır:** base mesh 52 ARKit + 15 viseme morph taşıyor, `jawOpen` / `viseme_*` isimleri TalkingHead uyumlu.

## Seçenekler

| Seçenek | Beklenen gerçekçilik | Maliyet / efor | Not |
|---|---|---|---|
| A. MPFB'yi cilalamak | 5/10 | Düşük | Tavan düşük; Holoxone hedefine ulaşmaz |
| B. MetaHuman → GLB → Three.js | 6–7/10 | Yüksek (editör işi + export pipeline'ı) | UE 5.7 MetaHuman Creator macOS'ta resmi destekli. Yüz, cilt ve saç kalitesi büyük sıçrama yapar |
| C. Unreal MetaHuman + Pixel Streaming | 9/10 | Çok yüksek; Windows/NVIDIA + GPU sunucu | Editör işinin çoğu kullanıcıda kalır |
| D. Hibrit: 3D oluşturucu + AI fotogerçekçi konuşan video | Oluşturucuda 5–6/10, sohbette 9/10 | Orta; video modeli maliyeti | Sohbet modu Holoxone'un kendisiyle aynı teknik (video) |
| E. Lisanslı asset satın almak (~$100–300) | 5–6/10 | Düşük–orta | Saç ve kıyafet kalitesini yükseltir, yüz MPFB olarak kalır |

## Sonraki adım

Karar kullanıcıda ve şirkette.

## Gereksinim güncellemesi (kullanıcı, 2026-10-20)

> "Gerçekçilik konusunda normal insana benzemesine gerek yok, sadece kaliteli dursun, animatik."

Hedef artık fotogerçekçilik değil, **yüksek kaliteli stilize (animasyon filmi / oyun tarzı)** bir karakter.
- Holoxone yalnızca "kaliteli his" referansı olarak kalıyor.
- Bu spike'ta yazılan stüdyo, turntable, post-processing, canlılık animasyonları ve lip-sync morph altyapısı stilize karakterde aynen kullanılacak.
- Yalnızca asset kaynağı ve malzeme stili değişecek.
