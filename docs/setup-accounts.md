# Hesap ve API anahtarı kurulumu

Sohbet ve ses için gereken servislerin hesaplarını açıp anahtarları `web/.env.local` içine koyma rehberi. Bilgiler 2026-10-20 tarihinde resmi dokümanlardan doğrulandı; limitler ve arayüz zamanla değişebilir, tarihli notlara dikkat et.

## Önce bilmen gerekenler

- **Hepsi isteğe bağlı.** Anahtar yoksa uygulama yine çalışır: `/api/chat` `503 {"error":"ai_not_configured"}`, `/api/tts` `503 {"error":"tts_not_configured"}` döner. Sohbet için tek bir AI anahtarı yeter; sesli konuşma için Azure gerekir.
- **Anahtarlar yalnızca `web/.env.local` içinde durur.** Bu dosya git'e girmez (`.env*` yok sayılır). Sunucu hiçbir anahtarı log'lamaz ve `/api/health` değer değil yalnızca `true/false` döner.
- **Değişkenleri kaydettikten sonra `pnpm dev`'i yeniden başlat.** Next.js env dosyalarını başlangıçta okur.
- **Sağlayıcı sırası:** Groq, Gemini, Anthropic (`AI_PROVIDER_ORDER` ile değişir). Önce iki ücretsiz sağlayıcı denenir; ücretli Claude (Haiku) yalnızca ikisi de hata verirse devreye girer. Bir sağlayıcı ilk kelimeyi üretmeden önce hata verirse (anahtar hatalı, 429, 5xx, ağ sorunu, ret, boş cevap, 25 saniye sessizlik) sıradakine geçilir. Cevap yazılmaya başladıktan sonra sağlayıcı asla değişmez.
- `web/.env.local` içinde bu değişkenlerin boş satırları hazır. `.env.example` ise örnek şablondur.

| Değişken | Servis | Zorunlu mu | Varsayılan |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | Groq | Hayır | yok |
| `GROQ_MODEL` | Groq | Hayır | `openai/gpt-oss-120b` |
| `GEMINI_API_KEY` | Google AI Studio | Hayır | yok |
| `GEMINI_MODEL` | Google AI Studio | Hayır | `gemini-3.5-flash-lite` |
| `ANTHROPIC_API_KEY` | Anthropic | Hayır | yok |
| `ANTHROPIC_MODEL` | Anthropic | Hayır | `claude-haiku-5-5` |
| `AI_PROVIDER_ORDER` | Sağlayıcı sırası | Hayır | `groq,gemini,anthropic` |
| `AZURE_SPEECH_KEY` | Azure Speech | Hayır | yok |
| `AZURE_SPEECH_REGION` | Azure Speech | Hayır | yok (ör. `westeurope`) |
| `AZURE_TTS_VOICE_TR_FEMALE` | Azure Speech | Hayır | `tr-TR-EmelNeural` |
| `AZURE_TTS_VOICE_TR_MALE` | Azure Speech | Hayır | `tr-TR-AhmetNeural` |
| `AZURE_TTS_VOICE_EN_FEMALE` | Azure Speech | Hayır | `en-US-AvaNeural` |
| `AZURE_TTS_VOICE_EN_MALE` | Azure Speech | Hayır | `en-US-AndrewNeural` |

## Varsayılan modeller nasıl seçildi

Groq ve Gemini ücretsiz katmanda çalışır; bu yüzden en büyük model yerine hızlı, güvenilir ve kotayı yavaş tüketen model seçildi. Adaylar bu anahtarlarla, persona benzeri bir sistem prompt'uyla ve aynı Türkçe mesajla ölçüldü (2026-10-20). Süreler ilk kelimeye kadar geçen süredir (TTFT).

| Sağlayıcı | Model | Sonuç |
| --- | --- | --- |
| Groq | `openai/gpt-oss-120b` (düşünme düşük) | **Seçildi.** TTFT 0,3-0,5 sn, toplam 0,4-0,7 sn; bilgiler doğru, Türkçe doğal. |
| Groq | `openai/gpt-oss-20b` | Benzer hız, ama İstanbul nüfusunu yanlış verdi (12 milyon). |
| Groq | `qwen/qwen3.8-27b` | TTFT 0,12 sn, ama yazım hatası yaptı. |
| Gemini | `gemini-3.5-flash-lite` (`MINIMAL`) | **Seçildi.** 40'tan fazla çağrıda hata yok. Sıcakken TTFT ortanca 0,6 sn (0,45-0,9). Boşta kaldıktan sonraki ilk çağrılarda 0,6-11 sn (5 ölçüm). |
| Gemini | `gemini-3.1-flash-lite` (`MINIMAL`) | 15/15 başarılı, sıcakken 0,5 sn; boşta kaldıktan sonra 13 ve 26 sn görüldü. |
| Gemini | `gemini-3.5-flash` | `MINIMAL` ile TTFT ortanca 1,3 sn ve 11 çağrının 2'si 429 (ücretsiz kota); `LOW` ile 4-7 sn ve bir 503. |
| Gemini | `gemini-3.7-flash`, `gemini-3.8-flash` | 30 sn zaman aşımı ve 429 (aşırı yük, kota); `MINIMAL`'i 400 ile reddeder. |
| Gemini | `gemini-2.5-flash`, `gemini-2.5-flash-lite` | Bu anahtarda 404. |
| Anthropic | `claude-haiku-5-5` (`effort: low`) | **Seçildi.** TTFT yaklaşık 1 sn, toplam yaklaşık 2 sn; Türkçe doğal; tur başına yaklaşık 0,014 sent. |

Ölçümler bir günün anlık görüntüsüdür; ücretsiz katmanın yükü ve kotası değişebilir. Gemini Flash-Lite için sürpriz gecikme olabilir (boşta kalınca ilk çağrı birkaç saniye sürebilir); yönlendirici 25 saniyede sıradaki sağlayıcıya geçer.

**Kural dayanıklılığı.** Persona prompt'una "kurallar tüm konuşma boyunca geçerlidir" satırı eklendi (sürüm 2). Kullanıcı listeyi, emojiyi, tabloyu veya linki zorladığında cevabın kurala uyup uymadığı, 4 baskı mesajıyla ölçüldü (az sayıda deneme, kesin sonuç değil): Claude Haiku 5.5'te ihlal 3/20'den 0/20'ye düştü, Gemini 3.5 Flash-Lite'ta iki sürümde de 0/8 kaldı, Groq `gpt-oss-120b` ise 8 denemenin 4'ünde kuralı bozdu (sürüm 1'de 5/8). Seslendirme öncesi `cleanSpeechText` emoji, link, madde işareti ve vurguyu zaten temizler.

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

## 1. Groq

- **Ne için:** Birincil sağlayıcı, çok hızlı. Model `openai/gpt-oss-120b`; düşünme kısa ve çıktıda gizli. Ölçümde ilk kelime yaklaşık 0,3-0,5 sn, bilgiler doğru, Türkçe doğal. Bu anahtarın aktif sohbet modelleri üç tane: `openai/gpt-oss-120b`, `openai/gpt-oss-20b` (aynı hız, ama bir bilgiyi yanlış verdi) ve `qwen/qwen3.8-27b` (çok hızlı, ama yazım hatası yaptı; kod bu model için düşünme parametresi göndermediğinden önerilmez). Eski dokümandaki `llama-3.3-70b-versatile` bu anahtarın aktif listesinde yok.
- **Kayıt:** https://console.groq.com/
- **Ücretsiz katman:** Limitler yanıt başlıklarından ölçüldü (2026-10-20): `x-ratelimit-limit-requests` = 1000 (günde 1.000 istek) ve `x-ratelimit-limit-tokens` = 8000 (dakikada 8.000 token). Üç sohbet modelinde de aynı; sayaçlar modele özel (her modelde ilk çağrıdan sonra 999 istek kaldı). Groq dokümanı ayrıca dakikada 30 istek ve günde 200.000 token taban limiti verir; bu ikisi başlıkla gelmez, ölçülemedi. Hesabının güncel limitleri: https://console.groq.com/settings/limits
  - Bir persona turu yaklaşık 440 token giriş ve 100-150 token çıkış harcar. Yeni bir konuşmada dakikada yaklaşık 10-14 tur sığar; konuşma uzadıkça geçmiş mesajlar girişi büyüttüğü için azalır. `max_completion_tokens` limitten baştan düşülmez (64 ile 4096 arasında denendi, düşülen miktar değişmedi).
  - Limit aşılırsa HTTP 429 ve `retry-after` gelir; uygulama iki kez yeniden dener, olmazsa Gemini'ye geçer.
- **Anahtar oluşturma:**
  1. https://console.groq.com/keys sayfasına git (giriş yaptıktan sonra).
  2. Yeni anahtar oluştur düğmesine (**Create API Key**) bas, bir ad ver.
  3. Anahtarı kopyala (sayfayı kapatmadan önce kaydet).
- **`web/.env.local`:**
  ```
  GROQ_API_KEY=...
  ```
- **Doğrula:** health çıktısında `"groq":true`. Tek başına denemek için geçici olarak `AI_PROVIDER_ORDER=groq`.

## 2. Google AI Studio (Gemini)

- **Ne için:** İkinci sağlayıcı. Model `gemini-3.5-flash-lite` (sabit sürüm; `-latest` takma adı kullanılmaz, çünkü arkasındaki model haber vermeden değişir). Düşünme seviyesi modele göre seçilir (`web/src/lib/ai/providers/gemini.ts`): Flash-Lite ile 3.5 ve 3.6 Flash için `MINIMAL` (düşünme token'ı harcamaz, ilk kelime hızlı gelir), diğer 3.x modeller için `LOW`; çünkü `gemini-3.7-flash`, `gemini-3.8-flash` ve `gemini-flash-latest` `MINIMAL`'i HTTP 400 ile reddeder.
- **Kayıt:** Google hesabınla https://aistudio.google.com/ adresine gir.
- **Ücretsiz katman:** `gemini-3.5-flash-lite` için ücretsiz katman vardır (Gemini API fiyat sayfasında giriş ve çıkış "Free of charge"; model sayfasında "Stable", kapatma tarihi yok). İstek ve token limitleri (dakikalık istek, dakikalık token, günlük istek) proje ve modele göre değişir ve dokümanda sabit rakam verilmez; kendi limitlerini https://aistudio.google.com/rate-limit adresinde gör. Günlük istek kotası Pasifik saatiyle gece yarısı sıfırlanır. Ölçümde büyük Flash modelleri (`gemini-3.8-flash`, `gemini-3.5-flash`) aynı gün birkaç çağrıdan sonra 429 verdi, Flash-Lite vermedi.
  - **Gizlilik uyarısı:** Ücretsiz katmanda gönderdiğin içerik Google ürünlerini geliştirmek için kullanılabilir (fiyat sayfasında "Used to improve our products: Yes"). Ücretli katmanda kullanılmaz. Gizli veri gönderme.
  - Ücretli katman (faturalandırma hesabı bağlayınca): milyon token başına 0,30 USD giriş / 2,50 USD çıkış (düşünme token'ları dahil).
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

## 3. Anthropic (Claude)

- **Ne için:** Son çare (ücretli) sağlayıcı: Groq ve Gemini ilk kelimeden önce hata verirse devreye girer. Model `claude-haiku-5-5` (tarih eki yok), `effort: low` (kısa düşünme). Ölçümde ilk kelime yaklaşık 1 sn, toplam yaklaşık 2 sn. Claude Haiku 5.5'te sunucu tarafı ret yedeği yoktur: bir güvenlik sınıflandırıcısı isteği reddederse bu ret olarak döner ve Anthropic zincirin sonunda olduğu için o turda `502 ai_unavailable` alırsın. Eski varsayılana dönmek istersen `ANTHROPIC_MODEL=claude-opus-5-5` yaz; bu modelde sunucu tarafı ret yedeği açık kalır.
- **Kayıt:** https://platform.claude.com/ (Claude Console).
- **Ücretsiz katman:** Yok. Kullanım ön ödemeli krediden düşer; sende 100 USD kredili bir anahtar var. `claude-haiku-5-5` fiyatı milyon token başına 0,10 USD giriş, 0,50 USD çıkış (istem 100.000 token ve altındaysa; daha uzunsa 0,50 / 2,50 USD; Anthropic model kılavuzu, Ekim 2026). Ölçülen bir persona turu 534 giriş + 163 çıkış token (düşünme dahil) = yaklaşık 0,000135 USD; 100 USD yaklaşık 740 bin tur eder. Bu tek bir turun ölçümüdür, gerçek tüketimi Console'dan izle.
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
- **Doğrula:** `curl -s localhost:3000/api/health` çıktısında `"anthropic":true`. Sohbet komutunda `x-ai-provider: anthropic` görmek için geçici olarak `AI_PROVIDER_ORDER=anthropic` yap (varsayılan sırada Groq ilk cevap verir).
- **Kredi biterse:** Anthropic hata döner (ör. 400, kredi yetersiz). Anthropic zincirde en sonda olduğu için sohbet Groq ve Gemini ile sürer; üçü de başarısız olursa `502 ai_unavailable`.

## 4. Azure Speech (seslendirme)

- **Ne için:** Karakterin sesi. Her cümle için MP3 ses, kelime zamanları ve viseme olayları döner; dudak senkronu bunlarla sürülür.
  - **tr-TR viseme destekler.** Microsoft'un "Visemes" tablosunda `tr-TR` için "Viseme ID" yazar (blend shapes yok). Biz viseme ID'leri kullanıyoruz.
  - Varsayılan sesler (standart neural): `tr-TR-EmelNeural` (kadın), `tr-TR-AhmetNeural` (erkek), `en-US-AvaNeural` (kadın), `en-US-AndrewNeural` (erkek). Ses listesi: https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts
- **Kayıt:** Azure hesabı ve aboneliği gerekir: https://azure.microsoft.com/free (kart doğrulaması istenebilir).
  - **`AADSTS50058` / `AADSTS50020` hatası** (`user account from identity provider 'live.com' does not exist in tenant 'Microsoft Services' ...`): kişisel Microsoft hesabının henüz bir Azure aboneliği ve dizini yok demektir. portal.azure.com'a doğrudan girme; önce ücretsiz kaydı tamamla: https://signup.azure.com/signup?offer=ms-azr-0044p. Kayıt aynı hatayla düşerse https://signup.live.com adresinden yeni bir outlook.com hesabı aç ve kaydı onunla yap.
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
| `502 ai_unavailable` | Tüm sağlayıcılar ilk kelimeden önce başarısız oldu. `pnpm dev` çıktısında `[ai] provider failed` satırlarına bak: `auth` anahtar hatası (Gemini geçersiz anahtara 400 verdiği için orada `bad_request` görünür), `rate_limit` kota, `server`/`network` sağlayıcı ya da bağlantı sorunu, `refusal` Claude'un güvenlik reddi. |
| Azure girişinde `AADSTS50058` veya `AADSTS50020` (`user account from identity provider 'live.com' does not exist in tenant 'Microsoft Services'`) | Kişisel Microsoft hesabının Azure aboneliği ve dizini yok. Önce https://signup.azure.com/signup?offer=ms-azr-0044p adresinden ücretsiz kaydı tamamla (portal.azure.com'dan değil). Kayıt aynı hatayla düşerse https://signup.live.com ile yeni bir outlook.com hesabı aç ve onunla kaydol. |
| `502 tts_unavailable` | Azure çağrısı başarısız. `pnpm dev` çıktısında `[api/tts] synthesis failed` satırındaki tür: `auth` anahtar/bölge uyuşmazlığı, `rate_limit` F0 sınırı, `bad_request` bölgede olmayan ses adı. |
| Cevap yarıda kesiliyor | Sağlayıcı bağlantısı cevap yazılırken koptu. Uygulama bu noktada başka sağlayıcıya geçmez; mesajı tekrar gönder. |
| `/api/health` `404` | Production build çalışıyor. Bu uç nokta yalnızca `pnpm dev`'de vardır. |
