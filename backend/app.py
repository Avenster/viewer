import os
import uuid
import json
import atexit
import secrets
import hashlib
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import pandas as pd
from functools import wraps

app = Flask(__name__)

# ==========================
# CONFIGURATION
# ==========================
CORS(app, resources={
    r"/api/*": {
        "origins": ["http://localhost:5173", "http://13.201.123.132:3000/"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "X-Session-Token", "X-Auth-Token", "X-Admin-Token"],
        "supports_credentials": False,
        "expose_headers": ["X-Already-Authenticated"]
    }
})

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'csv'}
SESSION_TIMEOUT = timedelta(hours=24)
AUTH_TOKEN_TIMEOUT = timedelta(hours=24)
ADMIN_TOKEN_TIMEOUT = timedelta(hours=24)

# File paths
SESSIONS_FILE = "sessions.json"
USERS_FILE = "users.json"
ADMIN_CREDENTIALS_FILE = "admin_credentials.json"
WORK_ASSIGNMENTS_FILE = "work_assignments.json"
GLOBAL_LINKS_FILE = "global_links.json"  # NEW: Global duplicate tracking

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
GLOBAL_LINKS = {}  # NEW: { "pdf_link_url": {"first_uploaded_by": "username", "first_uploaded_at": "timestamp", "count": 1} }

# ==========================
# AUTHENTICATION DECORATORS
# ==========================

def require_auth(f):
    """Decorator to require user authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_token = request.headers.get('X-Auth-Token')
        
        if not auth_token or auth_token not in AUTH_TOKENS:
            return jsonify({"error": "Unauthorized", "code": "AUTH_REQUIRED"}), 401
        
        token_data = AUTH_TOKENS[auth_token]
        expires_at = datetime.fromisoformat(token_data['expires_at'])
        
        if datetime.now() > expires_at:
            del AUTH_TOKENS[auth_token]
            return jsonify({"error": "Token expired", "code": "TOKEN_EXPIRED"}), 401
        
        request.user = token_data
        return f(*args, **kwargs)
    
    return decorated_function

def require_admin(f):
    """Decorator to require admin authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        admin_token = request.headers.get('X-Admin-Token')
        
        if not admin_token or admin_token not in ADMIN_TOKENS:
            return jsonify({"error": "Unauthorized", "code": "ADMIN_REQUIRED"}), 401
        
        token_data = ADMIN_TOKENS[admin_token]
        expires_at = datetime.fromisoformat(token_data['expires_at'])
        
        if datetime.now() > expires_at:
            del ADMIN_TOKENS[admin_token]
            return jsonify({"error": "Token expired", "code": "TOKEN_EXPIRED"}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

def check_already_authenticated(f):
    """Decorator to check if user is already authenticated (for login/signup routes)"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_token = request.headers.get('X-Auth-Token')
        
        if auth_token and auth_token in AUTH_TOKENS:
            token_data = AUTH_TOKENS[auth_token]
            expires_at = datetime.fromisoformat(token_data.get('expires_at', datetime.min.isoformat()))
            
            if datetime.now() <= expires_at:
                return jsonify({
                    "error": "Already authenticated",
                    "code": "ALREADY_AUTHENTICATED",
                    "user": {
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
    """Check which links are duplicates globally and return detailed info"""
    global GLOBAL_LINKS
    
    within_file_dupes = []  # Duplicates within the current file
    global_dupes = []  # Links that already exist in global database
    new_links = []  # Brand new links
    
    seen_in_current = {}  # Track what we've seen in current upload
    
    for link in links_list:
        link_clean = str(link).strip()
        if not link_clean:
            continue
        
        # Check if duplicate within current file
        if link_clean in seen_in_current:
            within_file_dupes.append({
                "link": link_clean,
                "type": "within_file"
            })
            continue
        
        seen_in_current[link_clean] = True
        
        # Check if exists in global database
        if link_clean in GLOBAL_LINKS:
            global_dupes.append({
                "link": link_clean,
                "first_uploaded_by": GLOBAL_LINKS[link_clean]['first_uploaded_by'],
                "first_uploaded_at": GLOBAL_LINKS[link_clean]['first_uploaded_at'],
                "upload_count": GLOBAL_LINKS[link_clean]['upload_count'],
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
    """Register new PDF links in global database"""
    global GLOBAL_LINKS
    
    registered_count = 0
    
    for link in links:
        link_clean = str(link).strip()
        if not link_clean:
            continue
        
        if link_clean in GLOBAL_LINKS:
            # Update existing entry
            GLOBAL_LINKS[link_clean]['upload_count'] += 1
            GLOBAL_LINKS[link_clean]['last_uploaded_by'] = username
            GLOBAL_LINKS[link_clean]['last_uploaded_at'] = datetime.now().isoformat()
        else:
            # New entry
            GLOBAL_LINKS[link_clean] = {
                "first_uploaded_by": username,
                "first_uploaded_at": datetime.now().isoformat(),
                "upload_count": 1,
                "last_uploaded_by": username,
                "last_uploaded_at": datetime.now().isoformat()
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
    """Remove expired sessions"""
    global SESSIONS
    now = datetime.now()
    expired = []
    
    for token, session in list(SESSIONS.items()):
        expires_at = datetime.fromisoformat(session.get('expires_at', datetime.min.isoformat()))
        if now > expires_at:
            expired.append(token)
    
    for token in expired:
        del SESSIONS[token]
    
    if expired:
        print(f"[CLEANUP] Removed {len(expired)} expired sessions")
        save_sessions()

def cleanup_expired_auth_tokens():
    """Remove expired auth tokens"""
    global AUTH_TOKENS
    now = datetime.now()
    expired = []
    
    for token, data in list(AUTH_TOKENS.items()):
        expires_at = datetime.fromisoformat(data.get('expires_at', datetime.min.isoformat()))
        if now > expires_at:
            expired.append(token)
    
    for token in expired:
        del AUTH_TOKENS[token]
    
    if expired:
        print(f"[CLEANUP] Removed {len(expired)} expired auth tokens")

def cleanup_expired_admin_tokens():
    """Remove expired admin tokens"""
    global ADMIN_TOKENS
    now = datetime.now()
    expired = []
    
    for token, data in list(ADMIN_TOKENS.items()):
        expires_at = datetime.fromisoformat(data.get('expires_at', datetime.min.isoformat()))
        if now > expires_at:
            expired.append(token)
    
    for token in expired:
        del ADMIN_TOKENS[token]
    
    if expired:
        print(f"[CLEANUP] Removed {len(expired)} expired admin tokens")

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
load_users()
load_sessions()
load_work_assignments()
load_global_links()  # NEW: Load global duplicate tracking

cleanup_expired_sessions()
cleanup_expired_auth_tokens()
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
    save_global_links()  # NEW: Save global links
    print("[SHUTDOWN] ✅ Cleanup complete")

atexit.register(cleanup)

# ==========================
# USER AUTHENTICATION ROUTES
# ==========================

@app.route('/api/auth/signup', methods=['POST'])
@check_already_authenticated
def signup():
    """User signup endpoint"""
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
            "created_at": datetime.now().isoformat()
        }
        
        auth_token = generate_token()
        AUTH_TOKENS[auth_token] = {
            "user_id": user_id,
            "username": username,
            "email": email,
            "name": name,
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + AUTH_TOKEN_TIMEOUT).isoformat()
        }
        
        save_users()
        
        print(f"[SIGNUP] ✅ New user created: {username} ({email})")
        
        return jsonify({
            "success": True,
            "token": auth_token,
            "user": {
                "username": username,
                "email": email,
                "name": name
            }
        })
        
    except Exception as e:
        print(f"[SIGNUP ERROR] ❌ {e}")
        return jsonify({"error": "Signup failed"}), 500

@app.route('/api/auth/login', methods=['POST'])
@check_already_authenticated
def login():
    """User login endpoint"""
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
        
        auth_token = generate_token()
        AUTH_TOKENS[auth_token] = {
            "user_id": user_id_found,
            "username": user_found['username'],
            "email": user_found['email'],
            "name": user_found['name'],
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + AUTH_TOKEN_TIMEOUT).isoformat()
        }
        
        print(f"[LOGIN] ✅ User logged in: {user_found['username']}")
        
        return jsonify({
            "success": True,
            "token": auth_token,
            "user": {
                "username": user_found['username'],
                "email": user_found['email'],
                "name": user_found['name']
            }
        })
        
    except Exception as e:
        print(f"[LOGIN ERROR] ❌ {e}")
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
    """Verify auth token"""
    try:
        auth_token = request.headers.get('X-Auth-Token')
        
        if not auth_token or auth_token not in AUTH_TOKENS:
            return jsonify({"error": "Invalid token", "code": "INVALID_TOKEN"}), 401
        
        token_data = AUTH_TOKENS[auth_token]
        expires_at = datetime.fromisoformat(token_data['expires_at'])
        
        if datetime.now() > expires_at:
            del AUTH_TOKENS[auth_token]
            return jsonify({"error": "Token expired", "code": "TOKEN_EXPIRED"}), 401
        
        return jsonify({
            "success": True,
            "user": {
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
            
            print(f"[ADMIN LOGIN] ✅ Admin logged in: {username}")
            return jsonify({"success": True, "token": token})
        else:
            print(f"[ADMIN LOGIN] ❌ Failed login attempt for: {username}")
            return jsonify({"error": "Invalid credentials"}), 401
            
    except Exception as e:
        print(f"[ADMIN LOGIN ERROR] ❌ {e}")
        return jsonify({"error": "Login failed"}), 500

@app.route('/api/admin/users', methods=['GET'])
@require_admin
def get_users_list():
    """Get list of all users for assignment dropdown"""
    try:
        users_list = []
        for user_id, user in USERS.items():
            users_list.append({
                "id": user_id,
                "username": user['username'],
                "name": user['name'],
                "email": user['email']
            })
        
        return jsonify({"users": users_list})
        
    except Exception as e:
        print(f"[GET USERS ERROR] ❌ {e}")
        return jsonify({"error": "Failed to get users"}), 500

@app.route('/api/admin/upload-assign', methods=['POST'])
@require_admin
def admin_upload_and_assign():
    """Admin uploads CSV and assigns work to users with global duplicate tracking"""
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
        except:
            return jsonify({"error": "Invalid assignments format"}), 400
        
        users_with_assignments = []
        for assignment in assignments:
            user_id = assignment['userId']
            if user_id not in USERS:
                continue
            
            user = USERS[user_id]
            username = user['username']
            
            for session_token, session in SESSIONS.items():
                if session.get('username') == username and session.get('assigned_by_admin', False):
                    session_expires = datetime.fromisoformat(session.get('expires_at', datetime.min.isoformat()))
                    if datetime.now() <= session_expires:
                        users_with_assignments.append(user['name'])
        
        if users_with_assignments:
            return jsonify({
                "error": f"The following users already have admin-assigned work: {', '.join(users_with_assignments)}. Please remove their existing assignments first."
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
        
        # NEW: Global duplicate checking
        original_count = len(df)
        all_links = df['link'].tolist()
        
        dup_check = check_global_duplicates(all_links)
        
        within_file_count = dup_check['within_file_count']
        global_dup_count = dup_check['global_duplicate_count']
        new_links_list = dup_check['new_links']
        
        total_duplicates = within_file_count + global_dup_count
        
        # Keep only new links
        df_clean = df[df['link'].isin(new_links_list)].copy()
        unique_count = len(df_clean)
        
        # Register new links globally
        register_links_globally(new_links_list, "admin")
        
        print(f"[ADMIN UPLOAD] 📊 Original: {original_count} | Within-file dupes: {within_file_count} | Global dupes: {global_dup_count} | New unique: {unique_count}")
        
        total_pdfs = len(df_clean)
        user_sessions = {}
        
        if assignment_type == 'range':
            for assignment in assignments:
                user_id = assignment['userId']
                start_range = int(assignment.get('startRange', 0))
                end_range = int(assignment.get('endRange', 0))
                
                if user_id not in USERS:
                    continue
                
                user = USERS[user_id]
                
                if start_range < 1 or end_range < 1:
                    os.remove(filepath)
                    return jsonify({"error": f"Range values must start from 1. Invalid range for {user['name']}"}), 400
                
                if start_range > total_pdfs or end_range > total_pdfs:
                    os.remove(filepath)
                    return jsonify({"error": f"Range exceeds total PDFs ({total_pdfs}). Invalid range for {user['name']}"}), 400
                
                if start_range > end_range:
                    os.remove(filepath)
                    return jsonify({"error": f"Start range cannot be greater than end range for {user['name']}"}), 400
                
                start_idx = start_range - 1
                end_idx = end_range
                
                user_df = df_clean.iloc[start_idx:end_idx].copy()
                
                if 'Status' not in user_df.columns:
                    user_df['Status'] = ''
                if 'Feedback' not in user_df.columns:
                    user_df['Feedback'] = ''
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
                    "created_at": datetime.now().isoformat(),
                    "expires_at": (datetime.now() + SESSION_TIMEOUT).isoformat(),
                    "last_accessed": datetime.now().isoformat(),
                    "assigned_by_admin": True,
                    "assigned_count": len(user_df),
                    "assigned_range": f"{start_range}-{end_range}",
                    "duplicates_removed": 0,
                    "duplicate_links": []
                }
                
                user_sessions[user_id] = {
                    "session_token": session_token,
                    "username": user['username'],
                    "name": user['name'],
                    "data": user_df.to_dict('records'),
                    "range": f"{start_range}-{end_range}"
                }
        
        else:
            current_index = 0
            
            for assignment in assignments:
                user_id = assignment['userId']
                percentage = assignment['percentage']
                
                if user_id not in USERS:
                    continue
                
                user = USERS[user_id]
                
                pdfs_count = int(total_pdfs * percentage / 100)
                
                start_idx = current_index
                end_idx = start_idx + pdfs_count
                user_df = df_clean.iloc[start_idx:end_idx].copy()
                current_index = end_idx
                
                if 'Status' not in user_df.columns:
                    user_df['Status'] = ''
                if 'Feedback' not in user_df.columns:
                    user_df['Feedback'] = ''
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
                    "created_at": datetime.now().isoformat(),
                    "expires_at": (datetime.now() + SESSION_TIMEOUT).isoformat(),
                    "last_accessed": datetime.now().isoformat(),
                    "assigned_by_admin": True,
                    "assigned_count": len(user_df),
                    "assigned_percentage": percentage,
                    "duplicates_removed": 0,
                    "duplicate_links": []
                }
                
                user_sessions[user_id] = {
                    "session_token": session_token,
                    "username": user['username'],
                    "name": user['name'],
                    "data": user_df.to_dict('records'),
                    "percentage": percentage
                }
        
        assignment_id = str(uuid.uuid4())
        WORK_ASSIGNMENTS[assignment_id] = {
            "filename": unique_filename,
            "file_hash": file_hash,
            "original_count": original_count,
            "unique_count": unique_count,
            "duplicates_count": total_duplicates,
            "within_file_duplicates": within_file_count,
            "global_duplicates": global_dup_count,
            "duplicate_links": [],
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
        
        print(f"[ADMIN UPLOAD] ✅ CSV uploaded and assigned to {len(user_sessions)} users")
        
        return jsonify({
            "success": True,
            "message": "Work assigned successfully",
            "assignment_id": assignment_id,
            "assignment_type": assignment_type,
            "total_pdfs": original_count,
            "unique_pdfs": unique_count,
            "duplicates": total_duplicates,
            "within_file_duplicates": within_file_count,
            "global_duplicates": global_dup_count,
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
        
        return jsonify({
            "success": True,
            "message": f"Session removed for {username}"
        })
        
    except Exception as e:
        print(f"[REMOVE SESSION ERROR] ❌ {e}")
        return jsonify({"error": "Failed to remove session"}), 500

@app.route('/api/admin/dashboard', methods=['GET'])
@require_admin
def admin_dashboard():
    """Admin dashboard endpoint - returns all sessions and stats with proper duplicate tracking"""
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
                "assigned_percentage": session.get('assigned_percentage')
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
            "global_unique_links": len(GLOBAL_LINKS)  # NEW: Total unique links ever uploaded
        }
        
        print(f"[ADMIN DASHBOARD] 📊 Data requested - {len(all_sessions)} sessions")
        
        return jsonify({"sessions": all_sessions, "stats": stats})
        
    except Exception as e:
        print(f"[ADMIN DASHBOARD ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to load dashboard"}), 500

# Continue in next message due to length...

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
            link = str(item.get('link', ''))[:50] + '...' if len(str(item.get('link', ''))) > 50 else str(item.get('link', ''))
            
            report_text += f"{idx}. [{status}] {link}\n"
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
    """Check if user has work assigned by admin"""
    try:
        username = request.user['username']
        
        user_sessions = []
        
        for session_token, session in SESSIONS.items():
            if session.get('username') == username:
                session_expires = datetime.fromisoformat(session.get('expires_at', datetime.min.isoformat()))
                if datetime.now() <= session_expires:
                    user_sessions.append({
                        'token': session_token,
                        'session': session,
                        'created_at': session.get('created_at'),
                        'assigned_by_admin': session.get('assigned_by_admin', False),
                        'total_pdfs': len(session.get('data', []))
                    })
        
        if not user_sessions:
            print(f"[CHECK WORK] ❌ {username} has no active sessions")
            return jsonify({"hasAssignedWork": False})
        
        admin_sessions = [s for s in user_sessions if s['assigned_by_admin']]
        
        if admin_sessions:
            admin_sessions.sort(key=lambda x: x['created_at'], reverse=True)
            selected_session = admin_sessions[0]
        else:
            user_sessions.sort(key=lambda x: x['created_at'], reverse=True)
            selected_session = user_sessions[0]
        
        print(f"[CHECK WORK] ✅ {username} has {selected_session['total_pdfs']} PDFs (admin assigned: {selected_session['assigned_by_admin']})")
        
        return jsonify({
            "hasAssignedWork": True,
            "session_token": selected_session['token'],
            "total_pdfs": selected_session['total_pdfs'],
            "assigned_by_admin": selected_session['assigned_by_admin']
        })
        
    except Exception as e:
        print(f"[CHECK WORK ERROR] ❌ {e}")
        return jsonify({"error": "Check failed"}), 500

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
            return jsonify({
                "is_duplicate": False,
                "message": "File is unique, ready to upload"
            })
        
    except Exception as e:
        print(f"[CHECK DUPLICATE ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Duplicate check failed"}), 500

@app.route('/api/upload', methods=['POST'])
@require_auth
def upload_csv():
    """Upload CSV file and create a review session with global duplicate tracking"""
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
        
        # NEW: Global duplicate checking
        original_count = len(df)
        all_links = df['link'].tolist()
        
        dup_check = check_global_duplicates(all_links)
        
        within_file_count = dup_check['within_file_count']
        global_dup_count = dup_check['global_duplicate_count']
        new_links_list = dup_check['new_links']
        
        total_duplicates = within_file_count + global_dup_count
        
        # Keep only new links
        df_clean = df[df['link'].isin(new_links_list)].copy()
        unique_count = len(df_clean)
        
        # Register new links globally
        register_links_globally(new_links_list, request.user['username'])
        
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
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + SESSION_TIMEOUT).isoformat(),
            "last_accessed": datetime.now().isoformat(),
            "duplicates_removed": total_duplicates,
            "within_file_duplicates": within_file_count,
            "global_duplicates": global_dup_count,
            "duplicate_links": [],
            "assigned_by_admin": False
        }
        
        save_sessions()
        
        print(f"[UPLOAD] ✅ New session created by {request.user['username']}: {unique_count} unique PDFs")
        print(f"[UPLOAD] 📊 Original: {original_count} | Within-file dupes: {within_file_count} | Global dupes: {global_dup_count} | New unique: {unique_count}")
        
        return jsonify({
            "success": True,
            "message": "File uploaded successfully",
            "token": session_token,
            "total": unique_count,
            "duplicates_removed": total_duplicates,
            "within_file_duplicates": within_file_count,
            "global_duplicates": global_dup_count,
            "original_count": original_count
        })
        
    except Exception as e:
        print(f"[UPLOAD ERROR] ❌ {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500

@app.route('/api/session-check', methods=['GET'])
def session_check():
    """Check if a session exists and is valid"""
    try:
        session_token = request.headers.get('X-Session-Token')
        
        if not session_token or session_token not in SESSIONS:
            return jsonify({"hasSession": False}), 200
        
        session = SESSIONS[session_token]
        expires_at = datetime.fromisoformat(session.get('expires_at', datetime.min.isoformat()))
        
        if datetime.now() > expires_at:
            del SESSIONS[session_token]
            save_sessions()
            return jsonify({"hasSession": False}), 200
        
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        
        return jsonify({"hasSession": True})
        
    except Exception as e:
        print(f"[SESSION CHECK ERROR] ❌ {e}")
        return jsonify({"hasSession": False}), 200

@app.route('/api/data', methods=['GET'])
def get_data():
    """Get session data with optional verifier filter"""
    try:
        session_token = request.headers.get('X-Session-Token')
        
        if not session_token or session_token not in SESSIONS:
            return jsonify({"error": "Invalid session"}), 401
        
        session = SESSIONS[session_token]
        expires_at = datetime.fromisoformat(session.get('expires_at', datetime.min.isoformat()))
        
        if datetime.now() > expires_at:
            del SESSIONS[session_token]
            save_sessions()
            return jsonify({"error": "Session expired"}), 401
        
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        
        data = session.get('data', [])
        
        verifier = request.args.get('verifier', '').strip()
        if verifier:
            data = [item for item in data if item.get('Verified By', '') == verifier]
        
        return jsonify({"data": data})
        
    except Exception as e:
        print(f"[GET DATA ERROR] ❌ {e}")
        return jsonify({"error": "Failed to get data"}), 500

# Continue from where it was cut off...

@app.route('/api/update-status', methods=['POST'])
def update_status():
    """Update PDF status (Accepted/Rejected) and feedback"""
    try:
        session_token = request.headers.get('X-Session-Token')
        
        if not session_token or session_token not in SESSIONS:
            return jsonify({"error": "Invalid session"}), 401
        
        session = SESSIONS[session_token]
        expires_at = datetime.fromisoformat(session.get('expires_at', datetime.min.isoformat()))
        
        if datetime.now() > expires_at:
            del SESSIONS[session_token]
            save_sessions()
            return jsonify({"error": "Session expired"}), 401
        
        data = request.json
        link = data.get('link', '').strip()
        status = data.get('status', '').strip()
        feedback = data.get('feedback', '').strip()
        
        if not link or not status:
            return jsonify({"error": "Link and status required"}), 400
        
        session_data = session.get('data', [])
        updated = False
        
        for item in session_data:
            if str(item.get('link', '')).strip() == link:
                item['Status'] = status
                if status == 'Rejected':
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
    """Download reviewed CSV file"""
    try:
        session_token = request.headers.get('X-Session-Token')
        
        if not session_token or session_token not in SESSIONS:
            return jsonify({"error": "Invalid session"}), 401
        
        session = SESSIONS[session_token]
        expires_at = datetime.fromisoformat(session.get('expires_at', datetime.min.isoformat()))
        
        if datetime.now() > expires_at:
            del SESSIONS[session_token]
            save_sessions()
            return jsonify({"error": "Session expired"}), 401
        
        df = pd.DataFrame(session.get('data', []))
        
        output_filename = f"reviewed_{session.get('filename', 'results.csv')}"
        output_path = os.path.join(UPLOAD_FOLDER, output_filename)
        df.to_csv(output_path, index=False)
        
        SESSIONS[session_token]['last_accessed'] = datetime.now().isoformat()
        
        print(f"[DOWNLOAD] 📥 {output_filename} by {session.get('username', 'Unknown')}")
        
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
    print(f"📊 Active sessions: {len(SESSIONS)}")
    print(f"👤 Registered users: {len(USERS)}")
    print(f"📋 Work assignments: {len(WORK_ASSIGNMENTS)}")
    print(f"🔗 Global unique PDF links: {len(GLOBAL_LINKS)}")
    print("="*60)
    print("🌐 Server running on: http://0.0.0.0:5000")
    print("🌐 Also accessible at: http://localhost:5000")
    print("="*60 + "\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False)