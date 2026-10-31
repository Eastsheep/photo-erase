'use strict';
const $ = s => document.querySelector(s);
const MAX_SIDE = 2560;          // 編輯用工作解析度上限
const TARGET_PIXELS = 2048 * 2048; // 送給 Seedream 的像素量（同時符合 4.0 / 4.5 下限）

const store = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const S = {
  W: 0, H: 0,
  base: null,      // 目前底圖 canvas
  mask: null,      // 遮罩 canvas（白色＝要修改）
  result: null,    // 合成後結果 canvas
  history: [],
  tool: 'lasso',
  drawing: false, pts: [], last: null,
  showOriginal: false,
  serverCfg: {},
};

const view = $('#view'); const vctx = view.getContext('2d');

function canvas(w = S.W, h = S.H) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function busy(on, text = '處理中…') { $('#busy').hidden = !on; $('#busyText').textContent = text; document.querySelectorAll('button').forEach(b => b.disabled = on); }

// ---------- 載入圖片 ----------
$('#fileInput').addEventListener('change', async e => {
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
    $('#empty').hidden = true; $('#editor').hidden = false;
    setMode('edit'); render();
  };
  img.onerror = () => toast('無法讀取這張圖片');
  img.src = url;
  e.target.value = '';
});
$('#btnNew').onclick = () => $('#fileInput').click();

function resetMask() { S.mask = canvas(); S.history = []; }

// ---------- 繪製畫面 ----------
function render(preview) {
  vctx.globalCompositeOperation = 'source-over';
  vctx.clearRect(0, 0, S.W, S.H);
  if (S.result && !S.showOriginal) { vctx.drawImage(S.result, 0, 0); return; }
  vctx.drawImage(S.base, 0, 0);
  if (S.result) return; // 對照原圖時不顯示遮罩
  const tint = canvas(); const t = tint.getContext('2d');
  t.drawImage(S.mask, 0, 0); t.globalCompositeOperation = 'source-in';
  t.fillStyle = 'rgba(255,60,50,0.55)'; t.fillRect(0, 0, S.W, S.H);
  vctx.drawImage(tint, 0, 0);
  if (preview && S.pts.length > 1) {
    vctx.save(); vctx.lineWidth = Math.max(3, S.W / 300); vctx.strokeStyle = '#ffb04e';
    vctx.setLineDash([vctx.lineWidth * 3, vctx.lineWidth * 2]);
    vctx.beginPath(); vctx.moveTo(S.pts[0].x, S.pts[0].y); S.pts.forEach(p => vctx.lineTo(p.x, p.y)); vctx.stroke(); vctx.restore();
  }
}

// ---------- 手指圈選 / 塗抹 ----------
function pos(e) {
  const r = view.getBoundingClientRect();
  return { x: (e.clientX - r.left) * S.W / r.width, y: (e.clientY - r.top) * S.H / r.height, scale: S.W / r.width };
}
function pushHistory() { S.history.push(S.mask.getContext('2d').getImageData(0, 0, S.W, S.H)); if (S.history.length > 20) S.history.shift(); }
function strokeTo(p) {
  const m = S.mask.getContext('2d');
  m.globalCompositeOperation = S.tool === 'erase' ? 'destination-out' : 'source-over';
  m.strokeStyle = m.fillStyle = '#fff'; m.lineCap = m.lineJoin = 'round';
  m.lineWidth = Number($('#brushSize').value) * p.scale;
  m.beginPath(); m.moveTo(S.last.x, S.last.y); m.lineTo(p.x + 0.01, p.y); m.stroke();
  S.last = p;
}
view.addEventListener('pointerdown', e => {
  if (S.result || !S.base) return;
  if (!e.isPrimary) return;
  view.setPointerCapture(e.pointerId);
  S.drawing = true; pushHistory();
  const p = pos(e); S.pts = [p]; S.last = p;
  if (S.tool !== 'lasso') strokeTo(p);
  render(true);
});
view.addEventListener('pointermove', e => {
  if (!S.drawing) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs) { const p = pos(ev); if (S.tool === 'lasso') S.pts.push(p); else strokeTo(p); }
  render(true);
});
function endDraw() {
  if (!S.drawing) return; S.drawing = false;
  if (S.tool === 'lasso') {
    if (S.pts.length > 4) {
      const m = S.mask.getContext('2d'); m.globalCompositeOperation = 'source-over'; m.fillStyle = '#fff';
      m.beginPath(); m.moveTo(S.pts[0].x, S.pts[0].y); S.pts.forEach(p => m.lineTo(p.x, p.y)); m.closePath(); m.fill();
      // 邊緣也加一點筆觸，避免圈得太貼
      m.lineWidth = Math.max(6, S.W / 150); m.strokeStyle = '#fff'; m.lineJoin = 'round'; m.stroke();
    } else S.history.pop();
  }
  S.pts = []; render();
}
view.addEventListener('pointerup', endDraw);
view.addEventListener('pointercancel', endDraw);

document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
  S.tool = b.dataset.tool; document.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('on', x === b));
});
$('#btnUndo').onclick = () => { const h = S.history.pop(); if (h) { S.mask.getContext('2d').putImageData(h, 0, 0); render(); } };
$('#btnClear').onclick = () => { pushHistory(); S.mask.getContext('2d').clearRect(0, 0, S.W, S.H); render(); };

function maskIsEmpty() {
  const small = canvas(64, 64); small.getContext('2d').drawImage(S.mask, 0, 0, 64, 64);
  const d = small.getContext('2d').getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
  return true;
}

// ---------- 呼叫後端 ----------
function headers() {
  const h = { 'Content-Type': 'application/json' };
  const pw = store.get('pe.password'); if (pw) h['X-App-Password'] = pw;
  const dk = store.get('pe.deepseek'); if (dk) h['X-DeepSeek-Key'] = dk;
  const ak = store.get('pe.ark'); if (ak) h['X-Ark-Key'] = ak;
  const md = store.get('pe.model'); if (md) h['X-Seedream-Model'] = md;
  return h;
}
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: `伺服器回應異常 (${r.status})` }));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}

// ---------- 直連模式（GitHub Pages 等純靜態網站用，金鑰只存在這支手機） ----------
const ARK_BASES = {
  cn: 'https://ark.cn-beijing.volces.com/api/v3',
  intl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
};
const DEFAULT_MODEL = { cn: 'doubao-seedream-4-0-250828', intl: 'seedream-4-0-250828' };
const SYSTEM_PROMPT = `你是專業的影像編輯提示詞工程師，負責為「Seedream」圖像編輯模型撰寫指令。
情境：使用者會提供兩張圖。圖1 是原始照片；圖2 是同一張照片，但需要修改的區域被塗上了不透明的紅色遮罩。
你的任務：把使用者簡短的需求，改寫成一段清楚、具體、可直接給 Seedream 的繁體中文編輯指令。
撰寫原則：
1. 明確說明「依照圖2紅色標記的位置，修改圖1對應區域」。
2. 若是移除（路人、物件、雜物、文字、電線等），要求以周圍環境（地面、牆面、天空、植物等的材質、光線、透視、陰影、雜訊顆粒）無縫自然地補全背景，不留殘影、輪廓或陰影。
3. 強調紅色區域以外的內容（人物、構圖、色調、解析度）完全保持不變，輸出圖不得出現任何紅色遮罩痕跡。
4. 輸出寫實照片風格，不加浮水印、文字或新物件（除非使用者要求）。
只輸出最終指令本身，不要任何解釋、引號或前後綴，長度 80–200 字。`;

function relayBase() { return store.get('pe.relay').replace(/\/+$/, ''); }
function region() { return store.get('pe.region', 'cn') === 'intl' ? 'intl' : 'cn'; }
function netError(what, e) {
  return new Error(`${what} 連線失敗（${e.message}）。若是被瀏覽器擋下（CORS），請在設定填入「代理網址」，見 README 的 Cloudflare Worker 說明`);
}
async function directJson(url, key, body, what) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  } catch (e) { throw netError(what, e); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${what} 錯誤：${data?.error?.message || r.status}`);
  return data;
}
async function enhanceDirect(instruction) {
  const key = store.get('pe.deepseek');
  if (!key) return fallbackPrompt(instruction);
  const url = relayBase() ? `${relayBase()}/deepseek/chat/completions` : 'https://api.deepseek.com/chat/completions';
  const data = await directJson(url, key, {
    model: 'deepseek-chat', temperature: 0.4, max_tokens: 400,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `使用者需求：${instruction || '移除圈選範圍內的路人與物件'}` }],
  }, 'DeepSeek');
  return data?.choices?.[0]?.message?.content?.trim() || fallbackPrompt(instruction);
}
async function inpaintDirect({ image, marked, prompt, size }) {
  const key = store.get('pe.ark');
  if (!key) throw new Error('請先到「設定」填入 Seedream API Key');
  const rg = region();
  const url = relayBase() ? `${relayBase()}/ark-${rg}/images/generations` : `${ARK_BASES[rg]}/images/generations`;
  const data = await directJson(url, key, {
    model: store.get('pe.model') || DEFAULT_MODEL[rg], prompt, image: [image, marked], size,
    sequential_image_generation: 'disabled', response_format: 'b64_json', watermark: false,
  }, 'Seedream');
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('Seedream 未回傳圖片');
  return { image: `data:image/jpeg;base64,${b64}` };
}

// 依部署環境自動選擇：有自己的 Node 伺服器 → 走 /api；純靜態（GitHub Pages）→ 直連
const backend = {
  enhance: instruction => S.mode === 'server' ? api('api/enhance', { instruction }).then(d => d.prompt) : enhanceDirect(instruction),
  inpaint: body => S.mode === 'server' ? api('api/inpaint', body) : inpaintDirect(body),
};
function fallbackPrompt(instruction) {
  const want = (instruction || '移除路人與多餘物件').trim();
  return `請參考圖2中紅色標記的區域，對圖1的相同位置進行修改：${want}。以周圍環境的材質、光線、透視與陰影無縫自然地補全背景，不留任何殘影或輪廓；紅色區域以外的內容、構圖與色調完全保持不變；輸出為寫實照片，畫面中不得出現紅色遮罩或任何文字浮水印。`;
}
function seedreamSize() {
  const a = S.W / S.H;
  let w = Math.sqrt(TARGET_PIXELS * a), h = w / a;
  const k = Math.min(1, 4096 / Math.max(w, h)); w *= k; h *= k;
  const r16 = v => Math.max(16, Math.round(v / 16) * 16);
  return `${r16(w)}x${r16(h)}`;
}
function loadImage(src) { return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('結果圖片無法載入')); i.src = src; }); }

// 把生成結果只貼回遮罩區域（邊緣羽化），遮罩外保留原圖像素
function composite(genImg) {
  const gen = canvas(); gen.getContext('2d').drawImage(genImg, 0, 0, S.W, S.H);
  // 縮小再放大＝便宜又跨瀏覽器的模糊，用來做羽化邊緣
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

$('#btnGo').onclick = async () => {
  if (maskIsEmpty()) return toast('請先用手指圈出要移除的範圍');
  const instruction = $('#instruction').value;
  try {
    let prompt = fallbackPrompt(instruction);
    if ($('#useDeepseek').checked) {
      busy(true, 'DeepSeek 正在優化提示詞…');
      prompt = await backend.enhance(instruction);
    }
    busy(true, 'Seedream 生圖中，約需 10–40 秒…');
    const image = S.base.toDataURL('image/jpeg', 0.92);
    const marked = canvas(); const mc = marked.getContext('2d');
    mc.drawImage(S.base, 0, 0);
    const red = canvas(); const rc = red.getContext('2d'); rc.drawImage(S.mask, 0, 0);
    rc.globalCompositeOperation = 'source-in'; rc.fillStyle = '#ff0000'; rc.fillRect(0, 0, S.W, S.H);
    mc.drawImage(red, 0, 0);
    const res = await backend.inpaint({ image, marked: marked.toDataURL('image/jpeg', 0.92), prompt, size: seedreamSize() });
    S.result = composite(await loadImage(res.image));
    $('#promptUsed').textContent = prompt; $('#promptUsedBox').hidden = false;
    setMode('result'); render();
    if (res.mock) toast('目前是 MOCK 測試模式，未真正呼叫 Seedream');
  } catch (err) {
    toast('失敗：' + err.message, 5000);
  } finally { busy(false); }
};

// ---------- 結果操作 ----------
function setMode(m) {
  const edit = m === 'edit';
  $('#drawTools').hidden = !edit; $('#promptRow').hidden = !edit; $('#resultRow').hidden = edit;
}
const cmp = $('#btnCompare');
const showOrig = on => { S.showOriginal = on; render(); };
cmp.addEventListener('pointerdown', () => showOrig(true));
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => showOrig(false)));
$('#btnDiscard').onclick = () => { S.result = null; setMode('edit'); render(); };
$('#btnKeep').onclick = () => { S.base = S.result; S.result = null; resetMask(); setMode('edit'); render(); toast('已套用，可以繼續圈選下一處'); };
$('#btnSave').onclick = () => {
  S.result.toBlob(async blob => {
    const file = new File([blob], `修圖達人-${Date.now()}.jpg`, { type: 'image/jpeg' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/jpeg', 0.95);
};

// ---------- 設定 ----------
async function loadServerCfg() {
  try {
    const r = await fetch('api/config');
    S.serverCfg = r.ok && (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
  } catch { S.serverCfg = null; }
  const c = S.serverCfg;
  S.mode = c ? 'server' : 'direct';
  document.querySelectorAll('.server-only').forEach(el => el.hidden = S.mode !== 'server');
  document.querySelectorAll('.direct-only').forEach(el => el.hidden = S.mode !== 'direct');
  if (!c) {
    $('#serverStatus').textContent = '直連模式：金鑰只存在這支手機的瀏覽器，直接呼叫 DeepSeek / Seedream。';
    if (!store.get('pe.ark')) { toast('第一次使用：請先在「設定」填入 API Key', 4000); openSettings(); }
    return;
  }
  $('#serverStatus').textContent = c.mock ? '伺服器：MOCK 測試模式'
    : `伺服器金鑰：DeepSeek ${c.hasDeepseekKey ? '✓' : '✗'}　Seedream ${c.hasArkKey ? '✓' : '✗'}　模型 ${c.model || '-'}`;
  if (c.needPassword && !store.get('pe.password')) openSettings();
  else if (!c.mock && !c.hasArkKey && !store.get('pe.ark')) { toast('請先到「設定」填入 Seedream API Key', 4000); }
}
function openSettings() {
  $('#setPassword').value = store.get('pe.password'); $('#setDeepseek').value = store.get('pe.deepseek');
  $('#setArk').value = store.get('pe.ark'); $('#setModel').value = store.get('pe.model');
  $('#setRegion').value = region(); $('#setRelay').value = store.get('pe.relay');
  $('#settings').showModal();
}
$('#btnSettings').onclick = openSettings;
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'ok') return;
  store.set('pe.password', $('#setPassword').value.trim()); store.set('pe.deepseek', $('#setDeepseek').value.trim());
  store.set('pe.ark', $('#setArk').value.trim()); store.set('pe.model', $('#setModel').value.trim());
  store.set('pe.region', $('#setRegion').value); store.set('pe.relay', $('#setRelay').value.trim());
  toast('設定已儲存');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
loadServerCfg();
