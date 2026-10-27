/**
 * Mirror of the Vercel deployment on ai-sims.pages.dev.
 *
 * Since 2026-10-27, Turkish networks (home ISP and mobile) reset the TLS
 * handshake for any *.vercel.app host (SNI filtering), while the same Vercel
 * IP answers for other names and *.pages.dev is reachable. This Cloudflare
 * Pages worker forwards every request to Vercel and translates the host in
 * both directions, so the app needs no change:
 * - Origin and Referer are rewritten to the Vercel origin (Next.js server
 *   actions and Better Auth compare Origin with the host they serve).
 * - Redirect targets on the Vercel host come back on this host.
 * - Cookies stay host-only here (any Domain attribute is dropped).
 *
 * Deploy: see docs/deploy.md ("Türkiye erişimi").
 */
const TARGET = "https://ai-sims-zeta.vercel.app";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const here = url.origin;
    const headers = new Headers(request.headers);
    if (headers.get("origin") === here) headers.set("origin", TARGET);
    const referer = headers.get("referer");
    if (referer?.startsWith(here))
      headers.set("referer", TARGET + referer.slice(here.length));
    headers.delete("host");

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const response = await fetch(new URL(url.pathname + url.search, TARGET), {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
    });

    const out = new Headers(response.headers);
    const location = out.get("location");
    if (location?.startsWith(TARGET))
      out.set("location", here + location.slice(TARGET.length));
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      out.delete("set-cookie");
      for (const cookie of cookies)
        out.append("set-cookie", cookie.replace(/;\s*domain=[^;]*/gi, ""));
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: out,
    });
  },
};
