// Service worker for the home-screen app. It caches nothing: every page load still
// comes from the network, so a new deploy shows up right away. It only answers
// page navigations when the phone is offline, with a short "no connection" page
// instead of the browser's error screen. (Having a fetch handler also lets older
// Chrome versions offer "安装应用".)
const OFFLINE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>卡路里记账本</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#F5F5F5;color:#333;text-align:center}
b{display:block;font-size:20px;margin-bottom:8px}button{margin-top:18px;padding:11px 26px;border:0;
border-radius:99px;background:#FF2442;color:#fff;font-size:16px}</style></head>
<body><div><b>没有网络</b>连上 Wi-Fi 或流量后再试一次<br><button onclick="location.reload()">重新打开</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;   // scripts, Firebase, AI calls: untouched
  e.respondWith(fetch(e.request).catch(() =>
    new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
