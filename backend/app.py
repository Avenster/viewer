# app.py (with admin auto-create and multi-token support)
import os
import uuid
import json
import atexit
import hashlib
import difflib
import zipfile
import tempfile
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pandas as pd
from werkzeug.utils import secure_filename

# ==========================
# CONFIG
# ==========================
UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", "uploads")
GLOBAL_PDF_FOLDER = os.environ.get("GLOBAL_PDF_FOLDER", os.path.join(UPLOAD_FOLDER, "global_pdfs"))
SESSIONS_FILE = os.environ.get("SESSIONS_FILE", "sessions.json")
USERS_FILE = os.environ.get("USERS_FILE", "users.json")
GLOBAL_PDFS_META = os.environ.get("GLOBAL_PDFS_META", "global_pdfs.json")
SESSION_EXPIRY_HOURS = int(os.environ.get("SESSION_EXPIRY_HOURS", "24"))
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://13.201.123.132:3000")
NAME_SIMILARITY_DEFAULT = float(os.environ.get("NAME_SIMILARITY_THRESHOLD", "0.85"))

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(GLOBAL_PDF_FOLDER, exist_ok=True)

# In-memory stores (persisted to disk)
SESSIONS = {}
USERS = {}

app = Flask(__name__)

# CORS: allow frontends
CORS(
    app,
    supports_credentials=False,
    resources={r"/api/*": {"origins": [FRONTEND_URL, "http://13.201.123.132:3000"]}},
    allow_headers=["Content-Type", "X-Session-Token", "X-Auth-Token"],
)

# ==========================
# Robust JSON persistence helpers
# ==========================
def load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        bak = f"{path}.bak"
        try:
            os.rename(path, bak)
            print(f"[LOAD_JSON] Corrupt JSON at {path}; backed up to {bak}. Error: {e}")
        except Exception as rename_err:
            print(f"[LOAD_JSON] Failed to backup corrupt file {path}: {rename_err}. Original error: {e}")
        return default
    except Exception as e:
        print(f"[LOAD_JSON] Failed load {path}: {e}")
        return default

def save_json_file(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[SAVE_JSON] Failed save {path}: {e}")

def load_sessions():
    global SESSIONS
    SESSIONS = load_json_file(SESSIONS_FILE, {})
    print(f"[SESSIONS] Loaded {len(SESSIONS)} sessions")

def save_sessions():
    save_json_file(SESSIONS_FILE, SESSIONS)

# ==========================
# Note: load_users implements migration from legacy single-token format
# to the new `auth_tokens` map (token -> expiry_iso). This keeps backwards
# compatibility with existing users while enabling multiple concurrent tokens.
def load_users():
    global USERS
    raw = load_json_file(USERS_FILE, {})
    USERS = {}
    for uid, u in raw.items():
        if not isinstance(u, dict):
            continue
        # Migration: if legacy "auth_token" present, convert into "auth_tokens"
        if u.get("auth_token") and not u.get("auth_tokens"):
            token = u.get("auth_token")
            expires = u.get("token_expires_at")
            try:
                if expires:
                    _ = datetime.fromisoformat(expires)
            except Exception:
                expires = (datetime.now() + timedelta(days=30)).isoformat()
            u["auth_tokens"] = {token: expires} if token else {}
            u.pop("auth_token", None)
            u.pop("token_expires_at", None)
        # Ensure auth_tokens exists and is a dict
        if "auth_tokens" not in u or not isinstance(u.get("auth_tokens"), dict):
            u["auth_tokens"] = {}
        USERS[uid] = u
    print(f"[USERS] Loaded {len(USERS)} users (migrated auth token format)")

def save_users():
    save_json_file(USERS_FILE, USERS)

# ==========================
# housekeeping: session cleanup
# ==========================
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def clean_expired_sessions():
    global SESSIONS
    now = datetime.now()
    removed = []
    for token, session_data in list(SESSIONS.items()):
        if isinstance(session_data, str):
            continue
        try:
            expires_at = datetime.fromisoformat(session_data.get("expires_at", "2000-01-01"))
        except Exception:
            expires_at = datetime(2000, 1, 1)
        if now > expires_at:
            csv_path = session_data.get("csv_path")
            if csv_path and os.path.exists(csv_path):
                try:
                    os.remove(csv_path)
                except Exception:
                    pass
            removed.append(token)
            del SESSIONS[token]
    if removed:
        print(f"[CLEANUP] Removed {len(removed)} expired sessions")
        save_sessions()

atexit.register(save_sessions)
atexit.register(save_users)
load_sessions()
load_users()
try:
    clean_expired_sessions()
except Exception as e:
    print(f"[CLEANUP] clean_expired_sessions failed during startup: {e}")

# ==========================
# Ensure admin user exists (username: admin, password: admin123)
def ensure_admin_exists():
    # If there's already a user with username "admin", do nothing.
    for u in USERS.values():
        if u.get("username") == "admin":
            print("[ADMIN] Existing 'admin' user found; skipping auto-create.")
            return
    # create admin user
    user_id = uuid.uuid4().hex
    USERS[user_id] = {
        "user_id": user_id,
        "username": "admin",
        "email": "admin@example.com",
        "name": "Administrator",
        "role": "admin",
        "password_hash": hash_password("admin123"),
        "auth_tokens": {},   # new-style tokens map (empty initially)
        "created_at": datetime.now().isoformat()
    }
    save_users()
    print("[ADMIN] Created default admin account -> username: 'admin' password: 'admin123'")

# call it now
ensure_admin_exists()

# ==========================
# Global PDFs metadata helpers
def load_global_pdfs():
    return load_json_file(GLOBAL_PDFS_META, [])

def save_global_pdfs(meta_list):
    save_json_file(GLOBAL_PDFS_META, meta_list)

def compute_file_hash_bytes(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()

def filename_similarity(a: str, b: str) -> float:
    an = os.path.splitext(a)[0].strip().lower()
    bn = os.path.splitext(b)[0].strip().lower()
    return difflib.SequenceMatcher(None, an, bn).ratio()

# ==========================
# CSV helpers
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

# ==========================
# Auth helpers & roles (multi-token support)
def get_auth_token_from_request():
    return request.headers.get("X-Auth-Token") or request.args.get("auth_token")

def verify_auth_token(token):
    if not token:
        return None
    for user_id, user_data in USERS.items():
        tokens = user_data.get("auth_tokens", {}) or {}
        expiry_iso = tokens.get(token)
        if expiry_iso:
            try:
                expires_at = datetime.fromisoformat(expiry_iso)
            except Exception:
                expires_at = datetime(2000,1,1)
            if datetime.now() > expires_at:
                # expired
                continue
            return {
                "user_id": user_id,
                "username": user_data.get("username"),
                "email": user_data.get("email"),
                "name": user_data.get("name"),
                "role": user_data.get("role", "user")
            }
    return None

def require_auth(f):
    def decorated_function(*args, **kwargs):
        token = get_auth_token_from_request()
        user = verify_auth_token(token)
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        request.current_user = user
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

def require_role(role):
    def decorator(f):
        def wrapped(*args, **kwargs):
            token = get_auth_token_from_request()
            user = verify_auth_token(token)
            if not user:
                return jsonify({"error": "Unauthorized"}), 401
            if user.get("role") != role:
                return jsonify({"error": "Forbidden - insufficient role"}), 403
            request.current_user = user
            return f(*args, **kwargs)
        wrapped.__name__ = f.__name__
        return wrapped
    return decorator

def get_session_from_request():
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
            expires_at = datetime(2000,1,1)
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
# Auth routes (signup/login/logout) with multi-token support
# new endpoint: /api/qc/signup
@app.route("/api/qc/signup", methods=["POST"])
def qc_signup():
    """
    Create a QC user.
    Optional protection: set env var QC_SIGNUP_KEY to require a secret key in the body:
      { username, email, password, name, signup_key }
    If QC_SIGNUP_KEY is not set, signup is allowed (useful for dev).
    """
    body = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    email = body.get("email", "").strip()
    password = body.get("password", "")
    name = body.get("name", "").strip()
    provided_key = body.get("signup_key", "")

    # optional protection
    required_key = os.environ.get("QC_SIGNUP_KEY", "")
    if required_key:
        if not provided_key or provided_key != required_key:
            return jsonify({"error": "Invalid signup key"}), 403

    if not username or not email or not password or not name:
        return jsonify({"error": "All fields are required"}), 400

    # check duplicates
    for u in USERS.values():
        if u.get("username") == username or u.get("email") == email:
            return jsonify({"error": "Username or email already exists"}), 400

    user_id = uuid.uuid4().hex
    auth_token = uuid.uuid4().hex
    expires_at = (datetime.now() + timedelta(days=30)).isoformat()
    USERS[user_id] = {
        "user_id": user_id,
        "username": username,
        "email": email,
        "name": name,
        "role": "qc",
        "password_hash": hash_password(password),
        "auth_tokens": { auth_token: expires_at },
        "created_at": datetime.now().isoformat()
    }
    save_users()
    print(f"[QC-SIGNUP] QC user created: {username}")
    return jsonify({
        "message": "QC signup successful",
        "auth_token": auth_token,
        "user": {"user_id": user_id, "username": username, "name": name, "role": "qc"}
    }), 201

# ==========================
@app.route("/api/auth/signup", methods=["POST"])
def signup():
    """
    Public signup -> default role 'user'.
    To create admin/qc programmatically use /api/admin/create-user (admin only).
    """
    body = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    email = body.get("email", "").strip()
    password = body.get("password", "")
    name = body.get("name", "").strip()
    if not username or not email or not password or not name:
        return jsonify({"error": "All fields are required"}), 400
    for user_data in USERS.values():
        if user_data.get("username") == username:
            return jsonify({"error": "Username already exists"}), 400
        if user_data.get("email") == email:
            return jsonify({"error": "Email already exists"}), 400
    user_id = uuid.uuid4().hex
    auth_token = uuid.uuid4().hex
    expires_at = (datetime.now() + timedelta(days=30)).isoformat()
    USERS[user_id] = {
        "user_id": user_id,
        "username": username,
        "email": email,
        "name": name,
        "role": "user",  # default role
        "password_hash": hash_password(password),
        "auth_tokens": { auth_token: expires_at },
        "created_at": datetime.now().isoformat(),
        "upload_sessions": []
    }
    save_users()
    print(f"[SIGNUP] New user: {username} ({email}) role=user")
    return jsonify({
        "message": "Signup successful",
        "auth_token": auth_token,
        "user": {
            "user_id": user_id,
            "username": username,
            "email": email,
            "name": name,
            "role": "user"
        }
    }), 201

@app.route("/api/auth/login", methods=["POST"])
def login():
    body = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    password = body.get("password", "")
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    user_id = None
    user_data = None
    for uid, data in USERS.items():
        if data.get("username") == username or data.get("email") == username:
            user_id = uid
            user_data = data
            break
    if not user_data:
        return jsonify({"error": "Invalid credentials"}), 401
    if user_data.get("password_hash") != hash_password(password):
        return jsonify({"error": "Invalid credentials"}), 401

    # create a new token and add to auth_tokens map (support multiple concurrent tokens)
    auth_token = uuid.uuid4().hex
    expires_at = (datetime.now() + timedelta(days=30)).isoformat()
    tokens = user_data.get("auth_tokens", {}) or {}
    tokens[auth_token] = expires_at
    user_data["auth_tokens"] = tokens
    user_data["last_login"] = datetime.now().isoformat()
    save_users()
    print(f"[LOGIN] User logged in: {username} role={user_data.get('role','user')}")
    return jsonify({
        "message": "Login successful",
        "auth_token": auth_token,
        "user": {
            "user_id": user_id,
            "username": user_data.get("username"),
            "email": user_data.get("email"),
            "name": user_data.get("name"),
            "role": user_data.get("role", "user")
        }
    }), 200

@app.route("/api/auth/verify", methods=["GET"])
def verify_auth():
    token = get_auth_token_from_request()
    user = verify_auth_token(token)
    if not user:
        return jsonify({"error": "Invalid or expired token"}), 401
    return jsonify({"valid": True, "user": user}), 200

@app.route("/api/auth/logout", methods=["POST"])
@require_auth
def logout():
    token = get_auth_token_from_request()
    if not token:
        return jsonify({"error": "No token provided"}), 400
    for user_data in USERS.values():
        tokens = user_data.get("auth_tokens", {}) or {}
        if token in tokens:
            try:
                tokens.pop(token, None)
                user_data["auth_tokens"] = tokens
                save_users()
            except Exception as e:
                print(f"[LOGOUT] failed removing token: {e}")
            break
    return jsonify({"message": "Logged out successfully"}), 200

# New admin-only user creation (create admin or qc)
@app.route("/api/admin/create-user", methods=["POST"])
@require_role("admin")
def admin_create_user():
    body = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    email = body.get("email", "").strip()
    password = body.get("password", "")
    name = body.get("name", "").strip()
    role = body.get("role", "user").strip()
    if role not in ("user", "admin", "qc"):
        return jsonify({"error": "Invalid role"}), 400
    if not username or not email or not password or not name:
        return jsonify({"error": "All fields are required"}), 400
    for u in USERS.values():
        if u.get("username") == username or u.get("email") == email:
            return jsonify({"error": "User exists"}), 400
    user_id = uuid.uuid4().hex
    auth_token = uuid.uuid4().hex
    expires_at = (datetime.now() + timedelta(days=30)).isoformat()
    USERS[user_id] = {
        "user_id": user_id,
        "username": username,
        "email": email,
        "name": name,
        "role": role,
        "password_hash": hash_password(password),
        "auth_tokens": { auth_token: expires_at },
        "created_at": datetime.now().isoformat()
    }
    save_users()
    return jsonify({"message": "User created", "user": {"username": username, "role": role}, "auth_token": auth_token}), 201

# ==========================
# CSV upload & session routes (unchanged)
@app.route("/api/upload", methods=["POST"])
@require_auth
def upload_csv():
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
        df["Verified By"] = user["name"]
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

# ==========================
# PDF upload route with dedupe by name & hash
@app.route("/api/upload-pdf", methods=["POST"])
@require_auth
def upload_pdf():
    NAME_SIMILARITY_THRESHOLD = float(os.environ.get("NAME_SIMILARITY_THRESHOLD", NAME_SIMILARITY_DEFAULT))
    if "pdf_file" not in request.files:
        return jsonify({"error": "No file uploaded (field name must be 'pdf_file')"}), 400
    pdf_file = request.files["pdf_file"]
    if pdf_file.filename.strip() == "":
        return jsonify({"error": "Empty filename"}), 400
    user = request.current_user
    original_filename = secure_filename(pdf_file.filename)
    try:
        file_bytes = pdf_file.read()
    except Exception as e:
        return jsonify({"error": f"Failed to read file: {e}"}), 400
    header_ok = len(file_bytes) >= 4 and file_bytes.startswith(b"%PDF")
    incoming_hash = compute_file_hash_bytes(file_bytes)
    meta = load_global_pdfs()
    name_duplicates = []
    for entry in meta:
        sim = filename_similarity(original_filename, entry.get("original_name", entry.get("stored_name", "")))
        if sim >= NAME_SIMILARITY_THRESHOLD:
            name_duplicates.append({"entry": entry, "similarity": sim})
    if name_duplicates:
        top = sorted(name_duplicates, key=lambda x: x["similarity"], reverse=True)[0]
        return jsonify({
            "duplicate": True,
            "reason": "name_similarity",
            "similarity": top["similarity"],
            "existing": top["entry"],
            "message": f"File appears duplicate by name (similarity={top['similarity']:.2f}).",
            "header_ok": header_ok
        }), 200
    hash_duplicates = [e for e in meta if e.get("sha256") == incoming_hash]
    if hash_duplicates:
        e = hash_duplicates[0]
        return jsonify({
            "duplicate": True,
            "reason": "hash_match",
            "existing": e,
            "message": "File binary matches an existing PDF (same SHA256).",
            "header_ok": header_ok
        }), 200
    stored_name = f"{uuid.uuid4().hex}_{original_filename}"
    stored_path = os.path.join(GLOBAL_PDF_FOLDER, stored_name)
    try:
        with open(stored_path, "wb") as fh:
            fh.write(file_bytes)
    except Exception as e:
        return jsonify({"error": f"Failed to save file: {e}"}), 500
    entry = {
        "id": uuid.uuid4().hex,
        "original_name": original_filename,
        "stored_name": stored_name,
        "path": stored_path,
        "sha256": incoming_hash,
        "uploaded_by": user.get("username"),
        "uploader_name": user.get("name"),
        "uploaded_at": datetime.now().isoformat(),
        "size_bytes": len(file_bytes),
        # review workflow fields
        "status": "",           # "", "Accepted", "Rejected"
        "feedback": "",
        "assigned_to": None,    # qc username
        "assigned_at": None,
        "assigned_by": None
    }
    meta.append(entry)
    save_global_pdfs(meta)
    user_data = USERS.get(user["user_id"])
    if user_data is not None:
        if "global_uploads" not in user_data:
            user_data["global_uploads"] = []
        user_data["global_uploads"].append({
            "id": entry["id"],
            "original_name": entry["original_name"],
            "uploaded_at": entry["uploaded_at"]
        })
        save_users()
    return jsonify({
        "duplicate": False,
        "message": "PDF uploaded and stored in global folder.",
        "entry": {
            "id": entry["id"],
            "original_name": entry["original_name"],
            "stored_name": entry["stored_name"],
            "sha256": entry["sha256"],
            "uploaded_at": entry["uploaded_at"],
            "status": entry["status"]
        },
        "header_ok": header_ok
    }), 201

# ==========================
# List & download global PDFs
@app.route("/api/global-pdfs", methods=["GET"])
@require_auth
def list_global_pdfs():
    meta = load_global_pdfs()
    safe = [{
        "id": e.get("id"),
        "original_name": e.get("original_name"),
        "stored_name": e.get("stored_name"),
        "sha256": e.get("sha256"),
        "uploaded_by": e.get("uploaded_by"),
        "uploader_name": e.get("uploader_name"),
        "uploaded_at": e.get("uploaded_at"),
        "size_bytes": e.get("size_bytes"),
        "status": e.get("status", ""),
        "feedback": e.get("feedback", ""),
        "assigned_to": e.get("assigned_to"),
        "assigned_at": e.get("assigned_at"),
        "assigned_by": e.get("assigned_by")
    } for e in meta]
    return jsonify({"items": safe, "total": len(safe)}), 200

@app.route("/api/global-pdfs/<pdf_id>", methods=["GET"])
@require_auth
def download_global_pdf(pdf_id):
    meta = load_global_pdfs()
    entry = next((e for e in meta if e.get("id") == pdf_id), None)
    if not entry:
        return jsonify({"error": "Not found"}), 404
    path = entry.get("path")
    if not path or not os.path.exists(path):
        return jsonify({"error": "File not available on server"}), 404

    # If client requests preview (e.g. ?preview=1 or ?preview=true), return inline.
    preview = request.args.get("preview", "").lower()
    inline = preview in ("1", "true", "yes")

    try:
        # set mimetype to application/pdf so browsers know how to render
        # send_file will set Content-Disposition: inline when as_attachment=False
        return send_file(
            path,
            mimetype="application/pdf",
            as_attachment=not inline,
            download_name=entry.get("original_name", entry.get("stored_name"))
        )
    except Exception as e:
        return jsonify({"error": f"Failed to send file: {e}"}), 500


# ==========================
# User-specific list & export
@app.route("/api/my-pdfs", methods=["GET"])
@require_auth
def my_pdfs():
    user = request.current_user
    meta = load_global_pdfs()
    items = [ {
        "id": e.get("id"),
        "original_name": e.get("original_name"),
        "uploaded_at": e.get("uploaded_at"),
        "size_bytes": e.get("size_bytes"),
        "status": e.get("status", ""),
        "feedback": e.get("feedback", ""),
        "assigned_to": e.get("assigned_to"),
        "sha256": e.get("sha256")
    } for e in meta if e.get("uploaded_by") == user.get("username")]
    items = sorted(items, key=lambda x: x.get("uploaded_at", ""), reverse=True)
    return jsonify({"items": items, "total": len(items)}), 200

# ==========================
# Admin endpoints
@app.route("/api/admin/global-pdfs", methods=["GET"])
@require_role("admin")
def admin_list_all_pdfs():
    # same as list_global_pdfs but admin-only
    meta = load_global_pdfs()
    safe = [{
        "id": e.get("id"),
        "original_name": e.get("original_name"),
        "stored_name": e.get("stored_name"),
        "sha256": e.get("sha256"),
        "uploaded_by": e.get("uploaded_by"),
        "uploader_name": e.get("uploader_name"),
        "uploaded_at": e.get("uploaded_at"),
        "size_bytes": e.get("size_bytes"),
        "status": e.get("status", ""),
        "feedback": e.get("feedback", ""),
        "assigned_to": e.get("assigned_to"),
        "assigned_at": e.get("assigned_at"),
        "assigned_by": e.get("assigned_by")
    } for e in meta]
    return jsonify({"items": safe, "total": len(safe)}), 200

@app.route("/api/admin/assign", methods=["POST"])
@require_role("admin")
def admin_assign_pdf():
    """
    Body: { "pdf_id": "...", "qc_username": "qc_user" }
    """
    body = request.get_json(silent=True) or {}
    pdf_id = body.get("pdf_id")
    qc_username = body.get("qc_username")
    if not pdf_id or not qc_username:
        return jsonify({"error": "pdf_id and qc_username required"}), 400
    meta = load_global_pdfs()
    idx = next((i for i, e in enumerate(meta) if e.get("id") == pdf_id), None)
    if idx is None:
        return jsonify({"error": "Not found"}), 404
    # verify qc user exists and role=qc
    qc_user = next((u for u in USERS.values() if u.get("username") == qc_username and u.get("role") == "qc"), None)
    if not qc_user:
        return jsonify({"error": "QC user not found or not a QC role"}), 400
    admin_user = request.current_user
    entry = meta[idx]
    entry["assigned_to"] = qc_username
    entry["assigned_at"] = datetime.now().isoformat()
    entry["assigned_by"] = admin_user.get("username")
    meta[idx] = entry
    save_global_pdfs(meta)
    return jsonify({"message": "Assigned", "entry": {"id": pdf_id, "assigned_to": qc_username}}), 200

@app.route("/api/admin/users", methods=["GET"])
@require_role("admin")
def admin_list_users():
    # returns minimal user info
    safe = [{"user_id": uid, "username": u.get("username"), "name": u.get("name"), "role": u.get("role")} for uid, u in USERS.items()]
    return jsonify({"users": safe, "total": len(safe)}), 200

@app.route("/api/admin/global-pdfs/<pdf_id>/status", methods=["POST"])
@require_role("admin")
def admin_update_status(pdf_id):
    """
    Admin can set status for any PDF.
    Body: {status: "Accepted"|"Rejected", feedback: "..."}
    """
    body = request.get_json(silent=True) or {}
    status = body.get("status", "")
    feedback = body.get("feedback", "")
    if status not in ("Accepted", "Rejected", ""):
        return jsonify({"error": "Invalid status"}), 400
    meta = load_global_pdfs()
    idx = next((i for i, e in enumerate(meta) if e.get("id") == pdf_id), None)
    if idx is None:
        return jsonify({"error": "Not found"}), 404
    entry = meta[idx]
    entry["status"] = status
    entry["feedback"] = feedback if status == "Rejected" else ""
    meta[idx] = entry
    save_global_pdfs(meta)
    return jsonify({"message": "Status updated", "entry": {"id": pdf_id, "status": entry["status"], "feedback": entry["feedback"]}}), 200

# ==========================
# QC endpoints
@app.route("/api/qc/tasks", methods=["GET"])
@require_role("qc")
def qc_tasks():
    user = request.current_user
    meta = load_global_pdfs()
    tasks = [ {
        "id": e.get("id"),
        "original_name": e.get("original_name"),
        "uploaded_by": e.get("uploaded_by"),
        "uploaded_at": e.get("uploaded_at"),
        "status": e.get("status", ""),
        "feedback": e.get("feedback", ""),
        "assigned_at": e.get("assigned_at")
    } for e in meta if e.get("assigned_to") == user.get("username")]
    tasks = sorted(tasks, key=lambda x: x.get("assigned_at") or "", reverse=True)
    return jsonify({"items": tasks, "total": len(tasks)}), 200

@app.route("/api/qc/<pdf_id>/status", methods=["POST"])
@require_role("qc")
def qc_update_status(pdf_id):
    body = request.get_json(silent=True) or {}
    status = body.get("status", "")
    feedback = body.get("feedback", "")
    if status not in ("Accepted", "Rejected", ""):
        return jsonify({"error": "Invalid status"}), 400
    user = request.current_user
    meta = load_global_pdfs()
    idx = next((i for i, e in enumerate(meta) if e.get("id") == pdf_id), None)
    if idx is None:
        return jsonify({"error": "Not found"}), 404
    entry = meta[idx]
    if entry.get("assigned_to") != user.get("username"):
        return jsonify({"error": "Forbidden - not assigned to you"}), 403
    entry["status"] = status
    entry["feedback"] = feedback if status == "Rejected" else ""
    meta[idx] = entry
    save_global_pdfs(meta)
    return jsonify({"message": "Status updated", "entry": {"id": pdf_id, "status": entry["status"], "feedback": entry["feedback"]}}), 200

# ==========================
# Export accepted PDFs (user)
@app.route("/api/export-accepted", methods=["GET"])
@require_auth
def export_accepted():
    user = request.current_user
    meta = load_global_pdfs()
    accepted = [e for e in meta if e.get("uploaded_by") == user.get("username") and e.get("status") == "Accepted"]
    if not accepted:
        return jsonify({"error": "No accepted PDFs found to export"}), 400
    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp_name = tmp.name
        tmp.close()
        with zipfile.ZipFile(tmp_name, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for e in accepted:
                path = e.get("path")
                if path and os.path.exists(path):
                    arcname = e.get("original_name") or e.get("stored_name")
                    base = arcname
                    counter = 1
                    while arcname in zf.namelist():
                        arcname = f"{os.path.splitext(base)[0]}_{counter}{os.path.splitext(base)[1]}"
                        counter += 1
                    zf.write(path, arcname=arcname)
        return send_file(tmp_name, as_attachment=True, download_name=f"accepted_pdfs_{user['username']}.zip")
    except Exception as e:
        return jsonify({"error": f"Failed to create zip: {e}"}), 500

# ==========================
# health
@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()}), 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV", "production") != "production"
    print(f"[START] Flask server starting on :{port}")
    app.run(host="0.0.0.0", debug=debug, port=port)
