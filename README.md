# 卡路里记账本

朋友小组一起打卡「吃饭 / 运动 / 卡路里记账」的手机网页 App。

- `index.html` — 全部前端（HTML + CSS + JS 单档，无框架、无打包、无 npm build）
- `netlify/functions/analyze-food.mjs` — 「加饮食」拍照识别
- `netlify/functions/chat-log.mjs` — 「记录」聊天：一句话 / 照片 → 饮食、运动、身体数据
- `netlify/functions/daily-report.mjs` — AI 日报
- `netlify/functions/coach.mjs` — AI 教练：根据训练记录排每周计划、给加重建议
- `netlify/lib/guard.mjs` — 所有 AI function 共用：验证 Firebase 登入、每人每日 AI 次数、呼叫 Anthropic
- `netlify.toml` — Netlify 设定（functions 目录、publish 根目录、无 build command）

技术栈：vanilla HTML + Firebase Auth + Firebase Realtime Database + Firebase Storage（皆 v8 compat CDN）+ Netlify Functions。
身份是 **Google 登入或 Email + 密码登入**，所有资料以 `auth.uid` 为 key，换设备登入同一个帐号就能看到自己的记录。

功能：今日记账、**今日概览**（热量 / 蛋白质 / 运动三个环 + 0–100 得分）、**AI 日报**（每天第一次打开自动写前一天的）、
**记录**（用聊天的方式记饮食、运动、体重、体态，也能读华为运动健康 / Strava 截图）、AI 拍照识别（一餐可多张照片）、
运动、**训练**（力量训练每组的次数和重量、每肌群每周组数、动作进步曲线、**AI 教练**每周计划）、月度（点日期看那天的得分和日报）、身材（私密）、小组、**朋友圈**（FB 风格动态墙 + 赞 + 评论）。

底部导航：**今日 · 记录 · 训练 · 朋友圈 · 我**；「我」里面再分 月度 / 身材 / 小组（设定在小组页）。

---

## 0. Firebase Console 手动设定 ⚠️ 必做

到 [Firebase Console](https://console.firebase.google.com/) → 选 `gcl-client-portal` 专案：

1. **启用 Email/密码登入**
   **Authentication** → **Sign-in method** → **Email/Password** → 启用第一个开关（Email/Password）→ 储存。
   第二个开关（Email link / 免密码登入）**不用开**。
   （如果 Authentication 还没初始化过，先点 **Get started**。）

   **启用 Google 登入**：同一页 → **Google** → 启用 → 「专案支援电子邮件」选你的 Gmail → 储存。
   同一个 Gmail 先前用 Email + 密码注册过的话，改用 Google 登入会进同一个帐号（uid 不变，记录都在）。

2. **加入授权网域**
   **Authentication** → **Settings** → **Authorized domains** →
   把你的 Netlify 网域加进去（例如 `your-app.netlify.app`，或你自订的网域）。
   `localhost` 预设就在清单里，本机 `netlify dev` 不用另外加。

3. **启用 Storage**（朋友圈照片要用）⚠️ 新增
   左侧选单 → **Storage** → 如果没启用过，点 **Get started** →
   规则那步先选哪个都行（等一下会整份换掉）→ 位置选 `asia-southeast1`（跟 RTDB 同区，比较快）→ 完成。
   建立好之后确认 bucket 名称是 `gcl-client-portal.firebasestorage.app`
   （要跟 `index.html` 里 `firebaseConfig.storageBucket` 一致，目前已经是这个值了）。

4. **贴上 Realtime Database Security Rules** —— 见下面第 3 节（必做，否则 profile 读不到，会卡在登入画面）。

5. **贴上 Storage Security Rules** —— 见下面第 3.5 节（必做，否则照片上传会失败）。
   **注意 Storage 的规则跟 Database 的规则是两套、两个地方贴，不要搞混。**

没做第 1 步的话，注册会报错 `auth/operation-not-allowed`，App 会显示「尚未在 Firebase 启用 Email/密码登入」。
没做第 3 / 5 步的话，存照片时会 toast「照片上传被拒绝，请检查 Storage 规则」。

---

## 1. 设 ANTHROPIC_API_KEY 环境变数

API key **只能**放在 Netlify 的环境变数里，绝对不要写进 `index.html` 或 commit 进 repo。

**方法 A — Netlify 网页后台**

1. 进入你的 site → **Site configuration** → **Environment variables**
2. **Add a variable** → Key 填 `ANTHROPIC_API_KEY`，Value 填你的 key（`sk-ant-...`）
3. Scopes 至少要勾 **Functions**（Builds 也勾着没关系）
4. 存档后 **重新 deploy 一次**，环境变数才会生效

**方法 B — Netlify CLI**

```bash
netlify env:set ANTHROPIC_API_KEY "sk-ant-xxxxxxxx"
netlify deploy --prod
```

Key 从 https://console.anthropic.com/ 的 API Keys 页面产生。

---

## 2. 部署

**方法 A — 接 Git（推荐）**

1. 把这个资料夹 push 到 GitHub / GitLab
2. Netlify → **Add new site** → **Import an existing project** → 选这个 repo
3. Build command 留空，Publish directory 填 `.`（`netlify.toml` 里已经设好，通常会自动带入）
4. Deploy → 照上面步骤设好 `ANTHROPIC_API_KEY` → 再 deploy 一次

**方法 B — Netlify CLI**

```bash
npm install -g netlify-cli
netlify login
netlify init          # 或 netlify link 接上已有的 site
netlify env:set ANTHROPIC_API_KEY "sk-ant-xxxxxxxx"
netlify deploy --prod
```

**本机测试**

```bash
netlify dev           # http://localhost:8888
```

`netlify dev` 会一起跑前端和 function，`/.netlify/functions/analyze-food` 才会通。
直接用 `open index.html` 或别的静态 server 打开的话，Firebase 同步正常，但 AI 识别会失败
（前端会跳出错误画面 + 「改为手动输入」按钮，不会卡住）。
本机跑的时候可以在专案根目录放一个 `.env`（记得加进 `.gitignore`）：

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

**加到主屏幕**：手机 Safari / Chrome 打开网址 → 分享 → 加到主屏幕。

---

## 3. Firebase Realtime Database Security Rules ⚠️ 必做

到 [Firebase Console](https://console.firebase.google.com/) → 选 `gcl-client-portal` 专案 →
**Realtime Database** → **规则 (Rules)** 分页，贴上以下规则并 **发布**。

这是**合并版**，已经包含原本的 `portal` 节点，直接整份取代 console 里现有的规则即可。
（Firebase 规则是 JSON，不能写注解，每段的意思看下面的说明。）

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "portal": {
      "$shareId": {
        ".read": true
      }
    },

    "calorie_ledger": {
      "groups": {
        "$groupCode": {
          ".read": "auth != null",
          "roster": {
            "$uid": {
              ".write": "auth != null && auth.uid === $uid",
              ".validate": "newData.hasChildren(['name', 'joinedAt'])",
              "name": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 12" },
              "joinedAt": { ".validate": "newData.isNumber()" },
              "$other": { ".validate": false }
            }
          },
          "food": {
            "$ym": {
              "$dKey": {
                "$uid": {
                  ".write": "auth != null && auth.uid === $uid"
                }
              }
            }
          },
          "exercise": {
            "$ym": {
              "$dKey": {
                "$uid": {
                  ".write": "auth != null && auth.uid === $uid"
                }
              }
            }
          },
          "social": {
            ".read": "auth != null",
            "$postId": {
              "likes": {
                "$uid": {
                  ".write": "auth != null && auth.uid === $uid",
                  ".validate": "newData.isBoolean()"
                }
              },
              "comments": {
                "$commentId": {
                  ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid)",
                  ".validate": "newData.hasChildren(['uid', 'name', 'text', 'time']) && newData.child('uid').val() === auth.uid",
                  "uid": { ".validate": "newData.val() === auth.uid" },
                  "name": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 12" },
                  "text": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 200" },
                  "time": { ".validate": "newData.isNumber()" },
                  "$other": { ".validate": false }
                }
              },
              "$other": { ".validate": false }
            }
          }
        }
      },

      "members": {
        "$uid": {
          ".read": "auth != null && auth.uid === $uid",
          ".write": "auth != null && auth.uid === $uid"
        }
      },

      "usage": {
        "$uid": {
          ".read": "auth != null && auth.uid === $uid",
          "$day": {
            ".write": "auth != null && auth.uid === $uid && newData.isNumber() && newData.val() === (data.exists() ? data.val() : 0) + 1"
          }
        }
      }
    }
  }
}
```

> **已经有规则在跑的话**：不要整份覆盖（同一个 Firebase 专案里可能还有别的系统的节点）。
> 只要在 `calorie_ledger` 里面、`members` 旁边加上 `usage` 这一段就好。

### 每段在做什么

| 区段 | 意思 |
|---|---|
| `".read": false, ".write": false`（最外层） | 预设全部锁死。Firebase 规则**不会往下继承 false** —— 底下的节点各自开权限，没开到的地方一律拒绝。 |
| `portal/$shareId` → `".read": true` | 保留你原本 portal 系统的公开读取，行为完全不变。没有 `.write`，所以仍然不能从前端写。 |
| `groups/$groupCode` → `".read": "auth != null"` | **登入**的用户可以读整个小组（组员互看今日战况需要）。这个 `.read` 会往下继承到 roster / food / exercise。未登入完全读不到。 |
| `roster/$uid` → `".write": auth.uid === $uid` | 只能写自己那一格 —— 不能改别人的暱称，也不能把别人踢出小组。 |
| `roster/$uid` 的 `.validate` | 必须有 `name`+`joinedAt`；`name` 限 1–12 字串、`joinedAt` 必须是数字；`$other: false` 挡掉塞额外栏位。 |
| `food/$ym/$dKey/$uid`、`exercise/...` | 同理：读得到全组（继承自 group 的 `.read`），但**只能写 `auth.uid` 等于自己的那一格**。别人的记录改不了。 |
| `members/$uid` | `.read` 和 `.write` 都要求 `auth.uid === $uid` —— `profile`、`body`（身材数据）、`chat`（聊天记录）、`reports`（AI 日报）**真正私密**，别人连读都读不到，不只是前端不显示。 |
| `usage/$uid/$day` | 每人每天用了几次 AI。只能读自己的；写入**只接受「原本的数字 + 1」**，所以没办法从浏览器把计数归零、删掉或改小。Netlify function 用使用者自己的登入凭证去 +1，超过上限就拒绝。没贴这段的话 AI 照样能用，只是不会限次数（function log 会提醒）。 |
| `social` → `".read": "auth != null"` | 朋友圈的赞和评论，**登入用户都读得到**（要看得到别人的贴文底下有谁按赞、留了什么）。 |
| `social/$postId/likes/$uid` → `".write": auth.uid === $uid` | **关键**：你只能写「自己那一格赞」。别人不能替你按赞，也不能帮你取消赞 —— 因为 key 就是按赞者的 uid，规则要求它等于 `auth.uid`。`.validate: newData.isBoolean()` 挡掉在这格塞奇怪资料。 |
| `social/$postId/comments/$commentId` 的 `.write` | `!data.exists()` = 这个 commentId 还没东西 → 任何登入用户都可以**新增**评论（这就是「别人能留言到你贴文底下」）。`data.child('uid').val() === auth.uid` = 已经存在的评论，只有**原作者**能改或删。 |
| `comments/$commentId` 的 `.validate` | 必须有 `uid`/`name`/`text`/`time` 四个栏位，而且 `newData.child('uid').val() === auth.uid` —— **评论里写的 uid 必须是你自己**，不能冒名别人留言。`text` 限 1–200 字，`$other: false` 挡掉塞额外栏位。（删除时 `newData` 是 null，`.validate` 会自动跳过，所以作者仍删得掉。） |
| `social/$postId` 的 `$other: false` | postId 底下只允许 `likes` 和 `comments` 两个子节点，不让人乱塞别的东西。 |

**为什么赞/评论要另外开一个 `social` 节点？**
因为 `food` / `exercise` 底下是 `.../$dKey/$uid`，规则写死「只能写自己 uid 那格」——
别人**根本没权限**写进你的记录里。赞和评论本质上是「别人要写到你的贴文底下」，
所以必须放在一个组员都写得到、但用更细的规则约束的地方，也就是 `social`。

**`postId` 怎么来的？** 前端用 `type + 日期 + 原记录 id` 组出来（例如 `food_2026-07-17_ab12cd34`），
是个稳定字串，同一则贴文在任何设备上算出来都一样，赞和评论才对得上。

**注意**：`social` 里没有「贴文本体」——贴文内容仍然只存在 `food`/`exercise` 里。
所以删掉一条记录后，它的赞/评论会变成读不到的孤儿资料（前端只渲染真的存在的记录，不会显示），
不影响使用，只是会留一点残留资料在 DB 里。

**规则里的 `$uid` 是什么？** 是 Firebase 的萬用字元变数：`$uid` 会捕捉那一层实际的 key 值，
所以 `auth.uid === $uid` 的意思就是「这个 key 必须等于你自己的 uid」。

### 还可以再收紧（选做）

- **小组代码可枚举**：任何登入用户只要猜中 6 位代码就能读那个小组。字元集 32^6 ≈ 10 亿种，
  暴力猜不容易，但如果在意，可以在 group 底下加一层 `members/{uid}: true` 的白名单，
  把 `.read` 改成 `"auth != null && data.child('roster').child(auth.uid).exists()"`。
- **食物/运动记录的结构验证**：目前 `food/.../$uid` 底下没有 `.validate`，
  写进去的阵列内容不受限。要防止有人塞超大资料，可以加 `.validate` 限制型别与长度。
- **Email 验证**：可要求 `auth.token.email_verified === true` 才能写入，
  搭配 `sendEmailVerification()`。
- **App Check**：Firebase Console → App Check，限制只有你的网域能打这个 DB。

---

## 3.5 Firebase Storage Security Rules ⚠️ 必做（跟上面那份是分开的两套）

朋友圈的照片存在 **Firebase Storage**，它有**自己独立的一套规则**，
跟 Realtime Database 的规则**不共用、不互相影响**，要另外贴。

到 [Firebase Console](https://console.firebase.google.com/) → `gcl-client-portal` →
**Storage** → **Rules** 分页 → 整份取代 → **发布 (Publish)**。

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    match /calorie_ledger/{uid}/{fileName} {
      allow read: if request.auth != null;

      allow create, update: if request.auth != null
        && request.auth.uid == uid
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');

      allow delete: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### 每段在做什么

| 区段 | 意思 |
|---|---|
| `rules_version = '2'` | 用第 2 版规则语法（Storage 目前的标准）。**注意 Storage 规则是 CEL 语法，不是 JSON**，跟 Database 那份长得完全不一样。 |
| `match /b/{bucket}/o` | Storage 规则的固定开头，`{bucket}` 对应你的 bucket，`/o` 底下才是实际的档案路径。 |
| `match /calorie_ledger/{uid}/{fileName}` | 只比对 `calorie_ledger/<某个uid>/<档名>` 这个形状的路径。`{uid}` 是萬用字元，会捕捉中间那层资料夹的名字。**没被 match 到的路径一律拒绝**（预设关闭）。 |
| `allow read: if request.auth != null` | **登入**用户就能读所有人的照片 —— 组员要能互看朋友圈的图。未登入完全读不到。 |
| `allow create, update` 的 `request.auth.uid == uid` | **关键**：路径中间那层资料夹名必须等于你自己的 uid，所以你**只能上传到自己的资料夹**，不能写到别人的资料夹里。 |
| `request.resource.size < 5 * 1024 * 1024` | 单档上限 5MB。前端已经压到 1280px / q0.82（通常 100–300KB），这是防呆的第二道关。 |
| `request.resource.contentType.matches('image/.*')` | 只准上传图片（`image/jpeg`、`image/png`…），挡掉拿 Storage 当免费网盘塞影片或执行档。 |
| `allow delete` | 只有自己能删自己资料夹里的档案。（delete 时 `request.resource` 是 null，所以不能跟 size / contentType 写在一起，必须分开写 —— 这就是为什么不用一行 `allow write`。） |

**关于 downloadURL**：`getDownloadURL()` 拿到的网址带一个 token，
知道完整网址的人不需要登入也能打开那张图（Firebase 的设计就是这样）。
网址只存在小组的 DB 里、外人读不到，但如果有人把网址复制出去，那张图就等于公开了。
在意的话可以改用 `getBlob()` / SDK 下载（会走上面的 `allow read` 规则），但速度和快取会差一些。

---

## 4. 资料结构

身份来源是 **Firebase Auth 的 `uid`**（Email + 密码登入），所有 key 都用 `uid`。

```
calorie_ledger/
  groups/
    {groupCode}/                       # 6 位代码，字元集 ABCDEFGHJKLMNPQRSTUVWXYZ23456789
      roster/
        {uid}: { name, joinedAt }
      food/
        {ym}/                          # "2026-07"
          {dKey}/                      # "2026-07-16"
            {uid}: [ {id,time,name,calories,protein,carbs,fat,items:[{name,calories}],
                      photos:["url",...], shared:true/false}, ... ]
      exercise/
        {ym}/
          {dKey}/
            {uid}: [ {id,time,activity,activityName,duration,calories,
                      lifts?:[{ name, muscle:'chest'|'back'|'legs'|'shoulders'|'arms'|'core'|'full',
                                sets:[{ reps, kg? }] }],          # 力量训练每一组；徒手动作没有 kg
                      photos:["url",...], shared:true/false}, ... ]
      social/                          # 赞和评论：组员写得到的地方
        {postId}/                      # "food_2026-07-16_ab12cd34"（type + 日期 + 记录 id）
          likes/
            {uid}: true                # 只有本人写得到自己这格
          comments/
            {commentId}: { uid, name, text, time }   # uid 必须等于 auth.uid
  members/
    {uid}/
      profile: { displayName, groupCode, dailyGoal, weightKg,     # 私密
                 heightCm?, age?, sex?, goal?, proteinTarget?, exerciseGoal?,
                 experience?:'beginner'|'intermediate'|'advanced', trainDays?:1-7,
                 equipment?:'gym'|'dumbbell'|'bodyweight' }
      body/                                                      # 私密，不进 group、不进朋友圈
        {ym}/
          {dKey}: { weight, bodyFat, waist, note, time,
                    chest?, hip?, arm?, thigh?, steps?, sleepH?, restingHr?, posture?, photos? }
      chat/                                                      # 私密：「记录」页的对话
        {ym}/
          {dKey}: [ { id, role:'user'|'ai', text, photos:[url], ts,
                      refs:[{ t:'food'|'exercise'|'body', id, dk }], err?, retryOf?, reportDKey?,
                      pending:[{ pid, status:'pending'|'confirmed'|'rejected'|'replaced',
                                 e:{ AI 识别的饮食 }, photos:[url], replacesRec?, recId?, recDk? }] }, ... ]
      reports/                                                   # 私密：AI 日报
        {dKey}: { date, ts, partial, score, sig, headline, summary, good:[], improve:[], tomorrow }
      coach: { ts, headline, assessment,                         # 私密：AI 教练最新一份计划
               plan:[{ day, focus, items:[{ name, sets, reps, load, rest, cue }] }],
               progression:[{ name, last, next, why }], recovery:[], cautions:[] }
  usage/
    {uid}/
      {YYYY-MM-DD}: 次数                                          # 马来西亚时间换日
```

**聊天建立的记录**跟手动输入的存在**同一个地方**（`food` / `exercise` / `body`），所以今日、月度、好友战况都直接算得到。
额外带 `source:'chat'`，饮食多了 `meal`（早午晚餐）、`portion`、`confidence`；运动可能多了 `distanceKm`、`lifts`（力量训练每一组）、`avgHr`、`intensity`。
聊天记的饮食和运动 **`shared` 一律是 `false`**，不会自己跑进朋友圈；要分享就到今日页点那一条打开开关。

**照片**：只有 Storage 的 `downloadURL` 字串进 Database，**base64 绝不进 DB**。
档案本体在 Storage 的 `calorie_ledger/{uid}/{timestamp}_{index}.jpg`。

**`shared`**：预设 `false`（不公开），由用户在记录时自己打开。旧记录没有这个栏位＝falsy＝不公开。

**隐私三条线**：
1. `shared: false` 的记录**绝不**出现在朋友圈（前端只收 `shared === true`）。
2. **身材数据永远不进朋友圈**，无论如何 —— 它存在 `members/{uid}/body`，规则层就只有本人读得到。
3. 今日页 / 月度页显示**自己全部的记录**（不管公开与否）；朋友圈只显示公开的。

**localStorage：已经完全不用了。** 身份来自 Auth（Firebase SDK 自己管 session persistence），
profile 存在 `members/{uid}/profile`，所以换设备、换浏览器登入同一个 Email 就会看到同样的记录。

**进入流程**：`onAuthStateChanged` 判断状态 →
未登入＝登入/注册画面 → 已登入但没 profile＝设暱称 → 创建/加入小组 → 已登入且有 profile＝直接进今日页。

---

## 5. 功能对照

| 页面 | 内容 |
|---|---|
| 登入 | Email + 密码，可切换「登入 / 注册」，常见错误都有中文提示 |
| 引导 | 设暱称 → 创建小组（产生 6 位代码）或加入小组（检查 roster 是否存在） |
| 今日 | **今日概览**（三个环 + 得分 + 步数 / 睡眠 / 静息心率）、**AI 日报**（昨日 / 今日切换）；目标 / 已摄入 / 已消耗 / 净值 / 剩余；饮食与运动清单（点击编辑、✕ 删除）；有照片显示 `📷 N`、已公开显示 `🌏 已分享`；右下角 + |
| 记录 | 聊天：打字或发照片（最多 4 张）→ AI 拆成饮食 / 运动 / 身体记录。**识别出的饮食先显示成「请确认」卡片**：点「对，记下」（或在聊天里回「对」）才写进资料库；「修改」可以改名称、份量、热量、营养、餐别、日期再记下；「不是」会取消这一项，并在输入框带出「不是…，是」让你直接说正确的食物。运动和身体数据直接记下。说「刚才那碗面只吃了一半」会产生一张修正卡，确认后才替换原本那条。**朋友圈**：确认卡上可以点「也分享到朋友圈」；已记下的饮食 / 运动下面有「分享到朋友圈」开关；也可以直接说「晚餐炒粿条，发朋友圈：今天好满足」或「刚才跑步那个发朋友圈」，配文会存进那条记录的备注、显示成朋友圈贴文的文字。身体数据永远不分享。会读华为运动健康 / Strava 截图的锻炼、步数、睡眠。底下显示今天还能用几次 AI |
| 训练 | **本周训练**：练了几天 / 设定的每周天数，胸、背、腿、肩、手臂、核心各几组（每肌群每周 10–20 组为绿色，少于 10 组金色，超过 20 组锈红）。**AI 教练**：按目标、训练经验、器材、最近 4 周每一组、每肌群组数、睡眠 / 步数 / 静息心率排出这周每天练什么（组数 × 次数、重量或 RPE、休息、动作要点），今天那天会框起来；「下次怎么加重」按渐进超负荷给每个练过的动作具体重量；还有恢复和注意事项。按一次用一次 AI。**动作进步**：每个动作最近一次的组数、Epley 估算最大重量（`kg × (1 + 次数 ÷ 30)`）和小折线。**最近训练**：最近 8 次力量训练 |
| 月度 | 月历上色（ratio<0.85 绿、0.85–1.05 金、>1.05 锈红、无资料灰）＋ 手写 inline SVG 折线图；**点任何一天**看那天的得分、三个环和日报 |
| 朋友圈 | FB 风格动态墙：小组所有 `shared:true` 的饮食/运动，时间倒序；暱称首字母圆头像 + 相对时间；照片 FB 排版；赞（自己按过会高亮）+ 评论（可展开留言）；全程 `.on('value')` 实时更新 |
| 身材 | 体重 / 体脂 / 腰围 / 备注，存 `members/{uid}/body`，私密，**永不进朋友圈** |
| 好友 | roster 名单 + 每人今日摄入/消耗，group 节点是 `.on('value')` 监听，组员更新自动刷新 |
| 设定 | 改暱称、改每日目标、身高 / 年龄 / 目标 / 蛋白质 / 运动目标、**训练经验 / 每周练几天 / 器材**（AI 教练用）、复制小组代码、显示已登入 Email、登出 |

**朋友圈照片排版（FB 风格）**：1 张＝大图 4:3；2 张＝并排各 1:1；3 张＝左边一大、右边两小；
4 张以上＝ 2×2 格状，第 4 格盖上 `+N` 表示还有几张。点任一张开全萤幕看图，可左右翻页。

**运动消耗公式**：`round((MET × 3.5 × weightKg ÷ 200) × 分钟)`，`weightKg` 取 profile（预设 65），
消耗值也可手动覆盖。10 个活动：走路 4.3、跑步 9.8、骑行 7.5、游泳 8.0、力量训练 6.0、
瑜伽 3.0、跳绳 11.0、爬楼梯 8.8、球类运动 7.0、自定义（无 MET）。

**每日得分（0–100，规则固定，同样的资料永远同样的分数）**：
记录 20（记了几个餐别，有身体数据 +2）· 热量 30（净摄入 ÷ 每日目标，0.8–1.05 满分；三餐都记了但总摄入低于 1200 不给高分）·
蛋白质 25（÷ 蛋白质目标，没设就用体重 × 1.6g）· 运动 25（÷ 每日运动目标，没设就 30 分钟）。

**记训练**：在「记录」里说「卧推 60kg 4×8，深蹲 80kg 4×6」或「引体向上 8、7、6」，AI 会把每一组拆成 `lifts`，
自动判断练的是哪个肌群、按每组约 2.5 分钟估时长、用力量训练的 MET 算消耗。说「我是新手，每周练 3 天，只有哑铃」会更新训练设定。
问「今天练什么」「卧推卡在 60kg 怎么办」时，聊天会带上最近 14 天的训练和 AI 教练计划，像私人教练一样回答（动作、组数 × 次数、重量、休息、要点）；
提到疼痛或受伤会先建议停下来看医生或物理治疗师。

**AI 日报**：每天第一次打开 App 时，自动写前一天的日报（标题、点评、做得好、可改进、明天做一件事），并在「记录」里推一则通知。
多台设备同时打开时，用 RTDB transaction 在 `reports/{dKey}` 先抢一个 `pending` 标记，只有一台会真的去生成。
今天的「今日点评」要自己按；前一天的完整版第二天会自动覆盖掉当天的点评。

**AI 次数上限**：每人每天预设 **30 次**（拍照识别、聊天、日报、AI 教练都算一次）。要改的话在 Netlify 环境变数加 `AI_DAILY_LIMIT`。
所有 AI function 都要求 `Authorization: Bearer <Firebase ID token>`，用 Google 的公开金钥验证（不需要 npm 套件），
没登入的人打不到你的 Anthropic key。可选的环境变数：`ANTHROPIC_VISION_MODEL`（有照片时，预设 `claude-sonnet-4-6`）、
`ANTHROPIC_FAST_MODEL`（纯文字聊天，预设 `claude-haiku-4-5`）、`ANTHROPIC_REPORT_MODEL`（日报，预设 `claude-sonnet-4-6`）、
`ANTHROPIC_COACH_MODEL`（AI 教练，预设 `claude-sonnet-4-6`）。

**AI 识别流程（一餐可多张照片）**：前端最多选 6 张 → 各自压缩（最长边 **1280px**、jpeg quality 0.82）→
把整批 base64 放进 `images` 阵列，**一次** POST 到 `/.netlify/functions/analyze-food` →
function 从 `process.env.ANTHROPIC_API_KEY` 读 key →
呼叫 `https://api.anthropic.com/v1/messages`（model `claude-sonnet-4-6`，max_tokens 1000），
把所有图片放进**同一个 message** 的 content 里 →
prompt 告诉模型「这些照片是同一餐（不同角度或不同菜色），请综合估算整餐的总营养，
同一道菜重复出现只能算一次」→ 从回覆文字里抽出第一个 `{` 到最后一个 `}` 解析 JSON →
**回传结构不变** → 「确认结果」页可编辑名称/卡路里/蛋白质/碳水/脂肪 →
确认后才上传照片到 Storage、写入 Firebase。识别失败时提供「改为手动输入」按钮。

Request 格式（三种都收，向下相容）：

```jsonc
{ "images": ["<base64>", "..."], "mediaType": "image/jpeg" }   // 多张，共用 mediaType
{ "images": [{ "base64": "...", "mediaType": "image/jpeg" }] } // 多张，各自带 mediaType（前端用这个）
{ "imageBase64": "...", "mediaType": "image/jpeg" }            // 旧的单张格式，仍可用
```

上限：最多 6 张、单张 base64 < 7MB、总量 < 24MB，超过回 400 / 413。

---

## 6. 疑难排解

| 症状 | 原因 |
|---|---|
| 识别一直失败、console 显示 500「服务端未配置 API key」 | 环境变数没设，或设完没重新 deploy |
| 本机 `open index.html` 识别失败 | 要用 `netlify dev`，function 才会跑 |
| 注册时说「尚未在 Firebase 启用 Email/密码登入」 | Console → Authentication → Sign-in method 没启用 Email/Password（第 0 节） |
| 登入后卡在登入画面、显示「读取设定档失败」 | Security Rules 没贴上或没发布，`members/{uid}/profile` 读不到（第 3 节） |
| 部署后登入报 `auth/unauthorized-domain` | Authentication → Settings → Authorized domains 没加你的 Netlify 网域 |
| 资料写不进去 / console 出现 `PERMISSION_DENIED` | Firebase 规则没贴上或没发布 |
| 组员更新看不到 | 检查两人的小组代码是否一致（好友页最上方） |
| 相机没跳出来 | iOS 需要 HTTPS；Netlify 的网址本来就是 HTTPS，本机测试用 `netlify dev` 的 localhost 也可以 |
| toast「照片上传被拒绝，请检查 Storage 规则」 / console `storage/unauthorized` | Storage 规则没贴或没发布（第 3.5 节） |
| console `storage/unknown` 或 404、bucket 不存在 | Storage 还没在 Console 点过 **Get started** 启用（第 0 节第 3 步） |
| 朋友圈按赞/留言 `PERMISSION_DENIED` | Database 规则里的 `social` 区段没贴到（第 3 节），或贴的是旧版规则 |
| **多张照片识别 504 / 502 超时** | Netlify function 预设 10s 上限，6 张图可能要 15–25s。见下面「Netlify timeout」 |
| 记录存了但朋友圈看不到 | 「分享到朋友圈」开关预设是**关**的，要自己打开；也确认贴文日期落在朋友圈已载入的月份内 |
| AI 显示「请先登录」/「登录已过期」 | function 收不到或验证不了 Firebase ID token。重新整理页面或重新登入 |
| AI 显示「今天的 AI 次数已用完」 | 到了 `AI_DAILY_LIMIT`（预设 30），马来西亚时间半夜 12 点归零 |
| Google 登入跳「这个网址还没加入 Firebase 的授权网域」 | Authentication → Settings → Authorized domains 加上目前的网域 |
| Google 登入说「这个 Email 已经用密码注册过了」 | 非 Gmail 的信箱先用密码注册过，请继续用 Email + 密码登入 |
| AI 日报没自动出现 | 前一天要有饮食或运动记录才会生成；也可以在「今日 → AI 日报 → 昨日」手动按「生成日报」 |

### Netlify timeout（已处理）

Netlify 一般 function 回应的上限是 10 秒，多张照片或聊天常常超过。
现在三个 AI function 都改成**串流回应**：等 Claude 的时候每 2.5 秒先送一个空白，最后才送 JSON。
串流回应适用 Netlify 比较长的执行上限，所以 6 张照片也不会再 502 / 504。前端读完整段文字、trim 之后再 `JSON.parse`。
因为串流一开始 HTTP 状态就已经是 200，后面才发生的错误会放在 JSON 的 `error` 栏位里。

**另外**：图片 token 会算钱。1280px 的图约 1600 tokens，6 张 ≈ 10k input tokens/次识别，
比单张贵约 6 倍，量大的话留意 Anthropic 的帐单。
