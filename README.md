# TWTrain 光復隧道監測資訊整合系統 POC

本專案是花蓮縣光復隧道北口擋土牆溢淹預警監測資訊整合系統的第一版 HTML5 POC。

## 目前內容

- `index.html`：可直接開啟的靜態展示頁。
- `js/simulation-engine.js`：12 小時、每分鐘一筆的瀏覽器端模擬器。
- `js/app.js`：地圖、儀表板、CCTV、查詢、統計、介接與設定頁面，含 EMAP01 / ESRI / OSM 底圖切換與 2D/3D 圖台切換。
- `docs/cost-estimate.html`：參考台鐵單價分析表格式完成的資訊系統全部費用估算。
- `data/hualien-railway-layers.*`：由 `ref/geojson` 轉換出的花蓮區域台鐵鐵道設施 WGS84 疊圖資料。

## 展示方式

建議以本機靜態伺服器預覽，例如在專案根目錄執行 `python -m http.server 8000` 後開啟 `http://127.0.0.1:8000/index.html`。CesiumJS CDN 可用時預設顯示光復隧道周邊 3D 圖台，並可切換 2D；若外部資源不可用，頁面會改用同一份狀態資料繪製 SVG 示意圖。

## 重要界線

- POC 使用示意座標，所有監測點標記為 `location_source=PLAN`。
- POC 不包含正式 GNSS 座標、現場設備序號、NVR 帳密、VPN、資料庫密碼、Cesium Ion token 或台鐵內部 API。
- 正式系統門檻值、通報程序與行動管理流程，需於現勘、設備送審、試運轉與機關審查後確認。

## 來源使用

本次開發參考工作區 `ref` 內的規格、契約圖說、台鐵 GeoJSON 與單價分析表格式。原始來源檔不納入 Git 版本提交。
