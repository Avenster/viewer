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
    supports_credentials=False,
    resources={r"/api/*": {"origins": [FRONTEND_URL, "http://13.201.123.132:3000"]}},
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
        
        try:
            expires_at = datetime.fromisoformat(session_data.get("expires_at", "2000-01-01"))
        except Exception:
            expires_at = datetime(2000, 1, 1)
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
def _normalize_columns_and_get_link_column(df: pd.DataFrame):
    """
    Normalize column names (strip spaces) and make a lower-case map.
    Ensure a 'link' column exists (case-insensitive) by renaming it to 'link'.
    Returns dataframe (possibly renamed) and the detected link column name.
    """
    # strip whitespace from column names
    new_cols = [c.strip() if isinstance(c, str) else c for c in df.columns]
    df.columns = new_cols

    # build map of lowercased column names to original
    lower_map = {str(c).lower(): c for c in df.columns}

    # common variants to check
    for candidate in ("link", "url"):
        if candidate in lower_map:
            orig = lower_map[candidate]
            if orig != "link":
                df = df.rename(columns={orig: "link"})
            return df, "link"

    # if nothing found, try to find any column that contains 'link' or 'url' substring
    for orig in df.columns:
        if isinstance(orig, str) and ("link" in orig.lower() or "url" in orig.lower()):
            if orig != "link":
                df = df.rename(columns={orig: "link"})
            return df, "link"

    return df, None

def _read_csv_with_fallbacks(path: str) -> pd.DataFrame:
    """
    Try reading CSV with common encodings to handle BOM/utf errors.
    Returns a pandas DataFrame or raises the last exception.
    """
    tried = []
    exceptions = []
    encodings = ["utf-8-sig", "utf-8", "latin1", "cp1252"]
    for enc in encodings:
        try:
            df = pd.read_csv(path, dtype=str, encoding=enc)
            # convert NaNs to empty strings for consistent downstream handling
            df = df.fillna("")
            return df
        except Exception as e:
            tried.append(enc)
            exceptions.append((enc, str(e)))
            # continue to next encoding
    # if all failed, raise a combined error
    err_msgs = "; ".join([f"{enc}: {msg}" for enc, msg in exceptions])
    raise Exception(f"All encodings failed ({err_msgs})")

def _normalize_status_value(val: str) -> str:
    """
    Normalize various status text variants to canonical values used by frontend:
      - 'Accepted' for accepts
      - 'Rejected' for rejects
      - '' (empty) for pending / unknown
    """
    if val is None:
        return ""
    s = str(val).strip()
    if s == "":
        return ""
    ls = s.lower()
    # common accept variants
    if ls in ("accept", "accepted", "acept", "acpt") or ls.startswith("accept"):
        return "Accepted"
    # common reject variants
    if ls in ("reject", "rejected", "rej") or ls.startswith("reject"):
        return "Rejected"
    # if value is already canonical
    if s in ("Accepted", "Rejected"):
        return s
    # otherwise, return trimmed original
    return s

def _find_verified_column(df: pd.DataFrame):
    """
    Find a column that represents 'Verified By' (various variants).
    Return the column name or None.
    """
    for c in df.columns:
        if not isinstance(c, str):
            continue
        lc = c.lower().replace("_", " ").strip()
        # match common variants
        if "verified" in lc and ("by" in lc or lc.endswith("verified") or lc == "verified"):
            return c
        if lc in ("verified by", "verified_by", "verifiedby", "verified"):
            return c
    # fallback: try any column that contains 'verified' substring
    for c in df.columns:
        if isinstance(c, str) and "verified" in c.lower():
            return c
    return None

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
        try:
            expires_at = datetime.fromisoformat(session_data.get("expires_at", "2000-01-01"))
        except Exception:
            expires_at = datetime(2000, 1, 1)
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
        # remove stale session entry if present
        if token in SESSIONS:
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
        df = _read_csv_with_fallbacks(upload_path)
    except Exception as e:
        try:
            os.remove(upload_path)
        except Exception:
            pass
        print(f"[UPLOAD] Failed to read uploaded CSV: {e}")
        return jsonify({"error": f"Failed to read CSV: {e}"}), 400
    
    # Normalize columns and ensure a link column exists
    df, link_col = _normalize_columns_and_get_link_column(df)
    if not link_col:
        try:
            os.remove(upload_path)
        except Exception:
            pass
        print("[UPLOAD] CSV missing 'link' column (case-insensitive search failed)")
        return jsonify({"error": "'link' column not found in CSV (expected column named Link, link, URL, etc.)"}), 400

    # Ensure link column values are strings and strip whitespace
    df["link"] = df["link"].astype(str).str.strip()

    # Remove empty links
    before_count = len(df)
    df = df[df["link"] != ""].reset_index(drop=True)
    removed_empty = before_count - len(df)

    # Remove duplicates based on link column
    original_count = len(df)
    df = df.drop_duplicates(subset=["link"], keep="first").reset_index(drop=True)
    duplicates_removed = original_count - len(df)
    
    # Normalize Status/Feedback/Verified columns
    col_map = {c: c.strip() for c in df.columns}
    if any(k != v for k, v in col_map.items()):
        df = df.rename(columns=col_map)

    # rename case-insensitive status/feedback/verified to canonical names
    for c in list(df.columns):
        if c.lower() == "status" and c != "Status":
            df = df.rename(columns={c: "Status"})
        if c.lower() == "feedback" and c != "Feedback":
            df = df.rename(columns={c: "Feedback"})
        # Verified By variants -> canonical "Verified By"
        lc = c.lower().replace("_", " ").strip()
        if "verified" in lc and ("by" in lc or lc == "verified"):
            if c != "Verified By":
                df = df.rename(columns={c: "Verified By"})

    # ensure columns exist
    if "Status" not in df.columns:
        df["Status"] = ""
    if "Feedback" not in df.columns:
        df["Feedback"] = ""
    if "Verified By" not in df.columns:
        # leave absent if not provided; we'll add empty column so frontend always sees it
        df["Verified By"] = ""

    # Normalize status values so frontend shows Accepted/Rejected/Pending consistently
    df["Status"] = df["Status"].apply(_normalize_status_value)

    # Replace NaN with empty string
    df = df.fillna("")

    base, _ext = os.path.splitext(upload_path)
    reviewed_path = f"{base}_reviewed.csv"

    try:
        df.to_csv(reviewed_path, index=False, encoding="utf-8")
    except Exception as e:
        print(f"[UPLOAD] Failed to save reviewed CSV: {e}")
        try:
            os.remove(upload_path)
        except Exception:
            pass
        return jsonify({"error": f"Failed to save processed CSV: {e}"}), 500
    
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
    
    print(f"[UPLOAD] token={token} -> {reviewed_path} ({len(df)} rows, {duplicates_removed} duplicates removed, {removed_empty} empty links removed)")
    
    return jsonify({
        "message": "CSV uploaded successfully",
        "total": len(df),
        "duplicates_removed": duplicates_removed,
        "empty_links_removed": removed_empty,
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

    verifier = request.args.get("verifier")  # optional filter value
    
    try:
        df = _read_csv_with_fallbacks(csv_path)
    except Exception as e:
        print(f"[DATA] pandas failed to read {csv_path}: {e}")
        return jsonify({"error": f"Failed to read CSV: {e}"}), 500
    
    # Normalize columns and ensure 'link' exists for the client
    df, link_col = _normalize_columns_and_get_link_column(df)
    if not link_col:
        return jsonify({"error": "'link' column missing in stored CSV"}), 500

    # coerce to strings and fillna
    df["link"] = df["link"].astype(str).str.strip()

    # Normalize status column
    if "Status" in df.columns:
        df["Status"] = df["Status"].apply(_normalize_status_value)
    else:
        for c in df.columns:
            if isinstance(c, str) and c.lower() == "status":
                df = df.rename(columns={c: "Status"})
                df["Status"] = df["Status"].apply(_normalize_status_value)
                break
        else:
            df["Status"] = ""

    # Ensure Feedback and Verified By columns exist (case-insensitive mapping)
    if "Feedback" not in df.columns:
        for c in df.columns:
            if isinstance(c, str) and c.lower() == "feedback":
                df = df.rename(columns={c: "Feedback"})
                break
        if "Feedback" not in df.columns:
            df["Feedback"] = ""

    # Detect verified column and normalize name to 'Verified By' if present
    vcol = _find_verified_column(df)
    if vcol and vcol != "Verified By":
        df = df.rename(columns={vcol: "Verified By"})
    if "Verified By" not in df.columns:
        df["Verified By"] = ""

    # apply verifier filtering if requested
    if verifier:
        verifier = str(verifier).strip().lower()
        # perform case-insensitive exact match on Verified By column
        df = df[df["Verified By"].astype(str).str.strip().str.lower() == verifier].reset_index(drop=True)

    df = df.fillna("")
    data = df.to_dict("records")
    
    print(f"[DATA] returning {len(data)} rows for token={token} (verifier filter={'none' if not verifier else verifier})")
    return jsonify({"data": data, "total": len(data)}), 200

@app.route("/api/update-status", methods=["POST"])
def update_status():
    """
    Update status and feedback for a specific item.

    Accepts either:
      - { "index": <int>, "status": "...", "feedback": "..." }  # legacy
      - { "link": "<unique_link>", "status": "...", "feedback": "..." }  # preferred
    The function updates the CSV row that matches the link (preferred) or index.
    """
    token, csv_path = get_session_from_request()
    print(f"[UPDATE] token={token}, csv_path={csv_path}")
    
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No CSV uploaded or invalid/expired token"}), 401
    
    body = request.get_json(silent=True) or {}
    index = body.get("index")
    status = body.get("status")
    feedback = body.get("feedback", "")
    link = body.get("link")

    if status is None:
        return jsonify({"error": "Missing status"}), 400
    
    try:
        df = _read_csv_with_fallbacks(csv_path)
    except Exception as e:
        return jsonify({"error": f"Failed to read CSV: {e}"}), 500
    
    # Normalize and ensure link column exists
    df, link_col = _normalize_columns_and_get_link_column(df)
    if not link_col:
        return jsonify({"error": "'link' column missing in stored CSV"}), 500

    # Normalize Status/Feedback columns presence
    if "Status" not in df.columns:
        df["Status"] = ""
    if "Feedback" not in df.columns:
        df["Feedback"] = ""

    # Decide which row to update: prefer link match
    target_idx = None
    if link:
        link = str(link).strip()
        matches = df.index[df["link"].astype(str).str.strip() == link].tolist()
        if len(matches) == 0:
            return jsonify({"error": "Link not found"}), 400
        target_idx = matches[0]
    else:
        # fallback to index if provided (legacy)
        if index is None:
            return jsonify({"error": "Missing index or link to identify row"}), 400
        try:
            idx = int(index)
        except Exception:
            return jsonify({"error": "Invalid index (must be integer)"}), 400

        if not (0 <= idx < len(df)):
            return jsonify({"error": "Invalid index"}), 400
        target_idx = idx

    # Normalize incoming status to canonical values
    canonical = _normalize_status_value(status)
    df.loc[target_idx, "Status"] = canonical
    df.loc[target_idx, "Feedback"] = feedback if canonical == "Rejected" else ""

    df = df.fillna("")
    try:
        df.to_csv(csv_path, index=False, encoding="utf-8")
    except Exception as e:
        print(f"[UPDATE] Failed to write CSV: {e}")
        return jsonify({"error": f"Failed to save CSV: {e}"}), 500
    
    print(f"[UPDATE] token={token}, target_idx={target_idx}, status={canonical}, feedback={'(hidden)' if feedback else 'none'}")
    return jsonify({"message": f"Marked row {target_idx} as {canonical}"}), 200

@app.route("/api/download", methods=["GET"])
def download_csv():
    """Download the reviewed CSV file"""
    token, csv_path = get_session_from_request()
    
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No reviewed CSV available or invalid/expired token"}), 401
    
    try:
        df = _read_csv_with_fallbacks(csv_path)
        # Normalize column names and ensure 'link' exists
        df, _ = _normalize_columns_and_get_link_column(df)

        # Normalize status column before download
        if "Status" in df.columns:
            df["Status"] = df["Status"].apply(_normalize_status_value)
        else:
            for c in df.columns:
                if isinstance(c, str) and c.lower() == "status":
                    df = df.rename(columns={c: "Status"})
                    df["Status"] = df["Status"].apply(_normalize_status_value)
                    break

        # Detect verified column and rename to 'Verified By' if present
        vcol = _find_verified_column(df)
        if vcol and vcol != "Verified By":
            df = df.rename(columns={vcol: "Verified By"})
        if "Verified By" not in df.columns:
            df["Verified By"] = ""

        # Remove duplicates that might have been added during review
        if "link" in df.columns:
            df = df.drop_duplicates(subset=["link"], keep="first")
        
        # Create a temporary file for download
        temp_path = csv_path.replace(".csv", "_download.csv")
        df.to_csv(temp_path, index=False, encoding="utf-8")
        
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
