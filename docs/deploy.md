# Deploy (Vercel + R2 + Atlas)

Şirket içi demo için canlı kurulum. Hepsi ücretsiz katmanda (2026-10-26).

- **Adres:** https://ai-sims-zeta.vercel.app (`ai-sims.vercel.app` başkasının). `ai-sims-yigtwx.vercel.app` ve deploy'a özel URL'ler Vercel girişi ister.
- **Akış:** `main`'e her push production deploy'u tetikler. Başka branch'ler preview olur; preview'larda giriş çalışmaz, çünkü `BETTER_AUTH_URL` production adresidir.

## Vercel

- Proje `ai-sims`, takım `yigtwx`, GitHub `Yigtwxx/ai-sims` bağlı. Plan Hobby; şirket kullanımı kullanıcı tarafından onaylandı.
- Root Directory `web`, Node 22, framework Next.js. Fonksiyon bölgesi `fra1` (`web/vercel.json`): Atlas kümesiyle aynı şehir.
- pnpm: Vercel sürümü lockfile'dan seçiyor ve pnpm 12 biçimini (iki YAML belgesi) okuyamıyor. Bu yüzden `web/vercel.json` kurulum ve build komutlarını `npx pnpm@12.4.2` ile sabitliyor. `packageManager` değişirse bu dosya da güncellenmeli.
- Deployment Protection: Standard. Preview ve deploy'a özel URL'ler Vercel girişi ister, production alan adı herkese açıktır.
- Hobby kotası: ayda 100 GB Fast Data Transfer. Varlıklar Vercel'den geçmez, bu yüzden kotayı yalnızca sayfa ve API trafiği harcar.

### Env (Production)

| Değişken | Not |
| --- | --- |
| `NEXT_PUBLIC_MH_ASSET_ROOT` | R2 bucket adresi (production + preview). Build'de inline edilir; değişirse yeniden deploy gerekir |
| `MONGODB_URI` | Atlas, kullanıcı `ai-sims-app`. Değer yalnızca Vercel'de durur |
| `BETTER_AUTH_SECRET` | Production'a özel üretildi, yereldekinden farklı |
| `BETTER_AUTH_URL` | Production adresi |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | Yerel `.env.local`'dan aktarıldı |
| `TTS_ENABLE_EDGE` | `1`. Azure anahtarı yok; ses Edge, sonra Gemini |

Anahtarlar ekrana basılmadan CLI ile girildi: `printf '%s' "$VALUE" | vercel env add NAME production --sensitive`.

## Varlıklar: Cloudflare R2

- Bucket `ai-sims-mh` (konum WEUR). Herkese açık adres `https://pub-3bc24e93f6b644a09830eee4f15bb5e0.r2.dev`.
- CORS: her origin'den `GET`/`HEAD`. Varlıklar zaten herkese açık; yazma yalnızca Cloudflare girişiyle yapılır.
- Önbellek: JSON dosyaları 60 sn, geri kalanlar 1 saat (dosya adlarında hash yok).
- **Senkron:** dönüştürücü çalıştıktan sonra `cd web && node scripts/r2-sync.mjs [klasör ...]`. Klasör verilmezse tüm export yüklenir (2 GB, yaklaşık 20 dakika). Önce bir kez `npx wrangler login`.
- Script yalnızca yükler. Yerelden silinen bir varlık bucket'ta kalır; manifest onu göstermediği için zararsızdır.
- `r2.dev` hız sınırlıdır ve önbelleği yoktur. Demo için yeterli; kalıcı kullanımda Cloudflare'e bağlı bir alan adı gerekir.
- Ücret: ayda 10 GB depolama, 1M yazma, 10M okuma ücretsiz; trafik her zaman ücretsiz. **Harcama tavanı yok**: kota aşılırsa kayıtlı karttan çekilir. Bugünkü kullanım 2 GB depolama, karakter başına yaklaşık 50 okuma.

## Veritabanı: MongoDB Atlas

- Org "Yiğit's Org - 2026-10-26", proje `ai-sims`, küme `ai-sims` (M0, AWS `eu-central-1`).
- Uygulama kullanıcısı `ai-sims-app`, yetkisi yalnızca `readWrite@ai-sims`. Parola rastgele üretildi ve yalnızca Vercel env'inde durur. Değiştirmek için: `atlas dbusers update ai-sims-app --password ... --projectId <id>`, ardından `MONGODB_URI`'yi güncelle ve yeniden deploy et.
- Network Access `0.0.0.0/0`: Vercel fonksiyonlarının IP'si sabit değil.
- M0 sınırları `docs/setup-accounts.md` §7'de. 30 gün bağlantı olmazsa küme duraklar.

## Türkiye erişimi: Cloudflare Pages aynası

- **Paylaşılacak adres: https://ai-sims.pages.dev.**
- **Sebep:** 2026-10-27'den beri Türk ağları (ev interneti ve mobil hotspot denendi) `*.vercel.app` adresleri için TLS el sıkışmasını kesiyor (SNI filtresi). Aynı Vercel IP'si başka bir adla yanıt veriyor; `*.pages.dev` ve R2'nin `*.r2.dev` adresi açılıyor.
- **Nasıl çalışır:** `proxy/pages/_worker.js` her isteği `https://ai-sims-zeta.vercel.app`'e aktarır ve host'u iki yönde çevirir:
  - `Origin` ve `Referer` Vercel adresine çevrilir; server action'lar ve Better Auth Origin'i kendi host'larıyla karşılaştırır.
  - Vercel host'una giden yönlendirmeler aynaya döner.
  - Çerezler aynanın host'unda kalır; `Domain` özniteliği atılır.
  - Uygulamada değişiklik gerekmez. Vercel'e her push aynada da hemen görünür.
- **Paylaşım önizlemesi:** önizleme görselinin mutlak adresi aynaya bakar (`web/src/app/[locale]/layout.tsx`, `metadataBase`). WhatsApp gibi uygulamalar görseli telefondan çeker; `vercel.app` adresi orada açılmaz.
- **Vekili güncellemek:** proje Cloudflare'de klasik Pages olarak açıldı (`ai-sims`, bir kez `--force` ile). Repo kökünde:

  ```bash
  npx -y wrangler@4.152.0 pages deploy proxy/pages --project-name ai-sims --branch main --commit-dirty=true
  ```

  Önce `npx wrangler login` gerekir. Bu Mac'te oturum açık.
- **Kalıcı çözüm:** projeye bir alan adı bağlamak. Engel `vercel.app` adınadır; kendi alan adında olmaz.

## Bilinen riskler

- Production adresi herkese açık ve anonim giriş var. Linki bilen herkes sohbeti ve sesi kullanabilir. Groq ve Gemini ücretsiz kotada kalır, ama zincirin sonundaki Claude ücretlidir. Kötüye kullanım görülürse Vercel'den `ANTHROPIC_API_KEY` silinip yeniden deploy edilir.
- Edge TTS 2026-10-26'dan itibaren her yerde düşüyordu (Vercel'de `kind: 'service'`, yerelde `Unexpected server response: 200`): Microsoft uç noktası değişmişti. `msedge-tts` 2.1.1 (2026-10-25) bunu düzeltti ve proje ona yükseltildi (2026-10-27). Edge kesilirse ses Gemini TTS'e düşer; Gemini'nin ücretsiz kotası birkaç cümlede biter ve zamanlama vermez. Azure F0 en sağlam seçenek, ama kullanıcının hesabı sürekli hata veriyor (2026-10-27). Edge yine kırılırsa önce `npm view msedge-tts time`'a bakıp kütüphaneyi güncelle.
- Edge 2026-10-27'den beri `tr-TR-AhmetNeural`'ı neredeyse hiç seslendirmiyor (ses gelmeden "no turn.end"; Emel ve İngilizce sesler sağlam). Türkçe erkek sesi Edge'de `en-US-BrianMultilingualNeural` okur (`EDGE_VOICE_SUBSTITUTES`, `web/src/lib/tts/edge.ts`): Türkçeyi kendisi algılıyor, kelime zamanı veriyor. Azure Ahmet'i kullanmaya devam eder. Ahmet düzelirse eşlemeyi kaldır.
