import os
import uuid
import json
import atexit
import secrets
import hashlib
import re
import posixpath
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, quote, unquote
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import pandas as pd
from functools import wraps
from math import floor

app = Flask(__name__)

# ==========================
# CONFIGURATION - SIMPLIFIED CORS
# ==========================
CORS(app, resources={
    r"/api/*": {
        "origins": ["http://localhost:5173", "http://13.201.123.132:3000"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "X-Session-Token", "X-Auth-Token", "X-Admin-Token"],
        "supports_credentials": False,
        "expose_headers": ["X-Already-Authenticated"]
    }
})
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'csv'}

# Sessions and tokens never expire (long duration)
SESSION_TIMEOUT = timedelta(days=36500)
AUTH_TOKEN_TIMEOUT = timedelta(days=36500)
ADMIN_TOKEN_TIMEOUT = timedelta(days=1)

# File paths
SESSIONS_FILE = "sessions.json"
USERS_FILE = "users.json"
ADMIN_CREDENTIALS_FILE = "admin_credentials.json"
WORK_ASSIGNMENTS_FILE = "work_assignments.json"
ADMIN_TOKENS_FILE = "admin_tokens.json"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ==========================
# IN-MEMORY STORAGE
# ==========================
SESSIONS = {}
USERS = {}
AUTH_TOKENS = {}
ADMIN_TOKENS = {}
WORK_ASSIGNMENTS = {}

# ==========================
# ADMIN TOKEN PERSISTENCE
# ==========================
def save_admin_tokens():
    try:
        with open(ADMIN_TOKENS_FILE, 'w') as f:
            json.dump(ADMIN_TOKENS, f, indent=2)
        print(f"[ADMIN TOKENS] Saved {len(ADMIN_TOKENS)} token(s)")
    except Exception as e:
        print(f"[ERROR] Failed to save admin tokens: {e}")

def load_admin_tokens():
    global ADMIN_TOKENS
    if os.path.exists(ADMIN_TOKENS_FILE):
        try:
            with open(ADMIN_TOKENS_FILE, 'r') as f:
                ADMIN_TOKENS = json.load(f)
            now = datetime.now()
            expired = []
            for token, data in list(ADMIN_TOKENS.items()):
                expires_at_str = data.get('expires_at')
                if not expires_at_str:
                    expired.append(token)
                    continue
                try:
                    expires_at = datetime.fromisoformat(expires_at_str)
                except Exception:
                    expired.append(token)
                    continue
                if now > expires_at:
                    expired.append(token)
            for t in expired:
                ADMIN_TOKENS.pop(t, None)
            if expired:
                print(f"[ADMIN TOKENS] Purged {len(expired)} expired token(s)")
                save_admin_tokens()
            print(f"[ADMIN TOKENS] Loaded {len(ADMIN_TOKENS)} active token(s)")
        except Exception as e:
            print(f"[ERROR] Failed to load admin tokens: {e}")
            ADMIN_TOKENS = {}
    else:
        ADMIN_TOKENS = {}
        print("[ADMIN TOKENS] No existing admin tokens file found")

# ==========================
# AUTH DECORATORS
# ==========================
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_token = request.headers.get('X-Auth-Token')
        if not auth_token or auth_token not in AUTH_TOKENS:
            return jsonify({"error": "Unauthorized", "code": "AUTH_REQUIRED"}), 401
        AUTH_TOKENS[auth_token]['last_used'] = datetime.now().isoformat()
        request.user = AUTH_TOKENS[auth_token]
        return f(*args, **kwargs)
    return decorated

def require_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        admin_token = request.headers.get('X-Admin-Token')
        if not admin_token or admin_token not in ADMIN_TOKENS:
            return jsonify({"error": "Unauthorized", "code": "ADMIN_REQUIRED"}), 401
        token_data = ADMIN_TOKENS[admin_token]
        expires_at_str = token_data.get('expires_at')
        if not expires_at_str:
            ADMIN_TOKENS.pop(admin_token, None)
            save_admin_tokens()
            return jsonify({"error": "Token expired"}), 401
        try:
            expires_at = datetime.fromisoformat(expires_at_str)
        except Exception:
            ADMIN_TOKENS.pop(admin_token, None)
            save_admin_tokens()
            return jsonify({"error": "Token expired"}), 401
        if datetime.now() > expires_at:
            ADMIN_TOKENS.pop(admin_token, None)
            save_admin_tokens()
            return jsonify({"error": "Token expired"}), 401
        # Auto-extend
        ADMIN_TOKENS[admin_token]['expires_at'] = (datetime.now() + ADMIN_TOKEN_TIMEOUT).isoformat()
        save_admin_tokens()
        return f(*args, **kwargs)
    return decorated

def check_already_authenticated(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_token = request.headers.get('X-Auth-Token')
        if auth_token and auth_token in AUTH_TOKENS:
            token_data = AUTH_TOKENS[auth_token]
            return jsonify({
                "error": "Already authenticated",
                "code": "ALREADY_AUTHENTICATED",
                "user": {
                    "user_id": token_data.get('user_id'),
                    "username": token_data['username'],
                    "email": token_data['email'],
                    "name": token_data['name']
                }
            }), 403
        return f(*args, **kwargs)
    return decorated

# ==========================
# HELPERS
# ==========================
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def generate_token():
    return secrets.token_urlsafe(32)

def calculate_file_hash(filepath):
    hash_md5 = hashlib.md5()
    try:
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()
    except Exception as e:
        print(f"[HASH ERROR] {e}")
        return None

def canonicalize_link(url: str) -> str:
    u = str(url or '').strip().strip('\'"<>')
    if not u:
        return ''
    if not re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', u):
        u = 'http://' + u
    parsed = urlparse(u)
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    if netloc.endswith(':80') and scheme == 'http':
        netloc = netloc[:-3]
    if netloc.endswith(':443') and scheme == 'https':
        netloc = netloc[:-4]
    path = re.sub(r'/+', '/', parsed.path or '')
    path = unquote(path)
    path = posixpath.normpath(path)
    if parsed.path.endswith('/') and not path.endswith('/'):
        path += '/'
    path = quote(path, safe='/%._-')
    # Remove tracking params locally (still useful for per-file dedupe)
    tracking_prefixes = ('utm_',)
    tracking_keys = {'gclid', 'fbclid', 'mc_eid', 'mc_cid', 'igshid', 'ref', 'ref_', 'spm', 'ved'}
    q = []
    for k, v in parse_qsl(parsed.query, keep_blank_values=True):
        kl = k.lower()
        if kl.startswith(tracking_prefixes) or kl in tracking_keys:
            continue
        q.append((kl, v))
    q.sort()
    query = urlencode(q, doseq=True)
    canon = urlunparse((scheme, netloc, path, '', query, ''))
    if canon.startswith('http://'):
        canon = 'https://' + canon[len('http://'):]
    if canon.lower().endswith('.pdf/'):
        canon = canon[:-1]
    return canon

def save_sessions():
    try:
        with open(SESSIONS_FILE, 'w') as f:
            json.dump(SESSIONS, f, indent=2)
        print(f"[SESSIONS] Saved {len(SESSIONS)}")
    except Exception as e:
        print(f"[ERROR] Failed to save sessions: {e}")

def load_sessions():
    global SESSIONS
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE, 'r') as f:
                SESSIONS = json.load(f)
            print(f"[SESSIONS] Loaded {len(SESSIONS)}")
        except Exception as e:
            print(f"[ERROR] Failed to load sessions: {e}")
            SESSIONS = {}
    else:
        SESSIONS = {}

def save_users():
    try:
        with open(USERS_FILE, 'w') as f:
            json.dump(USERS, f, indent=2)
        print(f"[USERS] Saved {len(USERS)}")
    except Exception as e:
        print(f"[ERROR] Failed to save users: {e}")

def load_users():
    global USERS
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, 'r') as f:
                USERS = json.load(f)
            print(f"[USERS] Loaded {len(USERS)}")
        except Exception as e:
            print(f"[ERROR] Failed to load users: {e}")
            USERS = {}
    else:
        USERS = {}

def save_work_assignments():
    try:
        with open(WORK_ASSIGNMENTS_FILE, 'w') as f:
            json.dump(WORK_ASSIGNMENTS, f, indent=2)
        print(f"[WORK] Saved work assignments")
    except Exception as e:
        print(f"[ERROR] Failed to save work assignments: {e}")

def load_work_assignments():
    global WORK_ASSIGNMENTS
    if os.path.exists(WORK_ASSIGNMENTS_FILE):
        try:
            with open(WORK_ASSIGNMENTS_FILE, 'r') as f:
                WORK_ASSIGNMENTS = json.load(f)
            print(f"[WORK] Loaded work assignments")
        except Exception as e:
            print(f"[ERROR] Failed to load work assignments: {e}")
            WORK_ASSIGNMENTS = {}
    else:
        WORK_ASSIGNMENTS = {}

def cleanup_expired_admin_tokens():
    global ADMIN_TOKENS
    now = datetime.now()
    expired = []
    for token, data in list(ADMIN_TOKENS.items()):
        try:
            expires_at = datetime.fromisoformat(data.get('expires_at', datetime.min.isoformat()))
        except Exception:
            expires_at = datetime.min
        if now > expires_at:
            expired.append(token)
    for token in expired:
        ADMIN_TOKENS.pop(token, None)
    if expired:
        print(f"[CLEANUP] Removed {len(expired)} expired admin tokens")
        save_admin_tokens()

def init_admin():
    if not os.path.exists(ADMIN_CREDENTIALS_FILE):
        default_admin = {
            "username": "admin",
            "password_hash": generate_password_hash("admin123"),
            "created_at": datetime.now().isoformat()
        }
        with open(ADMIN_CREDENTIALS_FILE, 'w') as f:
            json.dump(default_admin, f, indent=2)
        print("[ADMIN] Created default admin (admin/admin123) - CHANGE THIS IN PRODUCTION")
    else:
        print("[ADMIN] Credentials file exists")

# ==========================
# STARTUP
# ==========================
print("\n" + "="*60)
print("PDF REVIEWER BACKEND - Starting...")
print("="*60)
init_admin()
load_admin_tokens()
load_users()
load_sessions()
load_work_assignments()
cleanup_expired_admin_tokens()
print("="*60)

# ==========================
# SHUTDOWN
# ==========================
def cleanup():
    print("\n[SHUTDOWN] Saving data...")
    save_sessions()
    save_users()
    save_work_assignments()
    save_admin_tokens()
    print("[SHUTDOWN] Complete")

atexit.register(cleanup)

# ==========================
# AUTH ROUTES
# ==========================
@app.route('/api/auth/signup', methods=['POST'])
@check_already_authenticated
def signup():
    try:
        data = request.json
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        if not username or not email or not password or not name:
            return jsonify({"error": "All fields are required"}), 400
        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400
        for uid, user in USERS.items():
            if user['username'] == username:
                return jsonify({"error": "Username already exists"}), 400
            if user['email'] == email:
                return jsonify({"error": "Email already exists"}), 400
        user_id = str(uuid.uuid4())
        USERS[user_id] = {
            "username": username,
            "email": email,
            "password_hash": generate_password_hash(password),
            "name": name,
            "created_at": datetime.now().isoformat(),
            "is_active": True
        }
        save_users()
        auth_token = generate_token()
        AUTH_TOKENS[auth_token] = {
            "user_id": user_id,
            "username": username,
            "email": email,
            "name": name,
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + AUTH_TOKEN_TIMEOUT).isoformat(),
            "last_used": datetime.now().isoformat()
        }
        print(f"[SIGNUP] New user: {username}")
        return jsonify({
            "success": True,
            "token": auth_token,
            "user": {
                "user_id": user_id,
                "username": username,
                "email": email,
                "name": name
            }
        })
    except Exception as e:
        print(f"[SIGNUP ERROR] {e}")
        return jsonify({"error": "Signup failed"}), 500

@app.route('/api/auth/login', methods=['POST'])
@check_already_authenticated
def login():
    try:
        data = request.json
        username_or_email = data.get('username', '').strip()
        password = data.get('password', '').strip()
        if not username_or_email or not password:
            return jsonify({"error": "Username/email and password required"}), 400
        user_found = None
        user_id_found = None
        for user_id, user in USERS.items():
            if user['username'] == username_or_email or user['email'] == username_or_email:
                if check_password_hash(user['password_hash'], password):
                    user_found = user
                    user_id_found = user_id
                    break
        if not user_found:
            return jsonify({"error": "Invalid credentials"}), 401
        if not user_found.get('is_active', True):
            return jsonify({"error": "Account is deactivated"}), 403
        auth_token = generate_token()
        AUTH_TOKENS[auth_token] = {
            "user_id": user_id_found,
            "username": user_found['username'],
            "email": user_found['email'],
            "name": user_found['name'],
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + AUTH_TOKEN_TIMEOUT).isoformat(),
            "last_used": datetime.now().isoformat()
        }
        print(f"[LOGIN] User logged in: {user_found['username']}")
        return jsonify({
            "success": True,
            "token": auth_token,
            "user": {
                "user_id": user_id_found,
                "username": user_found['username'],
                "email": user_found['email'],
                "name": user_found['name']
            }
        })
    except Exception as e:
        print(f"[LOGIN ERROR] {e}")
        return jsonify({"error": "Login failed"}), 500

@app.route('/api/auth/logout', methods=['POST'])
@require_auth
def logout():
    try:
        auth_token = request.headers.get('X-Auth-Token')
        if auth_token and auth_token in AUTH_TOKENS:
            username = AUTH_TOKENS[auth_token].get('username', 'Unknown')
            del AUTH_TOKENS[auth_token]
            print(f"[LOGOUT] {username}")
        return jsonify({"success": True})
    except Exception as e:
        print(f"[LOGOUT ERROR] {e}")
        return jsonify({"error": "Logout failed"}), 500

@app.route('/api/auth/verify', methods=['GET'])
def verify_auth():
    try:
        auth_token = request.headers.get('X-Auth-Token')
        if not auth_token or auth_token not in AUTH_TOKENS:
            return jsonify({"error": "Invalid token", "code": "INVALID_TOKEN"}), 401
        token_data = AUTH_TOKENS[auth_token]
        AUTH_TOKENS[auth_token]['last_used'] = datetime.now().isoformat()
        return jsonify({
            "success": True,
            "user": {
                "user_id": token_data.get('user_id'),
                "username": token_data['username'],
                "email": token_data['email'],
                "name": token_data['name']
            }
        })
    except Exception as e:
        print(f"[AUTH VERIFY ERROR] {e}")
        return jsonify({"error": "Verification failed"}), 500

# ==========================
# ADMIN ROUTES
# ==========================
@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    try:
        data = request.json
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        if not username or not password:
            return jsonify({"error": "Username and password required"}), 400
        with open(ADMIN_CREDENTIALS_FILE, 'r') as f:
            admin = json.load(f)
        if admin['username'] == username and check_password_hash(admin['password_hash'], password):
            token = generate_token()
            ADMIN_TOKENS[token] = {
                "username": username,
                "created_at": datetime.now().isoformat(),
                "expires_at": (datetime.now() + ADMIN_TOKEN_TIMEOUT).isoformat()
            }
            save_admin_tokens()
            print(f"[ADMIN LOGIN] {username}")
            return jsonify({"success": True, "token": token})
        else:
            return jsonify({"error": "Invalid credentials"}), 401
    except Exception as e:
        print(f"[ADMIN LOGIN ERROR] {e}")
        return jsonify({"error": "Login failed"}), 500

@app.route('/api/admin/verify', methods=['GET'])
@require_admin
def admin_verify():
    try:
        admin_token = request.headers.get('X-Admin-Token')
        token_data = ADMIN_TOKENS.get(admin_token, {})
        return jsonify({
            "success": True,
            "admin": {
                "username": token_data.get("username", "admin"),
                "expires_at": token_data.get("expires_at")
            }
        })
    except Exception as e:
        print(f"[ADMIN VERIFY ERROR] {e}")
        return jsonify({"error": "Verification failed"}), 500

@app.route('/api/admin/users', methods=['GET'])
@require_admin
def get_users_list():
    try:
        load_users()
        users_list = []
        for user_id, user in USERS.items():
            if user.get('is_active', True):
                users_list.append({
                    "id": user_id,
                    "username": user['username'],
                    "name": user['name'],
                    "email": user['email'],
                    "created_at": user.get('created_at', '')
                })
        users_list.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        print(f"[GET USERS] {len(users_list)} active users")
        return jsonify({"users": users_list})
    except Exception as e:
        print(f"[GET USERS ERROR] {e}")
        return jsonify({"error": "Failed to get users"}), 500

@app.route('/api/admin/upload-assign', methods=['POST'])
@require_admin
def upload_assign():
    """
    Admin uploads CSV and assigns work to users.
    Only within-file de-duplication (canonical + drop_duplicates).
    """
    try:
        if 'csv_file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        file = request.files['csv_file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        if not allowed_file(file.filename):
            return jsonify({"error": "Only CSV files allowed"}), 400

        assignments_json = request.form.get('assignments')
        assignment_type = request.form.get('assignment_type', 'percentage')
        if not assignments_json:
            return jsonify({"error": "No assignments provided"}), 400
        try:
            assignments = json.loads(assignments_json)
        except Exception:
            return jsonify({"error": "Invalid assignments format"}), 400

        load_users()

        # Prevent assigning if user already has admin-assigned work
        users_with_assignments = []
        for assignment in assignments:
            user_id = assignment.get('userId')
            if not user_id or user_id not in USERS:
                continue
            username = USERS[user_id]['username']
            for session_token, session in SESSIONS.items():
                if (session.get('username') == username or session.get('user_id') == user_id) and session.get('assigned_by_admin', False):
                    users_with_assignments.append(USERS[user_id]['name'])
                    break
        if users_with_assignments:
            return jsonify({
                "error": f"The following users already have admin-assigned work: {', '.join(set(users_with_assignments))}. Remove their existing assignments first."
            }), 400

        filename = secure_filename(file.filename)
        unique_filename = f"{uuid.uuid4()}_{filename}"
        filepath = os.path.join(UPLOAD_FOLDER, unique_filename)
        file.save(filepath)
        file_hash = calculate_file_hash(filepath)

        df = pd.read_csv(filepath)
        df.columns = df.columns.str.strip()
        link_col = None
        for col in df.columns:
            if col.lower() in ['link', 'url', 'pdf', 'pdf_link']:
                link_col = col
                break
        if link_col is None:
            os.remove(filepath)
            return jsonify({"error": "CSV must contain a 'link' or 'URL' column"}), 400
        if link_col != 'link':
            df.rename(columns={link_col: 'link'}, inplace=True)

        df['link'] = df['link'].astype(str).apply(canonicalize_link)
        df = df[df['link'].str.len() > 0].copy()

        original_count = len(df)
        df_clean = df.drop_duplicates(subset=['link'], keep='first').copy()
        unique_count_all = len(df_clean)
        duplicates_removed_count = original_count - unique_count_all

        if unique_count_all == 0:
            os.remove(filepath)
            return jsonify({
                "error": "After de-duplication there are 0 unique links to assign. Please upload a different file."
            }), 400

        if 'Status' not in df_clean.columns:
            df_clean['Status'] = ''
        if 'Feedback' not in df_clean.columns:
            df_clean['Feedback'] = ''

        total_pdfs = len(df_clean)
        user_sessions = {}
        assigned_total_count = 0

        if assignment_type == 'range':
            used = set()
            for a in assignments:
                user_id = a.get('userId')
                if user_id not in USERS:
                    return jsonify({"error": "One or more selected users no longer exist"}), 400
                start_range = int(a.get('startRange', 0))
                end_range = int(a.get('endRange', 0))
                if start_range < 1 or end_range < 1:
                    return jsonify({"error": "Range values must be >= 1"}), 400
                if start_range > end_range:
                    return jsonify({"error": "Start range cannot be greater than end range"}), 400
                if end_range > total_pdfs:
                    return jsonify({"error": f"Range exceeds total PDFs ({total_pdfs})"}), 400
                for i in range(start_range, end_range + 1):
                    if i in used:
                        return jsonify({"error": f"Overlapping ranges detected at index {i}"}), 400
                for i in range(start_range, end_range + 1):
                    used.add(i)

            for a in assignments:
                user_id = a['userId']
                user = USERS[user_id]
                start_range = int(a.get('startRange'))
                end_range = int(a.get('endRange'))
                start_idx = start_range - 1
                end_idx = end_range
                user_df = df_clean.iloc[start_idx:end_idx].copy()
                if user_df.empty:
                    return jsonify({"error": f"Computed 0 PDFs for {user['name']} with range {start_range}-{end_range}"}), 400
                if 'Verified By' not in user_df.columns:
                    user_df['Verified By'] = user['name']
                session_token = generate_token()
                SESSIONS[session_token] = {
                    "filename": unique_filename,
                    "filepath": filepath,
                    "file_hash": file_hash,
                    "data": user_df.to_dict('records'),
                    "username": user['username'],
                    "email": user['email'],
                    "name": user['name'],
                    "user_id": user_id,
                    "created_at": datetime.now().isoformat(),
                    "expires_at": (datetime.now() + SESSION_TIMEOUT).isoformat(),
                    "last_accessed": datetime.now().isoformat(),
                    "assigned_by_admin": True,
                    "assigned_count": len(user_df),
                    "assigned_range": f"{start_range}-{end_range}",
                    "duplicates_removed": duplicates_removed_count
                }
                user_sessions[user_id] = {
                    "session_token": session_token,
                    "username": user['username'],
                    "name": user['name'],
                    "data": user_df.to_dict('records'),
                    "range": f"{start_range}-{end_range}"
                }
                assigned_total_count += len(user_df)

        else:  # percentage
            cleaned = []
            for a in assignments:
                pct = a.get('percentage', 0)
                try:
                    pct = float(pct)
                except Exception:
                    return jsonify({"error": "Percentages must be numeric"}), 400
                if pct <= 0:
                    continue
                a['percentage'] = pct
                cleaned.append(a)
            if len(cleaned) == 0:
                return jsonify({"error": "No positive percentages provided"}), 400
            total_pct = sum(a['percentage'] for a in cleaned)
            if total_pct > 100 + 1e-6:
                return jsonify({"error": f"Total percentage cannot exceed 100 (got {total_pct})"}), 400
            target_total = floor(total_pdfs * (total_pct / 100.0))
            if target_total <= 0:
                return jsonify({"error": "Computed 0 PDFs to assign with given percentages. Increase percentages."}), 400
            alloc = [0] * len(cleaned)
            remainders = []
            base_sum = 0
            for idx, a in enumerate(cleaned):
                exact = total_pdfs * a['percentage'] / 100.0
                base = floor(exact)
                base_sum += base
                alloc[idx] = base
                remainders.append((exact - base, idx))
            leftover = max(0, target_total - base_sum)
            remainders.sort(reverse=True)
            i = 0
            while leftover > 0 and i < len(remainders):
                _, idx = remainders[i]
                alloc[idx] += 1
                leftover -= 1
                i += 1
            final = [(idx, a, alloc[idx]) for idx, a in enumerate(cleaned) if alloc[idx] > 0]
            if len(final) == 0:
                return jsonify({"error": "After rounding, 0 PDFs were assigned. Adjust percentages."}), 400
            current_index = 0
            for _, a, count in final:
                user_id = a['userId']
                if user_id not in USERS:
                    return jsonify({"error": "One or more selected users no longer exist"}), 400
                user = USERS[user_id]
                start_idx = current_index
                end_idx = start_idx + count
                user_df = df_clean.iloc[start_idx:end_idx].copy()
                current_index = end_idx
                if user_df.empty:
                    continue
                if 'Verified By' not in user_df.columns:
                    user_df['Verified By'] = user['name']
                session_token = generate_token()
                SESSIONS[session_token] = {
                    "filename": unique_filename,
                    "filepath": filepath,
                    "file_hash": file_hash,
                    "data": user_df.to_dict('records'),
                    "username": user['username'],
                    "email": user['email'],
                    "name": user['name'],
                    "user_id": user_id,
                    "created_at": datetime.now().isoformat(),
                    "expires_at": (datetime.now() + SESSION_TIMEOUT).isoformat(),
                    "last_accessed": datetime.now().isoformat(),
                    "assigned_by_admin": True,
                    "assigned_count": len(user_df),
                    "assigned_percentage": a['percentage'],
                    "duplicates_removed": duplicates_removed_count
                }
                user_sessions[user_id] = {
                    "session_token": session_token,
                    "username": user['username'],
                    "name": user['name'],
                    "data": user_df.to_dict('records'),
                    "percentage": a['percentage']
                }
                assigned_total_count += len(user_df)

        if assigned_total_count == 0:
            os.remove(filepath)
            return jsonify({"error": "No rows were assigned after processing. Adjust ranges/percentages."}), 400

        assignment_id = str(uuid.uuid4())
        WORK_ASSIGNMENTS[assignment_id] = {
            "filename": unique_filename,
            "file_hash": file_hash,
            "original_count": original_count,
            "unique_count": assigned_total_count,
            "duplicates_count": duplicates_removed_count,
            "assignment_type": assignment_type,
            "assignments": [
                {
                    "user_id": uid,
                    "username": sess['username'],
                    "name": sess['name'],
                    "session_token": sess['session_token'],
                    "assigned_count": len(sess['data']),
                    "range": sess.get('range') if assignment_type == 'range' else None,
                    "percentage": sess.get('percentage') if assignment_type == 'percentage' else None
                }
                for uid, sess in user_sessions.items()
            ],
            "created_at": datetime.now().isoformat(),
            "created_by": "admin"
        }

        save_sessions()
        save_work_assignments()
        print(f"[ADMIN UPLOAD] Assigned {assigned_total_count} (orig={original_count} removed={duplicates_removed_count}) to {len(user_sessions)} users")

        return jsonify({
            "success": True,
            "message": "Work assigned successfully",
            "assignment_id": assignment_id,
            "assignment_type": assignment_type,
            "total_pdfs": original_count,
            "unique_pdfs_available": unique_count_all,
            "assigned_pdfs": assigned_total_count,
            "duplicates_removed": duplicates_removed_count,
            "users_assigned": len(user_sessions)
        })
    except Exception as e:
        print(f"[ADMIN UPLOAD ERROR] {e}")
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route('/api/admin/remove-session/<session_token>', methods=['DELETE'])
@require_admin
def remove_session(session_token):
    try:
        if session_token not in SESSIONS:
            return jsonify({"error": "Session not found"}), 404
        username = SESSIONS[session_token].get('username', 'Unknown')
        del SESSIONS[session_token]
        save_sessions()
        print(f"[ADMIN] Removed session for {username}")
        return jsonify({"success": True, "message": f"Session removed for {username}"})
    except Exception as e:
        print(f"[REMOVE SESSION ERROR] {e}")
        return jsonify({"error": "Failed to remove session"}), 500

@app.route('/api/admin/dashboard', methods=['GET'])
@require_admin
def admin_dashboard():
    try:
        all_sessions = []
        total_pdfs = 0
        total_accepted = 0
        total_rejected = 0
        total_pending = 0
        total_duplicates_removed = 0
        unique_users = set()

        for token, session in SESSIONS.items():
            df_data = session.get('data', [])
            total_pdfs += len(df_data)
            accepted = sum(1 for item in df_data if str(item.get('Status', '')).strip().lower() == 'accepted')
            rejected = sum(1 for item in df_data if str(item.get('Status', '')).strip().lower() == 'rejected')
            pending = sum(1 for item in df_data if str(item.get('Status', '')).strip().lower() in ['', 'pending'])
            total_accepted += accepted
            total_rejected += rejected
            total_pending += pending
            username = session.get('username', 'Unknown')
            unique_users.add(username)
            duplicates_removed = session.get('duplicates_removed', 0)
            total_duplicates_removed += duplicates_removed
            all_sessions.append({
                "token": token[:8] + "...",
                "full_token": token,
                "username": username,
                "email": session.get('email', ''),
                "name": session.get('name', ''),
                "created_at": session.get('created_at', ''),
                "expires_at": session.get('expires_at', ''),
                "last_accessed": session.get('last_accessed', ''),
                "total_pdfs": len(df_data),
                "accepted": accepted,
                "rejected": rejected,
                "pending": pending,
                "duplicates_removed": duplicates_removed,
                "assigned_by_admin": session.get('assigned_by_admin', False),
                "assigned_count": session.get('assigned_count', len(df_data)),
                "assigned_range": session.get('assigned_range'),
                "assigned_percentage": session.get('assigned_percentage')
            })

        total_assigned_links = sum(s.get('assigned_count', 0) for s in all_sessions)
        completion_rate = 0
        if total_assigned_links > 0:
            completed = total_accepted + total_rejected
            completion_rate = round((completed / total_assigned_links) * 100, 1)

        stats = {
            "total_sessions": len(SESSIONS),
            "total_users": len(unique_users),
            "total_pdfs": total_pdfs,
            "total_accepted": total_accepted,
            "total_rejected": total_rejected,
            "total_pending": total_pending,
            "total_duplicates_removed": total_duplicates_removed,
            "total_assigned_links": total_assigned_links,
            "completion_rate": completion_rate
        }
        print(f"[ADMIN DASHBOARD] Sessions: {len(all_sessions)}")
        return jsonify({"sessions": all_sessions, "stats": stats})
    except Exception as e:
        print(f"[ADMIN DASHBOARD ERROR] {e}")
        return jsonify({"error": "Failed to load dashboard"}), 500

@app.route('/api/admin/user-report/<session_token>', methods=['GET'])
@require_admin
def get_user_report(session_token):
    try:
        if session_token not in SESSIONS:
            return jsonify({"error": "Session not found"}), 404
        session = SESSIONS[session_token]
        data = session.get('data', [])
        total_assigned = len(data)
        completed = sum(1 for item in data if str(item.get('Status', '')).strip().lower() in ['accepted', 'rejected'])
        pending = sum(1 for item in data if str(item.get('Status', '')).strip().lower() in ['', 'pending'])
        accepted = sum(1 for item in data if str(item.get('Status', '')).strip().lower() == 'accepted')
        rejected = sum(1 for item in data if str(item.get('Status', '')).strip().lower() == 'rejected')
        acceptance_rate = (accepted / completed * 100) if completed > 0 else 0
        rejection_rate = (rejected / completed * 100) if completed > 0 else 0
        total_qc_time_minutes = completed * 3.67
        avg_time_per_file = total_qc_time_minutes / completed if completed > 0 else 0
        duplicates_removed = session.get('duplicates_removed', 0)
        report = {
            "qc_person": session.get('name', 'Unknown'),
            "username": session.get('username', 'Unknown'),
            "email": session.get('email', 'Unknown'),
            "date": datetime.now().strftime("%d %b %Y"),
            "data_type": "PDF",
            "total_assigned": total_assigned,
            "files_completed": completed,
            "pending_files": pending,
            "accepted": accepted,
            "rejected": rejected,
            "acceptance_rate": round(acceptance_rate, 1),
            "rejection_rate": round(rejection_rate, 1),
            "duplicates_removed": duplicates_removed,
            "total_qc_time_hours": f"{int(total_qc_time_minutes // 60):02d}:{int(total_qc_time_minutes % 60):02d}",
            "avg_time_per_file": f"{int(avg_time_per_file):02d}:{int((avg_time_per_file % 1) * 60):02d}",
            "target_achieved": round((completed / total_assigned * 100), 1) if total_assigned > 0 else 0,
            "remaining": pending,
            "assigned_range": session.get('assigned_range'),
            "assigned_by_admin": session.get('assigned_by_admin', False),
            "created_at": session.get('created_at', ''),
            "last_accessed": session.get('last_accessed', '')
        }
        return jsonify({"success": True, "report": report})
    except Exception as e:
        print(f"[USER REPORT ERROR] {e}")
        return jsonify({"error": "Failed to generate report"}), 500

@app.route('/api/admin/export-user-report/<session_token>', methods=['GET'])
@require_admin
def export_user_report(session_token):
    try:
        if session_token not in SESSIONS:
            return jsonify({"error": "Session not found"}), 404
        session = SESSIONS[session_token]
        data = session.get('data', [])
        total_assigned = len(data)
        completed = sum(1 for item in data if str(item.get('Status', '')).strip().lower() in ['accepted', 'rejected'])
        pending = sum(1 for item in data if str(item.get('Status', '')).strip().lower() in ['', 'pending'])
        accepted = sum(1 for item in data if str(item.get('Status', '')).strip().lower() == 'accepted')
        rejected = sum(1 for item in data if str(item.get('Status', '')).strip().lower() == 'rejected')
        acceptance_rate = (accepted / completed * 100) if completed > 0 else 0
        rejection_rate = (rejected / completed * 100) if completed > 0 else 0
        total_qc_time_minutes = completed * 3.67
        avg_time_per_file = total_qc_time_minutes / completed if completed > 0 else 0
        target_achieved = round((completed / total_assigned * 100), 1) if total_assigned > 0 else 0
        duplicates_removed = session.get('duplicates_removed', 0)
        report_text = f"""QC Daily Dashboard – {datetime.now().strftime("%d %b %Y")} (Data Type: PDF)
QC Person: {session.get('name', 'Unknown')}
Username: {session.get('username', 'Unknown')}
Email: {session.get('email', 'Unknown')}
--------------------------------------------------------------

Total Assigned     : {total_assigned:<14} Files Completed : {completed}
Pending Files      : {pending:<14} Accepted        : {accepted}
Rejected           : {rejected:<14} Acceptance Rate : {acceptance_rate:.1f}%
Rejection Rate     : {rejection_rate:.1f}%    Duplicates Removed : {duplicates_removed}

Total QC Time      : {int(total_qc_time_minutes // 60):02d}:{int(total_qc_time_minutes % 60):02d} hrs   Avg Time/File   : {int(avg_time_per_file):02d}:{int((avg_time_per_file % 1) * 60):02d} min

Target Achieved    : {target_achieved}%        Remaining       : {pending} files

--------------------------------------------------------------
Assignment Details:
- Assigned By Admin      : {'Yes' if session.get('assigned_by_admin') else 'No'}
- Range                  : {session.get('assigned_range', 'N/A')}
- Created At             : {session.get('created_at', 'N/A')}
- Last Accessed          : {session.get('last_accessed', 'N/A')}

--------------------------------------------------------------
Detailed Breakdown:

"""
        for idx, item in enumerate(data, 1):
            status = str(item.get('Status', 'Pending'))
            feedback = str(item.get('Feedback', ''))
            link_val = str(item.get('link', ''))
            link_short = link_val[:50] + '...' if len(link_val) > 50 else link_val
            report_text += f"{idx}. [{status}] {link_short}\n"
            if feedback:
                report_text += f"   Feedback: {feedback}\n"
        filename = f"QC_Report_{session.get('username', 'user')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(report_text)
        print(f"[EXPORT REPORT] Generated report for {session.get('username')}")
        return send_file(filepath, as_attachment=True, download_name=filename)
    except Exception as e:
        print(f"[EXPORT REPORT ERROR] {e}")
        return jsonify({"error": "Export failed"}), 500

# ==========================
# USER PDF REVIEW ROUTES
# ==========================
@app.route('/api/check-assigned-work', methods=['GET'])
@require_auth
def check_assigned_work():
    try:
        username = request.user['username']
        user_id = request.user.get('user_id')
        load_sessions()
        user_sessions = []
        for session_token, session in SESSIONS.items():
            if session.get('username') == username or session.get('user_id') == user_id:
                SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
                user_sessions.append({
                    'token': session_token,
                    'session': session,
                    'created_at': session.get('created_at'),
                    'assigned_by_admin': session.get('assigned_by_admin', False),
                    'total_pdfs': len(session.get('data', []))
                })
        if not user_sessions:
            return jsonify({"hasAssignedWork": False, "message": "No active work assignments found"})
        save_sessions()
        admin_sessions = [s for s in user_sessions if s['assigned_by_admin']]
        if admin_sessions:
            admin_sessions.sort(key=lambda x: x['created_at'], reverse=True)
            selected_session = admin_sessions[0]
        else:
            user_sessions.sort(key=lambda x: x['created_at'], reverse=True)
            selected_session = user_sessions[0]
        return jsonify({
            "hasAssignedWork": True,
            "session_token": selected_session['token'],
            "total_pdfs": selected_session['total_pdfs'],
            "assigned_by_admin": selected_session['assigned_by_admin']
        })
    except Exception as e:
        print(f"[CHECK WORK ERROR] {e}")
        return jsonify({"error": "Check failed", "hasAssignedWork": False}), 500

@app.route('/api/check-duplicate-file', methods=['POST'])
@require_auth
def check_duplicate_file():
    try:
        if 'csv_file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        file = request.files['csv_file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        temp_filename = f"temp_{uuid.uuid4()}_{secure_filename(file.filename)}"
        temp_filepath = os.path.join(UPLOAD_FOLDER, temp_filename)
        file.save(temp_filepath)
        file_hash = calculate_file_hash(temp_filepath)
        duplicates_found = []
        for session_token, session in SESSIONS.items():
            existing_hash = session.get('file_hash')
            if existing_hash and existing_hash == file_hash:
                duplicates_found.append({
                    'filename': session.get('filename', 'Unknown'),
                    'uploaded_by': session.get('name', 'Unknown'),
                    'username': session.get('username', 'Unknown'),
                    'created_at': session.get('created_at', ''),
                    'assigned_by_admin': session.get('assigned_by_admin', False)
                })
        try:
            os.remove(temp_filepath)
        except:
            pass
        if duplicates_found:
            return jsonify({
                "is_duplicate": True,
                "duplicates": duplicates_found,
                "message": f"This file has already been uploaded {len(duplicates_found)} time(s)"
            })
        else:
            return jsonify({"is_duplicate": False, "message": "File is unique, ready to upload"})
    except Exception as e:
        print(f"[CHECK DUPLICATE ERROR] {e}")
        return jsonify({"error": "Duplicate check failed"}), 500

@app.route('/api/upload', methods=['POST'])
@require_auth
def upload_csv():
    """
    User upload: only within-file de-duplication.
    If 0 unique links remain → error (no fallback displaying duplicates).
    """
    try:
        if 'csv_file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        file = request.files['csv_file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        if not allowed_file(file.filename):
            return jsonify({"error": "Only CSV files allowed"}), 400

        filename = secure_filename(file.filename)
        unique_filename = f"{uuid.uuid4()}_{filename}"
        filepath = os.path.join(UPLOAD_FOLDER, unique_filename)
        file.save(filepath)
        file_hash = calculate_file_hash(filepath)

        df = pd.read_csv(filepath)
        df.columns = df.columns.str.strip()
        link_col = None
        for col in df.columns:
            if col.lower() in ['link', 'url', 'pdf', 'pdf_link']:
                link_col = col
                break
        if link_col is None:
            os.remove(filepath)
            return jsonify({"error": "CSV must contain a 'link' or 'URL' column"}), 400
        if link_col != 'link':
            df.rename(columns={link_col: 'link'}, inplace=True)

        df['link'] = df['link'].astype(str).apply(canonicalize_link)
        df = df[df['link'].str.len() > 0].copy()

        original_count = len(df)
        df_clean = df.drop_duplicates(subset=['link'], keep='first').copy()
        unique_count = len(df_clean)
        duplicates_removed = original_count - unique_count

        if unique_count == 0:
            os.remove(filepath)
            return jsonify({
                "error": "After de-duplication there are 0 unique links to review. Please upload a different file."
            }), 400

        if 'Status' not in df_clean.columns:
            df_clean['Status'] = ''
        if 'Feedback' not in df_clean.columns:
            df_clean['Feedback'] = ''
        if 'Verified By' not in df_clean.columns:
            df_clean['Verified By'] = request.user['name']

        session_token = generate_token()
        SESSIONS[session_token] = {
            "filename": unique_filename,
            "filepath": filepath,
            "file_hash": file_hash,
            "data": df_clean.to_dict('records'),
            "username": request.user['username'],
            "email": request.user['email'],
            "name": request.user['name'],
            "user_id": request.user.get('user_id'),
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + SESSION_TIMEOUT).isoformat(),
            "last_accessed": datetime.now().isoformat(),
            "duplicates_removed": duplicates_removed,
            "assigned_by_admin": False
        }
        save_sessions()
        print(f"[UPLOAD] New session by {request.user['username']}: unique={unique_count} original={original_count} removed={duplicates_removed}")
        return jsonify({
            "success": True,
            "message": "File uploaded successfully",
            "token": session_token,
            "total": unique_count,
            "unique_after_filter": unique_count,
            "duplicates_removed": duplicates_removed,
            "original_count": original_count
        })
    except Exception as e:
        print(f"[UPLOAD ERROR] {e}")
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route('/api/session-check', methods=['GET'])
def session_check():
    try:
        session_token = request.headers.get('X-Session-Token')
        if not session_token or session_token not in SESSIONS:
            return jsonify({"hasSession": False}), 200
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        return jsonify({"hasSession": True})
    except Exception as e:
        print(f"[SESSION CHECK ERROR] {e}")
        return jsonify({"hasSession": False}), 200

@app.route('/api/data', methods=['GET'])
def get_data():
    try:
        session_token = request.headers.get('X-Session-Token')
        if not session_token or session_token not in SESSIONS:
            return jsonify({"error": "Invalid session"}), 401
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        data = SESSIONS[session_token].get('data', [])
        verifier = request.args.get('verifier', '').strip()
        if verifier:
            data = [item for item in data if item.get('Verified By', '') == verifier]
        return jsonify({"data": data})
    except Exception as e:
        print(f"[GET DATA ERROR] {e}")
        return jsonify({"error": "Failed to get data"}), 500

@app.route('/api/update-status', methods=['POST'])
def update_status():
    try:
        session_token = request.headers.get('X-Session-Token')
        if not session_token or session_token not in SESSIONS:
            return jsonify({"error": "Invalid session"}), 401
        body = request.json or {}
        link = (body.get('link') or '').strip()
        status = (body.get('status') or '').strip()
        feedback = (body.get('feedback') or '').strip()
        if not link or not status:
            return jsonify({"error": "Link and status required"}), 400
        session = SESSIONS[session_token]
        session_data = session.get('data', [])
        updated = False
        for item in session_data:
            if str(item.get('link', '')).strip() == link:
                item['Status'] = status
                if status.lower() == 'rejected':
                    item['Feedback'] = feedback
                updated = True
                break
        if not updated:
            return jsonify({"error": "Link not found"}), 404
        SESSIONS[session_token]['data'] = session_data
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        save_sessions()
        print(f"[UPDATE] {link} -> {status}")
        return jsonify({"success": True, "message": f"Updated to {status}"})
    except Exception as e:
        print(f"[UPDATE STATUS ERROR] {e}")
        return jsonify({"error": "Update failed"}), 500

@app.route('/api/download', methods=['GET'])
def download_csv():
    try:
        session_token = request.headers.get('X-Session-Token')
        if not session_token or session_token not in SESSIONS:
            return jsonify({"error": "Invalid session"}), 401
        df = pd.DataFrame(SESSIONS[session_token].get('data', []))
        output_filename = f"reviewed_{SESSIONS[session_token].get('filename', 'results.csv')}"
        output_path = os.path.join(UPLOAD_FOLDER, output_filename)
        df.to_csv(output_path, index=False)
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        print(f"[DOWNLOAD] {output_filename} by {SESSIONS[session_token].get('username', 'Unknown')}")
        return send_file(output_path, as_attachment=True, download_name=output_filename)
    except Exception as e:
        print(f"[DOWNLOAD ERROR] {e}")
        return jsonify({"error": "Download failed"}), 500

# ==========================
# HEALTH
# ==========================
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "sessions": len(SESSIONS),
        "users": len(USERS),
        "auth_tokens": len(AUTH_TOKENS),
        "admin_tokens": len(ADMIN_TOKENS),
        "work_assignments": len(WORK_ASSIGNMENTS)
    })

# ==========================
# START SERVER
# ==========================
if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 PDF REVIEWER BACKEND - Ready to serve!")
    print("="*60)
    print(f"📂 Upload folder: {UPLOAD_FOLDER}")
    print(f"💾 Sessions file: {SESSIONS_FILE}")
    print(f"👥 Users file: {USERS_FILE}")
    print(f"🔐 Admin credentials: {ADMIN_CREDENTIALS_FILE}")
    print(f"🗝️ Admin tokens file: {ADMIN_TOKENS_FILE}")
    print(f"📋 Work assignments: {len(WORK_ASSIGNMENTS)}")
    print(f"⏰ USER SESSION TIMEOUT: NEVER EXPIRES (100 years)")
    print(f"🔑 USER AUTH TOKEN TIMEOUT: NEVER EXPIRES (100 years)")
    print(f"🔐 ADMIN TOKEN TIMEOUT: 24 hours (auto-extends on use)")
    print("="*60)
    print("🌐 Server running on: http://0.0.0.0:5000")
    print("🌐 Also accessible at: http://localhost:5000")
    print("="*60 + "\n")
    app.run(host='0.0.0.0', port=5000, debug=False)
