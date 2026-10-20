# Devir notu (2026-10-20)

Yeni bir Claude Code oturumu (ör. Windows'ta) bu dosyayı okuyarak kaldığımız yerden devam eder. Kalıcı kurallar `CLAUDE.md`'de. Bu dosya güncel durumu ve sıradaki işi anlatıyor.

## Ürün

- Şirket içi demo/POC; izleyici yönetim ve karar vericiler.
- Tarayıcıda 3D karakter oluşturucu. "Bitti" denince karakter AI ile sesli konuşuyor ve ağız hareketleri kelimelerle senkron oluyor.
- Erkek + kadın, TR + EN.
- Kişiselleştirme seçenekleri sol panelde, karakter sağda.
- Kalite çıtası:
  - "Basit bir proje gibi durmayacak", her detay ince işçilik.
  - Karakter canlı görünecek; görsel hata olmayacak.

## Yön değişikliği: anime iptal, MetaHuman

- Anime (VRoid/VRM) stili şirket tarafından reddedildi ("bu kadar animatik olamaz"). Anime kodu `d147f71` commit'inde donduruldu; üzerinde çalışılmıyor.
- Hedef artık **ciddi ve gerçekçi** görünüm. Kullanıcı **MetaHuman**'ı seçti.
- MetaHuman Creator, Unreal Engine'in içinde bir eklenti olarak geliyor. Karakter üretimi ve dışa aktarma **Windows PC'de** yapılacak (tam destekli platform). Web geliştirme MacBook'ta sürüyor; dışa aktarılan dosyalar Mac'e taşınıyor.
- Lisans: MetaHuman'lar başka motorlarda kullanılabiliyor; Unreal lisansı kapsamında, yıllık geliri 1M $ altı olana ücretsiz. Şirket ürüne dönüştürürse lisans yeniden kontrol edilmeli.

## Windows'ta yapılacaklar (MetaHuman üretimi)

1. Epic Games Launcher → Unreal Engine → Library → **+** → en güncel 5.x (5.7 veya üstü). **Options**:
   - ✅ **MetaHuman Creator Core Data**
   - ⬜ Starter Content, Templates and Feature Packs, Android/iOS/Linux, Editor symbols for debugging
2. Yeni proje oluştur → Edit → Plugins → **MetaHuman Creator**'ı aç → editörü yeniden başlat.
3. İçerik tarayıcısında **MetaHuman Character** asset'i oluştur; MetaHuman Creator'da karakterleri hazırla.
   - Çeşitlilik hedefi: iki cinsiyet, farklı etnik kökenler, yüz şablonları.
   - Örgü ve kıvırcık dahil çok sayıda saç; kıyafetler.
4. Yüksek çözünürlüklü dokuları indir → **Assemble → DCC Export**. Bu adım baş/yüz DNA'sını ve dokuları zip olarak verir. Saç kartları (groom → cards) ve kıyafetler FBX olarak dışa aktarılacak; betikler Windows oturumunda yazılacak.
5. **İlk partide kütüphanenin tamamını dışa aktar.** MetaHuman'daki tüm saç modellerini (örgü, topuz, kıvırcık dahil) ve tüm kıyafetleri al. Saçlar ve kıyafetler bütün MetaHuman kafalarına ve vücutlarına oturuyor. Böylece yeni saç veya kıyafet için Windows'a nadiren dönmek gerekir; saç rengi ve boya desenleri zaten tarayıcıda (shader) yapılıyor.
6. Çıktıları Mac'e taşı (USB disk / Drive): `pipeline/source/metahuman/` (gitignore'da olmalı). Yedeği Drive'da da tut.

## Kullanıcının hedefi: Windows bir kez, ekleme her zaman Mac'ten

- Unreal yalnızca Windows'ta ve bir kez kullanılır. MetaHuman kütüphanesinin tamamı (yüzler, tüm saçlar, tüm kıyafetler) dosya olarak dışa aktarılır. Unreal Mac'e kurulmaz ve uygulama çalışırken hiç gerekmez.
- Sonradan eklemelerin hepsi Mac'ten yapılabilmeli:
  - Renk, boya deseni, ten, göz, makyaj, dövme, piercing ve takı uygulamanın içinde (kod).
  - Yeni yüzler, yüz şablonları arasında slider karışımıyla (morph) gelir.
  - **Yeni saç veya kıyafet** için Mac'te bir "varlık ekleme" hattı kurulacak, örnek:
    ```bash
    uv run asset-pipeline add-hair  path/to/hair.fbx  --label "..."
    uv run asset-pipeline add-outfit path/to/top.fbx  --label "..."
    ```
    Bu hat (Blender headless) dosyayı MetaHuman kafasına veya vücuduna oturtur. Kıyafette ağırlıklar vücuttan aktarılır, saçta kafa kemiğine bağlanır. Ardından dokular web formatına çevrilir, küçük resim üretilir ve kayıt manifest'e eklenir.
- Unreal yalnızca Epic'in MetaHuman kütüphanesine sonradan eklediği yeni bir varlık için gerekir.

## Mac'te sıradaki iş (web)

- **Dönüştürme hattı:** DNA/FBX → glTF.
  - Yüz için ARKit 52 + Oculus 15 viseme blendshape'leri gerekli. Kaynak: RigLogic pozlarından bake veya eklem pozları.
  - Dokular sıkıştırılacak (KTX2).
- **three.js gerçekçi görüntü:**
  - Deri (SSS yaklaşımı, detay normal).
  - Göz (kornea/iris).
  - Saç kartları: alpha-to-coverage, anizotropi.
- **Montaj:** MetaHuman'lar aynı iskelet ve topolojiyi paylaşıyor, bu yüzden parça montajı basit.
  - Yüz şablonları arasında morph ile "blend" slider'ları.
  - Saç, kıyafet ve ten seçenekleri.
- **Isı ve pil (kullanıcı için önemli):** MacBook'ta ısınma ve pil tüketimi defalarca dile getirildi.
  - Kalite modu: Yüksek / Dengeli / Pil tasarrufu. Demoda şarjdayken Yüksek.
  - Boşta (sürükleme ve konuşma yokken) 30 fps sınırı.
  - Kare süresi uzarsa DPR ve post efektleri otomatik düşer (`PerformanceMonitor`).
  - Gizli sekmede çizim durur.
  - Varlık ekleme işleri kısa sürmeli; doku sıkıştırma paralelliği ölçülü tutulmalı.
- **Yeniden kullanılacak katmanlar** (stilden bağımsız):
  - `web/src/features/lipsync/`: Türkçe viseme motoru, Azure viseme ve kelime hizalama.
  - Canlılık: göz kırpma, sakkad, nefes ve idle (`web/src/features/avatar/vrm/pose.ts`, `life.ts`; yeni rig'e uyarlanacak).
  - Takı ve piercing altyapısı: `web/src/features/avatar/accessories/`. 37 ürünlük katalog, PBR malzemeler, geometri, bağlama noktası yardımcıları. VRoid'e özel kısım yalnızca `vroid.ts`; MetaHuman için yeni adapter yazılacak. `rig.ts` şu an yer tutucu.
  - Oluşturucu arayüzü (`web/src/features/creator/`), Mongo + Better Auth, karakter kaydı, AI sohbet ve TTS route'ları.
- **Kullanıcının istediği kişiselleştirme:**
  - İsim, cinsiyet, yüz, vücut tipi + boy, ten, göz.
  - Saç stili (örgü, kıvırcık…) ve **saç boyası desenleri**: ombre (alt farklı), kökler (üst farklı), röfle/ara renk, iç katman.
  - Üst/alt/ayakkabı + renk.
  - Takı ve **piercing** (burun, kaş, dudak, kulak kıkırdağı, göbek).
  - **Çok sayıda dövme**: büyük vücut dövmeleri ve küçük minimal dövmeler, yerleşim seçenekleriyle.

## AI ve ses (hazır)

- **Sıra:** groq → gemini → anthropic (`AI_PROVIDER_ORDER`).
- **Modeller:**
  - Groq: `openai/gpt-oss-120b`, reasoning low.
  - Gemini: `gemini-3.5-flash-lite`, thinking MINIMAL.
  - Anthropic: `claude-haiku-5-5`, effort low, sunucu fallback'i yok.
- **İlk token zaman aşımı:** groq/gemini 10 sn, anthropic 25 sn.
- **Anahtarlar:** Mac'te `web/.env.local` içinde (git'te yok). Anthropic, Gemini ve Groq dolu; Azure Speech boş.
- **Azure:**
  - Gmail'li Microsoft hesabı `AADSTS50020` verdi.
  - Önce https://signup.azure.com/signup?offer=ms-azr-0044p ile ücretsiz kayıt, sonra Speech kaynağı (F0).
  - Olmazsa yedek: Gemini TTS (`gemini-3.8-flash-tts`, anahtarla test edildi). Viseme olayı olmadığı için metin tabanlı hizalama kullanılır.

## Ortam

- Mac geliştirme DB'si: `cd web && pnpm db:start` (mongod 127.0.0.1:27018). Kullanıcının kendi mongod'una (27017) **dokunma**.
- Komutlar, doğrulama ve git kuralları `CLAUDE.md`'de. Bu projede küçük Conventional Commit + push yetkisi var.
- Anime işinin iptal edilen yarım kalanı (VRoid kaynak genişletme, doku büyütme) yalnızca Mac'teki `git stash`'te duruyor; repoda yok.
- Kullanıcının kişisel kuralları Mac'te `~/.claude/CLAUDE.md` ve `~/.claude/rules/` içinde. Windows'ta aynı davranış için bu dosyalar `%USERPROFILE%\.claude\` altına kopyalanmalı. Özet:
  - Yanıtlar Türkçe; kod, identifier ve yorumlar İngilizce.
  - Gövde en fazla ~120 kelime; her yanıt `Kısaca:` ile biter.
  - Karar gerekiyorsa `Senin Kararın:` bölümü eklenir; her madde öneri ve gerekçeyle biter.
  - Secret'lar koda ve loga asla yazılmaz.

## Kararlar (2026-10-20 akşam, kullanıcı onaylı)

- **Demo cihazı:** yalnızca bu MacBook (M4 Pro, 48 GB). Kalite en üste çekilir: yüksek çözünürlüklü dokular, akıcı çalışan en detaylı LOD.
- **Dövme ve piercing:** kalıyor ama ölçülü. Küçük/minimal dövmeler, küpe ve ince piercing'ler var; abartılı büyük vücut parçaları yok.
- **Kıyafet:** karışık; iş/kurumsal (takım, ceket, gömlek) + günlük parçalar.
- **Sohbet rolü:** genel sohbet asistanı (mevcut persona ayarı).
- **Anime oluşturucu:** sonraki oturumda arayüzden kaldırılacak; kod git geçmişinde kalır.

## Açık kararlar

- Azure kaydı mı, Gemini TTS mi? (öneri: önce Azure, çünkü kelime senkronu için viseme verisi veriyor)
- İlk partide kaç yüz? (öneri: 6-8 yüz, iki cinsiyet ve farklı kökenler; saç ve kıyafetin tamamı alınır, çünkü hepsi her yüze oturuyor)
