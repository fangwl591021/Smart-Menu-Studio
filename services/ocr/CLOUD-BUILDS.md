# 獨立 OCR 雲端建置

2026-10-07：使用者同意只推送 OCR 程式並設定 Cloudflare Workers Builds，
不安裝系統 Docker、不更動正式 AI 金鑰與租戶資料。

## 建置契約

- Repository：`fangwl591021/Smart-Menu-Studio`。
- OCR 分支：`codex/umi-ocr-cloud-builds`；不推送／合併到 `main`。
- Worker：`smart-menu-ocr`，與 SaaS 的 `smart-menu-backend`／`smart-menu-frontend` 分開。
- Cloudflare account：`8058cf61f0cd44c4edd78080b193033a`。
- Root directory：`services/ocr/worker`。
- Build command：`npm run build:ci`。
- Deploy command：`npm run deploy`（保留 npm 的 predeploy 檢查，不直接呼叫 Wrangler 跳過）。
- Build variable：`NODE_VERSION=24.14.1`，不設定 AI 金鑰／會員資料。
- Include watch path：`services/ocr/*`（已移除 `*`）；只監看新 OCR 模組。
- 非 OCR 分支預覽建置關閉；不要讓這個 Worker 跟著 SaaS main 更新。
- 沿用既有 GitHub 安裝與 Workers Builds 權杖。缺權限時停止，不擴權或新增權杖。

`build:ci` 檢查 Worker 型別、12 項 Worker／guard 測試，並建置 Docker 的
`unit-tests` stage 以非 root、`RUN --network=none` 執行 24 項合成 Python 測試。
該 stage 不包含／下載原生引擎，不掛載租戶儲存。Cloudflare Builds 無法直接
使用內層 `docker run`，因此檢查放在 BuildKit 建置階段，並由外層建置配額
管理資源；沒有修改主機 cgroup／權限。source checks 成功不代表原生 OCR 可用。

真正的 `deploy` 先檢查原生第三方告示、Docker、建置正式映像；最終映像的
非 root、禁網路 RUN step 使用合成圖片跑真實引擎，全部通過才呼叫 Wrangler。
這仍不是正式 Container 執行環境的驗證。告示仍未核對完成，
目前部署應被 `OCR_DEPLOY_BLOCKED` 阻擋，而不是假裝辨識成功。

## 初始化

為在不使用 SaaS main 的情況下連接分支，可先用 `wrangler.bootstrap.jsonc`
註冊封閉的 Worker。bootstrap 所有請求只回 404：沒有 container／DO／AI／
D1／R2／secret／公開路由，不是 OCR 部署。初始化完成後，Cloudflare Builds
必須指向上述 OCR 分支與正常 `wrangler.jsonc`，不得留用 bootstrap 作為正式 OCR。

## 既有 SaaS 的 CI

2026-10-07 唯讀核對：既有 `smart-menu-backend` 的 production branch 是 main，
root 是 backend，非生產分支啟用且命令為 `wrangler versions upload`。
因此新增 OCR 分支可能啟動既有 SaaS 的預覽建置，但不應提升為正式部署。
本任務不改既有 SaaS 的分支／監看路徑／金鑰／資源設定；發布後需核對正式部署
仍是原版本，不能把預覽建置誤認為 OCR 建置。

## 發布範圍

分支只加入 `services/ocr/` 下已列入 Git 的來源／授權／合成測試／設定。
不包含本機下載的 native binary／models／cache／venv／node_modules／環境檔，
也不包含工作目錄內其他 CRM、會員、點數、LINE 或管理介面變更。
既有 SaaS 的混合 adapter 仍為本機接線，正式 OCR switch 尚未開啟。

## 狀態

2026-10-07 已完成：

- 來源提交 `4d5dc02fe6595e06499b60185792894be370630e` 已推送到 OCR 專用分支，
  只新增 `services/ocr/` 的 43 個檔案；未改 main／目前 checkout／原索引。
- 封閉 bootstrap 已註冊，版本 `16f43fe0-1358-408a-9862-a3c68271c720`；
  所有入口 404，沒有 native container 或租戶資源連線。
- Cloudflare dashboard 已儲存 GitHub Builds 連線、上述 root／command／Node
  設定與監看路徑；OCR Worker 的非生產分支預覽建置已關閉。
- 沿用既有 Builds 權杖；未新增權杖、擴大權限或安裝本機 Docker。
- 本機 Worker／guard 12 項、Python 合成測試 24 項通過，工具鏈 npm audit 0 項。
  雲端 Docker stage 尚待完整實際建置，不能以本機測試替代。
- 首次雲端建置 `6c0d775c-decf-4e5a-8b22-be564f88c72d` 已確實執行 Docker，
  但 Python 套件安裝遭遇 Docker-in-Docker DNS 失敗。建置腳本已改為沿用
  Wrangler 的既有 `WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST` 設定；沒有新增
  dashboard 網路權限／變數，也沒有改動 runtime 的 `--network none`。
- 第二輪 `4e6367c3-bbac-4150-93de-bee207d08453` 已修正 DNS 並建出測試映像，
  但內層 Docker 無 CPU CFS controller。CI 現在先唯讀探測 controller 支援，
  只設定實際可用的內層資源限制；外層 Workers Builds 配額仍由平台管理。
  未知／失敗的探測會停止。正式 Container 規格、禁網路、唯讀、cap-drop、
  no-new-privileges 均不變；此 CI 測試不掛載客戶資料或 AI 金鑰。
- 第三輪 `348fa8ba-63e8-40b1-a29e-0e5e44b293f2` 的 whole-info JSON 探測
  未通過嚴格檢查而安全停止。改以明確格式只讀取三個 true／false，避免
  整份 JSON 的欄位呈現差異；格式異常仍停止，不能把未知當作不支援。
- 第四輪 `d45b8a95-915f-492d-8b3f-e03c518f2d19` 明確證實三個內層
  controller 均 false；即使未設定內層限額，`docker run` 仍因 cgroup 路徑
  不存在失敗。因此移除這條不適用的執行方式與探測 helper，改由 BuildKit
  的離線／非 root RUN step 驗證。沒有更改主機權限或嘗試 cgroupns 繞過。

原生函式庫告示核對仍未完成：詳見 `licenses/NATIVE-DEPENDENCIES.md`。
不可將註冊 bootstrap、source checks 或成功 push 當作正式 OCR 已啟用。

官方依據：
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)、
[Container 部署](https://developers.cloudflare.com/containers/guides/deploy/)、
[Docker-in-Docker 建置網路](https://developers.cloudflare.com/containers/faq/#can-i-run-docker-inside-a-container-docker-in-docker)。
