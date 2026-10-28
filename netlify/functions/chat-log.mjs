// Netlify Function: the 记录 chat. One message (text and/or photos) in → structured
// food / exercise / body entries + a short reply out. The browser writes the entries
// into the same Firebase nodes the manual forms use.

import { admit, spend, imageBlocks, callClaude, extractJson, streamJson, jsonResponse, HttpError } from '../lib/guard.mjs';

const RULES = `你是「卡路里记账本」app 里的记录助手。用户用聊天的方式记下饮食、运动和身体状况，你负责把内容整理成结构化记录，并简短回复。

规则：
1. 从【用户新消息】和附带的照片里提取所有能记录的条目，分三类：food（饮食）、exercise（运动）、body（身体数据与体态）。一句话里有多项就拆成多条；同一餐的几样食物可以合成一条 food，并把每样写进 items。
2. 份量和热量按马来西亚常见份量估算（如一盘海南鸡饭、一碗板面、一份经济饭、一杯 teh tarik 或 kopi），数字取整。照片看不清份量就按常见份量估，confidence 填 low 或 medium。
3. 运动消耗用 MET 估算：MET × 3.5 × 体重kg ÷ 200 × 分钟。体重用【用户资料】里的体重，没有就按 65kg。力量训练按实际训练时间估；用户没说时长就合理估计，并在 reply 里说一下是估的。activity 从这些里选最接近的：walk 走路、run 跑步、bike 骑行、swim 游泳、lift 力量训练、yoga 瑜伽、rope 跳绳、stairs 爬楼梯、ball 球类运动；都不像就用 custom，并把项目名写进 name。
4. body：体重、体脂、围度直接记录。用户发体态照片（镜子自拍、正面或侧面照）时，在 posture 里客观描述能看到的体态特点（如头前伸、圆肩、骨盆前倾、高低肩、站姿重心），不评价长相，不做医疗诊断。能目测的体脂区间写进 note 并注明“目测”。
5. 用户发运动健康 app 的截图（如华为运动健康 Huawei Health、Strava、Apple 健康）时：锻炼记录记成 exercise（用截图里的项目、时长、距离、平均心率和消耗热量，time 用锻炼开始时间）；步数、睡眠时长、静息心率记成一条 body（steps、sleep_h、resting_hr）。截图里的“活动热量 / 卡路里”总数不要另外记成运动，避免和锻炼重复。截图日期不是今天就按截图上的日期记。如果【最近条目】里已经有同一次锻炼，就用 replaces 替换，不要重复记。
6. 用户纠正之前的记录（如“刚才那碗面其实只吃了一半”），输出修正后的完整新条目，并加 "replaces":"被替换条目的 id"（id 在【最近条目】的方括号里）。只删除不替换时输出 {"type":"delete","replaces":"id"}。
7. 用户提到身高、年龄、性别、目标、每日热量目标、蛋白质目标、每日运动目标（分钟）、日常活动量时，填进 profile；没提到就 profile 为 null。
8. 消息只是聊天或提问、没有可记录内容时，entries 为 []，在 reply 里正常回答。
9. date 默认【当前时间】的日期；用户说“昨天”“前天”“周一”等就换算成对应日期，不能晚于今天。time 用 24 小时 HH:MM，没说就用当前时间；饮食可以按餐别给一个合理时间。
10. reply 用简体中文，1 到 3 句，语气像懂训练和营养的朋友，需要时再加一句有用的提醒，比如今天蛋白质偏低、离目标还剩多少。不说教，不用每次都提醒。饮食的确认由 app 负责：识别到饮食时，一定要在 entries 里输出 food 条目——app 会把它显示成「请确认」卡片，用户点确认后才记下。绝对不要因为“要等用户确认”就不输出 food。reply 里说出你识别到的食物和份量，请用户确认（例如“看起来是一盘海南鸡饭，约 650 kcal，对吗？”）；真的看不出是什么时，仍然按最可能的食物输出 food（confidence 填 low），并在 reply 里问。运动和身体数据会直接记下，reply 里说记了什么。
11. 不鼓励极端做法：用户想长期每天吃低于 1200 kcal、长时间断食或短期大幅减重时，温和说明风险并给更稳妥的做法。提到疼痛、受伤或身体不适时，建议看医生或物理治疗师。
12. 【待确认饮食】里是之前识别出、还在等用户确认的饮食（还没记下），方括号里是它的 id。
   - 用户表示没错（如“对”“是的”“没错”“确认”“记吧”）：把这些 id 放进 "confirm"，不要再重复输出这些 food。没说哪一项就确认全部待确认饮食。
   - 用户纠正其中一项（如“不是鸡饭，是炒饭”“只吃了一半”）：输出修正后的完整 food 条目，加 "replaces":"那一项的 id"。
   - 用户说不是、不要记：输出 {"type":"delete","replaces":"那一项的 id"}。
   - 用户确认的是【最近对话】里提到、但【待确认饮食】里没有的食物：输出那条 food，并加 "confirmed":true（用户已经确认过，app 会直接记下）。
13. 朋友圈：用户想把饮食或运动发到朋友圈（如“发朋友圈”“分享给大家”“po 上去”）时——
   - 这条消息里的新饮食或运动：在那条 food / exercise 里加 "share":true；用户给了配文（想说的话、心情）就原样放进 "note"，没给就不填。
   - 已经记下的（【最近条目】）或待确认的（【待确认饮食】）：在 "share" 里列出 {"id":"方括号里的 id","note":"配文，没有就空字符串"}。用户说“刚才那个”“这个”就指最近一条饮食或运动。
   - 用户说不要分享、取消分享：把 id 放进 "unshare"。
   - 身体数据、体重、体态永远不分享；用户要求时在 reply 里说明这些只有自己看得到。
   - 没提朋友圈就不要加 share。

只输出一个 JSON 对象，不要任何其他文字：
{"reply":"…","entries":[…],"profile":null,"confirm":[],"share":[],"unshare":[]}

条目格式（数值未知用 null）：
food: {"type":"food","date":"YYYY-MM-DD","time":"HH:MM","meal":"breakfast|lunch|dinner|snack","name":"这一餐的名称","portion":"份量描述","kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"confidence":"high|medium|low","items":[{"name":"食物","kcal":0}]}（要发朋友圈时再加 "share":true,"note":"配文"）
exercise: {"type":"exercise","date":"YYYY-MM-DD","time":"HH:MM","activity":"walk|run|bike|swim|lift|yoga|rope|stairs|ball|custom","name":"项目名","duration_min":0,"distance_km":null,"sets":null,"reps":null,"weight_kg":null,"avg_hr":null,"intensity":"low|moderate|high","kcal_burned":0}（要发朋友圈时再加 "share":true,"note":"配文"）
body: {"type":"body","date":"YYYY-MM-DD","time":"HH:MM","weight_kg":null,"body_fat_pct":null,"waist_cm":null,"chest_cm":null,"hip_cm":null,"arm_cm":null,"thigh_cm":null,"steps":null,"sleep_h":null,"resting_hr":null,"posture":"","note":""}
profile（只填用户提到的字段）: {"height_cm":null,"age":null,"sex":"male|female","goal":"lose|gain|maintain|fitness","kcal_target":null,"protein_target_g":null,"exercise_goal_min":null,"activity":"sedentary|moderate|physical"}`;

const ACTS = ['walk', 'run', 'bike', 'swim', 'lift', 'yoga', 'rope', 'stairs', 'ball', 'custom'];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const BODY = {
  weight_kg: [20, 400], body_fat_pct: [2, 70], waist_cm: [30, 250], chest_cm: [30, 250], hip_cm: [30, 250],
  arm_cm: [10, 100], thigh_cm: [20, 150], steps: [0, 100000], sleep_h: [0, 24], resting_hr: [25, 220]
};

const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const numIn = (v, lo, hi, digits = 1) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};
const addDays = (ymd, d) => { const t = new Date(ymd + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

function mealFor(hm) {
  const h = parseInt(hm.slice(0, 2), 10) + parseInt(hm.slice(3), 10) / 60;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 17.5 ? 'snack' : h < 21.5 ? 'dinner' : 'snack';
}

export function normEntry(r, today, nowHm) {
  if (!r || typeof r !== 'object') return null;
  if (r.type === 'delete') return r.replaces ? { type: 'delete', replaces: str(String(r.replaces), 64) } : null;
  if (!['food', 'exercise', 'body'].includes(r.type)) return null;
  let date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today;
  if (date > today || date < addDays(today, -60)) date = today;
  let time = typeof r.time === 'string' && /^\d{1,2}:\d{2}$/.test(r.time.trim()) ? r.time.trim().padStart(5, '0') : nowHm;
  if (parseInt(time, 10) > 23) time = nowHm;
  const e = { type: r.type, date, time };
  if (r.replaces) e.replaces = str(String(r.replaces), 64);
  if (r.type !== 'body' && r.share === true) {
    e.share = true;
    const note = str(r.note, 200);
    if (note) e.note = note;
  }
  if (r.type === 'food') {
    e.name = str(r.name, 40) || '一餐';
    e.portion = str(r.portion, 60);
    e.meal = MEALS.includes(r.meal) ? r.meal : mealFor(time);
    e.kcal = Math.round(numIn(r.kcal, 0, 6000, 0) || 0);
    e.protein_g = Math.round(numIn(r.protein_g, 0, 500, 0) || 0);
    e.carbs_g = Math.round(numIn(r.carbs_g, 0, 1000, 0) || 0);
    e.fat_g = Math.round(numIn(r.fat_g, 0, 500, 0) || 0);
    e.confidence = ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'medium';
    if (r.confirmed === true) e.confirmed = true;
    e.items = Array.isArray(r.items)
      ? r.items.slice(0, 12).map(i => ({ name: str(i && i.name, 30) || '食物', kcal: Math.round(numIn(i && i.kcal, 0, 5000, 0) || 0) }))
      : [];
  } else if (r.type === 'exercise') {
    e.activity = ACTS.includes(r.activity) ? r.activity : 'custom';
    e.name = str(r.name, 30);
    e.duration_min = Math.round(numIn(r.duration_min, 0, 900, 0) || 0);
    e.distance_km = numIn(r.distance_km, 0, 400, 2);
    e.sets = numIn(r.sets, 0, 100, 0);
    e.reps = numIn(r.reps, 0, 1000, 0);
    e.weight_kg = numIn(r.weight_kg, 0, 600, 1);
    e.avg_hr = numIn(r.avg_hr, 30, 230, 0);
    e.intensity = ['low', 'moderate', 'high'].includes(r.intensity) ? r.intensity : 'moderate';
    e.kcal_burned = Math.round(numIn(r.kcal_burned, 0, 5000, 0) || 0);
    if (!e.duration_min && !e.kcal_burned) return null;
  } else {
    let any = false;
    for (const [k, [lo, hi]] of Object.entries(BODY)) {
      const v = numIn(r[k], lo, hi, k === 'steps' || k === 'resting_hr' ? 0 : 1);
      if (v !== null) { e[k] = v; any = true; }
    }
    e.posture = str(r.posture, 280);
    e.note = str(r.note, 200);
    if (!any && !e.posture && !e.note) return null;
  }
  return e;
}

export function normProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  const h = numIn(p.height_cm, 100, 250, 0); if (h !== null) out.heightCm = h;
  const a = numIn(p.age, 10, 100, 0); if (a !== null) out.age = a;
  if (['male', 'female'].includes(p.sex)) out.sex = p.sex;
  if (['lose', 'gain', 'maintain', 'fitness'].includes(p.goal)) out.goal = p.goal;
  const k = numIn(p.kcal_target, 800, 6000, 0); if (k !== null) out.dailyGoal = k;
  const pr = numIn(p.protein_target_g, 20, 400, 0); if (pr !== null) out.proteinTarget = pr;
  const ex = numIn(p.exercise_goal_min, 5, 300, 0); if (ex !== null) out.exerciseGoal = ex;
  if (['sedentary', 'moderate', 'physical'].includes(p.activity)) out.activity = p.activity;
  return Object.keys(out).length ? out : null;
}

export default async (req) => {
  const gate = await admit(req);
  if (gate instanceof Response) return gate;
  const b = gate.body;

  const text = str(b.text, 4000);
  const today = typeof b.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const nowHm = typeof b.now === 'string' && /^\d{2}:\d{2}$/.test(b.now) ? b.now : new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
  const context = str(b.context, 12000);
  const history = Array.isArray(b.history) ? b.history.slice(-10).map(t => ({
    role: t && t.role === 'assistant' ? '助手' : '用户',
    content: str(t && t.content, 1200)
  })).filter(t => t.content) : [];

  let images;
  try { images = imageBlocks(b.images, { max: 4 }); }
  catch (e) { return jsonResponse(e.status || 400, { error: e.message }); }
  if (!text && !images.length) return jsonResponse(400, { error: '消息是空的' });

  const quota = await spend(gate);
  if (quota instanceof Response) return quota;

  return streamJson(async () => {
    const prompt = [
      context,
      history.length ? '【最近对话】\n' + history.map(t => `${t.role}：${t.content}`).join('\n') : '',
      `【用户新消息】${images.length ? `（附 ${images.length} 张照片，见图片）` : ''}\n${text || '（只发了照片，没有文字）'}`,
      '只输出 JSON 对象。'
    ].filter(Boolean).join('\n\n');

    const { text: out, truncated } = await callClaude({
      model: images.length ? (process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-6') : (process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5'),
      fallbackModel: 'claude-sonnet-4-6',
      maxTokens: 1600,
      system: RULES,
      content: images.concat([{ type: 'text', text: prompt }])
    });
    if (truncated) throw new HttpError(502, '内容太多了，分成几条发吧');
    const parsed = extractJson(out);
    const entries = (Array.isArray(parsed.entries) ? parsed.entries : []).slice(0, 12)
      .map(r => normEntry(r, today, nowHm)).filter(Boolean);
    const confirm = Array.isArray(parsed.confirm)
      ? parsed.confirm.filter(x => typeof x === 'string' || typeof x === 'number').map(x => str(String(x), 64)).filter(Boolean).slice(0, 12)
      : [];
    const share = Array.isArray(parsed.share)
      ? parsed.share.map(s => typeof s === 'string' ? { id: str(s, 64), note: '' } : { id: str(String((s && s.id) || ''), 64), note: str(s && s.note, 200) })
          .filter(s => s.id).slice(0, 12)
      : [];
    const unshare = Array.isArray(parsed.unshare)
      ? parsed.unshare.map(x => str(String(x || ''), 64)).filter(Boolean).slice(0, 12)
      : [];
    const reply = str(parsed.reply, 1200) || (entries.length || confirm.length || share.length ? '好的。' : '收到。');
    return { reply, entries, profile: normProfile(parsed.profile), confirm, share, unshare, quota };
  });
};
