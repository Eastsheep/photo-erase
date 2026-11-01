'use strict';
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const MAX_SIDE = 2560;             // 編輯用工作解析度上限

const store = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const S = {
  W: 0, H: 0, base: null, mask: null, result: null, history: [],
  tool: 'lasso', drawing: false, pts: [], last: null,
  screen: 'home', busy: false,
  view: { z: 1, tx: 0, ty: 0, fit: 1 },
  pointers: new Map(), pinch: null, dragCompare: false, split: 0.5,
  instruction: '移除圈選範圍內的路人，自然補上背景',
};

const view = $('#view'); const vctx = view.getContext('2d');
const stage = $('#stage'); const board = $('#board');

function canvas(w = S.W, h = S.H) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function vibrate(ms = 10) { try { navigator.vibrate?.(ms); } catch {} }

// ---------- 畫面切換 ----------
function showScreen(name) {
  S.screen = name;
  $('#home').hidden = name !== 'home';
  $('#editor').hidden = name === 'home';
  $('#brand').hidden = name !== 'home';
  $('#btnBack').hidden = name === 'home';
  $('#barTitle').hidden = name === 'home';
  $('#barTitle').textContent = name === 'result' ? '完成' : '編輯';
  $('#editPanel').hidden = name !== 'edit';
  $('#resultPanel').hidden = name !== 'result';
  $('#compare').hidden = $('#tagBefore').hidden = $('#tagAfter').hidden = name !== 'result';
  if (name !== 'home') requestAnimationFrame(fitView);
}
$('#btnBack').onclick = () => {
  if (S.busy) return;
  if (S.result && !confirm('還沒儲存，確定要離開嗎？')) return;
  S.result = null; showScreen('home');
};

// ---------- 載入圖片 ----------
function onFile(e) {
  const f = e.target.files?.[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    S.W = Math.round(img.naturalWidth * k); S.H = Math.round(img.naturalHeight * k);
    S.base = canvas(); S.base.getContext('2d').drawImage(img, 0, 0, S.W, S.H);
    URL.revokeObjectURL(url);
    resetMask(); S.result = null;
    view.width = S.W; view.height = S.H;
    $('#coach').classList.remove('fade');
    showScreen('edit'); render(); updateGo();
  };
  img.onerror = () => toast('無法讀取這張圖片');
  img.src = url;
  e.target.value = '';
}
$('#fileInput').addEventListener('change', onFile);
$('#cameraInput').addEventListener('change', onFile);

function resetMask() { S.mask = canvas(); S.history = []; }

// ---------- 縮放 / 平移 ----------
function applyView() {
  const v = S.view;
  board.style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.z})`;
  $('#btnFit').hidden = v.z <= 1.01;
}
function fitView() {
  if (!S.W) return;
  const r = stage.getBoundingClientRect();
  const pad = 16;
  const fit = Math.min((r.width - pad * 2) / S.W, (r.height - pad * 2) / S.H);
  const bw = S.W * fit, bh = S.H * fit;
  board.style.width = bw + 'px'; board.style.height = bh + 'px';
  S.view = { z: 1, tx: (r.width - bw) / 2, ty: (r.height - bh) / 2, fit };
  applyView();
}
window.addEventListener('resize', fitView);
$('#btnFit').onclick = fitView;

// ---------- 繪製 ----------
function render() {
  vctx.globalCompositeOperation = 'source-over';
  vctx.clearRect(0, 0, S.W, S.H);
  if (S.result) {
    vctx.drawImage(S.result, 0, 0);
    const x = Math.round(S.split * S.W);
    vctx.save(); vctx.beginPath(); vctx.rect(0, 0, x, S.H); vctx.clip(); vctx.drawImage(S.base, 0, 0); vctx.restore();
    $('.cmp-line').style.left = (S.split * 100) + '%';
    return;
  }
  vctx.drawImage(S.base, 0, 0);
  const tint = canvas(); const t = tint.getContext('2d');
  t.drawImage(S.mask, 0, 0); t.globalCompositeOperation = 'source-in';
  t.fillStyle = 'rgba(255,60,90,0.5)'; t.fillRect(0, 0, S.W, S.H);
  vctx.drawImage(tint, 0, 0);
  if (S.drawing && S.tool === 'lasso' && S.pts.length > 1) {
    const lw = Math.max(2.5, 2.5 * S.W / (board.getBoundingClientRect().width || S.W));
    vctx.save(); vctx.lineJoin = vctx.lineCap = 'round';
    vctx.beginPath(); vctx.moveTo(S.pts[0].x, S.pts[0].y); S.pts.forEach(p => vctx.lineTo(p.x, p.y)); vctx.closePath();
    vctx.fillStyle = 'rgba(255,77,109,0.18)'; vctx.fill();
    vctx.lineWidth = lw * 2.2; vctx.strokeStyle = 'rgba(0,0,0,.45)'; vctx.stroke();
    vctx.lineWidth = lw; vctx.strokeStyle = '#fff'; vctx.setLineDash([lw * 3, lw * 2.5]); vctx.lineDashOffset = -performance.now() / 20; vctx.stroke();
    vctx.restore();
  }
}

// ---------- 手勢：單指畫、雙指縮放、結果模式拖曳對比 ----------
function pos(e) {
  const r = view.getBoundingClientRect();
  return { x: (e.clientX - r.left) * S.W / r.width, y: (e.clientY - r.top) * S.H / r.height, scale: S.W / r.width };
}
function pushHistory() { S.history.push(S.mask.getContext('2d').getImageData(0, 0, S.W, S.H)); if (S.history.length > 25) S.history.shift(); }
function strokeTo(p) {
  const m = S.mask.getContext('2d');
  m.globalCompositeOperation = S.tool === 'erase' ? 'destination-out' : 'source-over';
  m.strokeStyle = '#fff'; m.lineCap = m.lineJoin = 'round';
  m.lineWidth = Number($('#brushSize').value) * p.scale;
  m.beginPath(); m.moveTo(S.last.x, S.last.y); m.lineTo(p.x + 0.01, p.y); m.stroke();
  S.last = p;
}
function setSplit(e) {
  const r = view.getBoundingClientRect();
  S.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); render();
}
function startPinch() {
  const [a, b] = [...S.pointers.values()];
  S.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v: { ...S.view } };
}
function stageXY(e) { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

stage.addEventListener('pointerdown', e => {
  if (S.busy || !S.base) return;
  try { stage.setPointerCapture(e.pointerId); } catch {}
  S.pointers.set(e.pointerId, stageXY(e));
  if (S.pointers.size === 2) {
    if (S.drawing) { S.drawing = false; const h = S.history.pop(); if (h) S.mask.getContext('2d').putImageData(h, 0, 0); S.pts = []; render(); }
    S.dragCompare = false; startPinch(); return;
  }
  if (S.pointers.size > 2) return;
  if (S.screen === 'result') { S.dragCompare = true; setSplit(e); return; }
  if (S.screen !== 'edit') return;
  S.drawing = true; pushHistory();
  const p = pos(e); S.pts = [p]; S.last = p;
  if (S.tool !== 'lasso') strokeTo(p);
  $('#coach').classList.add('fade');
  render();
});
stage.addEventListener('pointermove', e => {
  if (!S.pointers.has(e.pointerId)) return;
  S.pointers.set(e.pointerId, stageXY(e));
  if (S.pinch && S.pointers.size === 2) {
    const [a, b] = [...S.pointers.values()]; const P = S.pinch;
    const d = Math.hypot(a.x - b.x, a.y - b.y); const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = Math.min(8, Math.max(1, P.v.z * d / P.d));
    const wx = (P.m.x - P.v.tx) / P.v.z, wy = (P.m.y - P.v.ty) / P.v.z;
    S.view.z = z; S.view.tx = m.x - wx * z; S.view.ty = m.y - wy * z; applyView();
    return;
  }
  if (S.dragCompare) { setSplit(e); return; }
  if (!S.drawing) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs) { const p = pos(ev); if (S.tool === 'lasso') S.pts.push(p); else strokeTo(p); }
  render();
});
function endPointer(e) {
  S.pointers.delete(e.pointerId);
  if (S.pointers.size < 2) S.pinch = null;
  if (S.pointers.size === 0) S.dragCompare = false;
  if (!S.drawing) return;
  S.drawing = false;
  if (S.tool === 'lasso') {
    if (S.pts.length > 4) {
      const m = S.mask.getContext('2d'); m.globalCompositeOperation = 'source-over'; m.fillStyle = m.strokeStyle = '#fff';
      m.beginPath(); m.moveTo(S.pts[0].x, S.pts[0].y); S.pts.forEach(p => m.lineTo(p.x, p.y)); m.closePath(); m.fill();
      m.lineWidth = Math.max(6, S.W / 150); m.lineJoin = 'round'; m.stroke(); // 邊緣外擴一點，避免圈太貼
      vibrate();
    } else S.history.pop();
  }
  S.pts = []; render(); updateGo();
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

// ---------- 工具列 ----------
$$('[data-tool]').forEach(b => b.onclick = () => {
  S.tool = b.dataset.tool;
  $$('[data-tool]').forEach(x => x.classList.toggle('on', x === b));
  $('#brushRow').hidden = S.tool === 'lasso';
});
function updateBrushDot() { $('#brushDot').style.setProperty('--d', Math.max(6, Math.min(40, $('#brushSize').value * 0.38)) + 'px'); }
$('#brushSize').addEventListener('input', updateBrushDot); updateBrushDot();
$('#btnUndo').onclick = () => { const h = S.history.pop(); if (h) { S.mask.getContext('2d').putImageData(h, 0, 0); render(); updateGo(); } };
$('#btnClear').onclick = () => { if (maskIsEmpty()) return; pushHistory(); S.mask.getContext('2d').clearRect(0, 0, S.W, S.H); render(); updateGo(); };

$$('.chip').forEach(c => c.onclick = () => {
  $$('.chip').forEach(x => x.classList.toggle('on', x === c));
  const custom = c.dataset.preset === 'custom';
  $('#instruction').hidden = !custom;
  if (custom) $('#instruction').focus(); else S.instruction = c.dataset.preset;
});

function maskIsEmpty() {
  if (!S.mask) return true;
  const small = canvas(64, 64); const sc = small.getContext('2d', { willReadFrequently: true });
  sc.drawImage(S.mask, 0, 0, 64, 64);
  const d = sc.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
  return true;
}
function updateGo() { $('#btnGo').disabled = S.busy || maskIsEmpty(); }

// ---------- AI 服務：DeepSeek（優化指令，選填）+ Google Nano Banana（生圖） ----------
function fallbackPrompt(instruction) {
  const want = (instruction || '移除路人與多餘物件').trim();
  return `請參考圖2中紅色標記的區域，對圖1的相同位置進行修改：${want}。以周圍環境的材質、光線、透視與陰影無縫自然地補全背景，不留任何殘影或輪廓；紅色區域以外的內容、構圖與色調完全保持不變；輸出為寫實照片，畫面中不得出現紅色遮罩或任何文字浮水印。`;
}
const SYSTEM_PROMPT = `你是專業的影像編輯提示詞工程師，負責為 AI 圖像編輯模型（Qwen Image / Nano Banana）撰寫指令。
情境：使用者會提供兩張圖。圖1 是原始照片；圖2 是同一張照片，但需要修改的區域被塗上了不透明的紅色遮罩。
你的任務：把使用者簡短的需求，改寫成一段清楚、具體、可直接給圖像編輯模型的繁體中文編輯指令。
撰寫原則：
1. 明確說明「依照圖2紅色標記的位置，修改圖1對應區域」。
2. 若是移除（路人、物件、雜物、文字、電線等），要求以周圍環境（地面、牆面、天空、植物等的材質、光線、透視、陰影、雜訊顆粒）無縫自然地補全背景，不留殘影、輪廓或陰影。
3. 強調紅色區域以外的內容（人物、構圖、色調、解析度）完全保持不變，輸出圖不得出現任何紅色遮罩痕跡。
4. 輸出寫實照片風格，不加浮水印、文字或新物件（除非使用者要求）。
只輸出最終指令本身，不要任何解釋、引號或前後綴，長度 80–200 字。`;

function relayBase() { return store.get('pe.relay').replace(/\/+$/, ''); }
function netError(what, e) {
  return new Error(`${what} 連線失敗（${e.message}）。若是被瀏覽器擋下（CORS），請在設定填入「代理網址」，見 README 的 Cloudflare Worker 說明`);
}
async function enhance(instruction) {
  const key = store.get('pe.deepseek');
  if (!key) return fallbackPrompt(instruction);
  const url = relayBase() ? `${relayBase()}/deepseek/chat/completions` : 'https://api.deepseek.com/chat/completions';
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({
      model: 'deepseek-chat', temperature: 0.4, max_tokens: 400,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `使用者需求：${instruction || '移除圈選範圍內的路人與物件'}` }],
    }) });
  } catch (e) { throw netError('DeepSeek', e); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`DeepSeek 錯誤：${data?.error?.message || r.status}`);
  return data?.choices?.[0]?.message?.content?.trim() || fallbackPrompt(instruction);
}

const GOOGLE_MODELS = {
  'gemini-nano-banana-2.1': 'Nano Banana 2.1',
  'gemini-3.1-flash-image': 'Nano Banana 2',
  'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite',
  'gemini-3-pro-image': 'Nano Banana Pro',
  'gemini-2.5-flash-image': 'Nano Banana',
};
function googleModel() { const m = store.get('pe.googleModel'); return GOOGLE_MODELS[m] ? m : 'gemini-nano-banana-2.1'; }
const QWEN_MODELS = {
  'qwen-image-3.0-pro': 'Qwen Image 3.0 Pro',
  'qwen-image-2.1-pro': 'Qwen Image 2.1 Pro',
  'qwen-image-2.1-turbo': 'Qwen Image 2.1 Turbo',
  'qwen-image-2.0-pro': 'Qwen Image 2.0 Pro',
  'qwen-image-2.0': 'Qwen Image 2.0',
};
const QWEN_BASE = 'https://ap-southeast-1.maas.qwencloudapi.com'; // Qwen Cloud 新加坡區
function engine() {
  const e = store.get('pe.engine');
  if (e === 'google' || e === 'qwen' || e === 'openrouter') return e;
  // 沒選過引擎：已有 Gemini Key、沒有 Qwen Key 的舊使用者沿用 Nano Banana
  return store.get('pe.google') && !store.get('pe.qwen') ? 'google' : 'qwen';
}
function qwenModel() { const m = store.get('pe.qwenModel'); return QWEN_MODELS[m] ? m : 'qwen-image-3.0-pro'; }
const ENGINES = {
  qwen: { key: 'pe.qwen', label: 'Qwen Cloud API Key', brand: 'Qwen Image' },
  google: { key: 'pe.google', label: 'Google Gemini API Key', brand: 'Google Nano Banana' },
  openrouter: { key: 'pe.openrouter', label: 'OpenRouter API Key', brand: 'OpenRouter' },
};
function genKey() { return store.get(ENGINES[engine()].key); }
function engineName() {
  const e = engine();
  return e === 'qwen' ? QWEN_MODELS[qwenModel()] : e === 'google' ? GOOGLE_MODELS[googleModel()] : (store.get('pe.orModelName') || orModel() || 'OpenRouter');
}
function keyLabel() { return ENGINES[engine()].label; }

// ---------- OpenRouter（可選任一支援「圖片輸入 + 圖片輸出」的模型）----------
const OR_BASE = 'https://openrouter.ai/api/v1';
function orModel() { return store.get('pe.orModel'); }
function orHeaders(key) {
  const h = { 'Content-Type': 'application/json', 'HTTP-Referer': location.origin + location.pathname, 'X-Title': 'Photo Erase' };
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}
// 抓模型清單：只留可以吃圖片、也能輸出圖片的（才能修圖）
async function fetchOrModels(key) {
  const tryGet = async path => { const r = await fetch(OR_BASE + path, { headers: orHeaders(key) }); if (!r.ok) throw new Error(r.status); return (await r.json()).data || []; };
  let list;
  try { list = await tryGet('/images/models'); } catch { list = await tryGet('/models?output_modalities=image'); }
  const canEdit = m => {
    const a = m.architecture || {};
    const inp = a.input_modalities || [], out = a.output_modalities || [];
    return out.includes('image') && (inp.length === 0 || inp.includes('image'));
  };
  return list.filter(canEdit).map(m => ({ id: m.id, name: m.name || m.id })).sort((a, b) => a.name.localeCompare(b.name));
}
function extractOrImage(d) {
  const b = d?.data?.[0];
  if (b?.b64_json) return `data:${b.media_type || 'image/png'};base64,${b.b64_json}`;
  if (b?.url) return b.url;
  const img = d?.choices?.[0]?.message?.images?.[0];
  return img?.image_url?.url || img?.url || null;
}
async function inpaintOpenRouter({ image, marked, prompt }, key) {
  const model = orModel();
  if (!model) throw new Error('請先到設定選擇 OpenRouter 模型');
  const post = async (path, body) => {
    let r;
    try { r = await fetch(OR_BASE + path, { method: 'POST', headers: orHeaders(key), body: JSON.stringify(body) }); }
    catch (e) { throw netError('OpenRouter', e); }
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  };
  const aspect = nearestAspect();
  // 1) 新版專用圖片端點
  const ref = url => ({ type: 'image_url', image_url: { url } });
  let res = await post('/images', { model, prompt, input_references: [ref(image), ref(marked)], aspect_ratio: aspect, n: 1 });
  if (!res.ok && res.status === 400) res = await post('/images', { model, prompt, input_references: [ref(image), ref(marked)], n: 1 });
  // 2) 退回 chat completions 的圖片輸出
  if (!res.ok && [400, 404, 405].includes(res.status)) {
    const fb = await post('/chat/completions', {
      model, modalities: ['image', 'text'],
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: image } },
        { type: 'image_url', image_url: { url: marked } },
      ] }],
    });
    if (fb.ok) res = fb;
  }
  if (!res.ok) {
    const hint = { 401: 'API Key 錯誤。', 402: 'OpenRouter 餘額不足，請到 openrouter.ai/credits 儲值。', 429: '請求太頻繁，稍後再試。' }[res.status] || '';
    const msg = res.data?.error?.message || res.data?.message || '';
    throw new Error(`OpenRouter ${res.status}${hint ? '：' + hint : ''}${msg ? `（${String(msg).slice(0, 160)}）` : ''}`);
  }
  const out = extractOrImage(res.data);
  if (!out) throw new Error('這個模型沒有回傳圖片，請換一個模型試試');
  return { image: out.startsWith('data:') ? out : await fetchAsDataURL(out) };
}

// ---------- Google Gemini（Nano Banana）----------
const ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
function nearestAspect() {
  const r = S.W / S.H; let best = '1:1', d = 1e9;
  for (const a of ASPECTS) { const [x, y] = a.split(':').map(Number); const e = Math.abs(Math.log(r / (x / y))); if (e < d) { d = e; best = a; } }
  return best;
}
// 從回應中找出最後一張圖片（相容 Interactions API 與 generateContent 兩種格式）
function findImage(obj) {
  let found = null;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const inl = o.inlineData || o.inline_data;
    if (inl?.data) found = { data: inl.data, mime: inl.mimeType || inl.mime_type || 'image/png' };
    else if (o.type === 'image' && typeof o.data === 'string' && o.data.length > 100) found = { data: o.data, mime: o.mime_type || o.mimeType || 'image/png' };
    for (const k in o) if (k !== 'inlineData' && k !== 'inline_data') walk(o[k]);
  })(obj);
  return found;
}
async function googleCall(path, key, body) {
  const base = relayBase() ? `${relayBase()}/google` : 'https://generativelanguage.googleapis.com';
  let r;
  try {
    r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  } catch (e) { throw netError('Google Gemini', e); }
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
// ---------- Qwen Cloud（Qwen Image 編輯）----------
function sizeFor(pixels) {
  const a = S.W / S.H; let w = Math.sqrt(pixels * a), h = w / a;
  const f = v => Math.max(512, Math.floor(v / 16) * 16);
  return `${f(w)}*${f(h)}`;
}
function blobToDataURL(b) { return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(b); }); }
async function fetchAsDataURL(url) {
  try { const r = await fetch(url); if (r.ok) return await blobToDataURL(await r.blob()); } catch {}
  if (relayBase()) {
    const r = await fetch(`${relayBase()}/img`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    if (r.ok) return await blobToDataURL(await r.blob());
  }
  throw new Error('結果圖片下載失敗（被瀏覽器擋下），請在設定填入「代理網址」');
}
async function inpaintQwen({ image, marked, prompt, enhanced }, key) {
  const url = relayBase() ? `${relayBase()}/qwen/api/v1/services/aigc/multimodal-generation/generation`
    : `${QWEN_BASE}/api/v1/services/aigc/multimodal-generation/generation`;
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({
      model: qwenModel(),
      input: { messages: [{ role: 'user', content: [{ image }, { image: marked }, { text: prompt }] }] },
      parameters: {
        n: 1, size: sizeFor(2000 * 2000), watermark: false, prompt_extend: !enhanced,
        negative_prompt: '紅色遮罩，紅色色塊，殘影，輪廓痕跡，文字，浮水印，畫面變形',
      },
    }) });
  } catch (e) { throw netError('Qwen Cloud', e); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.code) {
    const hint = { 401: 'API Key 錯誤或不是新加坡區的 Key。', 403: '這把 Key 沒有開通此模型，請到 Qwen Cloud 控制台確認。', 429: '請求太頻繁或額度用完，稍後再試。' }[r.status] || '';
    throw new Error(`Qwen Cloud ${r.status}${hint ? '：' + hint : ''}${data.message ? `（${String(data.message).slice(0, 160)}）` : ''}`);
  }
  const out = data?.output?.choices?.[0]?.message?.content?.find(c => c.image)?.image;
  if (!out) throw new Error('Qwen 沒有回傳圖片（可能被內容審核擋下，換個指令或範圍再試）');
  return { image: out.startsWith('data:') ? out : await fetchAsDataURL(out) };
}

async function inpaintGoogle({ image, marked, prompt }, key) {
  const model = googleModel();
  const b64 = u => u.split(',')[1];
  const aspect = nearestAspect();
  const size = model.includes('lite') ? '1K' : '2K';
  // 優先使用新版 Interactions API
  let res = await googleCall('/v1beta/interactions', key, {
    model,
    input: [
      { type: 'text', text: prompt },
      { type: 'image', mime_type: 'image/jpeg', data: b64(image) },
      { type: 'image', mime_type: 'image/jpeg', data: b64(marked) },
    ],
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspect, image_size: size },
  });
  // 不支援時退回 generateContent
  if (!res.ok && [400, 404].includes(res.status)) {
    const fb = await googleCall(`/v1beta/models/${model}:generateContent`, key, {
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: b64(image) } },
        { inline_data: { mime_type: 'image/jpeg', data: b64(marked) } },
      ] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
    });
    if (fb.ok) res = fb;
  }
  if (!res.ok) {
    const d = res.data || {};
    const detail = d.error?.message || d.message || d.error?.status || (typeof d.error === 'string' ? d.error : '');
    const hint = {
      402: '這個 API Key 的專案尚未開通付費。圖片模型沒有免費額度，請到 Google AI Studio 的 Billing 綁定付款方式後再試。',
      403: 'API Key 沒有權限，請確認 Key 正確且已啟用 Gemini API。',
      429: '使用量超過上限，稍等一下再試，或到 AI Studio 提高額度。',
      400: 'Google 拒絕了這個請求，可能是模型名稱或圖片格式問題。',
    }[res.status] || '';
    throw new Error(`Google Gemini ${res.status}${hint ? '：' + hint : ''}${detail ? `（${String(detail).slice(0, 160)}）` : ''}`);
  }
  const img = findImage(res.data);
  if (!img) throw new Error('Gemini 沒有回傳圖片（可能被安全機制擋下，換個指令或圈選範圍再試）');
  return { image: `data:${img.mime};base64,${img.data}` };
}


function loadImage(src) { return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('結果圖片無法載入')); i.src = src; }); }

// 把生成結果只貼回遮罩區域（邊緣羽化），遮罩外保留原圖像素
function composite(genImg) {
  const gen = canvas(); gen.getContext('2d').drawImage(genImg, 0, 0, S.W, S.H);
  const f = Math.max(8, Math.round(Math.max(S.W, S.H) / 160));
  const sw = Math.max(1, Math.round(S.W / f)), sh = Math.max(1, Math.round(S.H / f));
  const small = canvas(sw, sh); const sc = small.getContext('2d');
  sc.imageSmoothingQuality = 'high'; sc.drawImage(S.mask, 0, 0, sw, sh); sc.drawImage(small, 0, 0);
  const feather = canvas(); const fc = feather.getContext('2d');
  fc.imageSmoothingQuality = 'high'; fc.drawImage(small, 0, 0, S.W, S.H); fc.drawImage(S.mask, 0, 0);
  const g = gen.getContext('2d'); g.globalCompositeOperation = 'destination-in'; g.drawImage(feather, 0, 0);
  const out = canvas(); const o = out.getContext('2d'); o.drawImage(S.base, 0, 0); o.drawImage(gen, 0, 0);
  return out;
}

function setBusy(on, step, text, sub = '') {
  S.busy = on;
  $('#busy').hidden = $('#scan').hidden = !on;
  $('#busyText').textContent = text || ''; $('#busySub').textContent = sub;
  $('#step1').className = 'dot' + (step === 1 ? ' on' : step > 1 ? ' done' : '');
  $('#step2').className = 'dot' + (step === 2 ? ' on' : '');
  $$('.panel button, #btnBack').forEach(b => b.disabled = on);
  if (!on) updateGo();
}

$('#btnGo').onclick = async () => {
  if (maskIsEmpty()) return toast('請先用手指圈出要移除的範圍');
  if (!genKey()) { toast(`請先填入 ${keyLabel()}`); return openSettings(); }
  const custom = !$('#instruction').hidden;
  const instruction = custom ? ($('#instruction').value.trim() || S.instruction) : S.instruction;
  try {
    let prompt = fallbackPrompt(instruction), enhanced = false;
    if ($('#useDeepseek').checked && store.get('pe.deepseek')) {
      setBusy(true, 1, 'AI 正在理解你的需求', 'DeepSeek 優化修圖指令');
      prompt = await enhance(instruction); enhanced = !!store.get('pe.deepseek');
    }
    setBusy(true, 2, 'AI 正在補上背景', `${engineName()} 生成中，約 10–40 秒`);
    const image = S.base.toDataURL('image/jpeg', 0.92);
    const marked = canvas(); const mc = marked.getContext('2d');
    mc.drawImage(S.base, 0, 0);
    const red = canvas(); const rc = red.getContext('2d'); rc.drawImage(S.mask, 0, 0);
    rc.globalCompositeOperation = 'source-in'; rc.fillStyle = '#ff0000'; rc.fillRect(0, 0, S.W, S.H);
    mc.drawImage(red, 0, 0);
    const body = { image, marked: marked.toDataURL('image/jpeg', 0.92), prompt, enhanced };
    const e = engine();
    const res = e === 'qwen' ? await inpaintQwen(body, genKey()) : e === 'openrouter' ? await inpaintOpenRouter(body, genKey()) : await inpaintGoogle(body, genKey());
    S.result = composite(await loadImage(res.image));
    S.split = 0.5;
    $('#promptUsed').textContent = prompt;
    showScreen('result'); render(); vibrate(20);
  } catch (err) {
    toast('失敗：' + err.message, 6000);
  } finally { setBusy(false); }
};

// ---------- 結果 ----------
$('#btnDiscard').onclick = () => { S.result = null; showScreen('edit'); render(); };
$('#btnKeep').onclick = () => {
  S.base = S.result; S.result = null; resetMask(); showScreen('edit'); render(); updateGo();
  toast('已套用，可以繼續圈選下一處');
};
$('#btnSave').onclick = () => {
  S.result.toBlob(async blob => {
    const file = new File([blob], `修圖達人-${Date.now()}.jpg`, { type: 'image/jpeg' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('已下載');
  }, 'image/jpeg', 0.95);
};

// ---------- 設定 ----------
function updateStatus() {
  $('#featureEngine').textContent = `${store.get('pe.deepseek') ? 'DeepSeek 優化指令，' : ''}${engine() === 'openrouter' ? engineName() : ENGINES[engine()].brand} 生成`;
  $('#serverStatus').textContent = genKey() ? `✓ 已設定，使用 ${engineName()}${store.get('pe.deepseek') ? ' + DeepSeek' : ''}` : `第一次使用：填入 ${keyLabel()} 就能開始。`;
}
function openSettings() {
  $('#setEngine').value = engine(); $('#setQwen').value = store.get('pe.qwen'); $('#setQwenModel').value = qwenModel();
  $('#setGoogle').value = store.get('pe.google'); $('#setGoogleModel').value = googleModel();
  $('#setOr').value = store.get('pe.openrouter'); fillOrSelect(); syncEngine();
  $('#setDeepseek').value = store.get('pe.deepseek'); $('#setRelay').value = store.get('pe.relay');
  updateStatus(); $('#settings').showModal();
}
$('#btnSettings').onclick = openSettings;
function syncEngine() {
  const e = $('#setEngine').value;
  $$('.qwen-only').forEach(el => el.hidden = e !== 'qwen');
  $$('.google-only').forEach(el => el.hidden = e !== 'google');
  $$('.or-only').forEach(el => el.hidden = e !== 'openrouter');
  if (e === 'openrouter' && !orCache().length && $('#setOr').value.trim()) loadOrModels();
}
function orCache() { try { return JSON.parse(store.get('pe.orModels', '[]')); } catch { return []; } }
function fillOrSelect() {
  const sel = $('#setOrModel'); const list = orCache(); const cur = orModel();
  sel.innerHTML = '';
  if (!list.length && !cur) { sel.add(new Option('（先填 Key，再按「更新清單」）', '')); return; }
  if (cur && !list.some(m => m.id === cur)) sel.add(new Option(store.get('pe.orModelName') || cur, cur));
  list.forEach(m => sel.add(new Option(m.name, m.id)));
  sel.value = cur || list[0]?.id || '';
}
async function loadOrModels() {
  const btn = $('#btnOrRefresh'); btn.disabled = true; btn.textContent = '讀取中…';
  try {
    const list = await fetchOrModels($('#setOr').value.trim());
    store.set('pe.orModels', JSON.stringify(list)); fillOrSelect();
    $('#orHint').textContent = `找到 ${list.length} 個可修圖的模型（可輸入圖片、輸出圖片）`;
  } catch (e) {
    $('#orHint').textContent = `讀取模型清單失敗（${e.message}），請確認網路或 Key`;
  } finally { btn.disabled = false; btn.textContent = '更新清單'; }
}
$('#btnOrRefresh').addEventListener('click', e => { e.preventDefault(); loadOrModels(); });
$('#setEngine').addEventListener('change', syncEngine);
$('#settings').addEventListener('click', e => { if (e.target === $('#settings')) $('#settings').close('cancel'); });
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'ok') return;
  store.set('pe.engine', $('#setEngine').value); store.set('pe.qwen', $('#setQwen').value.trim()); store.set('pe.qwenModel', $('#setQwenModel').value);
  store.set('pe.google', $('#setGoogle').value.trim()); store.set('pe.googleModel', $('#setGoogleModel').value);
  const orSel = $('#setOrModel'); store.set('pe.openrouter', $('#setOr').value.trim());
  if (orSel.value) { store.set('pe.orModel', orSel.value); store.set('pe.orModelName', orSel.selectedOptions[0]?.text || orSel.value); }
  store.set('pe.deepseek', $('#setDeepseek').value.trim()); store.set('pe.relay', $('#setRelay').value.trim());
  updateStatus(); toast('設定已儲存');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
showScreen('home');
updateStatus();
