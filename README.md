# 卡路里记账本

朋友小组一起打卡「吃饭 / 运动 / 卡路里记账」的手机网页 App。

- `index.html` — 全部前端（HTML + CSS + JS 单档，无框架、无打包、无 npm build）
- `netlify/functions/analyze-food.js` — 呼叫 Anthropic API 的 server-side proxy（藏 API key）
- `netlify.toml` — Netlify 设定（functions 目录、publish 根目录、无 build command）

技术栈：vanilla HTML + Firebase Auth + Firebase Realtime Database（皆 v8 compat CDN）+ Netlify Function。
身份是 **Email + 密码登入**，所有资料以 `auth.uid` 为 key，换设备登入同一个 Email 就能看到自己的记录。

---

## 0. Firebase Console 手动设定 ⚠️ 必做

到 [Firebase Console](https://console.firebase.google.com/) → 选 `gcl-client-portal` 专案：

1. **启用 Email/密码登入**
   **Authentication** → **Sign-in method** → **Email/Password** → 启用第一个开关（Email/Password）→ 储存。
   第二个开关（Email link / 免密码登入）**不用开**。
   （如果 Authentication 还没初始化过，先点 **Get started**。）

2. **加入授权网域**
   **Authentication** → **Settings** → **Authorized domains** →
   把你的 Netlify 网域加进去（例如 `your-app.netlify.app`，或你自订的网域）。
   `localhost` 预设就在清单里，本机 `netlify dev` 不用另外加。

3. **贴上 Security Rules** —— 见下面第 3 节（必做，否则 profile 读不到，会卡在登入画面）。

没做第 1 步的话，注册会报错 `auth/operation-not-allowed`，App 会显示「尚未在 Firebase 启用 Email/密码登入」。

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
          }
        }
      },

      "members": {
        "$uid": {
          ".read": "auth != null && auth.uid === $uid",
          ".write": "auth != null && auth.uid === $uid"
        }
      }
    }
  }
}
```

### 每段在做什么

| 区段 | 意思 |
|---|---|
| `".read": false, ".write": false`（最外层） | 预设全部锁死。Firebase 规则**不会往下继承 false** —— 底下的节点各自开权限，没开到的地方一律拒绝。 |
| `portal/$shareId` → `".read": true` | 保留你原本 portal 系统的公开读取，行为完全不变。没有 `.write`，所以仍然不能从前端写。 |
| `groups/$groupCode` → `".read": "auth != null"` | **登入**的用户可以读整个小组（组员互看今日战况需要）。这个 `.read` 会往下继承到 roster / food / exercise。未登入完全读不到。 |
| `roster/$uid` → `".write": auth.uid === $uid` | 只能写自己那一格 —— 不能改别人的暱称，也不能把别人踢出小组。 |
| `roster/$uid` 的 `.validate` | 必须有 `name`+`joinedAt`；`name` 限 1–12 字串、`joinedAt` 必须是数字；`$other: false` 挡掉塞额外栏位。 |
| `food/$ym/$dKey/$uid`、`exercise/...` | 同理：读得到全组（继承自 group 的 `.read`），但**只能写 `auth.uid` 等于自己的那一格**。别人的记录改不了。 |
| `members/$uid` | `.read` 和 `.write` 都要求 `auth.uid === $uid` —— `profile` 和 `body`（身材数据）**真正私密**，别人连读都读不到，不只是前端不显示。 |

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
            {uid}: [ {id,time,name,calories,protein,carbs,fat,items:[{name,calories}]}, ... ]
      exercise/
        {ym}/
          {dKey}/
            {uid}: [ {id,time,activity,activityName,duration,calories}, ... ]
  members/
    {uid}/
      profile: { displayName, groupCode, dailyGoal, weightKg }   # 私密
      body/                                                      # 私密，不进 group、不分享
        {ym}/
          {dKey}: { weight, bodyFat, waist, note, time }
```

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
| 今日 | 目标 / 已摄入 / 已消耗 / 净值 / 剩余；饮食与运动清单（点击编辑、✕ 删除）；右下角 + |
| 月度 | 月历上色（ratio<0.85 绿、0.85–1.05 金、>1.05 锈红、无资料灰）＋ 手写 inline SVG 折线图 |
| 身材 | 体重 / 体脂 / 腰围 / 备注，存 `members/{memberId}/body`，私密 |
| 好友 | roster 名单 + 每人今日摄入/消耗，group 节点是 `.on('value')` 监听，组员更新自动刷新 |
| 设定 | 改暱称、改每日目标、复制小组代码、显示已登入 Email、登出 |

**运动消耗公式**：`round((MET × 3.5 × weightKg ÷ 200) × 分钟)`，`weightKg` 取 profile（预设 65），
消耗值也可手动覆盖。10 个活动：走路 4.3、跑步 9.8、骑行 7.5、游泳 8.0、力量训练 6.0、
瑜伽 3.0、跳绳 11.0、爬楼梯 8.8、球类运动 7.0、自定义（无 MET）。

**AI 识别流程**：前端压缩图片（最长边 1024px、jpeg quality 0.82）→ POST base64 到
`/.netlify/functions/analyze-food` → function 从 `process.env.ANTHROPIC_API_KEY` 读 key →
呼叫 `https://api.anthropic.com/v1/messages`（model `claude-sonnet-4-6`，max_tokens 1000）→
从回覆文字里抽出第一个 `{` 到最后一个 `}` 解析 JSON → 回传前端 → 「确认结果」页可编辑
名称/卡路里/蛋白质/碳水/脂肪，附置信度 tag 与「AI 估算仅供参考」提示 → 确认后才写入 Firebase。
识别失败时前端显示错误并提供「改为手动输入」按钮。

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
