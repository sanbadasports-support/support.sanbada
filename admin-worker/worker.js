// support.sanbada 관리자 Worker
// - 모든 요청은 Cloudflare Access 로그인(회사 메일 인증) 토큰을 검증한 뒤에만 처리합니다. 설정이 비어 있으면 전부 거절(안전 쪽 기본값).
// - GET  /api/content  : GitHub의 data/content.json 읽기
// - POST /api/save     : data/content.json 저장(커밋). 커밋 메시지에 저장한 사람 메일이 남습니다.
// - GET  /api/history  : 최근 변경 기록 20개
// GitHub 토큰은 Worker 비밀값(GITHUB_TOKEN)에만 있고 브라우저로 내려가지 않습니다.

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export default {
  async fetch(req, env) {
    const user = await verifyAccess(req, env);
    if (!user) return new Response("로그인이 필요합니다 (Cloudflare Access).", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/content" && req.method === "GET") return await getContent(env, user);
      if (url.pathname === "/api/save" && req.method === "POST") return await save(req, env, user);
      if (url.pathname === "/api/history" && req.method === "GET") return await history(env);
      if (url.pathname.startsWith("/api/")) return json({ error: "없는 주소" }, 404);
      const res = await env.ASSETS.fetch(req);
      const h = new Headers(res.headers);
      h.set("X-Frame-Options", "DENY"); h.set("Referrer-Policy", "no-referrer"); h.set("Cache-Control", "no-store");
      return new Response(res.body, { status: res.status, headers: h });
    } catch (e) {
      return json({ error: e.message || "서버 오류" }, e.status || 500);
    }
  },
};

/* ---------- GitHub ---------- */
async function gh(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw Object.assign(new Error("GitHub 열쇠(GITHUB_TOKEN)가 설정되지 않았어요."), { status: 500 });
  const r = await fetch("https://api.github.com" + path, {
    ...init,
    headers: { Authorization: "Bearer " + env.GITHUB_TOKEN, Accept: "application/vnd.github+json", "User-Agent": "sanbada-admin", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(r.status === 409 ? "다른 사람이 먼저 저장했어요." : "GitHub 오류 " + r.status + (body.message ? ": " + body.message : "")), { status: r.status === 409 ? 409 : 502 });
  return body;
}
const b64dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
function b64enc(str) { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }

async function getContent(env, user) {
  const f = await gh(env, `/repos/${env.REPO}/contents/${env.FILE}?ref=${env.BRANCH}`);
  return json({ content: JSON.parse(b64dec(f.content)), sha: f.sha, user, site: env.SITE_URL });
}

async function save(req, env, user) {
  const raw = await req.text();
  if (raw.length > 600000) return json({ error: "내용이 너무 커요." }, 413);
  const { content, sha, summary } = JSON.parse(raw);
  const err = validate(content);
  if (err) return json({ error: err }, 400);
  const text = JSON.stringify(content, null, 1) + "\n";
  const msg = `관리자 페이지 수정: ${String(summary || "내용 수정").slice(0, 200)}\n\n저장한 사람: ${user}`;
  const r = await gh(env, `/repos/${env.REPO}/contents/${env.FILE}`, {
    method: "PUT",
    body: JSON.stringify({ message: msg, content: b64enc(text), sha, branch: env.BRANCH }),
  });
  return json({ ok: true, sha: r.content.sha });
}

async function history(env) {
  const list = await gh(env, `/repos/${env.REPO}/commits?path=${encodeURIComponent(env.FILE)}&sha=${env.BRANCH}&per_page=20`);
  return json({ items: list.map((c) => ({ date: c.commit.author.date, message: c.commit.message.replace(/\n+/g, " · ") })) });
}

function validate(c) {
  const str = (v) => typeof v === "string" && v.length < 20000;
  if (!c || typeof c !== "object") return "형식 오류";
  if (!c.settings || typeof c.settings !== "object" || !Object.values(c.settings).every(str)) return "설정 형식 오류";
  if (!Array.isArray(c.brands) || !c.brands.every((b) => b && str(b.id) && str(b.name) && str(b.kind) && Array.isArray(b.docs) && b.docs.every((d) => str(d.t) && str(d.u ?? "") && (!d.u || /^https?:\/\//.test(d.u))))) return "브랜드 형식 오류 (자료 링크는 https:// 로 시작해야 해요)";
  if (!Array.isArray(c.faq) || c.faq.length > 500 || !c.faq.every((f) => f && str(f.q) && f.q.trim() && str(f.a) && f.a.trim() && str(f.t ?? "") && Array.isArray(f.b) && Array.isArray(f.c))) return "FAQ 형식 오류 (질문·답은 비울 수 없어요)";
  if (c.settings.dealerFinder && !/^https?:\/\//.test(c.settings.dealerFinder)) return "대리점 찾기 링크는 https:// 로 시작해야 해요";
  return "";
}

/* ---------- Cloudflare Access 토큰 검증 (RS256) ---------- */
let certCache = { at: 0, keys: [] };
async function verifyAccess(req, env) {
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return null;
  const tok = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!tok) return null;
  try {
    const [h, p, s] = tok.split(".");
    const dec = (x) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
    const head = dec(h), pay = dec(p);
    if (head.alg !== "RS256") return null;
    const aud = Array.isArray(pay.aud) ? pay.aud : [pay.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (pay.iss !== `https://${env.ACCESS_TEAM}`) return null;
    if (!pay.exp || pay.exp * 1000 < Date.now()) return null;
    if (Date.now() - certCache.at > 3600e3) {
      const r = await fetch(`https://${env.ACCESS_TEAM}/cdn-cgi/access/certs`);
      certCache = { at: Date.now(), keys: (await r.json()).keys || [] };
    }
    const jwk = certCache.keys.find((k) => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(h + "." + p));
    return ok ? pay.email || "알 수 없음" : null;
  } catch { return null; }
}
