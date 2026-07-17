// Netlify Function: server-side proxy for Anthropic food recognition.
// The API key lives ONLY in process.env.ANTHROPIC_API_KEY and never reaches the browser.
// Raw HTTP is used deliberately: the frontend is build-less and this repo has no npm
// install step, so there is no node_modules for @anthropic-ai/sdk to live in.
// Node 18+ provides global fetch.

const SHAPE = '只返回严格的 JSON，不要任何其他文字、解释、前后缀或 markdown 代码块标记。JSON 结构：{"items":[{"name":"食物名称","calories":数字}],"totalCalories":数字,"protein":数字,"carbs":数字,"fat":数字,"confidence":"low|medium|high","summary":"简短中文描述"}。calories 单位大卡，protein/carbs/fat 单位克，均为整数。若无可辨认食物，summary 填"未识别到食物"，items 为空数组，其余为 0。';

const promptFor = (n) => n <= 1
  ? '你是一位专业的营养估算助手。请仔细分析这张食物照片，识别其中的所有食物项目，并估算营养信息。' + SHAPE
  : '你是一位专业的营养估算助手。以下 ' + n + ' 张照片拍的是「同一餐」——可能是同一桌菜的不同角度，也可能是这一餐里的不同菜色。'
    + '请综合所有照片，估算这一餐的总营养。重要：同一道菜若在多张照片中重复出现，只能计算一次，不要重复累加；'
    + 'items 列出这一餐里所有不重复的食物项目，totalCalories 与 protein/carbs/fat 是整餐的合计值。' + SHAPE;

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGES = 6;
// ~5MB of base64 per image — the frontend compresses to 1280px/q0.82, so anything larger is bogus.
const MAX_ONE = 7_000_000;
const MAX_TOTAL = 24_000_000;

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const fail = (status, error) => ({
  statusCode: status,
  headers: HEADERS,
  body: JSON.stringify({ error })
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return fail(405, '只支持 POST 请求');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set in the function environment');
    return fail(500, '服务端未配置 API key');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return fail(400, '请求格式错误');
  }

  const dfltMedia = ALLOWED_MEDIA.includes(body.mediaType) ? body.mediaType : 'image/jpeg';

  // Accepted shapes, newest first:
  //   { images: ["<base64>", ...], mediaType }        — multi-photo, one meal
  //   { images: [{ base64, mediaType }, ...] }
  //   { imageBase64, mediaType }                      — legacy single photo
  const rawList = Array.isArray(body.images) && body.images.length
    ? body.images
    : [{ base64: body.imageBase64, mediaType: dfltMedia }];

  if (rawList.length > MAX_IMAGES) return fail(400, '最多只能一次识别 ' + MAX_IMAGES + ' 张照片');

  const images = [];
  let total = 0;
  for (const item of rawList) {
    const b64 = typeof item === 'string' ? item : (item && item.base64);
    const mt = (item && ALLOWED_MEDIA.includes(item.mediaType)) ? item.mediaType : dfltMedia;
    if (typeof b64 !== 'string' || b64.length < 100) return fail(400, '缺少图片数据');
    if (b64.length > MAX_ONE) return fail(413, '图片过大，请重新拍摄');
    total += b64.length;
    if (total > MAX_TOTAL) return fail(413, '照片总量过大，请减少张数');
    images.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } });
  }

  let res, raw;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: images.concat([{ type: 'text', text: promptFor(images.length) }])
        }]
      })
    });
    raw = await res.text();
  } catch (e) {
    console.error('anthropic request failed:', e);
    return fail(502, '无法连接识别服务，请稍后再试');
  }

  if (!res.ok) {
    // Log the upstream detail server-side; return something safe to the client.
    console.error('anthropic error', res.status, raw.slice(0, 500));
    if (res.status === 429) return fail(429, '识别请求太频繁，请稍后再试');
    if (res.status === 401 || res.status === 403) return fail(500, '服务端 API key 无效');
    return fail(502, '识别服务错误 (' + res.status + ')');
  }

  // Pull the model's text out of the Messages API response.
  let text = '';
  try {
    const data = JSON.parse(raw);
    if (data.stop_reason === 'refusal') return fail(422, '这张照片无法识别，请换一张');
    text = (data.content || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('');
  } catch (e) {
    console.error('unparseable anthropic response:', raw.slice(0, 500));
    return fail(502, '识别服务返回异常');
  }

  // Extract the JSON object: first "{" through last "}".
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    console.error('no JSON object in model output:', text.slice(0, 300));
    return fail(502, '识别结果解析失败，请改为手动输入');
  }

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    console.error('JSON.parse failed on model output:', text.slice(start, end + 1).slice(0, 300));
    return fail(502, '识别结果解析失败，请改为手动输入');
  }

  const int = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const conf = ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium';

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      items: Array.isArray(parsed.items)
        ? parsed.items.slice(0, 20).map((i) => ({
            name: String((i && i.name) || '未知食物').slice(0, 40),
            calories: int(i && i.calories)
          }))
        : [],
      totalCalories: int(parsed.totalCalories),
      protein: int(parsed.protein),
      carbs: int(parsed.carbs),
      fat: int(parsed.fat),
      confidence: conf,
      summary: String(parsed.summary || '识别结果').slice(0, 60)
    })
  };
};
