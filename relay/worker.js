// 修圖達人 備用代理（Cloudflare Worker，免費方案即可）
// 只有在手機瀏覽器直接呼叫 API 被 CORS 擋下時才需要。
// 它只做轉送，不保存任何金鑰；金鑰仍由 App 從手機送出。
// 部署：Cloudflare 後台 → Workers & Pages → Create Worker → 貼上本檔 → Deploy，
//       再到 App「設定 → 代理網址」填入 https://<名稱>.<帳號>.workers.dev
// 預設只允許 https://eastsheep.github.io 使用；要改可在 Worker 的 Settings → Variables 設 ALLOWED_ORIGIN（多個用逗號隔開，* 代表全部）。

const UPSTREAM = {
  deepseek: 'https://api.deepseek.com',
  google: 'https://generativelanguage.googleapis.com',
  qwen: 'https://ap-southeast-1.maas.qwencloudapi.com',
};
// /img 只允許下載這些網域的結果圖（Qwen 回傳的圖片網址）
const IMG_HOSTS = ['.aliyuncs.com', '.qwencloudapi.com', '.qwencloud.com', '.alicdn.com'];

export default {
  async fetch(req, env) {
    if (req.method === 'GET') {
      return new Response('修圖達人代理運作中 ✓ 把這個網址貼到 App 的「設定 → 代理網址」', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || 'https://eastsheep.github.io').split(',').map(s => s.trim());
    const ok = allowed.includes('*') || allowed.includes(origin);
    if (!ok) return new Response('forbidden: origin not allowed', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-goog-api-key',
      'Access-Control-Max-Age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });

    const url = new URL(req.url);
    if (url.pathname === '/img') {
      const { url: target } = await req.json().catch(() => ({}));
      let t; try { t = new URL(target); } catch { return new Response('bad url', { status: 400, headers: cors }); }
      if (t.protocol !== 'https:' || !IMG_HOSTS.some(h => t.hostname.endsWith(h))) return new Response('host not allowed', { status: 403, headers: cors });
      const img = await fetch(t.toString());
      const h = new Headers(cors); h.set('Content-Type', img.headers.get('Content-Type') || 'image/png');
      return new Response(img.body, { status: img.status, headers: h });
    }
    const [, service, ...rest] = url.pathname.split('/');
    const base = UPSTREAM[service];
    const path = '/' + rest.join('/');
    const okPath = service === 'qwen'
      ? path === '/api/v1/services/aigc/multimodal-generation/generation'
      : service === 'google'
      ? path === '/v1beta/interactions' || /^\/v1beta\/models\/[a-z0-9.-]+:generateContent$/.test(path)
      : path === '/chat/completions';
    if (!base || !okPath) {
      return new Response('not found', { status: 404, headers: cors });
    }
    const upstream = await fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(service === 'google'
          ? { 'x-goog-api-key': req.headers.get('x-goog-api-key') || '' }
          : { Authorization: req.headers.get('Authorization') || '' }),
      },
      body: await req.arrayBuffer(),
    });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
