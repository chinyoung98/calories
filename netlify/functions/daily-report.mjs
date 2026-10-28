// Netlify Function: the AI 日报. The browser computes the day's numbers and score
// (fixed rules, so the same data always scores the same) and sends them as a facts
// block; Claude writes the short report. Spends one unit of the daily AI budget.

import { admit, spend, callClaude, extractJson, streamJson, jsonResponse } from '../lib/guard.mjs';

const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const arr = (v, n) => Array.isArray(v) ? v.map(x => str(x, n)).filter(Boolean).slice(0, 3) : [];

function prompt(facts, partial, nowHm) {
  return `你是「卡路里记账本」app 的每日健康报告助手，风格像运动健康 app 的日报：简短、具体、有温度，不说空话。根据下面这一天的记录写日报。

只输出一个 JSON 对象，不要其他文字：
{"headline":"一句话标题，20 字以内，点出这天最关键的一点","summary":"2 到 3 句总体点评，引用具体数字，并和前几天比较","good":["做得好的地方，1 到 2 条，每条 25 字以内"],"improve":["可以改进的地方，1 到 2 条，每条 30 字以内，要具体到吃什么、练什么、多少"],"tomorrow":"${partial ? '今天剩下的时间' : '明天'}可以做的一件具体的事，30 字以内"}

要求：
- 评分由 app 按固定规则算好（见【评分】），不要重新打分，可以解释分数高低的原因。
- 只记了一两餐时，提醒可能漏记，不要把它当成吃得少来表扬。
- ${partial ? `这一天还没结束（现在 ${nowHm}），按“到目前为止”来写。` : '这一天已经结束，按全天来写。'}
- 有步数、睡眠、静息心率时一起点评；睡眠少于 6 小时要提一句对恢复和食欲的影响。
- 不鼓励极端节食或过度训练，不做医疗诊断；体态只说可以改善的姿势习惯。

${facts}`;
}

export default async (req) => {
  const gate = await admit(req, { maxBody: 200_000 });
  if (gate instanceof Response) return gate;
  const b = gate.body;
  const facts = str(b.facts, 10000);
  if (!facts) return jsonResponse(400, { error: '没有可分析的记录' });
  const partial = !!b.partial;
  const nowHm = typeof b.now === 'string' && /^\d{2}:\d{2}$/.test(b.now) ? b.now : '';

  const quota = await spend(gate);
  if (quota instanceof Response) return quota;

  return streamJson(async () => {
    const { text } = await callClaude({
      model: process.env.ANTHROPIC_REPORT_MODEL || 'claude-sonnet-4-6',
      fallbackModel: 'claude-sonnet-4-6',
      maxTokens: 900,
      content: [{ type: 'text', text: prompt(facts, partial, nowHm) }]
    });
    const o = extractJson(text);
    return {
      headline: str(o.headline, 60),
      summary: str(o.summary, 400),
      good: arr(o.good, 80),
      improve: arr(o.improve, 90),
      tomorrow: str(o.tomorrow, 90),
      quota
    };
  });
};
