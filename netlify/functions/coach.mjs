// Netlify Function: AI 教练. The browser sends a facts block (profile, training
// settings, the last four weeks of sessions with every set, weekly sets per
// muscle, recovery data); Claude answers one question — what to train TODAY (or
// rest) — plus how to adjust that session, how to progress each lift, and cautions.
// Spends one unit of the daily AI budget.
//
// Only one day is planned, so a single short reply (~10–15 s) is enough, and the
// advice and the session can't contradict each other. Exercises come back as
// "|"-separated lines inside the JSON (about half the tokens of nested objects);
// a reply cut off at max_tokens still keeps every finished value.

import { admit, spend, callClaude, extractJsonLoose, streamJson, jsonResponse, HttpError } from '../lib/guard.mjs';

const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : (typeof v === 'number' ? String(v) : '');
const arr = (v, n, max = 4) => Array.isArray(v) ? v.map(x => str(x, n)).filter(Boolean).slice(0, max) : [];

function prompt(facts) {
  return `你是一位有国际认证的私人健身教练和运动营养顾问，熟悉渐进超负荷、训练量（每肌群每周组数）、RPE / RIR 和恢复。根据下面这位用户的资料和真实训练记录，回答：**今天**适合练什么（或者该休息），以及怎样调整。

只输出一个 JSON 对象，不要其他文字：
{
 "headline": "今天最该做的事，一句话 20 字以内，如「今天练腿，胸留到后天」",
 "rest": false,
 "focus": "今天练的部位，如「下肢（股四头、臀、腿后侧）」；休息日写「休息」或「主动恢复」",
 "why": "为什么今天适合练这个或该休息，1 到 2 句，引用最近练过的部位和隔了几天、本周各肌群组数、睡眠等具体数字",
 "items": ["动作 | 组数 | 次数 | 重量或强度 | 组间休息 | 一句动作要点（15 字以内）"],
 "modify": [{"when": "情况，10 字以内", "how": "怎么调整今天的训练，30 字以内"}],
 "progression": [{"name": "动作", "last": "上次的表现，如 60kg × 8/8/8/7", "next": "下次怎么做，如 62.5kg × 6-8", "why": "理由，16 字以内"}],
 "cautions": ["需要注意的地方，没有就空数组，最多 2 条"]
}

例子（items 每个元素是一行，用 | 分隔 6 栏）：
"items": ["杠铃深蹲 | 4 | 5-6 | 82.5kg | 3分钟 | 膝盖对准脚尖", "罗马尼亚硬拉 | 3 | 8 | 60kg | 2分钟 | 臀部向后推"]

要求：
- 最近 48 小时练过的肌群今天不要再练；连续练了 3 天以上、睡眠少于 6 小时或静息心率明显升高时，今天安排休息或主动恢复（rest 为 true，items 写散步、拉伸等轻松活动，或空数组）。
- 本周已经达到每周能练的天数时，今天也以休息或主动恢复为主。
- 按训练经验和器材选动作：新手以复合动作和固定器械为主，4 个动作；有经验的最多 5 个动作；只有哑铃或徒手时不要安排杠铃和器械。
- 有历史记录的动作按渐进超负荷给具体重量：上次全部做满就加 2.5kg 左右或多做 1 到 2 次；没做满就维持；连续两周没进步就减量 10% 或换变式。没有记录的写「能做 X 次、还剩 2 次力气的重量」或 RPE。
- modify 写 3 到 4 条，针对今天这份训练：时间不够、累了或睡得不好、器材被占用或在家练、某个动作做起来不舒服时分别怎么改。
- progression 只写用户真的练过的动作，最多 3 个；没有记录时为空数组。
- 目标是减脂时保留力量训练并加入适量有氧；目标是增肌时保证每肌群每周 10 到 20 组。
- 不鼓励极端节食或过度训练；不做医疗诊断；提到疼痛或伤病时建议先看医生或物理治疗师。
- 全部用简体中文，动作用常见中文名。

${facts}`;
}

// "动作 | 4 | 6-8 | 62.5kg | 2分钟 | 要点" → item. Tolerates full-width bars, list markers, a missing tail.
export function parseItem(line) {
  if (line && typeof line === 'object') {   // the model sometimes sends objects anyway
    const o = line;
    return o.name ? { name: str(o.name, 30), sets: str(o.sets, 8), reps: str(o.reps, 16), load: str(o.load, 40), rest: str(o.rest, 20), cue: str(o.cue, 60) } : null;
  }
  const cells = String(line || '').replace(/｜/g, '|').replace(/\*\*/g, '').replace(/^\s*([-*•]|\d+[.、)])\s*/, '')
    .split('|').map(c => c.trim());
  if (!cells[0] || cells[0] === '动作' || /^-+$/.test(cells[0])) return null;
  return {
    name: str(cells[0], 30), sets: str(cells[1] || '', 8), reps: str(cells[2] || '', 16),
    load: str(cells[3] || '', 40), rest: str(cells[4] || '', 20), cue: str(cells.slice(5).join(' '), 60)
  };
}

export function normCoach(o) {
  const items = (Array.isArray(o.items) ? o.items : []).map(parseItem).filter(Boolean).slice(0, 6);
  const modify = (Array.isArray(o.modify) ? o.modify : []).slice(0, 4).map(m =>
    typeof m === 'string' ? { when: '', how: str(m, 80) } : { when: str(m && m.when, 24), how: str(m && m.how, 80) }
  ).filter(m => m.how);
  const progression = (Array.isArray(o.progression) ? o.progression : []).slice(0, 4).map(x => ({
    name: str(x && x.name, 30), last: str(x && x.last, 50), next: str(x && x.next, 50), why: str(x && x.why, 50)
  })).filter(x => x.name && x.next);   // a cut-off row without "next" says nothing
  return {
    headline: str(o.headline, 60),
    rest: o.rest === true,
    focus: str(o.focus, 40),
    why: str(o.why, 300),
    items, modify, progression,
    cautions: arr(o.cautions, 100, 2)
  };
}

export default async (req) => {
  const gate = await admit(req, { maxBody: 200_000 });
  if (gate instanceof Response) return gate;
  const facts = str(gate.body.facts, 16000);
  if (!facts) return jsonResponse(400, { error: '没有可分析的资料' });

  const quota = await spend(gate);
  if (quota instanceof Response) return quota;

  return streamJson(async () => {
    const { text, truncated } = await callClaude({
      model: process.env.ANTHROPIC_COACH_MODEL || 'claude-sonnet-4-6',
      fallbackModel: 'claude-sonnet-4-6',
      maxTokens: 2000,
      content: [{ type: 'text', text: prompt(facts) }]
    });
    if (truncated) console.warn('[coach] reply hit max_tokens; keeping the finished part');
    const c = normCoach(extractJsonLoose(text));
    if (!c.headline && !c.items.length) throw new HttpError(502, 'AI 回复解析失败，请再试一次');
    if (!c.headline) c.headline = c.rest ? '今天休息，让身体恢复' : `今天练${c.focus || '全身'}`;
    return { ...c, quota };
  });
};
