# 修圖達人（MVP）

手機網頁修圖 App（PWA，可加到主畫面）：上傳照片 → 用手指圈選 → AI 移除路人／物件。

## 運作方式

1. 前端用手指「圈選」或「塗抹」畫出遮罩（紅色區域）。
2. 後端呼叫 **DeepSeek**，把你的一句話需求改寫成給 Seedream 的精準編輯指令（可關閉，關閉時用內建範本）。
3. 後端呼叫 **Seedream**（火山方舟 `images/generations`），送兩張圖：圖1 原圖、圖2 紅色標記圖。
4. 前端把生成結果**只貼回圈選區域**（邊緣羽化），圈選範圍外保留原圖像素，避免 AI 改動其他地方。

> Seedream 4.x 沒有原生「遮罩」參數，所以採用「標記圖 + 指令 + 回貼合成」的作法。

## 線上使用（GitHub Pages）

網址：**https://eastsheep.github.io/photo-erase/**

推到 `main` 會自動用 GitHub Actions 部署 `public/`。這是純靜態網站，App 會自動進入「直連模式」：
API 金鑰只存在你手機的瀏覽器（設定頁填入），由網頁直接呼叫 DeepSeek / Seedream，**金鑰不會進到 repo**。

第一次開啟請到設定：生圖服務選 **fal.ai**（預設），填入 fal API Key（https://fal.ai/dashboard/keys），選模型：

| 模型 | 適合 | DeepSeek 指令 |
| --- | --- | --- |
| FLUX 專業消除（預設，fal-ai/flux-pro/v1/erase） | 移除路人、物件，最自然 | 不需要 |
| Seedream 4.5 編輯 | 移除後要補較複雜的背景、或想改內容 | 會用 |
| Seedream 4.0 編輯 | 同上，較便宜 | 會用 |
| Bria 專業消除 | 單純把東西擦掉，最貼合圈選範圍 | 不需要 |

也可切換回火山方舟 / BytePlus 直接呼叫 Seedream。DeepSeek Key 選填。

### 如果出現「連線失敗…CORS」

代表 API 不允許網頁直接呼叫，需要一個小代理：

1. 到 Cloudflare 後台 → Workers & Pages → Create Worker，把 `relay/worker.js` 整個貼上 → Deploy。
2. 程式預設只允許 `https://eastsheep.github.io` 使用；用瀏覽器打開 Worker 網址看到「代理運作中 ✓」就成功了。
3. App「設定 → 代理網址」填入 Worker 網址，例如 `https://photo-relay.xxx.workers.dev`。

代理只轉送，不保存金鑰。Cloudflare 免費方案每天 10 萬次請求，個人使用綽綽有餘。

## 本機啟動（選用：自架 Node 伺服器，金鑰放伺服器）

需要 Node.js 18 以上，不需安裝任何套件。

```bash
cp .env.example .env     # 填入 DEEPSEEK_API_KEY、ARK_API_KEY
npm start                # http://localhost:8787
npm run mock             # 不花錢的測試模式，不呼叫任何 API
```

## 金鑰安全

- 金鑰放在伺服器 `.env`，**不會**出現在網頁原始碼。
- 也可以讓伺服器不放金鑰，改在 App「設定」裡自行填入（只存在該手機瀏覽器，經你的伺服器轉送）。
- 部署到公開網址時，**務必設定 `APP_PASSWORD`**，否則任何知道網址的人都能用掉你的額度。

## 自架部署（選用）

任何能跑 Node 的平台都可以，例如 Render、Railway、Zeabur、Fly.io，或自己的電腦 + Cloudflare Tunnel。
啟動指令 `node server.js`，環境變數照 `.env.example` 設定。

加到主畫面：iPhone 用 Safari 開網址 → 分享 → 加入主畫面；Android 用 Chrome → 選單 → 安裝應用程式。

## 設定項目

| 變數 | 說明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 金鑰（沒有也能用，會改用固定範本提示詞） |
| `ARK_API_KEY` | 火山方舟 / BytePlus ModelArk 金鑰 |
| `ARK_BASE_URL` | 中國區 `https://ark.cn-beijing.volces.com/api/v3`；海外 BytePlus `https://ark.ap-southeast.bytepluses.com/api/v3` |
| `SEEDREAM_MODEL` | 你帳號開通的模型 ID，如 `doubao-seedream-4-0-250828`、`doubao-seedream-4-5-251128`（BytePlus 上 ID 可能不同，以控制台為準） |
| `APP_PASSWORD` | 使用密碼 |

## 已知限制

- 送出解析度約 400 萬像素，結果縮回工作解析度（長邊最多 2560）。
- 大面積移除時品質取決於 Seedream，可用「繼續修這張」分多次處理。
- 尚未支援雙指縮放，細部圈選可先調小筆刷。
