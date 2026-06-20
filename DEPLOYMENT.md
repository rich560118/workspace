# 免費網頁發布說明

這個專案是 Flask 後端加原生前端，已調整成可用 Render 免費資源發布。

## 使用的免費資源

- Render Free Web Service：執行 Flask + Gunicorn
- Render Free Postgres：保存工作項目與進度資料

本機開發仍會使用 `db.json`；上線到 Render 後，只要 Render 提供 `DATABASE_URL`，系統會自動改用 Postgres。

## Render 發布方式

1. 將專案上傳到 GitHub。
2. 登入 Render。
3. 選擇 **New +** -> **Blueprint**。
4. 選擇這個 GitHub repository。
5. Render 會讀取 `render.yaml`，自動建立：
   - `execution-progress-tracker` Web Service
   - `execution-progress-db` Postgres Database
6. 發布完成後會取得公開網址，例如：

```text
https://execution-progress-tracker.onrender.com
```

## 免費方案限制

- Render Free Web Service 閒置後可能會休眠，第一次開啟會比較慢。
- 免費 Postgres 方案有平台限制，請在正式長期使用前確認 Render 當下的免費資料庫政策。
- 目前資料會存在 Postgres；不是存在 Web Service 的暫存檔案系統。

## 本機測試

```powershell
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

開啟：

```text
http://127.0.0.1:5000/
```

## 健康檢查

```text
http://127.0.0.1:5000/healthz
```
