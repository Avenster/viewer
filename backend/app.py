# app.py
import os
import uuid
import json
import atexit
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pandas as pd
from werkzeug.utils import secure_filename

app = Flask(__name__)

# ==========================
# CONFIG
# ==========================
UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", "uploads")
SESSIONS_FILE = os.environ.get("SESSIONS_FILE", "sessions.json")
SESSION_EXPIRY_HOURS = int(os.environ.get("SESSION_EXPIRY_HOURS", "24"))
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

SESSIONS = {}

# CORS configuration for production
CORS(
    app,
    supports_credentials=False,  # Changed to False since we're using token-based auth
    resources={r"/api/*": {"origins": [FRONTEND_URL, "https://viewer-x964.vercel.app/"]}},
    allow_headers=["Content-Type", "X-Session-Token"],
)

# ==========================
# Persistence helpers
# ==========================
def load_sessions():
    """Load sessions from disk and clean expired ones"""
    global SESSIONS
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                SESSIONS = json.load(f)
                print(f"[SESSIONS] Loaded {len(SESSIONS)} sessions from {SESSIONS_FILE}")
                clean_expired_sessions()
        except Exception as e:
            print(f"[SESSIONS] Failed to load sessions: {e}")
            SESSIONS = {}

def save_sessions():
    """Save sessions to disk"""
    try:
        with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(SESSIONS, f)
            print(f"[SESSIONS] Saved {len(SESSIONS)} sessions to {SESSIONS_FILE}")
    except Exception as e:
        print(f"[SESSIONS] Failed to save sessions: {e}")

def clean_expired_sessions():
    """Remove expired sessions and their associated files"""
    global SESSIONS
    now = datetime.now()
    expired_tokens = []
    
    for token, session_data in list(SESSIONS.items()):
        if isinstance(session_data, str):
            # Old format - migrate or remove
            csv_path = session_data
            if not os.path.exists(csv_path):
                expired_tokens.append(token)
            continue
        
        expires_at = datetime.fromisoformat(session_data.get("expires_at", "2000-01-01"))
        if now > expires_at:
            expired_tokens.append(token)
            csv_path = session_data.get("csv_path")
            if csv_path and os.path.exists(csv_path):
                try:
                    os.remove(csv_path)
                    print(f"[CLEANUP] Removed expired file: {csv_path}")
                except Exception as e:
                    print(f"[CLEANUP] Failed to remove {csv_path}: {e}")
    
    for token in expired_tokens:
        del SESSIONS[token]
    
    if expired_tokens:
        print(f"[CLEANUP] Removed {len(expired_tokens)} expired sessions")
        save_sessions()

atexit.register(save_sessions)
load_sessions()

# ==========================
# Helpers
# ==========================
def get_session_from_request():
    """Extract and validate session token from request"""
    token = request.headers.get("X-Session-Token") or request.args.get("token")
    if not token:
        print("[DEBUG] Missing token in request")
        return None, None
    
    session_data = SESSIONS.get(token)
    if not session_data:
        print(f"[DEBUG] Token {token} not found in sessions")
        return None, None
    
    # Handle old format (string) - migrate to new format
    if isinstance(session_data, str):
        csv_path = session_data
        expires_at = datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS)
        session_data = {
            "csv_path": csv_path,
            "created_at": datetime.now().isoformat(),
            "expires_at": expires_at.isoformat(),
            "last_accessed": datetime.now().isoformat()
        }
        SESSIONS[token] = session_data
        save_sessions()
    else:
        # Check if session is expired
        expires_at = datetime.fromisoformat(session_data.get("expires_at", "2000-01-01"))
        if datetime.now() > expires_at:
            print(f"[DEBUG] Token {token} has expired")
            csv_path = session_data.get("csv_path")
            if csv_path and os.path.exists(csv_path):
                try:
                    os.remove(csv_path)
                except Exception as e:
                    print(f"[CLEANUP] Failed to remove {csv_path}: {e}")
            del SESSIONS[token]
            save_sessions()
            return None, None
        
        # Update last accessed time
        session_data["last_accessed"] = datetime.now().isoformat()
        save_sessions()
    
    csv_path = session_data.get("csv_path")
    if not csv_path or not os.path.exists(csv_path):
        print(f"[DEBUG] CSV file not found for token {token}")
        del SESSIONS[token]
        save_sessions()
        return None, None
    
    return token, csv_path

# ==========================
# Routes
# ==========================
@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint for AWS load balancer"""
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()}), 200

@app.route("/api/upload", methods=["POST"])
def upload_csv():
    """Handle CSV file upload and create new session"""
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
    
    # Remove temporary upload file
    try:
        os.remove(upload_path)
    except Exception as e:
        print(f"[UPLOAD] Failed to remove temp file: {e}")
    
    # Create new session with expiry
    token = uuid.uuid4().hex
    expires_at = datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS)
    
    SESSIONS[token] = {
        "csv_path": reviewed_path,
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at.isoformat(),
        "last_accessed": datetime.now().isoformat(),
        "original_filename": filename
    }
    save_sessions()
    
    # Clean up old sessions periodically
    clean_expired_sessions()
    
    print(f"[UPLOAD] token={token} -> {reviewed_path} ({len(df)} rows, {duplicates_removed} duplicates removed)")
    
    return jsonify({
        "message": "CSV uploaded successfully",
        "total": len(df),
        "duplicates_removed": duplicates_removed,
        "token": token,
        "expires_in_hours": SESSION_EXPIRY_HOURS
    }), 200

@app.route("/api/session-check", methods=["GET"])
def session_check():
    """Check if session token is valid"""
    token, csv_path = get_session_from_request()
    active = bool(token and csv_path and os.path.exists(csv_path))
    
    if active:
        session_data = SESSIONS.get(token, {})
        return jsonify({
            "hasSession": True,
            "expires_at": session_data.get("expires_at")
        }), 200
    else:
        return jsonify({"hasSession": False}), 200

@app.route("/api/data", methods=["GET"])
def get_data():
    """Get all data for the current session"""
    token, csv_path = get_session_from_request()
    print(f"[DATA] token={token}, csv_path={csv_path}")
    
    if not token or not csv_path:
        return jsonify({"error": "No CSV uploaded or invalid/expired token"}), 401
    
    if not os.path.exists(csv_path):
        print(f"[DATA] file not found at {csv_path}")
        return jsonify({"error": "CSV file not found on server"}), 404
    
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
    """Update status and feedback for a specific item"""
    token, csv_path = get_session_from_request()
    print(f"[UPDATE] token={token}, csv_path={csv_path}")
    
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No CSV uploaded or invalid/expired token"}), 401
    
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
    """Download the reviewed CSV file"""
    token, csv_path = get_session_from_request()
    
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No reviewed CSV available or invalid/expired token"}), 401
    
    try:
        df = pd.read_csv(csv_path)
        # Remove any duplicates that might have been added during review
        df = df.drop_duplicates(subset=["link"], keep="first")
        
        # Create a temporary file for download
        temp_path = csv_path.replace(".csv", "_download.csv")
        df.to_csv(temp_path, index=False)
        
        # Get original filename from session
        session_data = SESSIONS.get(token, {})
        original_name = session_data.get("original_filename", "reviewed_results.csv")
        download_name = f"reviewed_{original_name}"
        
        response = send_file(temp_path, as_attachment=True, download_name=download_name)
        
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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV", "production") != "production"
    print(f"[START] Flask server starting on :{port}")
    app.run(host="0.0.0.0", debug=debug, port=port)