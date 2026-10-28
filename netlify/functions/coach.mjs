// Netlify Function: AI 教练. The browser sends a facts block (profile, training
// settings, the last four weeks of sessions with every set, weekly sets per
// muscle, recovery data); Claude returns a weekly plan, per-lift progression and
// recovery advice. Spends one unit of the daily AI budget.
//
// A full week written as JSON in Chinese ran past max_tokens (~40 s) and came back
// cut off. So the work is split into two calls that run in parallel:
//   · analysis — small JSON (headline, assessment, progression, recovery, cautions)
//   · plan     — one line per exercise, "|"-separated, about half the tokens of JSON;
//                every complete line is usable even if the reply is cut short.

import { admit, spend, callClaude, extractJsonLoose, streamJson, jsonResponse, HttpError } from '../lib/guard.mjs';

const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : (typeof v === 'number' ? String(v) : '');
const arr = (v, n, max = 4) => Array.isArray(v) ? v.map(x => str(x, n)).filter(Boolean).slice(0, max) : [];

const ROLE = '你是一位有国际认证的私人健身教练和运动营养顾问，熟悉渐进超负荷、训练量（每肌群每周组数）、RPE / RIR、周期化和恢复。根据下面这位用户的资料和真实训练记录给出专业、具体、可以直接照着做的建议。';

const PRINCIPLES = `教练原则：
- 有历史记录的动作按渐进超负荷：上次全部做满就加 2.5kg 左右或多做 1 到 2 次；没做满就维持；连续两周没进步就减量 10% 或换变式。没有记录的动作写「能做 X 次、还剩 2 次力气的重量」或 RPE。
- 多数人每肌群每周 10 到 20 组；同一肌群至少隔 48 小时。
- 目标是减脂时保留力量训练并加入适量有氧；目标是增肌时保证每肌群每周 10 到 20 组。
- 睡眠少于 6 小时、静息心率升高或连续多天训练时，降低强度或安排休息。
- 不鼓励极端节食或过度训练；不做医疗诊断；提到疼痛或伤病时建议先看医生或物理治疗师。
- 全部用简体中文，动作用常见中文名。`;

function analysisPrompt(facts) {
  return `${ROLE}

只输出一个 JSON 对象，不要其他文字：
{
 "headline": "一句话总结目前最该做的事，24 字以内",
 "assessment": "2 到 3 句评估：训练频率、各肌群训练量是否在合理范围、进步或停滞、恢复情况，引用具体数字",
 "progression": [{"name": "动作", "last": "上次的表现，如 60kg × 8/8/8/7", "next": "下次怎么做，如 62.5kg × 6-8", "why": "理由，16 字以内"}],
 "recovery": ["睡眠、饮食（蛋白质克数）、休息日、拉伸等，每条 28 字以内，2 到 3 条"],
 "cautions": ["需要注意的地方，没有就空数组，最多 2 条"]
}

- progression 只写用户真的练过的动作，最多 4 个；没有力量训练记录时为空数组，并在 assessment 里建议从哪里开始。

${PRINCIPLES}

${facts}`;
}

function planPrompt(facts) {
  return `${ROLE}

为这位用户排从今天开始的 7 天训练计划，只列训练日。不要 JSON、不要解释、不要 markdown 表格，严格按下面的格式逐行输出：
每个训练日先写一行，以 ## 开头：## 星期 | 训练重点
接着每个动作一行，6 栏用 | 分隔：动作 | 组数 | 次数 | 重量或强度 | 组间休息 | 一句动作要点（15 字以内）

例子：
## 周三 | 上肢推（胸、肩、三头）
杠铃卧推 | 4 | 6-8 | 62.5kg | 2-3分钟 | 肩胛后收下沉
上斜哑铃卧推 | 3 | 8-10 | 22kg | 90秒 | 手肘约 45 度

要求：
- 训练日数量等于用户每周能练的天数（没填就 3 天），从【今天】那天开始往后排，中间留出休息日。
- 按训练经验和器材选动作：新手以复合动作和固定器械为主，每天 4 个动作；有经验的可以分化训练，每天最多 5 个动作；只有哑铃或徒手时不要安排杠铃和器械。
- 和用户最近练过的部位衔接，最近 48 小时练过的肌群不要排在今天。
- 重量按用户的历史记录给具体数字。

${PRINCIPLES}

${facts}`;
}

// "## 周三 | 上肢推" starts a day; "动作 | 4 | 6-8 | 62.5kg | 2分钟 | 要点" is an item.
// Tolerates full-width bars, list markers and a cut-off final line.
export function parsePlan(text) {
  const days = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/｜/g, '|').replace(/\*\*/g, '').trim();
    if (!line) continue;
    if (/^#{1,4}\s*/.test(line)) {
      const [day, ...rest] = line.replace(/^#{1,4}\s*/, '').split('|').map(s => s.trim());
      if (day) days.push({ day: str(day, 12), focus: str(rest.join(' '), 40), items: [] });
      continue;
    }
    const cells = line.replace(/^([-*•]|\d+[.、)])\s*/, '').split('|').map(s => s.trim());
    if (cells.length < 3 || !days.length || !cells[0] || /^-+$/.test(cells[0]) || cells[0] === '动作') continue;
    const d = days[days.length - 1];
    if (d.items.length >= 6) continue;
    d.items.push({
      name: str(cells[0], 30), sets: str(cells[1], 8), reps: str(cells[2], 16),
      load: str(cells[3] || '', 40), rest: str(cells[4] || '', 20), cue: str(cells.slice(5).join(' '), 60)
    });
  }
  return days.filter(d => d.items.length).slice(0, 7);
}

export default async (req) => {
  const gate = await admit(req, { maxBody: 200_000 });
  if (gate instanceof Response) return gate;
  const facts = str(gate.body.facts, 16000);
  if (!facts) return jsonResponse(400, { error: '没有可分析的资料' });

  const quota = await spend(gate);
  if (quota instanceof Response) return quota;

  return streamJson(async () => {
    const model = process.env.ANTHROPIC_COACH_MODEL || 'claude-sonnet-4-6';
    const [a, p] = await Promise.allSettled([
      callClaude({ model, fallbackModel: 'claude-sonnet-4-6', maxTokens: 1400, content: [{ type: 'text', text: analysisPrompt(facts) }] }),
      callClaude({ model, fallbackModel: 'claude-sonnet-4-6', maxTokens: 2600, content: [{ type: 'text', text: planPrompt(facts) }] })
    ]);
    const plan = p.status === 'fulfilled' ? parsePlan(p.value.text) : [];
    if (p.status === 'fulfilled' && p.value.truncated) console.warn('[coach] plan hit max_tokens; kept', plan.length, 'days');
    let o = {};
    if (a.status === 'fulfilled') {
      try { o = extractJsonLoose(a.value.text); } catch (e) { console.warn('[coach] analysis unparsable', a.value.text.slice(0, 200)); }
    } else console.warn('[coach] analysis failed', a.reason && a.reason.message);
    if (!plan.length && !o.headline) {
      throw (a.status === 'rejected' ? a.reason : p.status === 'rejected' ? p.reason : new HttpError(502, 'AI 回复解析失败，请再试一次'));
    }
    const progression = (Array.isArray(o.progression) ? o.progression : []).slice(0, 5).map(x => ({
      name: str(x && x.name, 30), last: str(x && x.last, 50), next: str(x && x.next, 50), why: str(x && x.why, 50)
    })).filter(x => x.name && x.next);   // a cut-off row without "next" says nothing
    return {
      headline: str(o.headline, 60) || '这周的训练计划',
      assessment: str(o.assessment, 500),
      plan,
      progression,
      recovery: arr(o.recovery, 80),
      cautions: arr(o.cautions, 100, 3),
      quota
    };
  });
};
