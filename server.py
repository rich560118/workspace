from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
from datetime import date, datetime
import gspread
from google.oauth2.service_account import Credentials

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)  # Enable CORS for all routes

# Data file path
DATA_FILE = os.environ.get('DATA_FILE', 'db.json')
DATABASE_URL = os.environ.get('DATABASE_URL')
DATA_STORE_INITIALIZED = False

# Google Sheets configuration
GOOGLE_SHEETS_CREDENTIALS_FILE = 'google-sheets-credentials.json'
GOOGLE_SHEETS_SPREADSHEET_ID = None  # Will be set from environment variable or config
GOOGLE_SHEETS_WORKSHEET_NAME = 'Progress Reports'
VALID_STATUSES = {'未開始', '執行中', '結案'}

def default_data():
    return {
        "workItems": [],
        "progressReports": []
    }

def read_file_data():
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_file_data(data):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def init_data_file():
    data_dir = os.path.dirname(DATA_FILE)
    if data_dir:
        os.makedirs(data_dir, exist_ok=True)

    if not os.path.exists(DATA_FILE):
        write_file_data(default_data())

def get_db_connection():
    import psycopg

    return psycopg.connect(DATABASE_URL)

def init_postgres_data():
    from psycopg.types.json import Jsonb

    seed_data = read_file_data() if os.path.exists(DATA_FILE) else default_data()

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                INSERT INTO app_state (key, value)
                VALUES (%s, %s)
                ON CONFLICT (key) DO NOTHING
            """, ("data", Jsonb(seed_data)))

def init_data_store():
    global DATA_STORE_INITIALIZED
    if DATA_STORE_INITIALIZED:
        return

    if DATABASE_URL:
        init_postgres_data()
    else:
        init_data_file()

    DATA_STORE_INITIALIZED = True

# Load data from file
def load_data():
    init_data_store()

    if DATABASE_URL:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM app_state WHERE key = %s", ("data",))
                row = cur.fetchone()
                return row[0] if row else default_data()

    return read_file_data()

# Save data to file
def save_data(data):
    init_data_store()

    if DATABASE_URL:
        from psycopg.types.json import Jsonb

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO app_state (key, value, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value,
                        updated_at = NOW()
                """, ("data", Jsonb(data)))
        return

    write_file_data(data)

def next_id(items):
    return max((item.get("id", 0) for item in items), default=0) + 1

def parse_iso_date(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None

def parse_report_month(value):
    try:
        datetime.strptime(value, "%Y-%m")
        return value
    except (TypeError, ValueError):
        return None

def validate_work_item(payload):
    name = (payload.get("name") or "").strip()
    project_member = (payload.get("projectMember") or "").strip()
    start_date = parse_iso_date(payload.get("startDate"))
    end_date = parse_iso_date(payload.get("endDate"))

    if not name:
        return "工作項目名稱不可空白"
    if not start_date or not end_date:
        return "請提供有效的開始日期與結束日期"
    if start_date > end_date:
        return "開始日期不可晚於結束日期"

    payload["name"] = name
    payload["projectMember"] = project_member
    return None

def calculate_progress(work_item, latest_report):
    if not latest_report:
        return 0

    status = latest_report.get("status")
    if status == "結案":
        return 100
    if status == "未開始":
        return 0
    if status != "執行中":
        return 0

    start_date = parse_iso_date(work_item.get("startDate"))
    end_date = parse_iso_date(work_item.get("endDate"))
    execution_date = parse_iso_date(latest_report.get("executionDate")) or date.today()

    if not start_date or not end_date:
        return 0
    if end_date <= start_date:
        return 100 if execution_date >= end_date else 0

    total_days = (end_date - start_date).days + 1
    elapsed_days = (execution_date - start_date).days + 1
    return max(0, min(round((elapsed_days / total_days) * 100, 1), 100))

def as_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0

def get_report_month(report):
    if not report:
        return ""

    report_month = parse_report_month(report.get("reportMonth"))
    if report_month:
        return report_month

    execution_date = report.get("executionDate")
    if parse_iso_date(execution_date):
        return execution_date[:7]

    return ""

# Serve the frontend index.html
@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/healthz')
def health_check():
    return jsonify({"status": "ok"})

# Initialize Google Sheets client
def init_google_sheets():
    try:
        if not os.path.exists(GOOGLE_SHEETS_CREDENTIALS_FILE):
            print(f"Google Sheets credentials file not found: {GOOGLE_SHEETS_CREDENTIALS_FILE}")
            return None
        
        # Define the scope
        scope = ['https://spreadsheets.google.com/feeds',
                 'https://www.googleapis.com/auth/drive']
        
        # Load credentials
        creds = Credentials.from_service_account_file(
            GOOGLE_SHEETS_CREDENTIALS_FILE, 
            scopes=scope
        )
        
        # Authorize the client
        client = gspread.authorize(creds)
        return client
    except Exception as e:
        print(f"Error initializing Google Sheets: {e}")
        return None

# Send progress report to Google Sheets
def send_to_google_sheets(progress_report, work_item_name=None, project_member=None):
    try:
        client = init_google_sheets()
        if not client:
            print("Could not initialize Google Sheets client")
            return False
        
        # Get spreadsheet ID from environment or use default
        spreadsheet_id = os.environ.get('GOOGLE_SHEETS_SPREADSHEET_ID', GOOGLE_SHEETS_SPREADSHEET_ID)
        if not spreadsheet_id:
            print("Google Sheets spreadsheet ID not configured")
            return False
        
        # Open the spreadsheet
        spreadsheet = client.open_by_key(spreadsheet_id)
        
        # Try to get the worksheet, create if it doesn't exist
        try:
            worksheet = spreadsheet.worksheet(GOOGLE_SHEETS_WORKSHEET_NAME)
        except gspread.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(title=GOOGLE_SHEETS_WORKSHEET_NAME, rows=1000, cols=20)
            # Add headers
            worksheet.append_row(['Timestamp', 'Work Item ID', 'Work Item Name', 'Project Member', 'Report Month', 'Actual Hours', 'Execution Date', 'Status', 'Description', 'Report ID'])
        
        # Prepare row data
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        row_data = [
            timestamp,
            progress_report.get('workItemId', ''),
            work_item_name or '',
            project_member or '',
            progress_report.get('reportMonth', ''),
            progress_report.get('actualHours', ''),
            progress_report.get('executionDate', ''),
            progress_report.get('status', ''),
            progress_report.get('description', ''),
            progress_report.get('id', '')
        ]
        
        # Append row to worksheet
        worksheet.append_row(row_data)
        return True
    except Exception as e:
        print(f"Error sending data to Google Sheets: {e}")
        return False

# API Routes

# Get all work items
@app.route('/api/work-items', methods=['GET'])
def get_work_items():
    data = load_data()
    return jsonify(data["workItems"])

# Create a new work item
@app.route('/api/work-items', methods=['POST'])
def create_work_item():
    data = load_data()
    new_item = request.get_json(silent=True) or {}
    validation_error = validate_work_item(new_item)
    if validation_error:
        return jsonify({"error": validation_error}), 400
    
    # Add ID and timestamps
    new_item["id"] = next_id(data["workItems"])
    new_item["createdAt"] = datetime.now().isoformat()
    new_item["updatedAt"] = datetime.now().isoformat()

    data["workItems"].append(new_item)
    save_data(data)
    
    return jsonify(new_item), 201

# Update a work item
@app.route('/api/work-items/<int:item_id>', methods=['PUT'])
def update_work_item(item_id):
    data = load_data()
    update_data = request.get_json(silent=True) or {}
    
    for item in data["workItems"]:
        if item["id"] == item_id:
            candidate = {**item, **update_data}
            validation_error = validate_work_item(candidate)
            if validation_error:
                return jsonify({"error": validation_error}), 400

            item.update(update_data)
            item["name"] = candidate["name"]
            item["projectMember"] = candidate.get("projectMember", "")
            item["updatedAt"] = datetime.now().isoformat()

            save_data(data)
            return jsonify(item)
    
    return jsonify({"error": "Work item not found"}), 404

# Delete a work item
@app.route('/api/work-items/<int:item_id>', methods=['DELETE'])
def delete_work_item(item_id):
    data = load_data()
    
    for i, item in enumerate(data["workItems"]):
        if item["id"] == item_id:
            deleted_item = data["workItems"].pop(i)
            data["progressReports"] = [
                report for report in data["progressReports"]
                if report.get("workItemId") != item_id
            ]
            save_data(data)
            return jsonify(deleted_item)
    
    return jsonify({"error": "Work item not found"}), 404

# Get all progress reports
@app.route('/api/progress-reports', methods=['GET'])
def get_progress_reports():
    data = load_data()
    return jsonify(data["progressReports"])

# Create a new progress report
@app.route('/api/progress-reports', methods=['POST'])
def create_progress_report():
    data = load_data()
    new_report = request.get_json(silent=True) or {}
    work_item_id = new_report.get("workItemId")
    work_item = next((item for item in data["workItems"] if item.get("id") == work_item_id), None)

    if not work_item:
        return jsonify({"error": "找不到指定的工作項目"}), 400

    try:
        new_report["actualHours"] = float(new_report.get("actualHours", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "實際執行時間格式不正確"}), 400

    if new_report["actualHours"] < 0:
        return jsonify({"error": "實際執行時間不可小於 0"}), 400
    report_month = parse_report_month(new_report.get("reportMonth"))
    if not report_month:
        return jsonify({"error": "請提供有效的填報月份"}), 400
    if not parse_iso_date(new_report.get("executionDate")):
        return jsonify({"error": "請提供有效的實際執行日期"}), 400
    if new_report.get("status") not in VALID_STATUSES:
        return jsonify({"error": "請選擇有效的執行情形"}), 400
    if not (new_report.get("description") or "").strip():
        return jsonify({"error": "進度說明不可空白"}), 400

    new_report["description"] = new_report["description"].strip()
    new_report["reportMonth"] = report_month
    
    # Add ID and timestamp
    new_report["id"] = next_id(data["progressReports"])
    new_report["createdAt"] = datetime.now().isoformat()
    
    data["progressReports"].append(new_report)
    save_data(data)
    
    # Also send to Google Sheets if configured
    try:
        # Get the work item name for better context in Google Sheets
        # Send to Google Sheets (non-blocking - don't fail the request if this fails)
        send_to_google_sheets(new_report, work_item.get("name"), work_item.get("projectMember"))
    except Exception as e:
        print(f"Error in Google Sheets integration: {e}")
        # Continue anyway - we don't want to fail the main request
    
    return jsonify(new_report), 201

# Get progress reports for a specific work item
@app.route('/api/progress-reports/work-item/<int:work_item_id>', methods=['GET'])
def get_progress_reports_by_work_item(work_item_id):
    data = load_data()
    reports = [report for report in data["progressReports"] if report.get("workItemId") == work_item_id]
    return jsonify(reports)

# Get Gantt chart data
@app.route('/api/gantt-data', methods=['GET'])
def get_gantt_data():
    data = load_data()
    gantt_data = []
    
    for work_item in data["workItems"]:
        total_actual_hours = 0
        related_reports = []
        for report in data["progressReports"]:
            if report.get("workItemId") == work_item.get("id"):
                total_actual_hours += as_number(report.get("actualHours", 0))
                related_reports.append(report)

        latest_report = None
        if related_reports:
            latest_report = max(
                related_reports,
                key=lambda report: report.get("createdAt", "")
            )
        
        gantt_data.append({
            "id": work_item.get("id"),
            "name": work_item.get("name", ""),
            "projectMember": work_item.get("projectMember", ""),
            "start": work_item.get("startDate", ""),
            "end": work_item.get("endDate", ""),
            "progress": calculate_progress(work_item, latest_report),
            "actualHours": total_actual_hours,
            "latestStatus": latest_report.get("status") if latest_report else "未開始",
            "latestReportMonth": get_report_month(latest_report),
            "latestExecutionDate": latest_report.get("executionDate") if latest_report else "",
            "latestDescription": latest_report.get("description") if latest_report else ""
        })
    
    return jsonify(gantt_data)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG') == '1'
    app.run(host='0.0.0.0', debug=debug, port=port)
