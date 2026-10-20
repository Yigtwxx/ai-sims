# Hesap ve API anahtarı kurulumu

Sohbet ve ses için gereken servislerin hesaplarını açıp anahtarları `web/.env.local` içine koyma rehberi. Bilgiler 2026-10-20 tarihinde resmi dokümanlardan doğrulandı; limitler ve arayüz zamanla değişebilir, tarihli notlara dikkat et.

## Önce bilmen gerekenler

- **Hepsi isteğe bağlı.** Anahtar yoksa uygulama yine çalışır: `/api/chat` `503 {"error":"ai_not_configured"}`, `/api/tts` `503 {"error":"tts_not_configured"}` döner. Sohbet için tek bir AI anahtarı yeter; sesli konuşma için Azure gerekir.
- **Anahtarlar yalnızca `web/.env.local` içinde durur.** Bu dosya git'e girmez (`.env*` yok sayılır). Sunucu hiçbir anahtarı log'lamaz ve `/api/health` değer değil yalnızca `true/false` döner.
- **Değişkenleri kaydettikten sonra `pnpm dev`'i yeniden başlat.** Next.js env dosyalarını başlangıçta okur.
- **Sağlayıcı sırası:** Anthropic, Gemini, Groq (`AI_PROVIDER_ORDER` ile değişir). Bir sağlayıcı ilk kelimeyi üretmeden önce hata verirse (anahtar hatalı, 429, 5xx, ağ sorunu, ret, boş cevap, 25 saniye sessizlik) sıradakine geçilir. Cevap yazılmaya başladıktan sonra sağlayıcı asla değişmez.
- `web/.env.local` içinde bu değişkenlerin boş satırları hazır. `.env.example` ise örnek şablondur.

| Değişken | Servis | Zorunlu mu | Varsayılan |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic | Hayır | yok |
| `ANTHROPIC_MODEL` | Anthropic | Hayır | `claude-opus-5-5` |
| `GEMINI_API_KEY` | Google AI Studio | Hayır | yok |
| `GEMINI_MODEL` | Google AI Studio | Hayır | `gemini-3.8-flash` |
| `GROQ_API_KEY` | Groq | Hayır | yok |
| `GROQ_MODEL` | Groq | Hayır | `openai/gpt-oss-120b` |
| `AI_PROVIDER_ORDER` | Sağlayıcı sırası | Hayır | `anthropic,gemini,groq` |
| `AZURE_SPEECH_KEY` | Azure Speech | Hayır | yok |
| `AZURE_SPEECH_REGION` | Azure Speech | Hayır | yok (ör. `westeurope`) |
| `AZURE_TTS_VOICE_TR_FEMALE` | Azure Speech | Hayır | `tr-TR-EmelNeural` |
| `AZURE_TTS_VOICE_TR_MALE` | Azure Speech | Hayır | `tr-TR-AhmetNeural` |
| `AZURE_TTS_VOICE_EN_FEMALE` | Azure Speech | Hayır | `en-US-AvaNeural` |
| `AZURE_TTS_VOICE_EN_MALE` | Azure Speech | Hayır | `en-US-AndrewNeural` |

## Doğrulama komutları

Her servisi kurduktan sonra aynı üç komutu kullanabilirsin. Dev sunucusu çalışıyor olmalı (`cd web && pnpm dev`).

**1. Anahtar tanımlı mı?** Yalnızca dev'de çalışır; production build'de `/api/health` her zaman `404` döner.

```bash
curl -s localhost:3000/api/health
# {"db":true,"auth":true,"ai":{"anthropic":true,"gemini":false,"groq":false},"tts":{"azure":false}}
```

`ai.*` ve `tts.azure` yalnızca anahtarın **tanımlı** olduğunu söyler, anahtarın **geçerli** olduğunu söylemez. Geçerliliği aşağıdaki gerçek çağrılar gösterir.

**2. Sohbet gerçekten çalışıyor mu?** Önce anonim oturum aç (çerez dosyaya yazılır), sonra mesaj gönder:

```bash
curl -s -c /tmp/ai-sims.cookies -X POST localhost:3000/api/auth/sign-in/anonymous \
  -H 'Content-Type: application/json' -d '{}' > /dev/null

curl -N -i -b /tmp/ai-sims.cookies -X POST localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"locale":"tr","messages":[{"role":"user","content":"Merhaba, nasılsın?"}]}'
```

Yanıtın başlığındaki `x-ai-provider` cevabı hangi sağlayıcının verdiğini gösterir; gövde akarak gelen düz metindir. `502 {"error":"ai_unavailable"}` alırsan tüm sağlayıcılar başarısız olmuştur: nedenini `pnpm dev` çıktısındaki `[ai] provider failed ...` satırlarında bulursun (yalnızca sağlayıcı adı, hata türü ve durum kodu yazılır, anahtar ve ham cevap yazılmaz).

**3. Ses çalışıyor mu?** (Azure kurulduktan sonra)

```bash
curl -s -b /tmp/ai-sims.cookies -X POST localhost:3000/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Merhaba dünya.","voice":"female","locale":"tr"}' \
| python3 -c "import sys,json; d=json.load(sys.stdin); print('viseme:', len(d['visemes']), 'kelime:', len(d['words']), 'ses (base64 karakter):', len(d['audio']))"
```

Türkçe için `viseme` sayısı sıfırdan büyük çıkmalıdır. Sesi dinlemek için: aynı komutta çıktıyı `python3 -c "import sys,json,base64; open('/tmp/tr.mp3','wb').write(base64.b64decode(json.load(sys.stdin)['audio']))"` ile dosyaya yazıp `open /tmp/tr.mp3` çalıştır.

Tarayıcıda denemek için `web/src/app/spike/ChatPanel.tsx` bileşenini `SpikeScene`'e eklediğinde `/spike` sayfasında yazıp konuşabilirsin.

---

## 1. Anthropic (Claude)

- **Ne için:** Sohbetin birincil sağlayıcısı. Model `claude-opus-5-5` (tarih eki yok). Sunucu tarafı ret yedeği açıktır: bir güvenlik sınıflandırıcısı isteği reddederse Anthropic aynı çağrı içinde kendi önerdiği yedek modelle yeniden dener.
- **Kayıt:** https://platform.claude.com/ (Claude Console).
- **Ücretsiz katman:** Yok. Kullanım ön ödemeli krediden düşer; sende 100 USD kredili bir anahtar var. `claude-opus-5-5` fiyatı milyon token başına 4 USD giriş, 20 USD çıkış (Anthropic model kılavuzu, Ekim 2026). Bir sohbet turu 1 sentin altında kalır (kısa cevap, kısa düşünme); 100 USD binlerce tur eder. Bu bir tahmindir, gerçek tüketimi Console'dan izle.
- **Anahtar oluşturma:**
  1. https://platform.claude.com/ adresinde giriş yap (hesabın yoksa oluştur).
  2. https://platform.claude.com/settings/keys sayfasına git (Console'da Settings, API keys).
  3. **Create key** düğmesine bas. Anahtara ad ver, son kullanma süresini seç, **Linked account** alanında kendini seç.
  4. `sk-ant-` ile başlayan anahtar **yalnızca bir kez** gösterilir. Hemen kopyala; kaybedersen yenisini oluşturman gerekir.
- **`web/.env.local`:**
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  İstersen modeli değiştirmek için `ANTHROPIC_MODEL` ekle.
- **Doğrula:** `curl -s localhost:3000/api/health` çıktısında `"anthropic":true`; sohbet komutunda `x-ai-provider: anthropic`.
- **Kredi biterse:** Anthropic hata döner (ör. 400, kredi yetersiz). Uygulama bunu otomatik olarak Gemini'ye (sonra Groq'a) devreder.

## 2. Google AI Studio (Gemini)

- **Ne için:** İkinci sağlayıcı. Model `gemini-3.8-flash`, düşünme seviyesi `low` (kısa gecikme için). Daha düşük gecikme istersen `GEMINI_MODEL=gemini-3.5-flash-lite` dene.
- **Kayıt:** Google hesabınla https://aistudio.google.com/ adresine gir.
- **Ücretsiz katman:** `gemini-3.8-flash` için ücretsiz katman vardır (Gemini API fiyat sayfasında "Free of charge"). İstek ve token limitleri (dakikalık istek, dakikalık token, günlük istek) proje ve modele göre değişir ve dokümanda sabit rakam verilmez; kendi limitlerini https://aistudio.google.com/rate-limit adresinde gör. Günlük istek kotası Pasifik saatiyle gece yarısı sıfırlanır.
  - **Gizlilik uyarısı:** Ücretsiz katmanda gönderdiğin içerik Google ürünlerini geliştirmek için kullanılabilir. Ücretli katmanda kullanılmaz. Gizli veri gönderme.
  - Ücretli katman (faturalandırma hesabı bağlayınca, Tier 1): milyon token başına 0,75 USD giriş / 3,75 USD çıkış (31 Aralık 2026'ya kadar), sonra 1,50 / 7,50 USD.
- **Anahtar oluşturma:**
  1. https://aistudio.google.com/apikey adresine git.
  2. Yeni kullanıcıya varsayılan bir proje otomatik atanır. Mevcut bir Google Cloud projesi kullanacaksan sol panelde **Projects**, sonra **Import projects** ile içe aktar.
  3. **API Keys** sayfasında **Create API key** düğmesine bas ve anahtarı kopyala.
  4. "You do not have permission to create a key in this project" hatası alırsan proje yöneticisinden Project Editor rolü iste.
- **`web/.env.local`:**
  ```
  GEMINI_API_KEY=...
  ```
- **Doğrula:** health çıktısında `"gemini":true`. Gemini'yi tek başına denemek için geçici olarak `AI_PROVIDER_ORDER=gemini` yap ve sunucuyu yeniden başlat.

## 3. Groq

- **Ne için:** Üçüncü sağlayıcı, çok hızlı. Model `openai/gpt-oss-120b` (Groq "Production Models" tablosunun amiral gemisi); düşünme çıktısı kapalı, kısa düşünme açık. Alternatif: `GROQ_MODEL=llama-3.3-70b-versatile`.
- **Kayıt:** https://console.groq.com/
- **Ücretsiz katman:** Groq dokümanı `openai/gpt-oss-120b` için şu taban limitleri verir: dakikada 30 istek, günde 1.000 istek, dakikada 8.000 token, günde 200.000 token. Doküman bunları "Developer planı taban limitleri" diye etiketler; hesabının gerçek limitlerini https://console.groq.com/settings/limits sayfasında gör. Limit aşılırsa HTTP 429 ve `retry-after` başlığı gelir; uygulama iki kez yeniden dener, olmazsa sıradaki sağlayıcıya geçer.
- **Anahtar oluşturma:**
  1. https://console.groq.com/keys sayfasına git (giriş yaptıktan sonra).
  2. Yeni anahtar oluştur düğmesine (**Create API Key**) bas, bir ad ver.
  3. Anahtarı kopyala (sayfayı kapatmadan önce kaydet).
- **`web/.env.local`:**
  ```
  GROQ_API_KEY=...
  ```
- **Doğrula:** health çıktısında `"groq":true`. Tek başına denemek için geçici olarak `AI_PROVIDER_ORDER=groq`.

## 4. Azure Speech (seslendirme)

- **Ne için:** Karakterin sesi. Her cümle için MP3 ses, kelime zamanları ve viseme olayları döner; dudak senkronu bunlarla sürülür.
  - **tr-TR viseme destekler.** Microsoft'un "Visemes" tablosunda `tr-TR` için "Viseme ID" yazar (blend shapes yok). Biz viseme ID'leri kullanıyoruz.
  - Varsayılan sesler (standart neural): `tr-TR-EmelNeural` (kadın), `tr-TR-AhmetNeural` (erkek), `en-US-AvaNeural` (kadın), `en-US-AndrewNeural` (erkek). Ses listesi: https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts
- **Kayıt:** Azure hesabı ve aboneliği gerekir: https://azure.microsoft.com/free (kart doğrulaması istenebilir).
- **Ücretsiz katman (F0):** Ayda 0,5 milyon karakter ücretsiz neural seslendirme. F0'da standart seslerde 60 saniyede 20 işlem sınırı vardır (ayarlanamaz); biz her cümle için bir işlem harcarız, yani dakikada yaklaşık 5 cevap rahat çalışır. İstek başına en fazla 10 dakikalık ses üretilir.
- **Kaynak oluşturma (Azure portal):**
  1. https://portal.azure.com adresinde giriş yap.
  2. **Create a resource** düğmesine bas, arama kutusuna `Speech` yaz ve Microsoft'un **Speech** hizmetini seç, **Create**. (Microsoft'un güncel hızlı başlangıcı doğrudan şu sayfaya yönlendirir: https://portal.azure.com/#create/Microsoft.CognitiveServicesAIFoundry, "Foundry resource for Speech".)
  3. Formu doldur: **Subscription**, **Resource group** (yeni oluşturabilirsin), **Region** (örn. West Europe), **Name**, **Pricing tier: Free F0**.
  4. **Review + create**, sonra **Create** de. Dağıtım bitince **Go to resource**.
  - Not: Güncel "Foundry resource" sihirbazında fiyat katmanı seçimini Ekim 2026'da doğrulayamadım. **Free F0** seçeneğini görmüyorsan klasik **Speech** kaynağı oluşturma ekranını kullan. Yalnızca S0 çıkıyorsa ücretsiz aylık kota geçerli olmaz; kullandığın kadar ödersin (Microsoft'un kota belgesi örnek maliyet hesabında milyon karakter için 15 USD birim fiyat kullanıyor).
- **Anahtar ve bölge:** Kaynak sayfasında sol menüden **Resource Management**, sonra **Keys and Endpoint**. **KEY 1** değerini ve **Location/Region** değerini (örn. `westeurope`) kopyala.
- **`web/.env.local`:**
  ```
  AZURE_SPEECH_KEY=...
  AZURE_SPEECH_REGION=westeurope
  ```
  Bölge küçük harfle, boşluksuz yazılır. Ses değiştirmek için `AZURE_TTS_VOICE_TR_FEMALE`, `AZURE_TTS_VOICE_TR_MALE`, `AZURE_TTS_VOICE_EN_FEMALE`, `AZURE_TTS_VOICE_EN_MALE` değişkenlerini kullan.
- **Doğrula:** health çıktısında `"azure":true`; yukarıdaki ses komutunda `viseme` sayısı sıfırdan büyük.
- **İpucu:** Standart seslerde görülen 429'ların çoğu kota aşımı değil, seçili bölgede o sesin geçici kapasite sınırıdır (Microsoft notu). Uygulama hızlı geçici hatalarda (429, bağlantı ve servis hatası) iki kez yeniden dener (300 ms ve 900 ms bekleyerek); yine olmazsa `502 tts_unavailable` döner ve sohbet metin olarak devam eder. Sürekli oluyorsa sesin yerel bölgesini ya da yaygın bir sesi seç.

## 5. pixiv / VRoid Hub (resmi AvatarSample modelleri)

- **Ne için:** Anime stilinin temel VRM modelleri. Asset pipeline'ı kaynak dosyaları `pipeline/source/vroid/` klasöründe bekler. Bu klasör `.gitignore` içindedir, dosyalar repoya girmez.
- **Kayıt:** pixiv hesabı aç, https://hub.vroid.com/ adresine pixiv hesabınla giriş yap. VRM indirmek için VRoid Hub Kullanım Şartları'nı kabul etmen gerekir.
- **Resmi model sayfaları** (VRoid yardım merkezi, "VRoidPreset_A - Z" makalesi, 2026-10-13 güncel):
  - AvatarSample_A: https://hub.vroid.com/en/characters/2843975675147313744/models/5644550979324015604
  - AvatarSample_B: https://hub.vroid.com/en/characters/7939147878897061040/models/2292219474373673889
  - AvatarSample_C: https://hub.vroid.com/en/characters/1248981995540129234/models/8640547963669442173
- **İndirme:**
  1. Yukarıdaki sayfalardan birini aç (giriş yapmış olarak). Başka kullanıcıların yeniden yüklediği kopyaları değil, bu resmi sayfaları kullan.
  2. Model sayfasındaki indirme seçeneğiyle VRM dosyasını indir.
  3. Dosyayı `pipeline/source/vroid/` altına koy, örn. `pipeline/source/vroid/AvatarSample_B.vrm`.
  - Alternatif: VRoid Studio içindeki örnek modelleri (`VRoidPreset_A - Z`) açıp VRM olarak dışa aktarabilirsin.
- **Lisans riski (kabul edilen):** Bu modellerin lisansı CC0 değildir. Resmi koşullar ticari kullanıma, düzenlemeye ve yeniden dağıtıma izin verir; ancak şu davranışı yasaklar: *"Development of a character creation service using data contained in the sample model, or diversion of data contained in the sample model to an existing character creation service."* VRoid parçalarını birleştiren bu proje bu maddeye girebilir. İç demo için risk senin tarafından kabul edildi (bkz. `docs/specs/2026-10-20-character-creator-design.md`). **Halka açık yayından önce** pixiv'den lisans alınmalı ya da parçalar değiştirilmeli. Ayrıca VRM'leri "CC0" olarak yeniden dağıtmak ve ücret karşılığı dağıtmak yasaktır. Koşullar değişebilir ("Conditions of use may be subject to change"); dosyaları kullanmadan önce makaleyi tekrar oku.

## 6. MongoDB Atlas (isteğe bağlı, demoyu paylaşmak için)

- **Ne için:** Yerel `mongod` (127.0.0.1:27018) yerine buluttaki ortak veritabanı. Yalnızca demoyu başkalarıyla paylaşacaksan gerekir.
- **Kayıt:** https://www.mongodb.com/cloud/atlas/register
- **Ücretsiz katman (Free / M0):** 0,5 GB depolama, en fazla 500 bağlantı, saniyede 100 işlem, yedi günlük dönemde 10 GB giriş ve 10 GB çıkış veri aktarımı. Proje başına bir ücretsiz küme açılabilir. 30 gün hiç bağlantı olmazsa küme duraklatılır (istediğin zaman devam ettirirsin).
- **Küme oluşturma:**
  1. Atlas'ta giriş yap, projeni seç, **Create** düğmesine bas.
  2. **M0** (Free) seçeneğini seç, sağlayıcı ve bölgeyi seç, küme adı ver, **Create**.
  3. Açılan güvenlik sihirbazında kullanıcı adı ve parola gir, **Create Database User**.
  4. **Add My Current IP Address** ile IP adresini ekle, **Finish and Close**, **Go to Overview**.
  5. Paylaşılan bir sunucudan bağlanacaksan o sunucunun IP'sini de **Network Access** bölümüne ekle. Her yerden erişime izin vermek (`0.0.0.0/0`) yalnızca kısa süreli demo için, güçlü parolayla kabul edilebilir.
  6. Küme sayfasında **Connect**, sonra **Drivers** yolunu izleyip `mongodb+srv://...` bağlantı dizesini kopyala.
- **`web/.env.local`:** Uygulama veritabanı adını bağlantı dizesinden alır, bu yüzden dizenin sonuna `/ai-sims` ekle. Parolada özel karakter varsa URL kodlaması yap.
  ```
  MONGODB_URI=mongodb+srv://KULLANICI:PAROLA@kume-adin.xxxxx.mongodb.net/ai-sims?retryWrites=true&w=majority
  BETTER_AUTH_URL=https://demoyu-paylasacagin-adres
  ```
  `BETTER_AUTH_URL`, uygulamayı açacağın gerçek adresle eşleşmeli (yerelde `http://localhost:3000`).
- **Doğrula:** health çıktısında `"db":true`.

---

## Sorun giderme

| Belirti | Olası neden ve çözüm |
| --- | --- |
| `/api/chat` `503 ai_not_configured` | Hiçbir AI anahtarı yok ya da `AI_PROVIDER_ORDER` anahtarı olan sağlayıcıyı içermiyor. `.env.local`'ı doldur, `pnpm dev`'i yeniden başlat. |
| `/api/tts` `503 tts_not_configured` | `AZURE_SPEECH_KEY` veya `AZURE_SPEECH_REGION` eksik ya da bölge biçimi hatalı (küçük harf, boşluksuz). |
| `401 unauthenticated` | Oturum çerezi yok. Önce anonim oturum aç (yukarıdaki sohbet komutunun ilk adımı) ya da tarayıcıda ana sayfada **Giriş**'e bas. |
| `502 ai_unavailable` | Tüm sağlayıcılar ilk kelimeden önce başarısız oldu. `pnpm dev` çıktısında `[ai] provider failed` satırlarına bak: `auth` anahtar hatası, `rate_limit` kota, `server`/`network` sağlayıcı ya da bağlantı sorunu. |
| `502 tts_unavailable` | Azure çağrısı başarısız. `pnpm dev` çıktısında `[api/tts] synthesis failed` satırındaki tür: `auth` anahtar/bölge uyuşmazlığı, `rate_limit` F0 sınırı, `bad_request` bölgede olmayan ses adı. |
| Cevap yarıda kesiliyor | Sağlayıcı bağlantısı cevap yazılırken koptu. Uygulama bu noktada başka sağlayıcıya geçmez; mesajı tekrar gönder. |
| `/api/health` `404` | Production build çalışıyor. Bu uç nokta yalnızca `pnpm dev`'de vardır. |
