# 專案內 Umi-OCR 核心模組

這是從官方 GitHub 抽出程式碼的移植，不需要使用者安裝 Umi 桌面軟體。已完成核心來源、受監督的無介面 HTTP 層、Cloudflare 私有 Worker 接線及容器建置程式；**尚未發布原生容器映像或啟用正式 OCR**。獨立建置的設定與狀態見 [CLOUD-BUILDS.md](./CLOUD-BUILDS.md)；只有返回 404 的 bootstrap 不代表 OCR 可用。

## 實際匯入的來源

| 來源 | 專案位置 | 用途 |
| --- | --- | --- |
| Umi-OCR `ocr/tbpu/tbpu.py`、`parser_multi_line.py` | `umi_core/vendor/tbpu/` | 文字區塊處理與多欄排序入口 |
| Umi-OCR `parser_tools/line_preprocessing.py` | `umi_core/vendor/tbpu/parser_tools/` | 根據文字框方向做標準化 |
| Umi-OCR `parser_tools/gap_tree.py` | `umi_core/vendor/tbpu/parser_tools/` | GapTree 閱讀順序演算法 |
| Umi-OCR_plugins `PPOCR_api.py` | `umi_core/vendor/paddle/` | 原生 PaddleOCR-json 的 Python 呼叫介面 |

來源已固定 revision，而不是每次從 main 自動更新。精確來源與本地修改記錄在 [UPSTREAM.json](./UPSTREAM.json)。兩個來源的 MIT 授權全文保留在 `licenses/`。

上游只有一處相容性修改：`line_preprocessing.py` 的桌面 `umi_log` 改用 Python 標準 logging。桌面視窗、Qt、剪貼簿、使用者資料與上游 AI 外掛均未匯入。

## 專案整合層

`umi_core/core.py` 提供無介面的 `UmiOcrCore.recognize()`，輸入符合既有混合辨識圖片請求的 base64/options，輸出維持 `code`、`data`、文字、信心分數及四點文字框。

- 固定繁體中文設定，不接受使用者指定引擎路徑、模型路徑或任意啟動參數。
- 限制圖片大小、回傳區塊數、文字量與幾何座標；錯誤不回傳原生引擎的路徑、內容或例外詳情。
- 複製並清理每次的文字區塊，再使用真正抽出的 Umi 多欄解析器；不把另一筆請求的布局狀態保留給下一筆。
- 單一引擎的重疊呼叫會立即回報忙碌，避免無上限排隊。低信心分數保留，交給既有 SaaS 混合分流決定是否退回視覺 AI。
- `create_native_core()` 僅在明確提供實際引擎、模型目錄與繁體設定檔時啟動；import 或單元測試不會啟動或下載引擎。
- 核心不包含 AI 金鑰、AI 呼叫、資料庫或圖片儲存；新增的 HTTP listener 僅在容器內使用，不開放公開 Worker 路由。

## 新增容器層

- `umi_core/image_input.py`：真正解碼 PNG／JPEG／WebP，拒絕截斷圖片、動畫與超過 12MP／單邊 10,000 像素的圖片；上傳仍限 2MiB。
- `umi_core/supervisor.py`：原版 blocking pipe 放入可終止的子程序。啟動限 20 秒，暖機後辨識限 4 秒；Linux 逾時會終止整個程序群組，包括原生引擎。IPC 寫入卡住也有 watchdog，錯誤後可重建引擎。
- `umi_core/server.py`：限制 body 2.9MB、實際解碼、同時工作數與連線數；不接受檔案路徑、任意 URL 或用戶選擇的引擎參數。圖片只在記憶體中處理，不寫入資料庫、R2 或本機圖片檔。
- `worker/src/index.ts`：公開/default fetch 永遠 404；只由 `OcrService` named entrypoint 接受 `/api/ocr`。私有 service binding 才能使用。`workers_dev`、preview URL、公開 routes 與 SSH 均關閉。
- 容器啟動時 `enableInternet: false`，不把現有 AI key、LINE UID、登入 cookie、token 或任意 request headers 傳進容器。
- 試行固定最多 1 個 `standard-1` 容器、APAC placement、閒置 2 分鐘停止；Durable Object 只設停止 alarm，不儲存圖片、辨識文字、會員或租戶資料。忙碌立即回報，沒有無上限排隊。
- Worker 4.5 秒內退回不可用；現有 SaaS OCR＋AI 流程的 OCR 總預算仍是 5 秒。冷啟動可能走原本視覺 AI，不保證首次更快。
- `fetch_engine.py` / `native-artifacts.json` / `Dockerfile`：固定官方引擎、模型及 Python image；建置時驗證資產大小／SHA256，執行時不下載或自動更新。原生 C++ 引擎使用官方預編譯版本，不聲稱由我們重新編譯。
- `worker/scripts/predeploy.mjs`：部署前先檢查 Linux Docker、原生第三方授權檢點、建置映像並執行離線合成圖 smoke test。失敗即停止，避免 Wrangler 先啟用 Worker 再發現 image 無法建置。這不能使 Cloudflare 整體部署變成原子操作。

## 私有接線與沿用既有 AI

`backend/src/ai/hybrid-ocr.ts` 已支援 `UMI_OCR_WORKER` binding；設定缺少或 OCR 開關未開啟時，保持原有流程。binding 優先於舊的 HTTPS＋OCR token 選項。

以下只是**啟用時才加入後端設定的範例**，本次未修改後端正式 Wrangler 設定：

```jsonc
{
  "services": [
    // 保留原有 services，再追加這筆
    { "binding": "UMI_OCR_WORKER", "service": "smart-menu-ocr", "entrypoint": "OcrService" }
  ],
  "vars": { "HYBRID_OCR_ENABLED": "true" }
}
```

不要把現有 services／vars 整段取代。AI 仍由現有 MLM gateway 處理，不需要新 AI 金鑰或 OCR bearer key。會員權限、用量記錄、人工確認、點數及原有 LINE webhook 維持不變。

## 尚未完成／部署阻擋

1. **映像建置**：Windows 與既有 Ubuntu 都未找到 Docker／Podman。雲端已執行合成測試 stage 的 Docker build，首輪遭遇 Docker-in-Docker DNS 失敗；已修正建置網路接線，仍需核對完整建置結果。完整原生映像／container smoke test 尚未執行，也未驗證 Cloudflare CPU 上的 AVX／模型相容性。已在既有 Ubuntu 使用本次下載、驗證 SHA256 的官方原生引擎及繁體模型跑通合成圖；不是已部署的 Cloudflare 驗證。
2. **建置方式已確認**：使用者已同意獨立 Cloudflare Workers Builds，只發布 `services/ocr/` 的程式、授權及合成測試；不安裝系統 Docker、不發布整個 dirty checkout、不合併至 SaaS 的 main。CI 使用既有 GitHub 安裝與既有建置權杖，不複製 AI 金鑰。
3. **帳號與部署**：既有 Wrangler OAuth 能列出 containers（目前 0 個），但這不是付費方案／資源配額的完整驗證。只有封閉 bootstrap 已註冊，沒有 native container／租戶繫結、方案升級或正式 OCR 部署；正式 OCR 開關仍未開啟。
4. **PDF 工作**：容器目前只做圖片；先前 PDF HTTP adapter 僅供完整 Umi doc provider 使用。私有圖片 binding 明確拒絕 PDF，尚無 PDF 上傳入口、解析背景工作或持久任務。
5. **真實素材比較**：還需要同批名片／海報核對錯誤率、暖機／冷啟動總延遲、AI tokens 和容器費。沒有驗證省費或準確率改善，低品質或冷啟動 fallback 可能增加耗時。商品外觀判斷仍需視覺 AI。
6. **原生附帶第三方授權**：官方 binary archive 含 OpenCV、Intel MKL／OpenMP、ONNX 等 library，卻沒有相應 LICENSE／NOTICE 檔；不能視為都由 PaddleOCR-json 的 Apache 2.0 授權涵蓋。發布前仍需核對版本、補齊適用告示，guard 暫時阻擋發布。檢點見 `licenses/NATIVE-DEPENDENCIES.md`。

只安裝專案目錄內的 Python venv／Node 依賴，下載並驗證官方 binary／models，以現有 Ubuntu 做離線合成圖測試；未安裝桌面 Umi／系統 Docker、修改 AI 金鑰、處理使用者檔案或修改正式會員資料。建置資產 cache 受 `.gitignore`／`.dockerignore` 排除，不能直接提交其中的二進位或測試暫存。

Container 計費與 Workers Paid 有關；最終資格／用量尚需部署前核對，不能把可列資源當成已可部署。試行規格尚未依實際 OCR 記憶體或效益數字調整。

## 已驗證

```powershell
# 在 services/ocr 目錄執行；只用合成區塊及模擬引擎
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
# 在 worker 目錄（只是本機檢查／Worker 打包，不是容器建置）
npm.cmd run types
npm.cmd run check
npm.cmd run bundle:worker
```

Python 24 項通過，含原版排序、真實圖片解碼、原生程序模擬、IPC 卡住終止、重新啟動、HTTP 合約及建置資產驗證。單元測試的 OCR 輸出為模擬。

另外執行 `tests/linux_native_smoke.py`：官方真實 PaddleOCR-json v1.4.1、繁體模型與抽出的 Umi 排序，在既有 Ubuntu 辨識出合成圖片中的 `123`，輸出 1 個區塊。該次啟動約 3,009ms、辨識約 328ms；只是單次合成圖／本機 CPU 數字，不能當作名片準確率、Cloudflare 延遲或省費證明。

本機 SaaS 整合的後端指定 50 項（含私有 binding／Workers runtime 測試）、前端指定 10 項通過；這些混有其他既有變更的整合檔未一起提交到獨立服務分支。獨立服務自身的 Worker 12 項測試（含 CI 建置網路、controller 探測與 runtime 禁網路分離）、型別檢查及僅 Worker 的 dry-run 通過；完整 container dry-run 因缺 Docker 受阻。新增 Worker 使用獨立 Wrangler 4.148.0／Miniflare 5 runtime，以測試今日相容日期；現有後端 Wrangler／相容日期未升級。較廣名片回歸的 3 項尚未解決，不能宣稱全站回歸全數通過。

獨立工具鏈以 `overrides` 固定 sharp 0.35.5，修復 GHSA-wq5f-xc86-pv6w；2026-10-07 重跑 audit 為 0 項，Worker 測試現為 12／12 通過。沒有套用 `audit fix --force` 或更動現有 SaaS 的 lockfile。

## 官方參考

- [Umi-OCR 專案與程式結構](https://github.com/hiroi-sora/Umi-OCR)
- [Umi OCR 原生引擎呼叫來源](https://github.com/hiroi-sora/Umi-OCR_plugins/blob/a07d80adf4e4612240db4e9dba19bde188729edd/win_linux_PaddleOCR-json/PPOCR_api.py)
- [Cloudflare Node.js 相容性：non-functional stub modules](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Containers 計費](https://developers.cloudflare.com/containers/platform/pricing/)
