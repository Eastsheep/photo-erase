// 修圖達人 後端代理：提供靜態檔案 + 代呼叫 DeepSeek / Seedream，API 金鑰只存在伺服器端
// 需求：Node.js 18+（使用內建 fetch），無第三方套件
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 讀取 .env（簡易版）
const envFile = path.join(__dirname, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const cfg = {
  port: Number(process.env.PORT || 8787),
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBase: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  arkKey: process.env.ARK_API_KEY || '',
  // 中國區火山方舟；海外 BytePlus 請改為 https://ark.ap-southeast.bytepluses.com/api/v3
  arkBase: process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
  seedreamModel: process.env.SEEDREAM_MODEL || 'doubao-seedream-4-0-250828',
  appPassword: process.env.APP_PASSWORD || '',
  mock: process.env.MOCK === '1',
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function readJson(req, limit = 30 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('圖片太大（上限 30MB）'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function checkAuth(req) {
  if (!cfg.appPassword) return true;
  return req.headers['x-app-password'] === cfg.appPassword;
}

// 金鑰優先使用伺服器設定；未設定時才接受使用者自帶（存在使用者手機上）
const keyFor = (req, server, header) => server || req.headers[header] || '';

const SYSTEM_PROMPT = `你是專業的影像編輯提示詞工程師，負責為「Seedream」圖像編輯模型撰寫指令。
情境：使用者會提供兩張圖。圖1 是原始照片；圖2 是同一張照片，但需要修改的區域被塗上了不透明的紅色遮罩。
你的任務：把使用者簡短的需求，改寫成一段清楚、具體、可直接給 Seedream 的繁體中文編輯指令。
撰寫原則：
1. 明確說明「依照圖2紅色標記的位置，修改圖1對應區域」。
2. 若是移除（路人、物件、雜物、文字、電線等），要求以周圍環境（地面、牆面、天空、植物等的材質、光線、透視、陰影、雜訊顆粒）無縫自然地補全背景，不留殘影、輪廓或陰影。
3. 強調紅色區域以外的內容（人物、構圖、色調、解析度）完全保持不變，輸出圖不得出現任何紅色遮罩痕跡。
4. 輸出寫實照片風格，不加浮水印、文字或新物件（除非使用者要求）。
只輸出最終指令本身，不要任何解釋、引號或前後綴，長度 80–200 字。`;

export function fallbackPrompt(instruction) {
  const want = (instruction || '移除路人與多餘物件').trim();
  return `請參考圖2中紅色標記的區域，對圖1的相同位置進行修改：${want}。以周圍環境的材質、光線、透視與陰影無縫自然地補全背景，不留任何殘影或輪廓；紅色區域以外的內容、構圖與色調完全保持不變；輸出為寫實照片，畫面中不得出現紅色遮罩或任何文字浮水印。`;
}

async function enhance(req, res) {
  const { instruction = '' } = await readJson(req, 64 * 1024);
  const key = keyFor(req, cfg.deepseekKey, 'x-deepseek-key');
  if (cfg.mock || !key) {
    return send(res, 200, { prompt: fallbackPrompt(instruction), source: cfg.mock ? 'mock' : 'template' });
  }
  const r = await fetch(`${cfg.deepseekBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.deepseekModel,
      temperature: 0.4,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `使用者需求：${instruction || '移除圈選範圍內的路人與物件'}` },
      ],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, 502, { error: `DeepSeek 錯誤：${data?.error?.message || r.status}` });
  const prompt = data?.choices?.[0]?.message?.content?.trim();
  send(res, 200, { prompt: prompt || fallbackPrompt(instruction), source: 'deepseek' });
}

async function inpaint(req, res) {
  const { image, marked, prompt, size } = await readJson(req);
  if (!image || !marked || !prompt) return send(res, 400, { error: '缺少圖片或提示詞' });
  if (cfg.mock) return send(res, 200, { image, mock: true });
  const key = keyFor(req, cfg.arkKey, 'x-ark-key');
  if (!key) return send(res, 400, { error: '尚未設定 Seedream（火山方舟）API Key' });
  const r = await fetch(`${cfg.arkBase}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: req.headers['x-seedream-model'] || cfg.seedreamModel,
      prompt,
      image: [image, marked],
      size: size || '2048x2048',
      sequential_image_generation: 'disabled',
      response_format: 'b64_json',
      watermark: false,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, 502, { error: `Seedream 錯誤：${data?.error?.message || r.status}` });
  const b64 = data?.data?.[0]?.b64_json;
  const url = data?.data?.[0]?.url;
  if (b64) return send(res, 200, { image: `data:image/jpeg;base64,${b64}` });
  if (url) { // 轉成 data URL，避免前端跨網域無法合成
    const ir = await fetch(url);
    const buf = Buffer.from(await ir.arrayBuffer());
    return send(res, 200, { image: `data:${ir.headers.get('content-type') || 'image/jpeg'};base64,${buf.toString('base64')}` });
  }
  send(res, 502, { error: 'Seedream 未回傳圖片' });
}

async function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(__dirname, 'public', path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public'))) return send(res, 403, { error: 'forbidden' });
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch { send(res, 404, { error: 'not found' }); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        needPassword: !!cfg.appPassword,
        hasDeepseekKey: !!cfg.deepseekKey, hasArkKey: !!cfg.arkKey,
        model: cfg.seedreamModel, mock: cfg.mock,
      });
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      if (!checkAuth(req)) return send(res, 401, { error: '密碼錯誤' });
      if (url.pathname === '/api/enhance') return await enhance(req, res);
      if (url.pathname === '/api/inpaint') return await inpaint(req, res);
      return send(res, 404, { error: 'not found' });
    }
    return await serveStatic(req, res);
  } catch (e) {
    console.error(e);
    send(res, e.status || 500, { error: e.message || '伺服器錯誤' });
  }
});

server.listen(cfg.port, () => {
  console.log(`修圖達人 running on http://localhost:${cfg.port}${cfg.mock ? ' (MOCK 模式)' : ''}`);
  console.log(`DeepSeek key: ${cfg.deepseekKey ? '已設定' : '未設定'}；Seedream key: ${cfg.arkKey ? '已設定' : '未設定'}；模型 ${cfg.seedreamModel}`);
});
