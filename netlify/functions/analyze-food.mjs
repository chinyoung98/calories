// Netlify Function: AI food recognition from the 加饮食 composer (one or more photos = one meal).
// The API key lives ONLY in process.env.ANTHROPIC_API_KEY and never reaches the browser.
// Callers must be signed in (Firebase ID token) and each call spends one unit of the
// per-person daily AI budget — see netlify/lib/guard.mjs.

import { admit, spend, imageBlocks, callClaude, extractJson, streamJson, jsonResponse, HttpError } from '../lib/guard.mjs';

const SHAPE = '只返回严格的 JSON，不要任何其他文字、解释、前后缀或 markdown 代码块标记。JSON 结构：{"items":[{"name":"食物名称","calories":数字}],"totalCalories":数字,"protein":数字,"carbs":数字,"fat":数字,"confidence":"low|medium|high","summary":"简短中文描述"}。calories 单位大卡，protein/carbs/fat 单位克，均为整数。若无可辨认食物，summary 填"未识别到食物"，items 为空数组，其余为 0。';

const promptFor = (n) => n <= 1
  ? '你是一位专业的营养估算助手。请仔细分析这张食物照片，识别其中的所有食物项目，并估算营养信息。份量按马来西亚常见份量估算。' + SHAPE
  : '你是一位专业的营养估算助手。以下 ' + n + ' 张照片拍的是「同一餐」——可能是同一桌菜的不同角度，也可能是这一餐里的不同菜色。'
    + '请综合所有照片，估算这一餐的总营养。重要：同一道菜若在多张照片中重复出现，只能计算一次，不要重复累加；'
    + 'items 列出这一餐里所有不重复的食物项目，totalCalories 与 protein/carbs/fat 是整餐的合计值。份量按马来西亚常见份量估算。' + SHAPE;

const int = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default async (req) => {
  const gate = await admit(req);
  if (gate instanceof Response) return gate;
  const body = gate.body;

  // Accepted shapes: { images: [{ base64, mediaType }] } (current), { images: ["<b64>"] }, { imageBase64, mediaType } (legacy)
  let images;
  try {
    const raw = Array.isArray(body.images) && body.images.length
      ? body.images
      : [{ base64: body.imageBase64, mediaType: body.mediaType }];
    images = imageBlocks(raw, { max: 6 });
  } catch (e) {
    return jsonResponse(e.status || 400, { error: e.message });
  }

  const quota = await spend(gate);
  if (quota instanceof Response) return quota;

  return streamJson(async () => {
    const { text } = await callClaude({
      model: process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-6',
      fallbackModel: 'claude-sonnet-4-6',
      maxTokens: 1000,
      content: images.concat([{ type: 'text', text: promptFor(images.length) }])
    });
    let parsed;
    try { parsed = extractJson(text); }
    catch (e) { throw new HttpError(502, '识别结果解析失败，请改为手动输入'); }
    return {
      items: Array.isArray(parsed.items)
        ? parsed.items.slice(0, 20).map((i) => ({ name: String((i && i.name) || '未知食物').slice(0, 40), calories: int(i && i.calories) }))
        : [],
      totalCalories: int(parsed.totalCalories),
      protein: int(parsed.protein),
      carbs: int(parsed.carbs),
      fat: int(parsed.fat),
      confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
      summary: String(parsed.summary || '识别结果').slice(0, 60),
      quota
    };
  });
};
