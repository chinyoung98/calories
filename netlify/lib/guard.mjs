// Shared by every AI function: who is calling, and have they used up today's AI budget.
//
// 1. verifyIdToken — checks the Firebase ID token the browser sends in
//    `Authorization: Bearer <token>` against Google's public certs. No npm deps:
//    the repo has no install step, so this uses Node's crypto directly.
// 2. takeQuota — bumps calorie_ledger/usage/{uid}/{day} by exactly +1 through the
//    Realtime Database REST API, using the caller's own token. The database rule on
//    that node only accepts "old value + 1", so nobody can reset their own counter
//    from the browser, and the function refuses once the count passes the limit.

import crypto from 'node:crypto';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gcl-client-portal';
const DB_URL = (process.env.FIREBASE_DB_URL ||
  'https://gcl-client-portal-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
// Quota days roll over at local midnight (Malaysia, UTC+8) unless overridden.
const TZ_OFFSET_MIN = Number.isFinite(Number(process.env.QUOTA_TZ_OFFSET_MIN)) ? Number(process.env.QUOTA_TZ_OFFSET_MIN) : 480;

export const DAILY_LIMIT = (() => {
  const n = parseInt(process.env.AI_DAILY_LIMIT, 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
})();

let certCache = { at: 0, maxAge: 0, keys: null };

async function getCerts() {
  const now = Date.now();
  if (certCache.keys && now - certCache.at < certCache.maxAge) return certCache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('cert fetch ' + res.status);
  const keys = await res.json();
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  certCache = { at: now, maxAge: (m ? parseInt(m[1], 10) : 3600) * 1000, keys };
  return keys;
}

const b64urlJson = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Returns { uid, email } or throws HttpError(401).
export async function verifyIdToken(token, { certs } = {}) {
  if (!token || typeof token !== 'string') throw new HttpError(401, '请先登录');
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, '登录凭证无效，请重新登录');
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); }
  catch (e) { throw new HttpError(401, '登录凭证无效，请重新登录'); }
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, '登录凭证无效，请重新登录');

  const keys = certs || await getCerts();
  const pem = keys[header.kid];
  if (!pem) throw new HttpError(401, '登录已过期，请重新登录');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]),
    crypto.createPublicKey(pem), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new HttpError(401, '登录凭证无效，请重新登录');

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT_ID || payload.iss !== 'https://securetoken.google.com/' + PROJECT_ID)
    throw new HttpError(401, '登录凭证不属于这个应用');
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) throw new HttpError(401, '登录已过期，请重新登录');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new HttpError(401, '登录凭证无效，请重新登录');
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) throw new HttpError(401, '登录凭证无效，请重新登录');
  return { uid: payload.sub, email: payload.email || null };
}

export function bearer(req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export function quotaDay(now = Date.now()) {
  return new Date(now + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

// Spends one unit of today's budget. Returns { used, limit, day }.
// Throws HttpError(429) once the limit is reached. If the database refuses the
// write because the usage rule hasn't been published yet, it lets the call through
// (logged), so a missing rule never takes the whole AI feature down.
export async function takeQuota(uid, token, { limit = DAILY_LIMIT, fetchImpl = fetch, now } = {}) {
  const day = quotaDay(now);
  const url = `${DB_URL}/calorie_ledger/usage/${encodeURIComponent(uid)}/${day}.json?auth=${encodeURIComponent(token)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = await fetchImpl(url, { headers: { 'X-Firebase-ETag': 'true' } }); }
    catch (e) { console.warn('[quota] read failed, allowing call', e && e.message); return { used: null, limit, day }; }
    if (res.status === 401 || res.status === 403) {
      console.warn('[quota] usage rule missing or denied — allowing call');
      return { used: null, limit, day };
    }
    if (!res.ok) { console.warn('[quota] read status', res.status); return { used: null, limit, day }; }
    const etag = res.headers.get('etag');
    const cur = Number(await res.json()) || 0;
    if (cur >= limit) throw new HttpError(429, `今天的 AI 次数已用完（每天 ${limit} 次），明天再来吧`);
    let put;
    try {
      put = await fetchImpl(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(etag ? { 'if-match': etag } : {}) },
        body: JSON.stringify(cur + 1)
      });
    } catch (e) { console.warn('[quota] write failed, allowing call', e && e.message); return { used: null, limit, day }; }
    if (put.status === 412) continue;                       // someone else bumped it first — re-read
    if (put.status === 401 || put.status === 403) {
      console.warn('[quota] usage write denied — allowing call');
      return { used: null, limit, day };
    }
    if (!put.ok) { console.warn('[quota] write status', put.status); return { used: null, limit, day }; }
    return { used: cur + 1, limit, day };
  }
  throw new HttpError(429, '请求太频繁，请稍后再试');
}

// One call to the Messages API. Falls back to `fallbackModel` if the first model
// id isn't available on this key.
export async function callClaude({ model, fallbackModel, maxTokens, content, system, fetchImpl = fetch }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('ANTHROPIC_API_KEY is not set'); throw new HttpError(500, '服务端未配置 API key'); }
  const once = async m => {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: m, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content }] })
    });
    return { res, raw: await res.text() };
  };
  let r;
  try {
    r = await once(model);
    if (fallbackModel && fallbackModel !== model && (r.res.status === 404 || (r.res.status === 400 && /model/i.test(r.raw)))) {
      console.warn('[claude] model', model, 'unavailable, falling back to', fallbackModel);
      r = await once(fallbackModel);
    }
  } catch (e) {
    console.error('anthropic request failed:', e);
    throw new HttpError(502, '无法连接 AI 服务，请稍后再试');
  }
  if (!r.res.ok) {
    console.error('anthropic error', r.res.status, r.raw.slice(0, 500));
    if (r.res.status === 429) throw new HttpError(429, 'AI 服务繁忙，请稍后再试');
    if (r.res.status === 401 || r.res.status === 403) throw new HttpError(500, '服务端 API key 无效');
    throw new HttpError(502, 'AI 服务错误 (' + r.res.status + ')');
  }
  let data;
  try { data = JSON.parse(r.raw); } catch (e) { throw new HttpError(502, 'AI 服务返回异常'); }
  if (data.stop_reason === 'refusal') throw new HttpError(422, '这条内容无法处理，换个说法再试');
  return {
    text: (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join(''),
    truncated: data.stop_reason === 'max_tokens'
  };
}

// First "{" through last "}" — the model is told to reply with one JSON object.
export function extractJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e <= s) throw new HttpError(502, 'AI 回复解析失败，请再试一次');
  try { return JSON.parse(text.slice(s, e + 1)); }
  catch (err) { throw new HttpError(502, 'AI 回复解析失败，请再试一次'); }
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export const jsonResponse = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

// Streams spaces every few seconds while `work()` runs, then the JSON result.
// Streaming responses get Netlify's longer execution limit instead of the 10 s
// one for buffered responses, so multi-photo calls stop timing out. The status is
// already 200 once streaming starts, so late failures go out as { error } —
// JSON.parse ignores the leading whitespace.
export function streamJson(work) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => { try { controller.enqueue(enc.encode(' ')); } catch (e) {} }, 2500);
      controller.enqueue(enc.encode(' '));
      let out;
      try { out = await work(); }
      catch (e) {
        if (!(e instanceof HttpError)) console.error('[ai] unexpected', e);
        out = { error: e instanceof HttpError ? e.message : '服务出错了，请再试一次', status: e instanceof HttpError ? e.status : 500 };
      }
      clearInterval(beat);
      controller.enqueue(enc.encode(JSON.stringify(out)));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: JSON_HEADERS });
}

// Common front door: POST only, valid token, parsed body. Returns { user, token, body } or a Response.
// The caller validates the body, then calls spend() — so a malformed request costs no budget.
export async function admit(req, { maxBody = 26_000_000 } = {}) {
  if (req.method !== 'POST') return jsonResponse(405, { error: '只支持 POST 请求' });
  const token = bearer(req);
  let user;
  try { user = await verifyIdToken(token); }
  catch (e) {
    if (e instanceof HttpError) return jsonResponse(e.status, { error: e.message });
    console.error('[auth] verify failed', e);
    return jsonResponse(503, { error: '暂时无法验证登录，请稍后再试' });
  }
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBody) return jsonResponse(413, { error: '内容太大了，请减少照片张数' });
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse(400, { error: '请求格式错误' }); }
  if (!body || typeof body !== 'object') return jsonResponse(400, { error: '请求格式错误' });
  return { user, token, body };
}

// Returns the quota object, or a Response when the budget is spent.
export async function spend(gate) {
  try { return await takeQuota(gate.user.uid, gate.token); }
  catch (e) { return jsonResponse(e.status || 429, { error: e.message }); }
}

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// [{ base64, mediaType }] → Messages API image blocks, with size caps.
export function imageBlocks(list, { max = 6, maxOne = 7_000_000, maxTotal = 24_000_000 } = {}) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > max) throw new HttpError(400, '最多只能一次发 ' + max + ' 张照片');
  let total = 0;
  return list.map(item => {
    const b64 = typeof item === 'string' ? item : (item && item.base64);
    const mt = item && ALLOWED_MEDIA.includes(item.mediaType) ? item.mediaType : 'image/jpeg';
    if (typeof b64 !== 'string' || b64.length < 100) throw new HttpError(400, '缺少图片数据');
    if (b64.length > maxOne) throw new HttpError(413, '图片过大，请重新拍摄');
    total += b64.length;
    if (total > maxTotal) throw new HttpError(413, '照片总量过大，请减少张数');
    return { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } };
  });
}
