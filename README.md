# 執行進度管控表

這是一個以 Flask + 原生前端實作的工作項目與執行進度追蹤工具，資料預設儲存在本機 `db.json`，也可選擇同步進度填報到 Google Sheets。

## 功能特色

1. **工作項目管理**
   - 新增工作項目名稱、專案人員姓名、開始日期、結束日期
   - 查看工作項目、專案人員、累計時數、填報筆數與填報月份
   - 編輯或刪除工作項目

2. **進度填報**
   - 在工作項目列表點選「填報」開啟填報視窗
   - 選擇工作項目與填報月份
   - 填寫實際執行時間、實際執行日期、執行情形與進度說明
   - 顯示每個工作項目的最新進度報告

3. **專案甘特圖**
   - 支援週、月、季度、年視圖
   - 依工作項目的開始/結束日期繪製期程
   - 依最新填報狀態與執行日期計算進度比例

4. **匯出功能**
   - 進度報告列表可匯出為圖片（SVG）或 PPTX
   - 專案甘特圖可匯出為圖片（SVG）或 PPTX

## 安裝與使用

### 前置條件

- Python 3.7+
- pip

### 啟動方式

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install flask flask-cors gspread google-auth google-auth-oauthlib
python server.py
```

開啟瀏覽器訪問：

```text
http://localhost:5000
```

## 網頁發布

本專案已加入部署設定檔：

- `requirements.txt`
- `Procfile`
- `runtime.txt`
- `render.yaml`

發布步驟請看 `DEPLOYMENT.md`。

## API 端點

### 工作項目

- `GET /api/work-items`：取得所有工作項目
- `POST /api/work-items`：建立新工作項目
- `PUT /api/work-items/<id>`：更新工作項目
- `DELETE /api/work-items/<id>`：刪除工作項目與其相關進度報告

### 進度報告

- `GET /api/progress-reports`：取得所有進度報告
- `POST /api/progress-reports`：建立新進度報告
- `GET /api/progress-reports/work-item/<work_item_id>`：取得特定工作項目的進度報告

### 甘特圖

- `GET /api/gantt-data?interval=weekly`：取得甘特圖資料

`interval` 可使用 `weekly`、`monthly`、`quarterly`、`yearly`。

### 匯出

- `GET /api/export/progress-reports.svg`：匯出進度報告列表圖片
- `GET /api/export/progress-reports.pptx`：匯出進度報告列表 PPT
- `GET /api/export/gantt.svg`：匯出甘特圖圖片
- `GET /api/export/gantt.pptx`：匯出甘特圖 PPT

## 資料儲存

資料儲存在專案根目錄的 `db.json`。

```json
{
  "workItems": [
    {
      "id": 1,
      "name": "工作項目名稱",
      "projectMember": "專案人員姓名",
      "startDate": "2026-06-18",
      "endDate": "2026-07-20",
      "createdAt": "2026-06-18T10:00:00",
      "updatedAt": "2026-06-18T10:00:00"
    }
  ],
  "progressReports": [
    {
      "id": 1,
      "workItemId": 1,
      "reportMonth": "2026-06",
      "actualHours": 8,
      "executionDate": "2026-06-18",
      "status": "執行中",
      "description": "進度說明內容",
      "createdAt": "2026-06-18T10:00:00"
    }
  ]
}
```

## 注意事項

- 這是開發用伺服器，不適合直接作為生產環境部署。
- 刪除工作項目時，相關進度報告會一併刪除。
- 如需 Google Sheets 同步，請依 `GOOGLE_SHEETS_SETUP.md` 設定憑證與試算表 ID。
