// Netlify Function: AI 教练. The browser sends a facts block (profile, training
// settings, the last four weeks of sessions with every set, weekly sets per
// muscle, recovery data); Claude returns a structured weekly plan, per-lift
// progression and recovery advice. Spends one unit of the daily AI budget.

import { admit, spend, callClaude, extractJson, streamJson, jsonResponse } from '../lib/guard.mjs';

const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : (typeof v === 'number' ? String(v) : '');
const arr = (v, n, max = 4) => Array.isArray(v) ? v.map(x => str(x, n)).filter(Boolean).slice(0, max) : [];

function prompt(facts) {
  return `你是一位有国际认证的私人健身教练和运动营养顾问，熟悉渐进超负荷、训练量（每肌群每周组数）、RPE / RIR、周期化和恢复。根据下面这位用户的资料和真实训练记录，给出专业、具体、可以直接照着做的建议。

只输出一个 JSON 对象，不要其他文字：
{
 "headline": "一句话总结目前最该做的事，24 字以内",
 "assessment": "2 到 4 句评估：训练频率、各肌群训练量是否在合理范围（多数人每肌群每周 10 到 20 组）、进步或停滞、恢复情况，引用具体数字",
 "plan": [
   {"day": "周一", "focus": "上肢推（胸、肩、三头）", "items": [
     {"name": "杠铃卧推", "sets": 4, "reps": "6-8", "load": "62.5kg 或 RPE 8", "rest": "2-3 分钟", "cue": "肩胛后收下沉，杠铃落在胸中下部"}
   ]}
 ],
 "progression": [{"name": "动作", "last": "上次的表现，如 60kg × 8/8/8/7", "next": "下次怎么做，如 62.5kg × 6-8", "why": "理由，20 字以内"}],
 "recovery": ["睡眠、饮食（蛋白质克数）、休息日、拉伸等，每条 30 字以内，2 到 4 条"],
 "cautions": ["需要注意的地方，没有就空数组"]
}

要求：
- plan 的天数等于用户每周能练的天数；按训练经验和器材选动作：新手以复合动作和固定器械为主，每次 4 到 5 个动作；有经验的可以分化训练；只有哑铃或徒手时不要安排杠铃和器械。
- 安排要和用户最近练过的部位衔接，同一肌群至少隔 48 小时。
- 有历史记录的动作，load 按渐进超负荷给具体重量（上次全部做满就加 2.5kg 左右或多做 1 到 2 次；没做满就维持；连续两周没进步就减量 10% 或换变式）；没有记录的写「选一个能做 X 次、还剩 2 次力气的重量」或 RPE。
- progression 只写用户真的练过的动作，最多 5 个；没有力量训练记录时 progression 为空数组，并在 assessment 里建议从哪里开始。
- 目标是减脂时，保留力量训练并加入适量有氧；目标是增肌时，保证每肌群每周 10 到 20 组。
- 用户睡眠少于 6 小时、静息心率升高或连续多天训练时，建议降低强度或安排休息。
- 不鼓励极端节食或过度训练；不做医疗诊断；提到疼痛或伤病时建议先看医生或物理治疗师。
- 全部用简体中文，动作用常见中文名；每天最多 5 个动作，cue 一句话，整体保持精简。

${facts}`;
}

export default async (req) => {
  const gate = await admit(req, { maxBody: 200_000 });
  if (gate instanceof Response) return gate;
  const facts = str(gate.body.facts, 16000);
  if (!facts) return jsonResponse(400, { error: '没有可分析的资料' });

  const quota = await spend(gate);
  if (quota instanceof Response) return quota;

  return streamJson(async () => {
    const { text } = await callClaude({
      model: process.env.ANTHROPIC_COACH_MODEL || 'claude-sonnet-4-6',
      fallbackModel: 'claude-sonnet-4-6',
      maxTokens: 2400,
      content: [{ type: 'text', text: prompt(facts) }]
    });
    const o = extractJson(text);
    const plan = (Array.isArray(o.plan) ? o.plan : []).slice(0, 7).map(d => ({
      day: str(d && d.day, 12),
      focus: str(d && d.focus, 40),
      items: (Array.isArray(d && d.items) ? d.items : []).slice(0, 8).map(i => ({
        name: str(i && i.name, 30),
        sets: str(i && i.sets, 8),
        reps: str(i && i.reps, 16),
        load: str(i && i.load, 40),
        rest: str(i && i.rest, 20),
        cue: str(i && i.cue, 60)
      })).filter(i => i.name)
    })).filter(d => d.day || d.focus);
    const progression = (Array.isArray(o.progression) ? o.progression : []).slice(0, 6).map(p => ({
      name: str(p && p.name, 30), last: str(p && p.last, 50), next: str(p && p.next, 50), why: str(p && p.why, 50)
    })).filter(p => p.name);
    return {
      headline: str(o.headline, 60),
      assessment: str(o.assessment, 500),
      plan,
      progression,
      recovery: arr(o.recovery, 80),
      cautions: arr(o.cautions, 100, 3),
      quota
    };
  });
};
