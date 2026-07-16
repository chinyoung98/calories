# 卡路里记账本

朋友小组一起打卡「吃饭 / 运动 / 卡路里记账」的手机网页 App。

- `index.html` — 全部前端（HTML + CSS + JS 单档，无框架、无打包、无 npm build）
- `netlify/functions/analyze-food.js` — 呼叫 Anthropic API 的 server-side proxy（藏 API key）
- `netlify.toml` — Netlify 设定（functions 目录、publish 根目录、无 build command）

技术栈：vanilla HTML + Firebase Realtime Database v8 compat（CDN）+ Netlify Function。
没有登入系统 —— 使用者身份是浏览器 localStorage 里一个随机产生的 `memberId`。

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

这组规则把这个 App 的读写范围限制在 `calorie_ledger` 节点内，**不会影响这个专案里其他资料**
（其他节点沿用你原本的规则；如果你原本的根节点规则是 `".read": false, ".write": false`，
就把下面的 `calorie_ledger` 区块合并进去）：

```json
{
  "rules": {
    "calorie_ledger": {
      "groups": {
        "$groupCode": {
          ".read": true,
          ".write": true,
          "roster": {
            "$memberId": {
              ".validate": "newData.hasChildren(['name', 'joinedAt'])"
            }
          }
        }
      },
      "members": {
        "$memberId": {
          ".read": true,
          ".write": true
        }
      }
    }
  }
}
```

### 🔴 正式上线前请务必收紧

上面这组是**开发用**规则：任何知道 databaseURL 的人都能读写 `calorie_ledger` 底下的资料。
之所以能这样开，是因为这个 App 刻意不做登入系统（没有 Firebase Auth，就没有 `auth.uid` 可以拿来当规则依据）。

上线前建议至少做到其中一项：

1. **加上 Firebase Anonymous Auth**，然后把规则改成用 `auth.uid` 当作 `memberId`：

   ```json
   "members": {
     "$memberId": {
       ".read": "auth != null && auth.uid === $memberId",
       ".write": "auth != null && auth.uid === $memberId"
     }
   }
   ```

   这样 `members/{memberId}/body`（身材数据）才是真正私密的 —— 目前它「不进 group 节点、
   前端不显示给组员」，但规则层面并没有挡住直接读取。

2. **限制小组代码为不可枚举**，并加上写入验证（例如只能写自己的 `memberId` 底下、
   `calories` 必须是数字、`roster` 只能新增不能删别人）。

3. 至少加上 **写入结构验证**，避免有人塞进超大或畸形的资料把 DB 撑爆。

另外记得在 Firebase Console → **Authentication → Settings → Authorized domains**
（若日后启用 Auth）以及 **App Check** 里限制来源网域。

---

## 4. 资料结构

```
calorie_ledger/
  groups/
    {groupCode}/                       # 6 位代码，字元集 ABCDEFGHJKLMNPQRSTUVWXYZ23456789
      roster/
        {memberId}: { name, joinedAt }
      food/
        {ym}/                          # "2026-07"
          {dKey}/                      # "2026-07-16"
            {memberId}: [ {id,time,name,calories,protein,carbs,fat,items:[{name,calories}]}, ... ]
      exercise/
        {ym}/
          {dKey}/
            {memberId}: [ {id,time,activity,activityName,duration,calories}, ... ]
  members/
    {memberId}/
      body/                            # 个人私有，不进 group、不分享
        {ym}/
          {dKey}: { weight, bodyFat, waist, note, time }
```

**localStorage**（不上 Firebase）：

- `cl_memberId` — 随机产生的使用者身份
- `cl_profile` — `{ displayName, groupCode, dailyGoal, weightKg }`

**Firebase**：只有 `groups/*`（分享给组员）和 `members/{memberId}/body`（私密，换装置也还在）。

---

## 5. 功能对照

| 页面 | 内容 |
|---|---|
| 引导 | 输入名字 → 创建小组（产生 6 位代码）或加入小组（检查 roster 是否存在） |
| 今日 | 目标 / 已摄入 / 已消耗 / 净值 / 剩余；饮食与运动清单（点击编辑、✕ 删除）；右下角 + |
| 月度 | 月历上色（ratio<0.85 绿、0.85–1.05 金、>1.05 锈红、无资料灰）＋ 手写 inline SVG 折线图 |
| 身材 | 体重 / 体脂 / 腰围 / 备注，存 `members/{memberId}/body`，私密 |
| 好友 | roster 名单 + 每人今日摄入/消耗，group 节点是 `.on('value')` 监听，组员更新自动刷新 |
| 设定 | 改名字、改每日目标、复制小组代码 |

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
| 资料写不进去 / console 出现 `PERMISSION_DENIED` | Firebase 规则没贴上或没发布 |
| 组员更新看不到 | 检查两人的小组代码是否一致（好友页最上方） |
| 相机没跳出来 | iOS 需要 HTTPS；Netlify 的网址本来就是 HTTPS，本机测试用 `netlify dev` 的 localhost 也可以 |
