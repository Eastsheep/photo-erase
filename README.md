# 修圖達人

手機網頁修圖 App（PWA，可加到主畫面）：上傳照片 → 用手指圈選 → AI 移除路人／物件。

網址：**https://eastsheep.github.io/photo-erase/**

## 運作方式

1. 用手指「圈選」或「塗抹」標出要修改的範圍（紅色區域），可雙指縮放細修。
2. （選填）**DeepSeek** 把你的一句話需求改寫成精準的修圖指令。
3. 修圖引擎收到原圖、紅色標記圖和指令，生成修好的照片：預設 **Qwen Cloud · Qwen Image**（新加坡區），也可切換 **Google Nano Banana** 或 **OpenRouter**（自選模型）。
4. App 只把結果貼回你圈選的範圍（邊緣羽化），其他地方保留原圖像素。

## 職場形象照

首頁上方可切換「移除路人／職場形象照」兩種模式，相簿與拍照按鈕依目前模式開啟（形象照拍照預設前鏡頭）。形象照：上傳一張生活照，選服裝（深色西裝、白襯衫、商務休閒、保留原服裝）與背景（淺灰棚拍、純白、辦公室虛化、深藍），可再輸入自訂要求（例如微笑一點、打藍色領帶，會優先照做），App 把整張照片送給目前設定的修圖引擎重繪成專業形象照，提示詞要求保留本人臉型、五官、膚色與髮型，只換服裝、背景與打光。不經過 DeepSeek，每次生成的費用與一般修圖相同（一張圖）。保留五官的效果以 Nano Banana Pro／2.1 較穩定。

## 設定

App 右上角「設定」：

| 欄位 | 說明 |
| --- | --- |
| 修圖引擎 | Qwen Cloud（預設）、Google Nano Banana、OpenRouter |
| OpenRouter API Key | 用 OpenRouter 時需要，按「更新清單」抓可修圖的模型 |
| Qwen Cloud API Key | 在 Qwen Cloud 控制台（新加坡區 ap-southeast-1）建立，按張計費 |
| Google Gemini API Key | 用 Nano Banana 時才需要，專案需開通 Billing |
| 模型 | 依引擎顯示 |
| DeepSeek API Key | 選填，填了才會用 DeepSeek 優化指令 |

金鑰只存在你的手機瀏覽器，不會進到 repo。

**用量統計**：設定頁的「用量統計」上方顯示 OpenRouter 官方的今天／本週／本月／累計花費與額度（`GET /api/v1/key`，用一般 Key 即可），下方是本機紀錄：記錄每次修圖的模型、tokens 與花費（OpenRouter 取回應的 `usage.cost`，沒有時用 `/api/v1/generation` 回查；DeepSeek 記 tokens；Qwen、Google 只記次數），可看今天／本月合計、依模型分組，並匯出 CSV。紀錄只存在這支手機的瀏覽器。

**Qwen Cloud**：呼叫 `https://ap-southeast-1.maas.qwencloudapi.com/api/v1/services/aigc/multimodal-generation/generation`。模型：`qwen-image-3.0-pro`（預設）、`qwen-image-2.1-pro`、`qwen-image-2.1-turbo`、`qwen-image-2.0-pro`、`qwen-image-2.0`。回傳的圖片網址 24 小時內有效，App 會立即下載。

**Google Nano Banana**：`gemini-nano-banana-2.1`（預設）、`gemini-3.1-flash-image`、`gemini-3.1-flash-lite-image`、`gemini-3-pro-image`、`gemini-2.5-flash-image`。呼叫 `/v1beta/interactions`，不支援時退回 `generateContent`。

**OpenRouter**：設定頁從 `GET /api/v1/images/models`（失敗改用 `/api/v1/models?output_modalities=image`）抓清單，只列出「可輸入圖片＋輸出圖片」的模型。修圖呼叫 `POST /api/v1/images`（`input_references` 帶原圖與標記圖），不支援時退回 `/api/v1/chat/completions` 的圖片輸出。

## 部署

- 前端：推到 `main` 會由 GitHub Actions 把 `public/` 部署到 GitHub Pages。

加到主畫面：iPhone 用 Safari 開網址 → 分享 → 加入主畫面；Android 用 Chrome → 選單 → 安裝應用程式。
