# Google Sheets 整合設定說明

這個應用程式可以將進度報告自動傳送到 Google Sheets。以下是設定步驟：

## 前置條件
1. Google 帳號
2. 建立 Google Cloud Platform 專案
3. 啟用 Google Sheets API 和 Google Drive API

## 設定步驟

### 1. 建立 Google Cloud Platform 專案
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案或選擇現有專案
3. 記下專案 ID

### 2. 啟用必要的 API
1. 在左側選單中選擇 "APIs & Services" > "Library"
2. 搜尋並啟用：
   - Google Sheets API
   - Google Drive API

### 3. 建立服務帳號和金鑰
1. 在左側選單中選擇 "IAM & Admin" > "Service Accounts"
2. 點擊 "CREATE SERVICE ACCOUNT"
3. 輸入服務帳號名稱和說明
4. 點擊 "CREATE AND CONTINUE"
5. 選擇角色：可以選擇 "Project" > "Editor" 或建立自訂角色
6. 點擊 "DONE"
7. 在服務帳號列表中找到剛才建立的帳號，點擊它
8. 選擇 "KEYS" 索引標籤
9. 點擊 "ADD KEY" > "Create new key"
10. 選擇 JSON 格式
11. 點擊 "CREATE" - 這會下載一個 JSON 金鑰檔案
12. 將下載的 JSON 檔案重命名為 `google-sheets-credentials.json`
13. 將此檔案放置在專案根目錄（與 server.py 同目錄）

### 4. 建立 Google Sheets 試算表
1. 前往 [Google Sheets](https://sheets.google.com/)
2. 建立新的試算表
3. 記下試算表的 ID（從 URL 中取得）：
   - URL 格式：`https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit`
   - 例如：`https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit`
   - 試算表 ID：`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

### 5. 設定環境變數
有兩種方式可以設定 Google Sheets 試算表 ID：

#### 方式一：使用環境變數（推薦）
在啟動應用程式前設定環境變數：
```bash
# Windows PowerShell
$env:GOOGLE_SHEETS_SPREADSHEET_ID="您的試算表ID"

# Windows CMD
set GOOGLE_SHEETS_SPREADSHEET_ID=您的試算表ID

# Linux/Mac
export GOOGLE_SHEETS_SPREADSHEET_ID="您的試算表ID"
```

#### 方式二：直接修改程式碼
編輯 `server.py` 檔案，將以下行：
```python
GOOGLE_SHEETS_SPREADSHEET_ID = None  # Will be set from environment variable or config
```
改為：
```python
GOOGLE_SHEETS_SPREADSHEET_ID = "您的試算表ID"  # Replace with your actual spreadsheet ID
```

### 6. 分享試算表給服務帳號
1. 開啟您建立的 Google Sheets 試算表
2. 點擊右上角的 "Share" 按鈕
3. 在添加人員的欄位中，輸入您的服務帳號電子郵件地址
   - 這個地址可以在您的 `google-sheets-credentials.json` 檔案中找到，欄位名稱為 `client_email`
   - 格式類似：`your-project-id@your-project-id.iam.gserviceaccount.com`
4. 確保權限設定為 "Editor"（可以編輯）
5. 點擊 "Send"

### 7. 測試整合
1. 確保您已經將 `google-sheets-credentials.json` 檔案放在專案根目錄
2. 確保試算表 ID 已經正確設定（透過環境變數或直接修改程式碼）
3. 啟動應用程式：
   ```bash
   python server.py
   ```
4. 在網頁介面中填寫一個進度報告
5. 檢查 Google Sheets 是否有新增一筆資料

## 欄位說明
Google Sheets 會自動建立一個名為 "Progress Reports" 的工作表，包含以下欄位：
- Timestamp：報告發送的時間戳記
- Work Item ID：工作項目的 ID
- Work Item Name：工作項目的名稱
- Actual Hours：實際執行小時數
- Description：進度說明
- Report ID：進度報告的 ID

## 疑難排解
1. **找不到認證檔案**：確認 `google-sheets-credentials.json` 檔案是否在專案根目錄
2. **權限錯誤**：確認服務帳號有 Google Sheets 和 Google Drive API 的存取權限
3. **試算表 ID 錯誤**：確認試算表 ID 是否正確，且服務帳號已被分享給該試算表
4. **API 未啟用**：確認 Google Cloud Platform 中已啟用 Google Sheets API 和 Google Drive API
5. **額外配額問題**：免費版 Google Sheets API 有每日使用限制，如需大量使用請考慮升級方案

## 安全注意事項
- 永遠不要將 `google-sheets-credentials.json` 檔案提交到公開的版本控制系統（如 GitHub）
- 考慮將此檔案加入 `.gitignore` 如果您使用 Git
- 定期輪換服務帳號金鑰以維持安全