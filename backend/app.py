import os
import uuid
import json
import atexit
import hashlib
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
USERS_FILE = os.environ.get("USERS_FILE", "users.json")
SESSION_EXPIRY_HOURS = int(os.environ.get("SESSION_EXPIRY_HOURS", "24"))
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

SESSIONS = {}
USERS = {}

# CORS configuration
CORS(
    app,
    supports_credentials=False,
    resources={r"/api/*": {"origins": [FRONTEND_URL, "http://13.201.123.132:3000"]}},
    allow_headers=["Content-Type", "X-Session-Token", "X-Auth-Token"],
)

# ==========================
# Persistence helpers
# ==========================
def load_sessions():
    """Load sessions from disk"""
    global SESSIONS
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                SESSIONS = json.load(f)
                print(f"[SESSIONS] Loaded {len(SESSIONS)} sessions")
                clean_expired_sessions()
        except Exception as e:
            print(f"[SESSIONS] Failed to load: {e}")
            SESSIONS = {}

def save_sessions():
    """Save sessions to disk"""
    try:
        with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(SESSIONS, f)
    except Exception as e:
        print(f"[SESSIONS] Failed to save: {e}")

def load_users():
    """Load users from disk"""
    global USERS
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, "r", encoding="utf-8") as f:
                USERS = json.load(f)
                print(f"[USERS] Loaded {len(USERS)} users")
        except Exception as e:
            print(f"[USERS] Failed to load: {e}")
            USERS = {}

def save_users():
    """Save users to disk"""
    try:
        with open(USERS_FILE, "w", encoding="utf-8") as f:
            json.dump(USERS, f, indent=2)
    except Exception as e:
        print(f"[USERS] Failed to save: {e}")

def hash_password(password: str) -> str:
    """Simple password hashing"""
    return hashlib.sha256(password.encode()).hexdigest()

def clean_expired_sessions():
    """Remove expired sessions"""
    global SESSIONS
    now = datetime.now()
    expired_tokens = []
    
    for token, session_data in list(SESSIONS.items()):
        if isinstance(session_data, str):
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
                except Exception as e:
                    print(f"[CLEANUP] Failed to remove {csv_path}: {e}")
    
    for token in expired_tokens:
        del SESSIONS[token]
    
    if expired_tokens:
        print(f"[CLEANUP] Removed {len(expired_tokens)} expired sessions")
        save_sessions()

atexit.register(save_sessions)
atexit.register(save_users)
load_sessions()
load_users()

# ==========================
# Auth Helpers
# ==========================
def get_auth_token_from_request():
    """Extract auth token from request"""
    return request.headers.get("X-Auth-Token") or request.args.get("auth_token")

def verify_auth_token(token):
    """Verify auth token and return user data"""
    if not token:
        return None
    
    for user_id, user_data in USERS.items():
        if user_data.get("auth_token") == token:
            # Check if token is expired
            try:
                expires_at = datetime.fromisoformat(user_data.get("token_expires_at", "2000-01-01"))
            except Exception:
                expires_at = datetime(2000, 1, 1)
            
            if datetime.now() > expires_at:
                return None
            
            return {
                "user_id": user_id,
                "username": user_data.get("username"),
                "email": user_data.get("email"),
                "name": user_data.get("name")
            }
    return None

def require_auth(f):
    """Decorator to require authentication"""
    def decorated_function(*args, **kwargs):
        token = get_auth_token_from_request()
        user = verify_auth_token(token)
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        request.current_user = user
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

# ==========================
# CSV Helper Functions (from original)
# ==========================
def _normalize_columns_and_get_link_column(df: pd.DataFrame):
    new_cols = [c.strip() if isinstance(c, str) else c for c in df.columns]
    df.columns = new_cols
    lower_map = {str(c).lower(): c for c in df.columns}
    
    for candidate in ("link", "url"):
        if candidate in lower_map:
            orig = lower_map[candidate]
            if orig != "link":
                df = df.rename(columns={orig: "link"})
            return df, "link"
    
    for orig in df.columns:
        if isinstance(orig, str) and ("link" in orig.lower() or "url" in orig.lower()):
            if orig != "link":
                df = df.rename(columns={orig: "link"})
            return df, "link"
    
    return df, None

def _read_csv_with_fallbacks(path: str) -> pd.DataFrame:
    encodings = ["utf-8-sig", "utf-8", "latin1", "cp1252"]
    for enc in encodings:
        try:
            df = pd.read_csv(path, dtype=str, encoding=enc)
            df = df.fillna("")
            return df
        except Exception:
            continue
    raise Exception("Failed to read CSV with all encodings")

def _normalize_status_value(val: str) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    if s == "":
        return ""
    ls = s.lower()
    if ls in ("accept", "accepted", "acept", "acpt") or ls.startswith("accept"):
        return "Accepted"
    if ls in ("reject", "rejected", "rej") or ls.startswith("reject"):
        return "Rejected"
    if s in ("Accepted", "Rejected"):
        return s
    return s

def _find_verified_column(df: pd.DataFrame):
    for c in df.columns:
        if not isinstance(c, str):
            continue
        lc = c.lower().replace("_", " ").strip()
        if "verified" in lc and ("by" in lc or lc.endswith("verified") or lc == "verified"):
            return c
        if lc in ("verified by", "verified_by", "verifiedby", "verified"):
            return c
    for c in df.columns:
        if isinstance(c, str) and "verified" in c.lower():
            return c
    return None

def get_session_from_request():
    """Extract and validate session token"""
    token = request.headers.get("X-Session-Token") or request.args.get("token")
    if not token:
        return None, None
    
    session_data = SESSIONS.get(token)
    if not session_data:
        return None, None
    
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
        try:
            expires_at = datetime.fromisoformat(session_data.get("expires_at", "2000-01-01"))
        except Exception:
            expires_at = datetime(2000, 1, 1)
        if datetime.now() > expires_at:
            csv_path = session_data.get("csv_path")
            if csv_path and os.path.exists(csv_path):
                try:
                    os.remove(csv_path)
                except Exception:
                    pass
            del SESSIONS[token]
            save_sessions()
            return None, None
        
        session_data["last_accessed"] = datetime.now().isoformat()
        save_sessions()
    
    csv_path = session_data.get("csv_path")
    if not csv_path or not os.path.exists(csv_path):
        if token in SESSIONS:
            del SESSIONS[token]
            save_sessions()
        return None, None
    
    return token, csv_path

# ==========================
# Auth Routes
# ==========================
@app.route("/api/auth/signup", methods=["POST"])
def signup():
    """User signup"""
    body = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    email = body.get("email", "").strip()
    password = body.get("password", "")
    name = body.get("name", "").strip()
    
    if not username or not email or not password or not name:
        return jsonify({"error": "All fields are required"}), 400
    
    # Check if username or email already exists
    for user_data in USERS.values():
        if user_data.get("username") == username:
            return jsonify({"error": "Username already exists"}), 400
        if user_data.get("email") == email:
            return jsonify({"error": "Email already exists"}), 400
    
    # Create new user
    user_id = uuid.uuid4().hex
    auth_token = uuid.uuid4().hex
    
    USERS[user_id] = {
        "user_id": user_id,
        "username": username,
        "email": email,
        "name": name,
        "password_hash": hash_password(password),
        "auth_token": auth_token,
        "token_expires_at": (datetime.now() + timedelta(days=30)).isoformat(),
        "created_at": datetime.now().isoformat(),
        "upload_sessions": []
    }
    
    save_users()
    
    print(f"[SIGNUP] New user: {username} ({email})")
    
    return jsonify({
        "message": "Signup successful",
        "auth_token": auth_token,
        "user": {
            "user_id": user_id,
            "username": username,
            "email": email,
            "name": name
        }
    }), 201

@app.route("/api/auth/login", methods=["POST"])
def login():
    """User login"""
    body = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    password = body.get("password", "")
    
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    
    # Find user by username or email
    user_id = None
    user_data = None
    for uid, data in USERS.items():
        if data.get("username") == username or data.get("email") == username:
            user_id = uid
            user_data = data
            break
    
    if not user_data:
        return jsonify({"error": "Invalid credentials"}), 401
    
    # Verify password
    if user_data.get("password_hash") != hash_password(password):
        return jsonify({"error": "Invalid credentials"}), 401
    
    # Generate new auth token
    auth_token = uuid.uuid4().hex
    user_data["auth_token"] = auth_token
    user_data["token_expires_at"] = (datetime.now() + timedelta(days=30)).isoformat()
    user_data["last_login"] = datetime.now().isoformat()
    
    save_users()
    
    print(f"[LOGIN] User logged in: {username}")
    
    return jsonify({
        "message": "Login successful",
        "auth_token": auth_token,
        "user": {
            "user_id": user_id,
            "username": user_data.get("username"),
            "email": user_data.get("email"),
            "name": user_data.get("name")
        }
    }), 200

@app.route("/api/auth/verify", methods=["GET"])
def verify_auth():
    """Verify auth token"""
    token = get_auth_token_from_request()
    user = verify_auth_token(token)
    
    if not user:
        return jsonify({"error": "Invalid or expired token"}), 401
    
    return jsonify({
        "valid": True,
        "user": user
    }), 200

@app.route("/api/auth/logout", methods=["POST"])
@require_auth
def logout():
    """Logout user"""
    token = get_auth_token_from_request()
    
    # Invalidate token
    for user_data in USERS.values():
        if user_data.get("auth_token") == token:
            user_data["auth_token"] = None
            user_data["token_expires_at"] = None
            save_users()
            break
    
    return jsonify({"message": "Logged out successfully"}), 200

# ==========================
# Protected Routes (require auth)
# ==========================
@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()}), 200

@app.route("/api/upload", methods=["POST"])
@require_auth
def upload_csv():
    """Handle CSV file upload (requires auth)"""
    if "csv_file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    csv_file = request.files["csv_file"]
    if csv_file.filename.strip() == "":
        return jsonify({"error": "Empty filename"}), 400
    
    user = request.current_user
    
    filename = secure_filename(csv_file.filename)
    upload_path = os.path.join(UPLOAD_FOLDER, f"{uuid.uuid4().hex}_{filename}")
    csv_file.save(upload_path)
    
    try:
        df = _read_csv_with_fallbacks(upload_path)
    except Exception as e:
        try:
            os.remove(upload_path)
        except Exception:
            pass
        return jsonify({"error": f"Failed to read CSV: {e}"}), 400
    
    df, link_col = _normalize_columns_and_get_link_column(df)
    if not link_col:
        try:
            os.remove(upload_path)
        except Exception:
            pass
        return jsonify({"error": "'link' column not found"}), 400
    
    df["link"] = df["link"].astype(str).str.strip()
    before_count = len(df)
    df = df[df["link"] != ""].reset_index(drop=True)
    removed_empty = before_count - len(df)
    
    original_count = len(df)
    df = df.drop_duplicates(subset=["link"], keep="first").reset_index(drop=True)
    duplicates_removed = original_count - len(df)
    
    # Process columns
    col_map = {c: c.strip() for c in df.columns}
    if any(k != v for k, v in col_map.items()):
        df = df.rename(columns=col_map)
    
    for c in list(df.columns):
        if c.lower() == "status" and c != "Status":
            df = df.rename(columns={c: "Status"})
        if c.lower() == "feedback" and c != "Feedback":
            df = df.rename(columns={c: "Feedback"})
        lc = c.lower().replace("_", " ").strip()
        if "verified" in lc and ("by" in lc or lc == "verified"):
            if c != "Verified By":
                df = df.rename(columns={c: "Verified By"})
    
    if "Status" not in df.columns:
        df["Status"] = ""
    if "Feedback" not in df.columns:
        df["Feedback"] = ""
    if "Verified By" not in df.columns:
        df["Verified By"] = user["name"]  # Set to current user's name
    
    df["Status"] = df["Status"].apply(_normalize_status_value)
    df = df.fillna("")
    
    base, _ext = os.path.splitext(upload_path)
    reviewed_path = f"{base}_reviewed.csv"
    
    try:
        df.to_csv(reviewed_path, index=False, encoding="utf-8")
    except Exception as e:
        try:
            os.remove(upload_path)
        except Exception:
            pass
        return jsonify({"error": f"Failed to save: {e}"}), 500
    
    try:
        os.remove(upload_path)
    except Exception:
        pass
    
    # Create session
    token = uuid.uuid4().hex
    expires_at = datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS)
    
    SESSIONS[token] = {
        "csv_path": reviewed_path,
        "user_id": user["user_id"],
        "username": user["username"],
        "user_name": user["name"],
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at.isoformat(),
        "last_accessed": datetime.now().isoformat(),
        "original_filename": filename
    }
    save_sessions()
    
    # Add session to user's upload history
    user_data = USERS.get(user["user_id"])
    if user_data:
        if "upload_sessions" not in user_data:
            user_data["upload_sessions"] = []
        user_data["upload_sessions"].append({
            "token": token,
            "filename": filename,
            "uploaded_at": datetime.now().isoformat()
        })
        save_users()
    
    clean_expired_sessions()
    
    return jsonify({
        "message": "CSV uploaded successfully",
        "total": len(df),
        "duplicates_removed": duplicates_removed,
        "empty_links_removed": removed_empty,
        "token": token,
        "expires_in_hours": SESSION_EXPIRY_HOURS
    }), 200

@app.route("/api/session-check", methods=["GET"])
@require_auth
def session_check():
    """Check if session token is valid"""
    token, csv_path = get_session_from_request()
    active = bool(token and csv_path and os.path.exists(csv_path))
    
    if active:
        session_data = SESSIONS.get(token, {})
        return jsonify({
            "hasSession": True,
            "expires_at": session_data.get("expires_at"),
            "user_name": session_data.get("user_name")
        }), 200
    else:
        return jsonify({"hasSession": False}), 200

@app.route("/api/data", methods=["GET"])
@require_auth
def get_data():
    """Get data for current session"""
    token, csv_path = get_session_from_request()
    
    if not token or not csv_path:
        return jsonify({"error": "No CSV uploaded or invalid token"}), 401
    
    if not os.path.exists(csv_path):
        return jsonify({"error": "CSV file not found"}), 404
    
    verifier = request.args.get("verifier")
    
    try:
        df = _read_csv_with_fallbacks(csv_path)
    except Exception as e:
        return jsonify({"error": f"Failed to read CSV: {e}"}), 500
    
    df, link_col = _normalize_columns_and_get_link_column(df)
    if not link_col:
        return jsonify({"error": "'link' column missing"}), 500
    
    df["link"] = df["link"].astype(str).str.strip()
    
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
    
    if "Feedback" not in df.columns:
        for c in df.columns:
            if isinstance(c, str) and c.lower() == "feedback":
                df = df.rename(columns={c: "Feedback"})
                break
        if "Feedback" not in df.columns:
            df["Feedback"] = ""
    
    vcol = _find_verified_column(df)
    if vcol and vcol != "Verified By":
        df = df.rename(columns={vcol: "Verified By"})
    if "Verified By" not in df.columns:
        df["Verified By"] = ""
    
    if verifier:
        verifier = str(verifier).strip().lower()
        df = df[df["Verified By"].astype(str).str.strip().str.lower() == verifier].reset_index(drop=True)
    
    df = df.fillna("")
    data = df.to_dict("records")
    
    return jsonify({"data": data, "total": len(data)}), 200

@app.route("/api/update-status", methods=["POST"])
@require_auth
def update_status():
    """Update status and feedback"""
    token, csv_path = get_session_from_request()
    
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No CSV uploaded or invalid token"}), 401
    
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
    
    df, link_col = _normalize_columns_and_get_link_column(df)
    if not link_col:
        return jsonify({"error": "'link' column missing"}), 500
    
    if "Status" not in df.columns:
        df["Status"] = ""
    if "Feedback" not in df.columns:
        df["Feedback"] = ""
    
    target_idx = None
    if link:
        link = str(link).strip()
        matches = df.index[df["link"].astype(str).str.strip() == link].tolist()
        if len(matches) == 0:
            return jsonify({"error": "Link not found"}), 400
        target_idx = matches[0]
    else:
        if index is None:
            return jsonify({"error": "Missing index or link"}), 400
        try:
            idx = int(index)
        except Exception:
            return jsonify({"error": "Invalid index"}), 400
        if not (0 <= idx < len(df)):
            return jsonify({"error": "Invalid index"}), 400
        target_idx = idx
    
    canonical = _normalize_status_value(status)
    df.loc[target_idx, "Status"] = canonical
    df.loc[target_idx, "Feedback"] = feedback if canonical == "Rejected" else ""
    
    df = df.fillna("")
    try:
        df.to_csv(csv_path, index=False, encoding="utf-8")
    except Exception as e:
        return jsonify({"error": f"Failed to save: {e}"}), 500
    
    return jsonify({"message": f"Marked as {canonical}"}), 200

@app.route("/api/download", methods=["GET"])
@require_auth
def download_csv():
    """Download reviewed CSV"""
    token, csv_path = get_session_from_request()
    
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No CSV available"}), 401
    
    try:
        df = _read_csv_with_fallbacks(csv_path)
        df, _ = _normalize_columns_and_get_link_column(df)
        
        if "Status" in df.columns:
            df["Status"] = df["Status"].apply(_normalize_status_value)
        
        vcol = _find_verified_column(df)
        if vcol and vcol != "Verified By":
            df = df.rename(columns={vcol: "Verified By"})
        
        if "link" in df.columns:
            df = df.drop_duplicates(subset=["link"], keep="first")
        
        temp_path = csv_path.replace(".csv", "_download.csv")
        df.to_csv(temp_path, index=False, encoding="utf-8")
        
        session_data = SESSIONS.get(token, {})
        original_name = session_data.get("original_filename", "reviewed_results.csv")
        download_name = f"reviewed_{original_name}"
        
        response = send_file(temp_path, as_attachment=True, download_name=download_name)
        
        @response.call_on_close
        def cleanup():
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except Exception:
                pass
        
        return response
    except Exception as e:
        return jsonify({"error": f"Download failed: {e}"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV", "production") != "production"
    print(f"[START] Flask server starting on :{port}")
    app.run(host="0.0.0.0", debug=debug, port=port)