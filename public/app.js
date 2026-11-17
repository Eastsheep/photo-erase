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
  screen: 'home', busy: false, mode: 'erase', // mode：erase（圈選移除）、portrait（職場形象照）或 restore（畫質修復）
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
const MODES = ['erase', 'portrait', 'restore'];
const MODE_TITLE = { portrait: '職場形象照', restore: '畫質修復' };
const COACH = { edit: '用手指圈出要移除的人或物　·　雙指可縮放', portrait: '選好服裝與背景，按下生成', restore: '選擇要修的問題，按下開始修復　·　雙指可縮放' };
const HERO_ICON = { erase: '#i-sparkles', portrait: '#i-briefcase', restore: '#i-wand' };
function showScreen(name) {
  S.screen = name;
  $('#home').hidden = name !== 'home';
  $('#editor').hidden = name === 'home';
  $('#brand').hidden = name !== 'home';
  $('#btnBack').hidden = name === 'home';
  $('#barTitle').hidden = name === 'home';
  $('#barTitle').textContent = name === 'result' ? '完成' : MODE_TITLE[name] || '編輯';
  $('#editPanel').hidden = name !== 'edit';
  $('#portraitPanel').hidden = name !== 'portrait';
  $('#restorePanel').hidden = name !== 'restore';
  $('#coach').textContent = COACH[name] || COACH.edit;
  $('#coach').hidden = name === 'result';
  $('#tagAfter').textContent = S.mode === 'portrait' ? '形象照' : '修復後';
  const full = S.resultFull;
  $('#resultHint').textContent = full && S.origW
    ? `原圖 ${S.origW}×${S.origH} → 修復後 ${full.width}×${full.height}　·　拖曳滑桿比對`
    : '拖曳畫面上的滑桿，比對修圖前後';
  $('#resultPanel').hidden = name !== 'result';
  $('#compare').hidden = $('#tagBefore').hidden = $('#tagAfter').hidden = name !== 'result';
  if (name !== 'home') requestAnimationFrame(fitView);
}
// ---------- 儲存檢核 ----------
// resultSaved：目前結果是否已儲存；baseDirty：「繼續修」後畫面上的照片含有尚未儲存的修改
function hasUnsaved() { return S.result ? !S.resultSaved : !!S.baseDirty; }
const UNSAVED_MSG = '修好的照片還沒儲存，離開後就找不回來了。確定要離開嗎？';
$('#btnBack').onclick = () => {
  if (S.busy) return;
  if (hasUnsaved() && !confirm(UNSAVED_MSG)) return;
  S.result = S.resultFull = null; S.baseDirty = false; showScreen('home');
};
window.addEventListener('beforeunload', e => { if (hasUnsaved() || S.busy) { e.preventDefault(); e.returnValue = ''; } });

// ---------- 載入圖片 ----------
function onFile(e) {
  const f = e.target.files?.[0]; if (!f) return;
  S.mode = S.homeMode;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    S.W = Math.round(img.naturalWidth * k); S.H = Math.round(img.naturalHeight * k);
    S.base = canvas(); S.base.getContext('2d').drawImage(img, 0, 0, S.W, S.H);
    URL.revokeObjectURL(url);
    S.origW = img.naturalWidth; S.origH = img.naturalHeight;
    resetMask(); S.result = S.resultFull = null; S.baseDirty = false; S.resultSaved = false;
    view.width = S.W; view.height = S.H;
    $('#coach').classList.remove('fade');
    showScreen(modeScreen()); render(); updateGo();
  };
  img.onerror = () => toast('無法讀取這張圖片');
  img.src = url;
  e.target.value = '';
}
$('#fileInput').addEventListener('change', onFile);
$('#cameraInput').addEventListener('change', onFile);

// 首頁模式：移除路人／職場形象照／畫質修復，三者同等，相簿與拍照按鈕依目前模式開啟
function setHomeMode(m) {
  S.homeMode = MODES.includes(m) ? m : 'erase';
  store.set('pe.homeMode', S.homeMode);
  $$('.mode-tab').forEach(t => { const on = t.dataset.mode === S.homeMode; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  $$('#home [data-for]').forEach(el => el.hidden = el.dataset.for !== S.homeMode);
  $('#heroIco').setAttribute('href', HERO_ICON[S.homeMode]);
  $('#cameraInput').setAttribute('capture', S.homeMode === 'portrait' ? 'user' : 'environment'); // 形象照預設前鏡頭
}
$$('.mode-tab').forEach(t => t.onclick = () => setHomeMode(t.dataset.mode));
setHomeMode(store.get('pe.homeMode', 'erase'));

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

function netError(what, e) {
  return new Error(`${what} 連線失敗（${e.message}）`);
}
async function enhance(instruction) {
  const key = store.get('pe.deepseek');
  if (!key) return fallbackPrompt(instruction);
  const url = 'https://api.deepseek.com/chat/completions';
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({
      model: 'deepseek-chat', temperature: 0.4, max_tokens: 400,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `使用者需求：${instruction || '移除圈選範圍內的路人與物件'}` }],
    }) });
  } catch (e) { throw netError('DeepSeek', e); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`DeepSeek 錯誤：${data?.error?.message || r.status}`);
  if (data.usage) logUsage({ engine: 'deepseek', model: 'deepseek-chat', ...tokensOf(data.usage) });
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
async function inpaintOpenRouter({ images, prompt }, key) {
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
  let res = await post('/images', { model, prompt, input_references: images.map(ref), aspect_ratio: aspect, n: 1 });
  if (!res.ok && res.status === 400) res = await post('/images', { model, prompt, input_references: images.map(ref), n: 1 });
  // 2) 退回 chat completions 的圖片輸出
  if (!res.ok && [400, 404, 405].includes(res.status)) {
    const fb = await post('/chat/completions', {
      model, modalities: ['image', 'text'],
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        ...images.map(url => ({ type: 'image_url', image_url: { url } })),
      ] }],
      usage: { include: true },
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
  logOrUsage(res.data, model, key);
  return { image: out.startsWith('data:') ? out : await fetchAsDataURL(out) };
}

// ---------- 用量紀錄（存在這支手機）----------
const USAGE_MAX = 3000;
function usageLog() { try { return JSON.parse(store.get('pe.usage', '[]')); } catch { return []; } }
function saveUsage(list) { store.set('pe.usage', JSON.stringify(list.slice(-USAGE_MAX))); }
function tokensOf(u = {}) {
  const pt = u.prompt_tokens ?? u.input_tokens ?? 0, ct = u.completion_tokens ?? u.output_tokens ?? 0;
  return { pt, ct, tt: u.total_tokens ?? pt + ct, cost: typeof u.cost === 'number' ? u.cost : null };
}
function logUsage(e) {
  const entry = { t: Date.now(), id: Math.random().toString(36).slice(2, 10), pt: 0, ct: 0, tt: 0, cost: null, ...e };
  const list = usageLog(); list.push(entry); saveUsage(list); return entry.id;
}
function patchUsage(id, patch) { const list = usageLog(); const e = list.find(x => x.id === id); if (e) { Object.assign(e, patch); saveUsage(list); } }
// OpenRouter：回應帶 usage（tokens、cost）；沒附 cost 時用 generation id 回查
function logOrUsage(d, model, key) {
  const name = store.get('pe.orModel') === model ? (store.get('pe.orModelName') || model) : model;
  const id = logUsage({ engine: 'openrouter', model, name, ...tokensOf(d?.usage) });
  const gid = d?.id;
  if (d?.usage?.cost == null && gid) setTimeout(async () => {
    try {
      const r = await fetch(`${OR_BASE}/generation?id=${encodeURIComponent(gid)}`, { headers: orHeaders(key) });
      const g = (await r.json())?.data; if (!g) return;
      const pt = g.native_tokens_prompt ?? g.tokens_prompt, ct = g.native_tokens_completion ?? g.tokens_completion;
      patchUsage(id, { cost: g.total_cost ?? null, ...(pt != null ? { pt, ct: ct || 0, tt: pt + (ct || 0) } : {}) });
    } catch {}
  }, 2500);
}
const fmtUSD = n => n == null ? '—' : '$' + (n >= 1 || n === 0 ? n.toFixed(2) : n < 0.01 ? n.toFixed(5) : n.toFixed(3));
const fmtNum = n => (n || 0).toLocaleString('en-US');
function usageRange() { return $('#usageRange').value; }
// OpenRouter 官方：GET /api/v1/key 回傳這把 Key 今天／本週／本月／累計花費與額度
async function loadOrKey() {
  const key = store.get('pe.openrouter'), box = $('#orOfficial');
  box.hidden = !key; if (!key) return;
  const grid = $('#orKeyGrid'), hint = $('#orKeyHint');
  hint.textContent = '讀取中…';
  try {
    const r = await fetch(`${OR_BASE}/key`, { headers: orHeaders(key) });
    const d = (await r.json().catch(() => ({})))?.data;
    if (!r.ok || !d) throw new Error(r.status === 401 ? 'Key 錯誤' : r.status);
    const cell = (v, t) => `<div class="u-cell"><b>${fmtUSD(v ?? 0)}</b><span>${t}</span></div>`;
    grid.innerHTML = cell(d.usage_daily, '今天') + cell(d.usage_weekly, '本週') + cell(d.usage_monthly, '本月') + cell(d.usage, '累計');
    const reset = { daily: '每日', weekly: '每週', monthly: '每月' }[d.limit_reset] || '';
    hint.textContent = (d.limit != null
      ? `額度上限 ${fmtUSD(d.limit)}${reset ? `（${reset}重置）` : ''}，剩餘 ${fmtUSD(d.limit_remaining)}。`
      : '這把 Key 沒有設額度上限，可到 openrouter.ai/keys 設定。')
      + '日／週／月以 UTC 時間計算。';
  } catch (e) {
    grid.innerHTML = ''; hint.textContent = `讀取官方用量失敗（${e.message}），請確認網路或 Key。`;
  }
}
function renderUsage() {
  const all = usageLog(); const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const monStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const sum = list => list.reduce((a, e) => (a.n++, a.tt += e.tt || 0, a.cost += e.cost || 0, a.miss += e.cost == null && e.engine !== 'deepseek' ? 1 : 0, a), { n: 0, tt: 0, cost: 0, miss: 0 });
  const today = sum(all.filter(e => e.t >= dayStart)), month = sum(all.filter(e => e.t >= monStart));
  $('#usageToday').innerHTML = `<b>${fmtUSD(today.cost)}</b><span>今天 · ${today.n} 次 · ${fmtNum(today.tt)} tokens</span>`;
  $('#usageMonth').innerHTML = `<b>${fmtUSD(month.cost)}</b><span>本月 · ${month.n} 次 · ${fmtNum(month.tt)} tokens</span>`;
  const r = usageRange();
  const list = all.filter(e => r === 'all' || e.t >= (r === 'today' ? dayStart : monStart));
  const groups = new Map();
  for (const e of list) {
    const k = e.engine + '|' + e.model;
    if (!groups.has(k)) groups.set(k, { name: e.name || e.model, engine: e.engine, items: [] });
    groups.get(k).items.push(e);
  }
  const rows = [...groups.values()].map(g => ({ ...g, ...sum(g.items) })).sort((a, b) => b.cost - a.cost || b.n - a.n);
  const label = { openrouter: 'OpenRouter', deepseek: 'DeepSeek（優化指令）', google: 'Google', qwen: 'Qwen Cloud' };
  $('#usageRows').innerHTML = rows.length ? rows.map(g => `
    <div class="u-row"><div class="u-name"><b>${esc(g.name)}</b><small>${label[g.engine] || g.engine}</small></div>
    <div class="u-num"><b>${fmtUSD(g.n - g.miss ? g.cost : null)}</b><small>${[`${g.n} 次`, g.tt ? `${fmtNum(g.tt)} tok` : '', g.engine !== 'deepseek' && g.n - g.miss ? `均 ${fmtUSD(g.cost / (g.n - g.miss))}/張` : ''].filter(Boolean).map(t => `<span>${t}</span>`).join(' · ')}</small></div></div>`).join('')
    : '<p class="field-hint u-empty">這段期間還沒有紀錄</p>';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function exportUsage() {
  const head = 'time,engine,model,prompt_tokens,completion_tokens,total_tokens,cost_usd';
  const pad = n => String(n).padStart(2, '0');
  const ts = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const csv = '\ufeff' + [head, ...usageLog().map(e => [ts(e.t), e.engine, e.model, e.pt, e.ct, e.tt, e.cost ?? ''].map(q).join(','))].join('\n');
  const file = new File([csv], `修圖達人用量-${Date.now()}.csv`, { type: 'text/csv' });
  (async () => {
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  })();
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
  const base = 'https://generativelanguage.googleapis.com';
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
  throw new Error('結果圖片下載失敗（可能被瀏覽器擋下）');
}
async function inpaintQwen({ images, prompt, enhanced, negative, hires }, key) {
  const url = `${QWEN_BASE}/api/v1/services/aigc/multimodal-generation/generation`;
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({
      model: qwenModel(),
      input: { messages: [{ role: 'user', content: [...images.map(image => ({ image })), { text: prompt }] }] },
      parameters: {
        n: 1, size: sizeFor(hires ? 2048 * 2048 : 2000 * 2000), watermark: false, prompt_extend: !enhanced,
        negative_prompt: negative || '紅色遮罩，紅色色塊，殘影，輪廓痕跡，文字，浮水印，畫面變形',
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

async function inpaintGoogle({ images, prompt, hires }, key) {
  const model = googleModel();
  const b64 = u => u.split(',')[1];
  const aspect = nearestAspect();
  // 畫質修復要求最高解析度 4K；Lite 只有 1K
  const size = model.includes('lite') ? '1K' : hires ? '4K' : '2K';
  // 優先使用新版 Interactions API
  const interact = image_size => googleCall('/v1beta/interactions', key, {
    model,
    input: [
      { type: 'text', text: prompt },
      ...images.map(u => ({ type: 'image', mime_type: 'image/jpeg', data: b64(u) })),
    ],
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspect, image_size },
  });
  let res = await interact(size);
  if (!res.ok && res.status === 400 && size === '4K') res = await interact('2K'); // 模型不支援 4K 時降為 2K
  // 不支援時退回 generateContent
  if (!res.ok && [400, 404].includes(res.status)) {
    const fb = await googleCall(`/v1beta/models/${model}:generateContent`, key, {
      contents: [{ parts: [
        { text: prompt },
        ...images.map(u => ({ inline_data: { mime_type: 'image/jpeg', data: b64(u) } })),
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

// 依目前引擎送出圖片編輯請求，並記錄用量
async function runEngine(body) {
  const e = engine(), key = genKey();
  const res = e === 'qwen' ? await inpaintQwen(body, key) : e === 'openrouter' ? await inpaintOpenRouter(body, key) : await inpaintGoogle(body, key);
  if (e === 'qwen') logUsage({ engine: 'qwen', model: qwenModel() });
  if (e === 'google') logUsage({ engine: 'google', model: googleModel(), name: GOOGLE_MODELS[googleModel()], ...tokensOf(res.usage) });
  return res;
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
    const res = await runEngine({ images: [image, marked.toDataURL('image/jpeg', 0.92)], prompt, enhanced });
    S.result = composite(await loadImage(res.image)); S.resultSaved = false;
    S.split = 0.5;
    $('#promptUsed').textContent = prompt;
    showScreen('result'); render(); vibrate(20);
  } catch (err) {
    toast('失敗：' + err.message, 6000);
  } finally { setBusy(false); }
};

// ---------- 職場形象照：整張重繪，保留本人五官 ----------
const OUTFITS = {
  suit: '換上合身的深色（深灰或海軍藍）商務西裝外套，內搭乾淨的淺色襯衫或上衣，依照本人的性別與風格自然搭配，衣領平整',
  shirt: '換上熨燙平整、合身的白色正式襯衫，簡潔俐落，依照本人的性別與風格自然搭配',
  smart: '換上質感好的商務休閒服裝（例如素色針織衫或休閒西裝外套），專業但親切',
  keep: '保留原本的服裝款式與顏色，只把衣服整理得平整乾淨、去除皺摺與髒污',
};
const BACKDROPS = {
  grey: '乾淨的淺灰色攝影棚無縫背景，帶柔和的漸層暗角',
  white: '純白色乾淨背景，像證件照或企業官網大頭照',
  office: '明亮現代的辦公室場景，背景以淺景深大幅虛化，不搶主體',
  navy: '深藍色攝影棚背景，帶柔和漸層，沉穩專業',
};
const P = { outfit: 'suit', bg: 'grey' };
function portraitPrompt(extra = '') {
  return `把這張照片修成職場專業人士的形象照（企業官網／LinkedIn 大頭照風格）。
最重要：必須是同一個人。完全保留照片中人物的臉型、五官（眼睛、眉毛、鼻子、嘴巴、耳朵）、膚色、年齡感、髮型與髮色、痣與臉部特徵，不要換臉、不要改變臉型或五官比例、不要過度美顏。
服裝：${OUTFITS[P.outfit]}。
背景：${BACKDROPS[P.bg]}。
打光：專業棚拍柔光（主光加補光，帶一點輪廓光），臉部明亮均勻、陰影自然，眼神有光。
姿態與表情：保持原本的臉部角度與表情，肩膀端正放鬆，看起來自然、自信、親切。頭髮整理乾淨，去除雜亂髮絲。
構圖：人物置中，以胸上半身為主；若照片中有多人，只保留最主要（最大、最清楚）的那一位。
畫質：寫實照片質感、對焦清晰，肌膚保留自然紋理，只做輕微修飾（淡化痘痘與暗沉）。不得出現文字、浮水印、相框或多餘物件。${extra ? `
使用者的額外要求（優先照做，若與上面的服裝、背景設定衝突，以這裡為準；但仍須保留本人五官）：${extra}` : ''}`;
}
function bindChips(sel, attr) {
  $$(sel + ' .chip').forEach(c => c.onclick = () => {
    $$(sel + ' .chip').forEach(x => x.classList.toggle('on', x === c));
    P[attr] = c.dataset[attr];
  });
}
bindChips('#outfitChips', 'outfit');
bindChips('#bgChips', 'bg');
$('#portraitExtra').value = store.get('pe.portraitExtra');

// 生成結果長寬比與原圖不同時，置中裁切填滿，避免變形
function coverCanvas(img) {
  const out = canvas(); const k = Math.max(S.W / img.naturalWidth, S.H / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  const o = out.getContext('2d'); o.imageSmoothingQuality = 'high';
  o.drawImage(img, (S.W - w) / 2, (S.H - h) / 2, w, h);
  return out;
}

$('#btnPortraitGo').onclick = async () => {
  if (!genKey()) { toast(`請先填入 ${keyLabel()}`); return openSettings(); }
  try {
    setBusy(true, 2, 'AI 正在拍攝形象照', `${engineName()} 生成中，約 15–60 秒`);
    const extra = $('#portraitExtra').value.trim(); store.set('pe.portraitExtra', extra);
    const prompt = portraitPrompt(extra);
    const res = await runEngine({
      images: [S.base.toDataURL('image/jpeg', 0.92)], prompt, enhanced: true,
      negative: '換臉，五官改變，臉型改變，過度美顏，塑膠皮膚，卡通，畸形的手，多餘的人，文字，浮水印',
    });
    S.result = coverCanvas(await loadImage(res.image)); S.resultSaved = false;
    S.split = 0.5;
    $('#promptUsed').textContent = prompt;
    showScreen('result'); render(); vibrate(20);
  } catch (err) {
    toast('失敗：' + err.message, 6000);
  } finally { setBusy(false); }
};

// ---------- 畫質修復：去模糊、去雜訊、放大銳化、老照片修復 ----------
const FIXES = {
  auto: '先判斷這張照片的主要畫質問題（模糊、失焦、手震、雜訊、壓縮破圖、解析度太低、褪色或刮痕），再針對性修復',
  deblur: '修正失焦、手震與動態模糊，讓主體輪廓、五官、文字與紋理恢復銳利清楚',
  upscale: '把低解析度的小圖放大成高解析度，重建細節（頭髮、皮膚紋理、布料、葉片、文字邊緣），去除放大後的鋸齒與馬賽克感',
  old: '修復老照片：去除刮痕、摺痕、污點、黴斑與破損，修正褪色與泛黃，恢復正確的對比與層次，臉部清晰自然',
  colorize: '修復這張黑白（或單色）老照片並自然上色：依照年代與場景推測合理的膚色、衣服、環境顏色，色彩寫實不浮誇，同時去除刮痕與雜訊、提升清晰度',
  denoise: '去除夜拍、高 ISO 產生的雜訊顆粒與 JPEG 壓縮破圖，同時保留真實細節與邊緣，不要塗抹成油畫感',
};
const LEVELS = {
  light: '修復強度：輕微。以忠於原圖為最優先，只做必要的清晰化，寧可保守也不要自行添加原圖看不出的細節。',
  normal: '修復強度：標準。在忠於原圖的前提下，明顯提升清晰度與細節。',
  strong: '修復強度：強力。盡可能重建清晰的細節與質感，但仍不得改變人物長相、物件與構圖。',
};
const R = { fix: 'auto', level: 'normal' };
function restorePrompt(extra = '') {
  const color = R.fix === 'colorize' ? '' : '\n色彩：保持原本的色彩與白平衡（黑白照片維持黑白），只修正明顯的褪色或偏色。';
  return `請提升這張照片的畫質，輸出同一張照片的高畫質、高解析度版本。
修復內容：${FIXES[R.fix]}。
${LEVELS[R.level]}
最重要：必須是同一張照片。構圖、取景範圍、長寬比、人物的臉型五官與表情、姿勢、服裝、物件位置、文字內容都要完全保持不變；不要換臉、不要美顏、不要新增或刪除任何物件、不要改變背景。${color}
畫質：寫實照片質感，邊緣銳利但不過度銳化（不要白邊光暈），保留自然的皮膚紋理與材質，不要出現塑膠感或油畫感。不得出現文字、浮水印或相框。${extra ? `
使用者的額外要求（優先照做，但仍須保持同一張照片的內容與人物長相）：${extra}` : ''}`;
}
$$('#fixChips .chip').forEach(c => c.onclick = () => {
  $$('#fixChips .chip').forEach(x => x.classList.toggle('on', x === c)); R.fix = c.dataset.fix;
});
$$('#levelChips .chip').forEach(c => c.onclick = () => {
  $$('#levelChips .chip').forEach(x => x.classList.toggle('on', x === c)); R.level = c.dataset.level;
});
$('#restoreExtra').value = store.get('pe.restoreExtra');

const OUT_MAX = 4096; // 儲存的最高解析度（長邊）
// 依原圖長寬比，把生成結果置中裁切成 w×h
function coverTo(img, w, h) {
  const out = canvas(w, h); const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
  const o = out.getContext('2d'); o.imageSmoothingQuality = 'high';
  o.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return out;
}
// 結果比目前底圖大時，把底圖等比放大到同尺寸（對比時才看得出差別）
function growBase(w, h) {
  if (w <= S.W && h <= S.H) return;
  const nb = canvas(w, h); const c = nb.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(S.base, 0, 0, w, h);
  S.W = w; S.H = h; S.base = nb; resetMask(); view.width = w; view.height = h;
}

$('#btnRestoreGo').onclick = async () => {
  if (!genKey()) { toast(`請先填入 ${keyLabel()}`); return openSettings(); }
  try {
    setBusy(true, 2, 'AI 正在修復畫質', `${engineName()} 生成中，約 15–60 秒`);
    const extra = $('#restoreExtra').value.trim(); store.set('pe.restoreExtra', extra);
    const prompt = restorePrompt(extra);
    const res = await runEngine({
      images: [S.base.toDataURL('image/jpeg', 0.95)], prompt, enhanced: true, hires: true,
      negative: '換臉，五官改變，構圖改變，新增物件，過度銳化，白邊光暈，塑膠皮膚，油畫感，卡通，文字，浮水印',
    });
    const img = await loadImage(res.image);
    // 輸出尺寸：維持原圖長寬比，取生成結果的解析度（不小於目前底圖），長邊最多 OUT_MAX
    const a = S.W / S.H;
    const long = Math.min(OUT_MAX, Math.max(img.naturalWidth, img.naturalHeight, S.W, S.H));
    const ow = Math.round(a >= 1 ? long : long * a), oh = Math.round(a >= 1 ? long / a : long);
    S.resultFull = coverTo(img, ow, oh);
    // 畫面上的工作畫布不超過 MAX_SIDE，儲存時用完整解析度
    const k = Math.min(1, MAX_SIDE / Math.max(ow, oh));
    growBase(Math.round(ow * k), Math.round(oh * k));
    S.result = k === 1 ? S.resultFull : coverTo(img, S.W, S.H);
    S.resultSaved = false; S.split = 0.5;
    $('#promptUsed').textContent = prompt;
    showScreen('result'); render(); vibrate(20);
  } catch (err) {
    toast('失敗：' + err.message, 6000);
  } finally { setBusy(false); }
};

// ---------- 結果 ----------
const modeScreen = () => S.mode === 'portrait' ? 'portrait' : S.mode === 'restore' ? 'restore' : 'edit';
$('#btnDiscard').onclick = () => {
  if (!S.resultSaved && !confirm('這次的結果還沒儲存，確定要放棄並重來嗎？')) return;
  S.result = S.resultFull = null; showScreen(modeScreen()); render();
};
// 繼續修：以結果為新底圖，留在原本的功能（形象照仍是形象照，移除路人仍是移除路人）
$('#btnKeep').onclick = () => {
  S.baseDirty = !S.resultSaved;
  S.base = S.result; S.result = S.resultFull = null; resetMask(); showScreen(modeScreen()); render(); updateGo();
  toast({ portrait: '已套用，可以調整服裝、背景或要求再生成一次', restore: '已套用，可以換個修復項目再修一次' }[S.mode] || '已套用，可以繼續圈選下一處');
};
$('#btnSave').onclick = () => {
  (S.resultFull || S.result).toBlob(async blob => {
    const file = new File([blob], `修圖達人-${Date.now()}.jpg`, { type: 'image/jpeg' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); S.resultSaved = true; return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    S.resultSaved = true;
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
  $('#setDeepseek').value = store.get('pe.deepseek');
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
$('#btnUsage').addEventListener('click', e => { e.preventDefault(); $('#settings').close('cancel'); renderUsage(); loadOrKey(); $('#usage').showModal(); });
$('#btnOrKeyRefresh').addEventListener('click', e => { e.preventDefault(); loadOrKey(); });
$('#usageRange').addEventListener('change', renderUsage);
$('#btnUsageCsv').addEventListener('click', e => { e.preventDefault(); exportUsage(); });
$('#btnUsageClear').addEventListener('click', e => { e.preventDefault(); if (confirm('確定清除這支手機上的所有用量紀錄？')) { saveUsage([]); renderUsage(); } });
$('#usage').addEventListener('click', e => { if (e.target === $('#usage')) $('#usage').close(); });
$('#btnOrRefresh').addEventListener('click', e => { e.preventDefault(); loadOrModels(); });
$('#setEngine').addEventListener('change', syncEngine);
$('#settings').addEventListener('click', e => { if (e.target === $('#settings')) $('#settings').close('cancel'); });
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'ok') return;
  store.set('pe.engine', $('#setEngine').value); store.set('pe.qwen', $('#setQwen').value.trim()); store.set('pe.qwenModel', $('#setQwenModel').value);
  store.set('pe.google', $('#setGoogle').value.trim()); store.set('pe.googleModel', $('#setGoogleModel').value);
  const orSel = $('#setOrModel'); store.set('pe.openrouter', $('#setOr').value.trim());
  if (orSel.value) { store.set('pe.orModel', orSel.value); store.set('pe.orModelName', orSel.selectedOptions[0]?.text || orSel.value); }
  store.set('pe.deepseek', $('#setDeepseek').value.trim());
  updateStatus(); toast('設定已儲存');
});

// 自動更新：每次回到 App 都檢查新版；新版接手時若不在編輯中就重新載入
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    if (S.screen === 'home' && !S.busy) { reloaded = true; location.reload(); }
    else toast('有新版本，下次開啟 App 時會套用');
  });
}
showScreen('home');
updateStatus();
