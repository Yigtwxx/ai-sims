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

## Bilinen riskler

- Production adresi herkese açık ve anonim giriş var. Linki bilen herkes sohbeti ve sesi kullanabilir. Groq ve Gemini ücretsiz kotada kalır, ama zincirin sonundaki Claude ücretlidir. Kötüye kullanım görülürse Vercel'den `ANTHROPIC_API_KEY` silinip yeniden deploy edilir.
- Edge TTS Vercel'den çalışmıyor: `fra1`'de her istek `kind: 'service'` hatasıyla düşüyor (2026-10-26). Ses bu yüzden Gemini TTS'ten geliyor. Gemini zamanlama vermediği için dudak senkronu metinden tahmin ediliyor ve ücretsiz günlük kotası küçük. Viseme'li en iyi senkron için Vercel'e `AZURE_SPEECH_KEY` ve `AZURE_SPEECH_REGION` eklenmeli (F0 ücretsiz; `docs/setup-accounts.md`).
