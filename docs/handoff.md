# Devir notu (2026-10-21 sabah)

Yeni bir Claude Code oturumu bu dosyayı okuyarak kaldığı yerden devam eder. Kalıcı kurallar `CLAUDE.md`'de. Bu dosya güncel durumu, Mac'e taşımayı ve sıradaki işi anlatır.

## Ürün

- Şirket içi demo/POC. İzleyici yönetim ve karar vericiler.
- Tarayıcıda gerçekçi 3D karakter oluşturucu. "Bitti" denince karakter AI ile sesli konuşur; ağız kelimelerle senkron oynar.
- Erkek ve kadın, TR ve EN.
- Ekranlar:
  - Oluşturucu: sol panelde kişiselleştirme, sağda sahne.
  - Konuşma: karakter solda tam boy, sohbet sağda. Zoom ve döndürme var, yüz yakın planı (PiP) yok.
- Kalite çıtası:
  - "Basit bir proje gibi durmayacak."
  - Karakter hiç dümdüz durmaz.
  - Dudak senkronu en kritik ölçüt.

## Yön

- Anime (VRoid) iptal; kod `d147f71`'de donduruldu.
- Gerçekçi rota **MetaHuman**:
  - Unreal yalnızca bu Windows PC'de, bir kez kullanılır.
  - Kütüphanenin tamamı dosya olarak dışa aktarılır, web'e çevrilir ve Mac'e taşınır.
  - Sonraki her şey Mac'ten yapılır.

## Durum

### Unreal dışa aktarımı (Windows, `pipeline/unreal/mh_export/`)

- **Bitti:**

  | İş | Sonuç |
  |---|---|
  | inventory | 29 preset |
  | arkit | 66 poz, 274 kontrol |
  | bodies | 2 cinsiyet × 15 DNA varyantı |
  | lighting | 9 sahne |
  | animations | — |
  | statics | — |
  | materials | parametreler (düğüm grafiği boş) |
  | wardrobe | — |
  | grooms | 79 kartlı groom |
  | outfits | kadın 38 öğe |

- **Sürüyor** (gece zinciri `chain_night3.sh`, tek editör, RAM yüzünden ikinci editör yok):
  - outfits erkek: ~4 dk/öğe.
  - Ardından kalan 22 preset (`characters`, ~11 dk/preset, 8K yüz).
  - Ardından Fab karakteri (Vampire).
- Bitmiş presetler: Ada, Aera, Aoi, Asha, Bo.
- **Bruce ve Cameron:** ilk sürüm eksik dışa aktarılmıştı (DCC haritası yok). `raw/characters/*.stale` olarak kenara alındılar; zincir yeniden dışa aktarır.
- **Cinsiyet:** `raw/characters_genders.json`'daki masculine/feminine değerinden gelir. |değer| < 0.3 ise vücut şekli karar verir. Asha bu yüzden kadın.

### Dönüştürücü (`asset-pipeline mh-convert`, `pipeline/src/asset_pipeline/mh/`)

- Komut `--all` ile artımlı çalışır; yalnızca değişen ya da yeni gelen birimleri çevirir. Çıktı `MetaHumanArchive/web/`.
- Manifest v2: 7 yüz, 5 cilt, 2 vücut, 79 groom, 5 iris, 116 animasyon, 8 ışık. Kıyafet henüz yok.
- Sıkıştırma:
  - Kendi meshopt encoder'ı; vertex sırası ve IBM'ler korunur.
  - Dokular GLB dışında, KTX2 UASTC. Normal haritalar OpenGL.
- Yüz:
  - ARKit 52 + 15 viseme morph.
  - Kırışıklık haritaları ve boyun dikişi verisi.
- Groom:
  - Kart LOD0 ve LOD2.
  - Yüzey bağlaması (`_bind_*`) sayesinde her yüze oturur.
  - Baked yoğunluk dokusu (head UV).
- Animasyon:
  - Gövde klipleri RigLogic twist'li GLB.
  - Yüz klipleri ARKit ağırlık JSON'u (`{fps, names, frames}`).
- Doğrulama:
  - `gltf-transform validate` 0 hata.
  - pytest 209 test geçiyor, ruff temiz.

### Web (`web/`)

- **Sahne (`web/src/features/avatar/mh/`)**, sayfaların tek 3D giriş noktası `MhStage`'dir. İçinde:
  - Montaj:
    - Kafa gövde iskeletine bağlanır.
    - Boyun dikişi kaynaklanır. Kafa kenarı gövdenin altına 1.5 mm uzanır, böylece çatlak kalmaz.
  - Cilt shader'ı:
    - SSS sarma, SRMF speküler, gözenek mikro normali, cavity.
    - Kırışıklık normalleri.
    - Groom yoğunluğuyla kafa derisi, kaş ve sakal tonu.
  - Göz: kornea, iris ve göz oklüzyonu.
  - Saç, kaş, sakal ve bıyık kartları (`hair.ts`, `grooms.ts`, `hairMaterial.ts`):
    - Yüze yeniden oturtma ve kafa eklemlerine skin.
    - Melanin/redness/dye renk modeli ve desenler (ombre, kökler, röfle, iç katman).
    - Kajiya-Kay çift lob.
    - Alpha-test çekirdek + harmanlanan saçak (MSAA yok, N8AO yüzünden).
  - Canlılık (`characterLife.ts`):
    - Mocap idle klipleri: Fab crowd/stand döngüleri, `web/scripts/retarget-fbx.mjs` ile.
    - Prosedürel nefes ve kol katmanı.
    - Göz teması ve başın kısmen kullanıcıya dönmesi.
    - Sakkad, göz kırpma.
    - Yüz idle döngüsü ve hafif "nefes alan" gülümseme.
    - Vurgulu hecede baş onayı ve kaş kalkması.
  - Lip-sync (`web/src/features/lipsync/`):
    - Kaynak önceliği: TTS viseme olayı, kelime zamanı, metin hizalaması.
    - 90 ms görsel öncülük; m/b/p'de dudaklar kapanır.
    - Edge TTS kelime zamanlarıyla TR cümlede kare kare kontrol edildi.
  - Konuşma kamerası: yakın planda başı takip eder, sallanan konuşmacı kadrajda kalır.
  - Gölge: PCF 16 örnek, sabit disk. Three'nin gürültülü 5 örneği kolda tanecik bırakıyordu.
  - Kalite katmanları (`quality.ts`): high / balanced / battery.
    - Varsayılan `auto`: high'tan başlar, kare düşünce iner.
    - Battery: AO kapalı, hafif saç kartı, 30 fps.
- **Sayfalar** (ajan B):
  - Landing.
  - Karakterlerim.
  - Oluşturucu: autosave, undo, hazır yüz/saç/kıyafet panelleri.
  - Konuşma: sol sahne, sağ sohbet, altyazı.
  - Kürasyon: `/[locale]/curate`, yalnız dev.
  - i18n anahtar testi ve Playwright e2e (4 test).
  - Bu işin commit'i inceleme bulguları düzeltilince atılıyor.
- **Dev sayfaları:**
  - `/dev/stage`: gerçek manifest; yüz, saç ve kalite seçimi; `/api/tts` ile canlı TTS; zoom.
  - `/dev/thumbs`: küçük resim üretici (ajan B yazıyor).

## Mac'e taşıma (sabah)

1. Mac ile PC aynı ağda olmalı.
2. PC'de sunucuyu aç:

   ```bash
   cd pipeline && uv run asset-pipeline serve-slim --archive C:/Users/Asus/MetaHumanArchive
   ```

   - Varsayılan klasörler: `web`, `raw`, `fab_anims`, `logs`. Fab `.mhpkg`'leri (`fab`, ~14 GB) yalnız Unreal'da işe yarar; istenirse `--include web,raw,fab_anims,logs,fab` ver.
   - Windows güvenlik duvarı sorarsa **"Özel ağ: İzin ver"**.
   - Komut, Mac'te çalıştırılacak komutu token'ıyla birlikte yazar.
3. Mac'te, repo kökünde (yalnız standart kütüphane, `uv` gerekmez):

   ```bash
   python3 pipeline/scripts/fetch_slim.py --url http://<pc>:8765 --token <token> --dest ~/MetaHumanArchive
   ```

   - Paralel indirir, kalınan yerden devam eder, her dosyanın sha256'sını doğrular.
   - Yarıda kalırsa aynı komut yeniden çalıştırılır.
   - "all files verified" yazınca PC'de Ctrl+C.
4. Toplam boyut arşivin tamamı (tahmini 40-60 GB), 170 GB bütçesinin çok altında. Ayrı bir "slim" kopya üretilmiyor.

## Mac kurulumu

```bash
ln -s ~/MetaHumanArchive/web web/public/assets/mh       # web sahnesi buradan okur (gitignore'da)
cd web && pnpm install && pnpm db:start && pnpm dev     # .env.local Mac'te zaten var
cd ../pipeline && uv sync                               # dönüştürücü için
uv run --no-sync python scripts/build_openriglogic.py   # macOS arm64'te RigLogic modülleri
```

- KTX-Software 4.4.2 gerekir (`$KTX_TOOLS` ya da PATH).
- Yeniden dönüştürme: `uv run asset-pipeline mh-convert --all --archive ~/MetaHumanArchive`.

## Sıradaki iş

- Kıyafet dönüştürme:
  - Ham kıyafetler bitince F7: UE glTF'leri normalize edilir.
  - Renk varyantları tint preset olarak birleştirilir.
  - Vücut morph'ları kıyafete aktarılır.
  - Ardından web'de kıyafet bağlama (`SkinnedMesh.bind`) ve bölge gizleme.
- Küçük resimler: `/dev/thumbs` ile tüm yüz ve groom'lar web renderer'ından üretilir. Unreal küçük resimleri placeholder dokuyla çizilmişti.
- Konuşma jestleri: MoCap Online / ActorCore ücretsiz paketleri sabah Epic Launcher'dan projeye eklenir (kullanıcı aksiyonu), sonra UE retarget.
- Kartsız 9 groom (stubble, buzz cut) kafa materyaline baked doku olarak eklenecek.
- Erkek ve slider'lı gövdede klip pelvis ölçeği (`extras.mh.retarget.leg_lengths_m`).
- Baş ve gövde cildi arasında göğüste hafif ton farkı var.
- CC BY atfı: crowd idle klipleri için UI'da kredi satırı.

## AI ve ses

- **AI sırası:** groq → gemini → anthropic (`AI_PROVIDER_ORDER`). Modeller `web/src/lib/env.ts`'te.
- **TTS sırası:** azure → edge → gemini (`TTS_PROVIDER_ORDER`).
  - Azure yapılandırılmamış.
  - Edge anahtarsız çalışır ve kelime zamanı verir; lip-sync bunu kullanır.
- **Anahtarlar** `web/.env.local`'da (git'te yok). Değerleri hiçbir zaman loglanmaz.

## Ortam

- Geliştirme DB'si: `cd web && pnpm db:start` (mongod 127.0.0.1:27018). Kullanıcının kendi mongod'una (27017) **dokunma**.
- Komutlar, doğrulama ve git kuralları `CLAUDE.md`'de. Bu projede küçük Conventional Commit + push yetkisi var.
- Kullanıcının kişisel kuralları `~/.claude/CLAUDE.md` ve `~/.claude/rules/` içinde:
  - Yanıtlar Türkçe; kod İngilizce.
  - Gövde ≤80 kelime; sonda `Kısaca:` ve gerekiyorsa `Senin Kararın:`.

## Kararlar (kullanıcı onaylı)

- **Demo cihazı:** MacBook (M4 Pro, 48 GB). Kalite en üste çekilir.
- **Kapsam:** Windows'ta seçim yapılmaz; her şey dışa aktarılır. Ayıklama Mac'teki kürasyon ekranında yapılır.
- **Kaynak dokular** 8K; web için yüz 4K, diğerleri 2K, KTX2.
- **Tasarım:** karanlık sinematik. Grafit zemin, tek amber vurgu. Mor gradyan ve her yerde glassmorphism yasak.
- **Dövme ve piercing:** ölçülü.
- **Kıyafet:** iş ve günlük karışık.
- **İçerik:** ücretli içerik alınmaz. Fab'den yalnız $0 öğeler (20 Epic kıyafeti, 6 saç, Vampire, 2 Nyanpasinka gömleği).
- **Lisans:** UE EULA MetaHuman'ların AI eğitimi/testi için kullanımını yasaklıyor. LLM ile konuşturmak için ürünleşmeden önce hukuki kontrol gerekli.
