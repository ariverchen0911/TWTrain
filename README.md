# TWTrain 光復隧道監測資訊整合系統 POC

本專案是花蓮縣光復隧道北口擋土牆溢淹預警監測資訊整合系統的 HTML5 POC，目前版本 **v1.3.0（2026-09-23）**。

## v1.3.0 更新

- 新增登入入口、預設示範帳密 `geoinfor / 84234755`、隨機四碼動態驗證碼及錯誤重試限制。
- 通過驗證後才初始化圖台；桌面與手機均可登出並返回登入頁。
- 登入僅在瀏覽器端執行，帳密寫在靜態 JavaScript 中，只適用於 POC 展示，不具正式身份驗證或存取控制能力。
- 詳見 `docs/version-history.html`。

## v1.2.0 更新（2026-09-20）

- 預設直接顯示 EMAP01 灰階底圖，朝北定位於光復隧道北口；操作中心超出北口周邊界限後自動返回。
- 接入 Esri WorldElevation3D / Terrain3D 全球 DEM，圖層貼地；支援失敗狀態與重試。
- 全花蓮 8,087 筆來源保留；圖台僅繪製北向導航範圍包絡相交的 141 筆，減少 2D / 3D 貼地幾何重建負擔。
- 地圖左上新增返回初始範圍按鈕；修復資訊面板關閉及數值更新。
- 修正桌面 / 平板 / 手機版面、查詢與 CSV 的時間條件、門檻驗證、累積雨量及設備統計。
- 版本、完整性差異及測試結果請開啟 `docs/version-history.html`。

## 目前內容

- `index.html`：可直接開啟的靜態展示頁。
- `js/simulation-engine.js`：12 小時、每分鐘一筆的瀏覽器端模擬器。
- `js/app.js`：地圖、儀表板、CCTV、查詢、統計、介接與設定頁面，含 EMAP01 / ESRI / OSM 底圖切換與 2D/3D 圖台切換。
- `docs/cost-estimate.html`：參考台鐵單價分析表格式完成的資訊系統全部費用估算。
- `data/hualien-railway-layers.*`：由 `ref/geojson` 轉換出的花蓮區域台鐵鐵道設施 WGS84 疊圖資料。

## 展示方式

建議以本機靜態伺服器預覽，例如在專案根目錄執行 `python -m http.server 8000` 後開啟 `http://127.0.0.1:8000/index.html`。CesiumJS CDN 可用時預設顯示光復隧道周邊 3D 圖台，並可切換 2D；若外部資源不可用，頁面會改用同一份狀態資料繪製 SVG 示意圖。

DEM 與底圖需網路。預設視角與範圍集中管理於 `GFTData.map`；`home` 是北口示意目標，`homeBounds` 是 2D 初始範圍，`navigationBounds` 是操作中心界限。DEM 並非工程測量高程，固定日光也不代表即時日照。

## 驗證

靜態頁面不需 npm 才能執行。開發回歸可使用 Node.js：

```sh
npm install
npm test
npm run test:browser
```

瀏覽器測試需先啟動上述本機伺服器，預設使用 Windows Chrome。其他環境可用 `GFT_CHROME` 指定 Chromium 執行檔、`GFT_URL` 指定網站。v1.2.0 結果與截圖保留於 `outputs/qa/v1.2.0/`（不提交 Git）。

本版仍為瀏覽器端模擬：登入權限、正式 NVR、後端 API、資料庫、告警處置流程與月報未完成。完整性檢視已逐項區分。

## 重要界線

- POC 使用示意座標，所有監測點標記為 `location_source=PLAN`。
- POC 不包含正式 GNSS 座標、現場設備序號、NVR 帳密、VPN、資料庫密碼、Cesium Ion token 或台鐵內部 API。
- 正式系統門檻值、通報程序與行動管理流程，需於現勘、設備送審、試運轉與機關審查後確認。

## 來源使用

本次開發參考工作區 `ref` 內的規格、契約圖說、台鐵 GeoJSON 與單價分析表格式。原始來源檔不納入 Git 版本提交。
