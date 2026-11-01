# 修圖達人

手機網頁修圖 App（PWA，可加到主畫面）：上傳照片 → 用手指圈選 → AI 移除路人／物件。

網址：**https://eastsheep.github.io/photo-erase/**

## 運作方式

1. 用手指「圈選」或「塗抹」標出要修改的範圍（紅色區域），可雙指縮放細修。
2. （選填）**DeepSeek** 把你的一句話需求改寫成精準的修圖指令。
3. **Google Nano Banana**（Gemini API）收到原圖、紅色標記圖和指令，生成修好的照片。
4. App 只把結果貼回你圈選的範圍（邊緣羽化），其他地方保留原圖像素。

## 設定

App 右上角「設定」：

| 欄位 | 說明 |
| --- | --- |
| Google Gemini API Key | 必填，在 https://aistudio.google.com/apikey 建立。圖片模型沒有免費額度，專案需開通付費（Billing） |
| 模型 | 見下表 |
| DeepSeek API Key | 選填，填了才會用 DeepSeek 優化指令 |
| 代理網址 | 選填，只有連線被瀏覽器擋下時才需要 |

金鑰只存在你的手機瀏覽器，不會進到 repo。

| 模型 ID | 說明 |
| --- | --- |
| `gemini-nano-banana-2.1`（預設） | Nano Banana 2.1，Google 建議的新版 |
| `gemini-3.1-flash-image` | Nano Banana 2，較快較省 |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite，最快最便宜，只輸出 1K |
| `gemini-3-pro-image` | Nano Banana Pro，最高畫質 |
| `gemini-2.5-flash-image` | Nano Banana 舊版 |

呼叫 Google 的 Interactions API（`/v1beta/interactions`），不支援時自動退回 `generateContent`。

## 部署

- 前端：推到 `main` 會由 GitHub Actions 把 `public/` 部署到 GitHub Pages。
- 代理（選用）：`relay/worker.js` 是 Cloudflare Worker，只轉送 DeepSeek 與 Google 的請求、不保存金鑰，預設只允許 `https://eastsheep.github.io` 使用。`wrangler.jsonc` 讓 Cloudflare 連 repo 自動部署。

加到主畫面：iPhone 用 Safari 開網址 → 分享 → 加入主畫面；Android 用 Chrome → 選單 → 安裝應用程式。
