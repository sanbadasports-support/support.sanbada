// support.sanbada 접수·조회 문지기 Worker (공개용, 로그인 없음)
// 홈페이지 → 이 Worker → Make 웹훅. Make 주소·접수 키는 Worker 비밀값에만 있고 공개 코드에는 없습니다.
// - POST /submit : 사람 확인(Turnstile) + IP당 횟수 제한 → Make 접수 웹훅
// - POST /lookup : a=serial(자동완성, 횟수 제한) / a=track(진행 조회, Turnstile + 더 엄격한 횟수 제한) → Make 조회 웹훅
// 비밀값(대시보드 「암호화」): HOOK_SUBMIT, HOOK_LOOKUP, SUBMIT_KEY, TURNSTILE_SECRET

const MAX_BODY = 15 * 1024 * 1024; // 사진 6장(각 1600px JPEG) 넉넉히

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = { "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "", "Vary": "Origin" };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
    if (req.method !== "POST") return json({ ok: false, error: "없는 주소" }, 404);
    if (!allowed.includes(origin)) return json({ ok: false, error: "허용되지 않은 사이트" }, 403);

    const len = Number(req.headers.get("Content-Length") || 0);
    if (len > MAX_BODY) return json({ ok: false, error: "사진 용량이 너무 커요." }, 413);
    const ip = req.headers.get("CF-Connecting-IP") || "0";
    const path = new URL(req.url).pathname;

    let form;
    try { const raw = await req.text(); if (raw.length > MAX_BODY) return json({ ok: false, error: "사진 용량이 너무 커요." }, 413); form = new URLSearchParams(raw); }
    catch { return json({ ok: false, error: "잘못된 요청" }, 400); }

    if (path === "/submit") {
      if (!(await limit(env.RL_SUBMIT, ip))) return json({ ok: false, error: "잠시 뒤 다시 시도해 주세요." }, 429);
      if (form.get("hp")) return json({ ok: true, no: "" }); // 자동 프로그램이 숨은 칸을 채운 경우: 조용히 버림
      if (!(await human(env, form.get("ts"), ip))) return json({ ok: false, error: "사람 확인에 실패했어요. 새로고침 후 다시 해 주세요." }, 403);
      form.delete("ts"); form.set("k", env.SUBMIT_KEY || "");
      return relay(env.HOOK_SUBMIT, form, cors);
    }
    if (path === "/lookup") {
      const a = form.get("a");
      if (a === "serial") {
        if (!(await limit(env.RL_SERIAL, ip))) return json({ ok: false, error: "잠시 뒤 다시 시도해 주세요." }, 429);
        const q = (form.get("q") || "").trim();
        if (q.length < 3 || q.length > 30) return json({ ok: true, boards: [] });
        return relay(env.HOOK_LOOKUP, new URLSearchParams({ a, q }), cors);
      }
      if (a === "track") {
        if (!(await limit(env.RL_TRACK, ip))) return json({ ok: false, error: "조회를 너무 많이 했어요. 1분 뒤 다시 해 주세요." }, 429);
        if (!(await human(env, form.get("ts"), ip))) return json({ ok: false, error: "사람 확인에 실패했어요. 새로고침 후 다시 해 주세요." }, 403);
        const no = (form.get("no") || "").trim(), ph = (form.get("ph") || "").trim();
        if (!/^\d{6}-\d{2,3}$/.test(no) || !/^\d{4}$/.test(ph)) return json({ ok: true, found: false });
        return relay(env.HOOK_LOOKUP, new URLSearchParams({ a, no, ph }), cors);
      }
    }
    return json({ ok: false, error: "없는 주소" }, 404);
  },
};

async function limit(rl, ip) {
  if (!rl) return true; // 횟수 제한 설정 전에는 통과(배포 직후 대비)
  const { success } = await rl.limit({ key: ip });
  return success;
}

async function human(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return false; // 설정이 비면 거절(안전 쪽 기본값)
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const d = await r.json().catch(() => ({}));
  return d.success === true;
}

async function relay(hook, form, cors) {
  if (!hook) return new Response(JSON.stringify({ ok: false, error: "웹훅 주소가 설정되지 않았어요." }), { status: 500, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
  const r = await fetch(hook, { method: "POST", body: form });
  const h = new Headers({ ...cors, "Content-Type": r.headers.get("Content-Type") || "application/json; charset=utf-8", "Cache-Control": "no-store" });
  return new Response(r.body, { status: r.status, headers: h });
}
