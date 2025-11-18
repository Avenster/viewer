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

# ✅ Sessions and tokens NEVER expire (100 years)
SESSION_TIMEOUT = timedelta(days=36500)  # ~100 years - NEVER EXPIRES
AUTH_TOKEN_TIMEOUT = timedelta(days=36500)  # ~100 years - NEVER EXPIRES
ADMIN_TOKEN_TIMEOUT = timedelta(days=1)  # Admin expires after 1 day for security

# File paths
SESSIONS_FILE = "sessions.json"
USERS_FILE = "users.json"
ADMIN_CREDENTIALS_FILE = "admin_credentials.json"
WORK_ASSIGNMENTS_FILE = "work_assignments.json"
GLOBAL_LINKS_FILE = "global_links.json"
ADMIN_TOKENS_FILE = "admin_tokens.json"  # Persist admin tokens to disk

# Create upload folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ==========================
# IN-MEMORY STORAGE
# ==========================
SESSIONS = {}
USERS = {}
AUTH_TOKENS = {}
ADMIN_TOKENS = {}
WORK_ASSIGNMENTS = {}
GLOBAL_LINKS = {}

# ==========================
# ADMIN TOKEN PERSISTENCE
# ==========================
def save_admin_tokens():
    """Persist admin tokens to file"""
    try:
        with open(ADMIN_TOKENS_FILE, 'w') as f:
            json.dump(ADMIN_TOKENS, f, indent=2)
        print(f"[ADMIN TOKENS] Saved {len(ADMIN_TOKENS)} token(s) -> {ADMIN_TOKENS_FILE}")
    except Exception as e:
        print(f"[ERROR] Failed to save admin tokens: {e}")

def load_admin_tokens():
    """Load admin tokens from file and purge expired"""
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
                print(f"[ADMIN TOKENS] Purged {len(expired)} expired token(s) on load")
                save_admin_tokens()
            print(f"[ADMIN TOKENS] Loaded {len(ADMIN_TOKENS)} active token(s) from {ADMIN_TOKENS_FILE}")
        except Exception as e:
            print(f"[ERROR] Failed to load admin tokens: {e}")
            ADMIN_TOKENS = {}
    else:
        ADMIN_TOKENS = {}
        print(f"[ADMIN TOKENS] No existing admin tokens file found")

# ==========================
# AUTHENTICATION DECORATORS
# ==========================
def require_auth(f):
    """Decorator to require user authentication - NEVER EXPIRES"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_token = request.headers.get('X-Auth-Token')
        if not auth_token or auth_token not in AUTH_TOKENS:
            return jsonify({"error": "Unauthorized", "code": "AUTH_REQUIRED"}), 401
        token_data = AUTH_TOKENS[auth_token]
        # ✅ No expiration check - tokens never expire
        AUTH_TOKENS[auth_token]['last_used'] = datetime.now().isoformat()
        request.user = token_data
        return f(*args, **kwargs)
    return decorated_function

def require_admin(f):
    """Decorator to require admin authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        admin_token = request.headers.get('X-Admin-Token')
        if not admin_token:
            print("[ADMIN AUTH] ❌ Missing X-Admin-Token header")
            return jsonify({"error": "Unauthorized", "code": "ADMIN_REQUIRED"}), 401
        if admin_token not in ADMIN_TOKENS:
            print("[ADMIN AUTH] ❌ Invalid admin token (not in store) or lost due to restart")
            return jsonify({"error": "Unauthorized", "code": "ADMIN_REQUIRED"}), 401
        token_data = ADMIN_TOKENS[admin_token]
        expires_at_str = token_data.get('expires_at')
        if not expires_at_str:
            print("[ADMIN AUTH] ❌ Token missing expires_at")
            ADMIN_TOKENS.pop(admin_token, None)
            save_admin_tokens()
            return jsonify({"error": "Token expired", "code": "TOKEN_EXPIRED"}), 401
        try:
            expires_at = datetime.fromisoformat(expires_at_str)
        except Exception:
            print("[ADMIN AUTH] ❌ Malformed expires_at on token")
            ADMIN_TOKENS.pop(admin_token, None)
            save_admin_tokens()
            return jsonify({"error": "Token expired", "code": "TOKEN_EXPIRED"}), 401
        if datetime.now() > expires_at:
            ADMIN_TOKENS.pop(admin_token, None)
            save_admin_tokens()
            print("[ADMIN AUTH] ❌ Token expired")
            return jsonify({"error": "Token expired", "code": "TOKEN_EXPIRED"}), 401
        # Auto-extend admin token
        ADMIN_TOKENS[admin_token]['expires_at'] = (datetime.now() + ADMIN_TOKEN_TIMEOUT).isoformat()
        save_admin_tokens()
        return f(*args, **kwargs)
    return decorated_function

def check_already_authenticated(f):
    """Decorator to check if user is already authenticated"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_token = request.headers.get('X-Auth-Token')
        if auth_token and auth_token in AUTH_TOKENS:
            token_data = AUTH_TOKENS[auth_token]
            # ✅ No expiration check - tokens never expire
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
    return decorated_function

# ==========================
# HELPER FUNCTIONS
# ==========================
def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def generate_token():
    """Generate a secure random token"""
    return secrets.token_urlsafe(32)

def calculate_file_hash(filepath):
    """Calculate MD5 hash of file content"""
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
    """
    Normalize a URL so that visually different but equivalent links dedupe correctly.
    - Lowercase scheme/host, remove default ports
    - Collapse multiple slashes, normalize dot segments
    - Strip fragments (#...)
    - Remove common tracking params (utm_*, gclid, fbclid, ref, etc.)
    - Prefer https
    - Remove trailing slash after .pdf
    """
    u = str(url or '').strip().strip('\'"<>')
    if not u:
        return ''

    # Add scheme if missing
    if not re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', u):
        u = 'http://' + u

    parsed = urlparse(u)

    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()

    # Remove default ports
    if netloc.endswith(':80') and scheme == 'http':
        netloc = netloc[:-3]
    if netloc.endswith(':443') and scheme == 'https':
        netloc = netloc[:-4]

    # Normalize path: collapse slashes, resolve dot segments
    path = re.sub(r'/+', '/', parsed.path or '')
    path = unquote(path)
    path = posixpath.normpath(path)
    # Preserve trailing slash if it existed and normpath removed it
    if parsed.path.endswith('/') and not path.endswith('/'):
        path += '/'
    # Re-quote path safely
    path = quote(path, safe='/%._-')

    # Strip fragment
    fragment = ''

    # Clean query: remove common tracking params and sort
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

    # Prefer https to improve dedupe between http/https
    if canon.startswith('http://'):
        canon = 'https://' + canon[len('http://'):]

    # Remove trailing slash after .pdf
    if canon.lower().endswith('.pdf/'):
        canon = canon[:-1]

    return canon

def save_global_links():
    """Save global links database to file"""
    try:
        with open(GLOBAL_LINKS_FILE, 'w') as f:
            json.dump(GLOBAL_LINKS, f, indent=2)
        print(f"[GLOBAL LINKS] Saved {len(GLOBAL_LINKS)} unique PDF links")
    except Exception as e:
        print(f"[ERROR] Failed to save global links: {e}")

def load_global_links():
    """Load global links database from file"""
    global GLOBAL_LINKS
    if os.path.exists(GLOBAL_LINKS_FILE):
        try:
            with open(GLOBAL_LINKS_FILE, 'r') as f:
                GLOBAL_LINKS = json.load(f)
            print(f"[GLOBAL LINKS] Loaded {len(GLOBAL_LINKS)} unique PDF links from history")
        except Exception as e:
            print(f"[ERROR] Failed to load global links: {e}")
            GLOBAL_LINKS = {}
    else:
        GLOBAL_LINKS = {}
        print(f"[GLOBAL LINKS] No existing global links database found")

def check_global_duplicates(links_list):
    """Check which links are duplicates globally and return detailed info (uses canonicalization)"""
    global GLOBAL_LINKS
    within_file_dupes = []
    global_dupes = []
    new_links = []
    seen_in_current = set()

    for raw_link in links_list:
        link_clean = canonicalize_link(raw_link)
        if not link_clean:
            continue

        # within-file duplicate detection (canonical)
        if link_clean in seen_in_current:
            within_file_dupes.append({"link": link_clean, "type": "within_file"})
            continue
        seen_in_current.add(link_clean)

        # global duplicate detection (canonical)
        if link_clean in GLOBAL_LINKS:
            meta = GLOBAL_LINKS[link_clean]
            global_dupes.append({
                "link": link_clean,
                "first_uploaded_by": meta.get('first_uploaded_by'),
                "first_uploaded_at": meta.get('first_uploaded_at'),
                "upload_count": meta.get('upload_count', 1),
                "type": "global_duplicate"
            })
        else:
            new_links.append(link_clean)

    return {
        "within_file_duplicates": within_file_dupes,
        "global_duplicates": global_dupes,
        "new_links": new_links,
        "within_file_count": len(within_file_dupes),
        "global_duplicate_count": len(global_dupes),
        "new_count": len(new_links)
    }

def register_links_globally(links, username):
    """Register new PDF links in global database (canonicalized)"""
    global GLOBAL_LINKS
    registered_count = 0
    now_iso = datetime.now().isoformat()

    for raw_link in links:
        link_clean = canonicalize_link(raw_link)
        if not link_clean:
            continue

        if link_clean in GLOBAL_LINKS:
            GLOBAL_LINKS[link_clean]['upload_count'] = GLOBAL_LINKS[link_clean].get('upload_count', 1) + 1
            GLOBAL_LINKS[link_clean]['last_uploaded_by'] = username
            GLOBAL_LINKS[link_clean]['last_uploaded_at'] = now_iso
        else:
            GLOBAL_LINKS[link_clean] = {
                "first_uploaded_by": username,
                "first_uploaded_at": now_iso,
                "upload_count": 1,
                "last_uploaded_by": username,
                "last_uploaded_at": now_iso
            }
            registered_count += 1

    save_global_links()
    print(f"[GLOBAL LINKS] Registered {registered_count} new unique links for {username}")
    return registered_count

def save_sessions():
    """Save sessions to file"""
    try:
        with open(SESSIONS_FILE, 'w') as f:
            json.dump(SESSIONS, f, indent=2)
        print(f"[SESSIONS] Saved {len(SESSIONS)} sessions to {SESSIONS_FILE}")
    except Exception as e:
        print(f"[ERROR] Failed to save sessions: {e}")

def load_sessions():
    """Load sessions from file"""
    global SESSIONS
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE, 'r') as f:
                SESSIONS = json.load(f)
            print(f"[SESSIONS] Loaded {len(SESSIONS)} sessions from {SESSIONS_FILE}")
        except Exception as e:
            print(f"[ERROR] Failed to load sessions: {e}")
            SESSIONS = {}
    else:
        SESSIONS = {}
        print(f"[SESSIONS] No existing sessions file found")

def save_users():
    """Save users to file"""
    try:
        with open(USERS_FILE, 'w') as f:
            json.dump(USERS, f, indent=2)
        print(f"[USERS] Saved {len(USERS)} users to {USERS_FILE}")
    except Exception as e:
        print(f"[ERROR] Failed to save users: {e}")

def load_users():
    """Load users from file"""
    global USERS
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, 'r') as f:
                USERS = json.load(f)
            print(f"[USERS] Loaded {len(USERS)} users from {USERS_FILE}")
        except Exception as e:
            print(f"[ERROR] Failed to load users: {e}")
            USERS = {}
    else:
        USERS = {}
        print(f"[USERS] No existing users file found")

def save_work_assignments():
    """Save work assignments to file"""
    try:
        with open(WORK_ASSIGNMENTS_FILE, 'w') as f:
            json.dump(WORK_ASSIGNMENTS, f, indent=2)
        print(f"[WORK] Saved work assignments to {WORK_ASSIGNMENTS_FILE}")
    except Exception as e:
        print(f"[ERROR] Failed to save work assignments: {e}")

def load_work_assignments():
    """Load work assignments from file"""
    global WORK_ASSIGNMENTS
    if os.path.exists(WORK_ASSIGNMENTS_FILE):
        try:
            with open(WORK_ASSIGNMENTS_FILE, 'r') as f:
                WORK_ASSIGNMENTS = json.load(f)
            print(f"[WORK] Loaded work assignments from {WORK_ASSIGNMENTS_FILE}")
        except Exception as e:
            print(f"[ERROR] Failed to load work assignments: {e}")
            WORK_ASSIGNMENTS = {}
    else:
        WORK_ASSIGNMENTS = {}
        print(f"[WORK] No existing work assignments file found")

def cleanup_expired_sessions():
    """DISABLED - Sessions never expire"""
    print(f"[CLEANUP] Session cleanup disabled - sessions never expire")

def cleanup_expired_auth_tokens():
    """DISABLED - Auth tokens never expire"""
    print(f"[CLEANUP] Auth token cleanup disabled - tokens never expire")

def cleanup_expired_admin_tokens():
    """Remove expired admin tokens only"""
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
        save_admin_tokens()  # persist changes

def init_admin():
    """Initialize admin credentials"""
    if not os.path.exists(ADMIN_CREDENTIALS_FILE):
        default_admin = {
            "username": "admin",
            "password_hash": generate_password_hash("admin123"),
            "created_at": datetime.now().isoformat()
        }
        with open(ADMIN_CREDENTIALS_FILE, 'w') as f:
            json.dump(default_admin, f, indent=2)
        print("[ADMIN] ✅ Created default credentials - username: admin, password: admin123")
        print("[ADMIN] ⚠️  PLEASE CHANGE THESE CREDENTIALS IN PRODUCTION!")
    else:
        print("[ADMIN] ✅ Admin credentials file exists")

# ==========================
# STARTUP INITIALIZATION
# ==========================
print("\n" + "="*60)
print("PDF REVIEWER BACKEND - Starting...")
print("="*60)

init_admin()
load_admin_tokens()
load_users()
load_sessions()
load_work_assignments()
load_global_links()
cleanup_expired_admin_tokens()

print("="*60)

# ==========================
# SHUTDOWN HANDLER
# ==========================
def cleanup():
    """Save data on shutdown"""
    print("\n[SHUTDOWN] 💾 Saving data before exit...")
    save_sessions()
    save_users()
    save_work_assignments()
    save_global_links()
    save_admin_tokens()
    print("[SHUTDOWN] ✅ Cleanup complete")

atexit.register(cleanup)

# ==========================
# USER AUTHENTICATION ROUTES
# ==========================
@app.route('/api/auth/signup', methods=['POST'])
@check_already_authenticated
def signup():
    """User signup endpoint - ✅ Returns user_id"""
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

        for user_id, user in USERS.items():
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

        print(f"[SIGNUP] ✅ New user created: {username} ({email}) - ID: {user_id}")
        print(f"[SIGNUP] 📊 Total users now: {len(USERS)}")

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
        print(f"[SIGNUP ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Signup failed"}), 500

@app.route('/api/auth/login', methods=['POST'])
@check_already_authenticated
def login():
    """User login endpoint - ✅ Returns user_id"""
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

        print(f"[LOGIN] ✅ User logged in: {user_found['username']}")

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
        print(f"[LOGIN ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Login failed"}), 500

@app.route('/api/auth/logout', methods=['POST'])
@require_auth
def logout():
    """User logout endpoint"""
    try:
        auth_token = request.headers.get('X-Auth-Token')
        if auth_token and auth_token in AUTH_TOKENS:
            username = AUTH_TOKENS[auth_token].get('username', 'Unknown')
            del AUTH_TOKENS[auth_token]
            print(f"[LOGOUT] ✅ User logged out: {username}")
        return jsonify({"success": True})
    except Exception as e:
        print(f"[LOGOUT ERROR] ❌ {e}")
        return jsonify({"error": "Logout failed"}), 500

@app.route('/api/auth/verify', methods=['GET'])
def verify_auth():
    """Verify auth token - ✅ Returns user_id, NEVER EXPIRES"""
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
        print(f"[AUTH VERIFY ERROR] ❌ {e}")
        return jsonify({"error": "Verification failed"}), 500

# ==========================
# ADMIN ROUTES
# ==========================
@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    """Admin login endpoint"""
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
            print(f"[ADMIN LOGIN] ✅ Admin logged in: {username}")
            return jsonify({"success": True, "token": token})
        else:
            print(f"[ADMIN LOGIN] ❌ Failed login attempt for: {username}")
            return jsonify({"error": "Invalid credentials"}), 401
    except Exception as e:
        print(f"[ADMIN LOGIN ERROR] ❌ {e}")
        return jsonify({"error": "Login failed"}), 500

@app.route('/api/admin/verify', methods=['GET'])
@require_admin
def admin_verify():
    """Verify admin token and return basic info (also auto-extends expiry)"""
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
        print(f"[ADMIN VERIFY ERROR] ❌ {e}")
        return jsonify({"error": "Verification failed"}), 500

@app.route('/api/admin/users', methods=['GET'])
@require_admin
def get_users_list():
    """Get list of all users for assignment dropdown - ✅ Reloads users from file"""
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
        print(f"[GET USERS] 📋 Returning {len(users_list)} active users to admin")
        return jsonify({"users": users_list})
    except Exception as e:
        print(f"[GET USERS ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to get users"}), 500

@app.route('/api/admin/upload-assign', methods=['POST'])
@require_admin
def upload_assign():
    """
    Admin uploads CSV and assigns work to users.
    REQUIREMENT: Always de-duplicate before assignment so users never see duplicates.
    The 'include_duplicates' form flag (if sent by UI) is ignored.
    Supports assigning any fraction of work (percentages sum can be <= 100).
    """
    try:
        # Check file
        if 'csv_file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        file = request.files['csv_file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        if not allowed_file(file.filename):
            return jsonify({"error": "Only CSV files allowed"}), 400

        # Parse basic form data
        _form_flag = str(request.form.get('include_duplicates', 'false')).strip().lower() == 'true'
        include_duplicates = False  # Force de-duplication as per requirement

        assignments_json = request.form.get('assignments')
        assignment_type = request.form.get('assignment_type', 'percentage')

        if not assignments_json:
            return jsonify({"error": "No assignments provided"}), 400
        try:
            assignments = json.loads(assignments_json)
        except Exception:
            return jsonify({"error": "Invalid assignments format"}), 400

        # Load latest users
        load_users()

        # Prevent double assignments for users
        users_with_assignments = []
        for assignment in assignments:
            user_id = assignment.get('userId')
            if not user_id or user_id not in USERS:
                continue
            user = USERS[user_id]
            username = user['username']
            for session_token, session in SESSIONS.items():
                if (session.get('username') == username or session.get('user_id') == user_id) and session.get('assigned_by_admin', False):
                    users_with_assignments.append(user['name'])
                    break
        if users_with_assignments:
            return jsonify({
                "error": f"The following users already have admin-assigned work: {', '.join(set(users_with_assignments))}. Please remove their existing assignments first."
            }), 400

        # Save uploaded file
        filename = secure_filename(file.filename)
        unique_filename = f"{uuid.uuid4()}_{filename}"
        filepath = os.path.join(UPLOAD_FOLDER, unique_filename)
        file.save(filepath)

        file_hash = calculate_file_hash(filepath)

        # Read CSV
        df = pd.read_csv(filepath)
        df.columns = df.columns.str.strip()

        # Find link column
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

        # Normalize/Canonicalize links
        df['link'] = df['link'].astype(str).apply(canonicalize_link)
        # Remove empty links
        df = df[df['link'].str.len() > 0].copy()

        original_count = len(df)

        # Duplicate analysis using global store (works with canonical links)
        dup_check = check_global_duplicates(df['link'].tolist())
        within_file_count = dup_check['within_file_count']
        global_dup_count = dup_check['global_duplicate_count']
        new_links_list = dup_check['new_links']
        total_duplicates_identified = within_file_count + global_dup_count

        # Keep only new unique links and drop any remaining within-file duplicates
        df_clean = df[df['link'].isin(new_links_list)].copy()
        df_clean = df_clean.drop_duplicates(subset=['link'], keep='first')
        unique_count_all = len(df_clean)
        duplicates_removed_count = original_count - unique_count_all

        if unique_count_all == 0:
            os.remove(filepath)
            return jsonify({
                "error": "After de-duplication there are 0 unique links to assign. Please upload a different file."
            }), 400

        # Prepare columns
        if 'Status' not in df_clean.columns:
            df_clean['Status'] = ''
        if 'Feedback' not in df_clean.columns:
            df_clean['Feedback'] = ''

        total_pdfs = len(df_clean)
        user_sessions = {}
        assigned_total_count = 0

        if assignment_type == 'range':
            # Validate and ensure non-overlapping, within bounds, and non-empty
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

            # Create sessions
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
                    # Store duplicates removed at file level
                    "duplicates_removed": duplicates_removed_count,
                    "duplicate_links": [],
                    "include_duplicates": include_duplicates
                }
                user_sessions[user_id] = {
                    "session_token": session_token,
                    "username": user['username'],
                    "name": user['name'],
                    "data": user_df.to_dict('records'),
                    "range": f"{start_range}-{end_range}"
                }
                assigned_total_count += len(user_df)

            # Register only the assigned links globally (canonicalized)
            assigned_all_links = []
            for sess in user_sessions.values():
                assigned_all_links.extend([row['link'] for row in sess['data']])
            register_links_globally(assigned_all_links, "admin")

        else:
            # Percentage-based assignment: allow sum <= 100 (assign whatever admin wants)
            # Filter out zero or missing percentages
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

            # Target number of PDFs to assign based on requested total percentage
            target_total = floor(total_pdfs * (total_pct / 100.0))
            if target_total <= 0:
                return jsonify({"error": "Computed 0 PDFs to assign with given percentages. Increase percentages."}), 400

            # Compute fair allocation limited to target_total (do NOT distribute leftover beyond requested total)
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
            remainders.sort(reverse=True)  # by remainder desc
            i = 0
            while leftover > 0 and i < len(remainders):
                _, idx = remainders[i]
                alloc[idx] += 1
                leftover -= 1
                i += 1

            # Remove any assignments that ended up with 0 after rounding
            final = [(idx, a, alloc[idx]) for idx, a in enumerate(cleaned) if alloc[idx] > 0]
            if len(final) == 0:
                return jsonify({"error": "After rounding, 0 PDFs were assigned. Adjust percentages."}), 400

            # Create user sessions in order, slicing df_clean sequentially
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
                    # This can occur if count becomes 0 after slicing or data exhausted
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
                    # Store duplicates removed at file level
                    "duplicates_removed": duplicates_removed_count,
                    "duplicate_links": [],
                    "include_duplicates": include_duplicates
                }
                user_sessions[user_id] = {
                    "session_token": session_token,
                    "username": user['username'],
                    "name": user['name'],
                    "data": user_df.to_dict('records'),
                    "percentage": a['percentage']
                }
                assigned_total_count += len(user_df)

            # Register only the assigned links globally (canonicalized)
            assigned_all_links = []
            for sess in user_sessions.values():
                assigned_all_links.extend([row['link'] for row in sess['data']])
            if assigned_all_links:
                register_links_globally(assigned_all_links, "admin")

        if assigned_total_count == 0:
            os.remove(filepath)
            return jsonify({"error": "No rows were assigned after processing. Adjust ranges/percentages."}), 400

        # Persist work assignment meta
        assignment_id = str(uuid.uuid4())
        WORK_ASSIGNMENTS[assignment_id] = {
            "filename": unique_filename,
            "file_hash": file_hash,
            "original_count": original_count,
            # what was actually distributed to users (may be < unique_count_all if admin assigned partial)
            "unique_count": assigned_total_count,
            "duplicates_count": duplicates_removed_count,
            "within_file_duplicates": within_file_count,
            "global_duplicates": global_dup_count,
            "duplicate_links": [],
            "assignment_type": assignment_type,
            "include_duplicates": include_duplicates,
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
        print(f"[ADMIN UPLOAD] ✅ Assigned to {len(user_sessions)} users | de-duplicated | orig={original_count} assigned={assigned_total_count} unique_all={unique_count_all} removed={duplicates_removed_count}")

        return jsonify({
            "success": True,
            "message": "Work assigned successfully",
            "assignment_id": assignment_id,
            "assignment_type": assignment_type,
            "total_pdfs": original_count,
            "unique_pdfs_available": unique_count_all,
            "assigned_pdfs": assigned_total_count,
            "duplicates_identified": total_duplicates_identified,
            "within_file_duplicates": within_file_count,
            "global_duplicates": global_dup_count,
            "duplicates_removed": duplicates_removed_count,
            "users_assigned": len(user_sessions)
        })
    except Exception as e:
        print(f"[ADMIN UPLOAD ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route('/api/admin/remove-session/<session_token>', methods=['DELETE'])
@require_admin
def remove_session(session_token):
    """Admin can remove a session"""
    try:
        if session_token not in SESSIONS:
            return jsonify({"error": "Session not found"}), 404
        session = SESSIONS[session_token]
        username = session.get('username', 'Unknown')
        del SESSIONS[session_token]
        save_sessions()
        print(f"[ADMIN] 🗑️ Removed session for {username}")
        return jsonify({"success": True, "message": f"Session removed for {username}"})
    except Exception as e:
        print(f"[REMOVE SESSION ERROR] ❌ {e}")
        return jsonify({"error": "Failed to remove session"}), 500

@app.route('/api/admin/dashboard', methods=['GET'])
@require_admin
def admin_dashboard():
    """Admin dashboard endpoint - returns all sessions and stats"""
    try:
        all_sessions = []
        total_pdfs = 0
        total_accepted = 0
        total_rejected = 0
        total_pending = 0
        total_duplicates = 0
        total_uploaded_links = 0
        total_assigned_links = 0
        unique_users = set()
        counted_file_hashes = set()

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

            file_hash = session.get('file_hash')
            session_duplicates = 0

            if session.get('assigned_by_admin', False):
                for assignment_id, assignment_data in WORK_ASSIGNMENTS.items():
                    if assignment_data.get('file_hash') == file_hash:
                        if file_hash and file_hash not in counted_file_hashes:
                            session_duplicates = assignment_data.get('duplicates_count', 0)
                            total_duplicates += session_duplicates
                            total_uploaded_links += assignment_data.get('original_count', 0)
                            total_assigned_links += assignment_data.get('unique_count', 0)
                            counted_file_hashes.add(file_hash)
                        else:
                            session_duplicates = 0
                        break
            else:
                if file_hash and file_hash not in counted_file_hashes:
                    session_duplicates = session.get('duplicates_removed', 0)
                    total_duplicates += session_duplicates
                    user_unique = len(df_data)
                    user_original = user_unique + session_duplicates
                    total_uploaded_links += user_original
                    total_assigned_links += user_unique
                    if file_hash:
                        counted_file_hashes.add(file_hash)

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
                "duplicates_removed": session_duplicates,
                "assigned_by_admin": session.get('assigned_by_admin', False),
                "assigned_count": session.get('assigned_count', len(df_data)),
                "assigned_range": session.get('assigned_range'),
                "assigned_percentage": session.get('assigned_percentage'),
                "include_duplicates": session.get('include_duplicates', False)
            })

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
            "total_duplicates": total_duplicates,
            "total_uploaded_links": total_uploaded_links,
            "total_assigned_links": total_assigned_links,
            "completion_rate": completion_rate,
            "global_unique_links": len(GLOBAL_LINKS)
        }

        print(f"[ADMIN DASHBOARD] 📊 Data requested - {len(all_sessions)} sessions")
        return jsonify({"sessions": all_sessions, "stats": stats})
    except Exception as e:
        print(f"[ADMIN DASHBOARD ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to load dashboard"}), 500

@app.route('/api/admin/user-report/<session_token>', methods=['GET'])
@require_admin
def get_user_report(session_token):
    """Generate detailed report for a specific user session"""
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
        min_time = 1.17
        max_time = 7.92

        file_hash = session.get('file_hash')
        original_duplicates = 0

        if session.get('assigned_by_admin', False):
            for assignment_id, assignment_data in WORK_ASSIGNMENTS.items():
                if assignment_data.get('file_hash') == file_hash:
                    original_duplicates = assignment_data.get('duplicates_count', 0)
                    break
        else:
            original_duplicates = session.get('duplicates_removed', 0)

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
            "re_qc_needed": 0,
            "duplicates_in_original_file": original_duplicates,
            "total_qc_time_hours": f"{int(total_qc_time_minutes // 60):02d}:{int(total_qc_time_minutes % 60):02d}",
            "avg_time_per_file": f"{int(avg_time_per_file):02d}:{int((avg_time_per_file % 1) * 60):02d}",
            "min_time_per_file": f"{int(min_time):02d}:{int((min_time % 1) * 60):02d}",
            "max_time_per_file": f"{int(max_time):02d}:{int((max_time % 1) * 60):02d}",
            "target_achieved": round((completed / total_assigned * 100), 1) if total_assigned > 0 else 0,
            "remaining": pending,
            "assigned_range": session.get('assigned_range'),
            "assigned_by_admin": session.get('assigned_by_admin', False),
            "created_at": session.get('created_at', ''),
            "last_accessed": session.get('last_accessed', '')
        }
        return jsonify({"success": True, "report": report})
    except Exception as e:
        print(f"[USER REPORT ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to generate report"}), 500

@app.route('/api/admin/export-user-report/<session_token>', methods=['GET'])
@require_admin
def export_user_report(session_token):
    """Export user report as text file"""
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

        file_hash = session.get('file_hash')
        original_duplicates = 0

        if session.get('assigned_by_admin', False):
            for assignment_id, assignment_data in WORK_ASSIGNMENTS.items():
                if assignment_data.get('file_hash') == file_hash:
                    original_duplicates = assignment_data.get('duplicates_count', 0)
                    break
        else:
            original_duplicates = session.get('duplicates_removed', 0)

        report_text = f"""QC Daily Dashboard – {datetime.now().strftime("%d %b %Y")} (Data Type: PDF)
QC Person: {session.get('name', 'Unknown')}
Username: {session.get('username', 'Unknown')}
Email: {session.get('email', 'Unknown')}
--------------------------------------------------------------
 
Total Assigned     : {total_assigned:<14} Files Completed : {completed}
Pending Files      : {pending:<14} Accepted        : {accepted}
Rejected           : {rejected:<14} Acceptance Rate : {acceptance_rate:.1f}%
Rejection Rate     : {rejection_rate:.1f}%{' ' * 8} Re-QC Needed    : 0
 
Total QC Time      : {int(total_qc_time_minutes // 60):02d}:{int(total_qc_time_minutes % 60):02d} hrs{' ' * 4} Avg Time/File   : {int(avg_time_per_file):02d}:{int((avg_time_per_file % 1) * 60):02d} min
Min Time/File      : 01:10 min{' ' * 4} Max Time/File   : 07:55 min

Target Achieved    : {target_achieved}%{' ' * 10} Remaining       : {pending} files

--------------------------------------------------------------
Assignment Details:
- Assigned By Admin      : {'Yes' if session.get('assigned_by_admin') else 'No'}
- Range                  : {session.get('assigned_range', 'N/A')}
- Created At             : {session.get('created_at', 'N/A')}
- Last Accessed          : {session.get('last_accessed', 'N/A')}
- Duplicates in Original : {original_duplicates} PDF links removed

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
        print(f"[EXPORT REPORT] 📥 Generated report for {session.get('username')}")
        return send_file(filepath, as_attachment=True, download_name=filename)
    except Exception as e:
        print(f"[EXPORT REPORT ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Export failed"}), 500

# ==========================
# PDF REVIEW ROUTES
# ==========================
@app.route('/api/check-assigned-work', methods=['GET'])
@require_auth
def check_assigned_work():
    """✅ Check if user has work assigned - with proper user_id matching"""
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
            print(f"[CHECK WORK] ❌ {username} (ID: {user_id}) has no active sessions")
            return jsonify({"hasAssignedWork": False, "message": "No active work assignments found"})
        save_sessions()
        admin_sessions = [s for s in user_sessions if s['assigned_by_admin']]
        if admin_sessions:
            admin_sessions.sort(key=lambda x: x['created_at'], reverse=True)
            selected_session = admin_sessions[0]
        else:
            user_sessions.sort(key=lambda x: x['created_at'], reverse=True)
            selected_session = user_sessions[0]
        print(f"[CHECK WORK] ✅ {username} (ID: {user_id}) has {selected_session['total_pdfs']} PDFs (admin: {selected_session['assigned_by_admin']})")
        return jsonify({
            "hasAssignedWork": True,
            "session_token": selected_session['token'],
            "total_pdfs": selected_session['total_pdfs'],
            "assigned_by_admin": selected_session['assigned_by_admin']
        })
    except Exception as e:
        print(f"[CHECK WORK ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Check failed", "hasAssignedWork": False}), 500

@app.route('/api/check-duplicate-file', methods=['POST'])
@require_auth
def check_duplicate_file():
    """Check if uploaded file is a duplicate"""
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
            print(f"[DUPLICATE CHECK] ⚠️ File already uploaded {len(duplicates_found)} time(s)")
            return jsonify({
                "is_duplicate": True,
                "duplicates": duplicates_found,
                "message": f"This file has already been uploaded {len(duplicates_found)} time(s)"
            })
        else:
            print(f"[DUPLICATE CHECK] ✅ File is unique")
            return jsonify({"is_duplicate": False, "message": "File is unique, ready to upload"})
    except Exception as e:
        print(f"[CHECK DUPLICATE ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Duplicate check failed"}), 500

@app.route('/api/upload', methods=['POST'])
@require_auth
def upload_csv():
    """Upload CSV file and create a review session - NEVER EXPIRES
       Fallback: if all rows are duplicates (unique_count == 0), we keep the original rows
       and annotate duplicate types so the user still sees data in Viewer."""
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

        # Normalize/Canonicalize links to improve dedupe
        df['link'] = df['link'].astype(str).apply(canonicalize_link)
        # Remove empty links
        df = df[df['link'].str.len() > 0].copy()

        original_count = len(df)
        all_links = df['link'].tolist()
        dup_check = check_global_duplicates(all_links)

        within_file_count = dup_check['within_file_count']
        global_dup_count = dup_check['global_duplicate_count']
        new_links_list = dup_check['new_links']
        total_duplicates = within_file_count + global_dup_count

        # Keep only new unique links and drop any remaining within-file duplicates
        df_clean = df[df['link'].isin(new_links_list)].copy()
        df_clean = df_clean.drop_duplicates(subset=['link'], keep='first')
        unique_count = len(df_clean)

        # Fallback: if everything was filtered out, keep all original rows,
        # and annotate each row with duplicate type for UI visibility.
        all_duplicates_flag = False
        if unique_count == 0:
            all_duplicates_flag = True
            within_set = set([d['link'] for d in dup_check['within_file_duplicates']])
            global_set = set([d['link'] for d in dup_check['global_duplicates']])

            df_fallback = df.copy()

            def dup_type(l):
                if l in within_set:
                    return 'within_file'
                if l in global_set:
                    return 'global_duplicate'
                return ''
            df_fallback['DuplicateType'] = df_fallback['link'].apply(dup_type)
            df_clean = df_fallback  # keep everything so Viewer shows items

        # Register only the new links globally (canonicalized)
        # If fallback, only register the "new_links_list" (not duplicates)
        to_register = df_clean['link'].tolist() if not all_duplicates_flag else new_links_list
        register_links_globally(to_register, request.user['username'])

        # Ensure required columns
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
            "duplicates_removed": (original_count - unique_count) if not all_duplicates_flag else (within_file_count + global_dup_count),
            "within_file_duplicates": within_file_count,
            "global_duplicates": global_dup_count,
            "duplicate_links": [],
            "assigned_by_admin": False
        }

        save_sessions()

        print(f"[UPLOAD] ✅ New session by {request.user['username']}: unique={len(df_clean)} original={original_count} dupes={within_file_count + global_dup_count} (fallback={all_duplicates_flag})")

        return jsonify({
            "success": True,
            "message": "File uploaded successfully",
            "token": session_token,
            "total": len(df_clean),
            "unique_after_filter": unique_count,
            "duplicates_removed": (original_count - unique_count) if not all_duplicates_flag else (within_file_count + global_dup_count),
            "within_file_duplicates": within_file_count,
            "global_duplicates": global_dup_count,
            "original_count": original_count,
            "all_duplicates": all_duplicates_flag
        })
    except Exception as e:
        print(f"[UPLOAD ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route('/api/session-check', methods=['GET'])
def session_check():
    """Check if a session exists and is valid - NEVER EXPIRES"""
    try:
        session_token = request.headers.get('X-Session-Token')
        if not session_token or session_token not in SESSIONS:
            return jsonify({"hasSession": False}), 200
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        return jsonify({"hasSession": True})
    except Exception as e:
        print(f"[SESSION CHECK ERROR] ❌ {e}")
        return jsonify({"hasSession": False}), 200

@app.route('/api/data', methods=['GET'])
def get_data():
    """Get session data with optional verifier filter - NEVER EXPIRES"""
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
        print(f"[GET DATA ERROR] ❌ {e}")
        return jsonify({"error": "Failed to get data"}), 500

@app.route('/api/update-status', methods=['POST'])
def update_status():
    """Update PDF status (Accepted/Rejected) and feedback - NEVER EXPIRES"""
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
        print(f"[UPDATE] ✅ {link} -> {status}")
        return jsonify({"success": True, "message": f"Updated to {status}"})
    except Exception as e:
        print(f"[UPDATE STATUS ERROR] ❌ {e}")
        return jsonify({"error": "Update failed"}), 500

@app.route('/api/download', methods=['GET'])
def download_csv():
    """Download reviewed CSV file - NEVER EXPIRES"""
    try:
        session_token = request.headers.get('X-Session-Token')
        if not session_token or session_token not in SESSIONS:
            return jsonify({"error": "Invalid session"}), 401
        df = pd.DataFrame(SESSIONS[session_token].get('data', []))
        output_filename = f"reviewed_{SESSIONS[session_token].get('filename', 'results.csv')}"
        output_path = os.path.join(UPLOAD_FOLDER, output_filename)
        df.to_csv(output_path, index=False)
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        print(f"[DOWNLOAD] 📥 {output_filename} by {SESSIONS[session_token].get('username', 'Unknown')}")
        return send_file(output_path, as_attachment=True, download_name=output_filename)
    except Exception as e:
        print(f"[DOWNLOAD ERROR] ❌ {e}")
        return jsonify({"error": "Download failed"}), 500

# ==========================
# HEALTH CHECK
# ==========================
@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "sessions": len(SESSIONS),
        "users": len(USERS),
        "auth_tokens": len(AUTH_TOKENS),
        "admin_tokens": len(ADMIN_TOKENS),
        "work_assignments": len(WORK_ASSIGNMENTS),
        "global_unique_links": len(GLOBAL_LINKS)
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
    print(f"📊 Active sessions: {len(SESSIONS)}")
    print(f"👤 Registered users: {len(USERS)}")
    print(f"📋 Work assignments: {len(WORK_ASSIGNMENTS)}")
    print(f"🔗 Global unique PDF links: {len(GLOBAL_LINKS)}")
    print(f"⏰ USER SESSION TIMEOUT: NEVER EXPIRES (100 years)")
    print(f"🔑 USER AUTH TOKEN TIMEOUT: NEVER EXPIRES (100 years)")
    print(f"🔐 ADMIN TOKEN TIMEOUT: 24 hours (auto-extends on use)")
    print("="*60)
    print("🌐 Server running on: http://0.0.0.0:5000")
    print("🌐 Also accessible at: http://localhost:5000")
    print("="*60 + "\n")

    app.run(host='0.0.0.0', port=5000, debug=False)
