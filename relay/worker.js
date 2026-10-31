// 修圖達人 備用代理（Cloudflare Worker，免費方案即可）
// 只有在手機瀏覽器直接呼叫 API 被 CORS 擋下時才需要。
// 它只做轉送，不保存任何金鑰；金鑰仍由 App 從手機送出。
// 部署：Cloudflare 後台 → Workers & Pages → Create Worker → 貼上本檔 → Deploy，
//       再到 App「設定 → 代理網址」填入 https://<名稱>.<帳號>.workers.dev
// 建議在 Worker 的 Settings → Variables 設 ALLOWED_ORIGIN = https://eastsheep.github.io，只允許你的網站使用。

const UPSTREAM = {
  deepseek: 'https://api.deepseek.com',
  'ark-cn': 'https://ark.cn-beijing.volces.com/api/v3',
  'ark-intl': 'https://ark.ap-southeast.bytepluses.com/api/v3',
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    if (allowed !== '*' && origin !== allowed) return new Response('forbidden', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });

    const url = new URL(req.url);
    const [, service, ...rest] = url.pathname.split('/');
    const base = UPSTREAM[service];
    const path = '/' + rest.join('/');
    if (!base || !['/chat/completions', '/images/generations'].includes(path)) {
      return new Response('not found', { status: 404, headers: cors });
    }
    const upstream = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.get('Authorization') || '' },
      body: await req.arrayBuffer(),
    });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
