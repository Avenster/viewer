# app.py
import os
import uuid
import json
import atexit
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pandas as pd
from werkzeug.utils import secure_filename

app = Flask(__name__)

# ==========================
# CONFIG
# ==========================
UPLOAD_FOLDER = "uploads"
SESSIONS_FILE = "sessions.json"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

SESSIONS = {}

CORS(
    app,
    supports_credentials=True,
    resources={r"/api/*": {"origins": "http://localhost:5173"}},
    allow_headers=["Content-Type", "X-Session-Token"],
)

# ==========================
# Persistence helpers
# ==========================
def load_sessions():
    global SESSIONS
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                SESSIONS = json.load(f)
                print(f"[SESSIONS] Loaded {len(SESSIONS)} sessions from {SESSIONS_FILE}")
        except Exception as e:
            print(f"[SESSIONS] Failed to load sessions: {e}")

def save_sessions():
    try:
        with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(SESSIONS, f)
            print(f"[SESSIONS] Saved {len(SESSIONS)} sessions to {SESSIONS_FILE}")
    except Exception as e:
        print(f"[SESSIONS] Failed to save sessions: {e}")

atexit.register(save_sessions)
load_sessions()

# ==========================
# Helpers
# ==========================
def get_csv_path_from_request():
    token = request.headers.get("X-Session-Token") or request.args.get("token")
    if not token:
        print("[DEBUG] Missing token in request")
        return None, None
    csv_path = SESSIONS.get(token)
    if not csv_path:
        print(f"[DEBUG] Token {token} not found in sessions")
    return token, csv_path

# ==========================
# Routes
# ==========================
@app.route("/api/upload", methods=["POST"])
def upload_csv():
    if "csv_file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    csv_file = request.files["csv_file"]
    if csv_file.filename.strip() == "":
        return jsonify({"error": "Empty filename"}), 400
    
    filename = secure_filename(csv_file.filename)
    upload_path = os.path.join(UPLOAD_FOLDER, f"{uuid.uuid4().hex}_{filename}")
    csv_file.save(upload_path)
    print(f"[UPLOAD] saved temp upload -> {upload_path}")
    
    try:
        df = pd.read_csv(upload_path)
    except Exception as e:
        try:
            os.remove(upload_path)
        except Exception:
            pass
        print(f"[UPLOAD] Failed to read uploaded CSV: {e}")
        return jsonify({"error": f"Failed to read CSV: {e}"}), 400
    
    if "link" not in df.columns:
        try:
            os.remove(upload_path)
        except Exception:
            pass
        print("[UPLOAD] CSV missing 'link' column")
        return jsonify({"error": "'link' column not found in CSV"}), 400
    
    # Remove duplicates based on link column
    original_count = len(df)
    df = df.drop_duplicates(subset=["link"], keep="first").reset_index(drop=True)
    duplicates_removed = original_count - len(df)
    
    if "Status" not in df.columns:
        df["Status"] = ""
    if "Feedback" not in df.columns:
        df["Feedback"] = ""
    
    # Replace NaN with empty string
    df = df.fillna("")
    
    base, _ext = os.path.splitext(upload_path)
    reviewed_path = f"{base}_reviewed.csv"
    df.to_csv(reviewed_path, index=False)
    
    token = uuid.uuid4().hex
    SESSIONS[token] = reviewed_path
    save_sessions()
    
    print(f"[UPLOAD] token={token} -> {reviewed_path} ({len(df)} rows, {duplicates_removed} duplicates removed)")
    
    return jsonify({
        "message": "CSV uploaded successfully",
        "total": len(df),
        "duplicates_removed": duplicates_removed,
        "token": token
    }), 200

@app.route("/api/data", methods=["GET"])
def get_data():
    token, csv_path = get_csv_path_from_request()
    print(f"[DATA] token={token}, csv_path={csv_path}")
    
    if not token or not csv_path:
        return jsonify({"error": "No CSV uploaded or invalid token"}), 400
    
    if not os.path.exists(csv_path):
        print(f"[DATA] file not found at {csv_path}")
        return jsonify({"error": "CSV file not found on server"}), 400
    
    try:
        df = pd.read_csv(csv_path)
    except Exception as e:
        print(f"[DATA] pandas failed to read {csv_path}: {e}")
        return jsonify({"error": f"Failed to read CSV: {e}"}), 500
    
    df = df.fillna("")
    data = df.to_dict("records")
    
    print(f"[DATA] returning {len(data)} rows for token={token}")
    return jsonify({"data": data, "total": len(data)}), 200

@app.route("/api/update-status", methods=["POST"])
def update_status():
    token, csv_path = get_csv_path_from_request()
    print(f"[UPDATE] token={token}, csv_path={csv_path}")
    
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No CSV uploaded or invalid token"}), 400
    
    body = request.get_json(silent=True) or {}
    index = body.get("index")
    status = body.get("status")
    feedback = body.get("feedback", "")
    
    if index is None or status is None:
        return jsonify({"error": "Missing index or status"}), 400
    
    try:
        df = pd.read_csv(csv_path)
    except Exception as e:
        return jsonify({"error": f"Failed to read CSV: {e}"}), 500
    
    if not (0 <= int(index) < len(df)):
        return jsonify({"error": "Invalid index"}), 400
    
    df.loc[int(index), "Status"] = status
    df.loc[int(index), "Feedback"] = feedback if status == "Rejected" else ""
    
    df = df.fillna("")
    df.to_csv(csv_path, index=False)
    
    print(f"[UPDATE] token={token}, index={index}, status={status}, feedback={feedback[:50] if feedback else 'none'}")
    return jsonify({"message": f"Marked as {status}"}), 200

@app.route("/api/download", methods=["GET"])
def download_csv():
    token, csv_path = get_csv_path_from_request()
    
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No reviewed CSV available or invalid token"}), 400
    
    # Read the CSV and ensure no duplicates before sending
    try:
        df = pd.read_csv(csv_path)
        # Remove any duplicates that might have been added during review
        df = df.drop_duplicates(subset=["link"], keep="first")
        
        # Create a temporary file for download
        temp_path = csv_path.replace(".csv", "_download.csv")
        df.to_csv(temp_path, index=False)
        
        response = send_file(temp_path, as_attachment=True, download_name="reviewed_results.csv")
        
        # Clean up temp file after sending
        @response.call_on_close
        def cleanup():
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except Exception as e:
                print(f"Failed to cleanup temp file: {e}")
        
        return response
    except Exception as e:
        print(f"[DOWNLOAD] Error: {e}")
        return jsonify({"error": f"Download failed: {e}"}), 500

@app.route("/api/session-check", methods=["GET"])
def session_check():
    token, csv_path = get_csv_path_from_request()
    active = bool(token and csv_path and os.path.exists(csv_path))
    print(f"[SESSION-CHECK] token={token}, active={active}")
    return jsonify({"hasSession": active}), 200

if __name__ == "__main__":
    print("[START] Flask server starting on :5000")
    app.run(debug=True, port=5000)