# server.py (replace/merge with your existing app)
import os
import uuid
import json
import atexit
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS
import pandas as pd
from werkzeug.utils import secure_filename
import requests
from pathlib import Path
from PyPDF2 import PdfReader, PdfWriter  # pip install PyPDF2

app = Flask(__name__)

# ==========================
# CONFIG
# ==========================
UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", "uploads")
SESSIONS_FILE = os.environ.get("SESSIONS_FILE", "sessions.json")
SESSION_EXPIRY_HOURS = int(os.environ.get("SESSION_EXPIRY_HOURS", "24"))
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
MAX_PARALLEL_DOWNLOADS = int(os.environ.get("MAX_PARALLEL_DOWNLOADS", "6"))

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

SESSIONS = {}

# CORS: allow serve-pdf and api endpoints
CORS(
    app,
    supports_credentials=False,
    resources={r"/api/*": {"origins": [FRONTEND_URL, "http://localhost:5173", "http://localhost:3000"]}},
    allow_headers=["Content-Type", "X-Session-Token"],
)

# ==========================
# Persistence helpers (extended)
# ==========================
def load_sessions():
    global SESSIONS
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                SESSIONS = json.load(f)
                # ensure cached_pages keys exist
                for token, data in list(SESSIONS.items()):
                    if isinstance(data, dict) and "cached_pages" not in data:
                        data["cached_pages"] = {}
                print(f"[SESSIONS] Loaded {len(SESSIONS)} sessions from {SESSIONS_FILE}")
                clean_expired_sessions()
        except Exception as e:
            print(f"[SESSIONS] Failed to load sessions: {e}")
            SESSIONS = {}

def save_sessions():
    try:
        with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(SESSIONS, f)
            print(f"[SESSIONS] Saved {len(SESSIONS)} sessions to {SESSIONS_FILE}")
    except Exception as e:
        print(f"[SESSIONS] Failed to save sessions: {e}")

def delete_cached_files_for_session(token):
    data = SESSIONS.get(token)
    if not data:
        return
    cached = data.get("cached_pages", {})
    for page, file_list in list(cached.items()):
        for p in file_list:
            try:
                if os.path.exists(p):
                    os.remove(p)
                    print(f"[CLEANUP] removed cached file {p}")
            except Exception as e:
                print(f"[CLEANUP] failed remove {p}: {e}")
    data["cached_pages"] = {}
    save_sessions()

def clean_expired_sessions():
    global SESSIONS
    now = datetime.now()
    expired_tokens = []
    for token, session_data in list(SESSIONS.items()):
        # If session_data is a string (older format) treat as csv path
        if isinstance(session_data, str):
            csv_path = session_data
            if not os.path.exists(csv_path):
                expired_tokens.append(token)
            continue

        expires_at = datetime.fromisoformat(session_data.get("expires_at", "2000-01-01"))
        if now > expires_at:
            expired_tokens.append(token)
            # delete csv
            csv_path = session_data.get("csv_path")
            if csv_path and os.path.exists(csv_path):
                try:
                    os.remove(csv_path)
                    print(f"[CLEANUP] Removed expired file: {csv_path}")
                except Exception as e:
                    print(f"[CLEANUP] Failed to remove {csv_path}: {e}")
            # delete cached compressed files
            cached = session_data.get("cached_pages", {})
            for _, file_list in cached.items():
                for p in file_list:
                    try:
                        if os.path.exists(p):
                            os.remove(p)
                    except Exception:
                        pass

    for token in expired_tokens:
        if token in SESSIONS:
            del SESSIONS[token]

    if expired_tokens:
        print(f"[CLEANUP] Removed {len(expired_tokens)} expired sessions")
        save_sessions()

atexit.register(save_sessions)
load_sessions()

# ==========================
# Helpers
# ==========================
def get_session_from_request(require_csv=True):
    token = request.headers.get("X-Session-Token") or request.args.get("token")
    if not token:
        print("[DEBUG] Missing token in request")
        return None, None
    session_data = SESSIONS.get(token)
    if not session_data:
        print(f"[DEBUG] Token {token} not found in sessions")
        return None, None
    if isinstance(session_data, str):
        csv_path = session_data
        expires_at = datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS)
        session_data = {
            "csv_path": csv_path,
            "created_at": datetime.now().isoformat(),
            "expires_at": expires_at.isoformat(),
            "last_accessed": datetime.now().isoformat(),
            "cached_pages": {}
        }
        SESSIONS[token] = session_data
        save_sessions()
    else:
        expires_at = datetime.fromisoformat(session_data.get("expires_at", "2000-01-01"))
        if datetime.now() > expires_at:
            print(f"[DEBUG] Token {token} has expired")
            csv_path = session_data.get("csv_path")
            if csv_path and os.path.exists(csv_path):
                try:
                    os.remove(csv_path)
                except Exception as e:
                    print(f"[CLEANUP] Failed to remove {csv_path}: {e}")
            # cleanup cached files
            delete_cached_files_for_session(token)
            del SESSIONS[token]
            save_sessions()
            return None, None
        session_data["last_accessed"] = datetime.now().isoformat()
        save_sessions()

    csv_path = session_data.get("csv_path")
    if require_csv and (not csv_path or not os.path.exists(csv_path)):
        print(f"[DEBUG] CSV file not found for token {token}")
        # remove session and any caches
        delete_cached_files_for_session(token)
        if token in SESSIONS:
            del SESSIONS[token]
            save_sessions()
        return None, None
    return token, csv_path

# ==========================
# Routes (existing)
# ==========================
@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()}), 200

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
    original_count = len(df)
    df = df.drop_duplicates(subset=["link"], keep="first").reset_index(drop=True)
    duplicates_removed = original_count - len(df)
    if "Status" not in df.columns:
        df["Status"] = ""
    if "Feedback" not in df.columns:
        df["Feedback"] = ""
    df = df.fillna("")
    base, _ext = os.path.splitext(upload_path)
    reviewed_path = f"{base}_reviewed.csv"
    df.to_csv(reviewed_path, index=False)
    try:
        os.remove(upload_path)
    except Exception as e:
        print(f"[UPLOAD] Failed to remove temp file: {e}")
    token = uuid.uuid4().hex
    expires_at = datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS)
    SESSIONS[token] = {
        "csv_path": reviewed_path,
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at.isoformat(),
        "last_accessed": datetime.now().isoformat(),
        "original_filename": filename,
        "cached_pages": {}
    }
    save_sessions()
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
    # NOTE: previously we required feedback for Rejected; user requested to allow rejecting without feedback
    try:
        df = pd.read_csv(csv_path)
    except Exception as e:
        return jsonify({"error": f"Failed to read CSV: {e}"}), 500
    if not (0 <= int(index) < len(df)):
        return jsonify({"error": "Invalid index"}), 400
    df.loc[int(index), "Status"] = status
    # only set Feedback if provided, else clear it
    df.loc[int(index), "Feedback"] = feedback if feedback else df.loc[int(index), "Feedback"]
    df = df.fillna("")
    df.to_csv(csv_path, index=False)
    print(f"[UPDATE] token={token}, index={index}, status={status}, feedback={(feedback[:50] if feedback else 'none')}")
    return jsonify({"message": f"Marked as {status}"}), 200

@app.route("/api/download", methods=["GET"])
def download_csv():
    token, csv_path = get_session_from_request()
    if not token or not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "No reviewed CSV available or invalid/expired token"}), 401
    try:
        df = pd.read_csv(csv_path)
        df = df.drop_duplicates(subset=["link"], keep="first")
        temp_path = csv_path.replace(".csv", "_download.csv")
        df.to_csv(temp_path, index=False)
        session_data = SESSIONS.get(token, {})
        original_name = session_data.get("original_filename", "reviewed_results.csv")
        download_name = f"reviewed_{original_name}"
        response = send_file(temp_path, as_attachment=True, download_name=download_name, mimetype='text/csv')
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

# ==========================
# New: PDF prep / caching / serving endpoints
# ==========================
def safe_filename(name: str) -> str:
    return secure_filename(name)

def ensure_session_dir(token: str) -> str:
    d = os.path.join(UPLOAD_FOLDER, token)
    os.makedirs(d, exist_ok=True)
    return d

def try_compress_pdf(src_path: str, dest_path: str) -> bool:
    """
    Lightweight re-write using PyPDF2 which sometimes reduces size.
    Returns True if dest_path exists and is written, False otherwise.
    """
    try:
        reader = PdfReader(src_path)
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        # copy metadata (keeps minimal)
        with open(dest_path, "wb") as f:
            writer.write(f)
        return os.path.exists(dest_path)
    except Exception as e:
        print(f"[COMPRESS] failed compressing {src_path}: {e}")
        return False

def download_file_stream(url: str, dest_path: str, timeout=20) -> bool:
    try:
        with requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
        return True
    except Exception as e:
        print(f"[DOWNLOAD] failed {url}: {e}")
        return False

@app.route("/api/prepare-page", methods=["POST"])
def prepare_page():
    """
    Prepare page: download and compress the PDFs for the requested page (0-indexed).
    Request JSON:
      { "page": 0, "items_per_page": 10 }
    Response:
      { "items": [{ "index": <abs_index>, "compressed_url": "<url or null>", "original_link": "<link>" }, ...] }
    """
    token, csv_path = get_session_from_request()
    if not token or not csv_path:
        return jsonify({"error": "No CSV uploaded or invalid/expired token"}), 401

    body = request.get_json(silent=True) or {}
    page = int(body.get("page", 0))
    items_per_page = int(body.get("items_per_page", 10))
    # read CSV and get links for the page
    try:
        df = pd.read_csv(csv_path)
    except Exception as e:
        return jsonify({"error": f"Failed to read CSV: {e}"}), 500

    start = page * items_per_page
    end = min(start + items_per_page, len(df))
    page_rows = df.iloc[start:end].to_dict("records")
    session_dir = ensure_session_dir(token)

    # delete cached pages except the page we are preparing
    cached = SESSIONS[token].get("cached_pages", {})
    to_delete_pages = [p for p in list(cached.keys()) if int(p) != page]
    for p in to_delete_pages:
        for f in cached.get(p, []):
            try:
                if os.path.exists(f):
                    os.remove(f)
                    print(f"[CLEANUP] removed cached {f}")
            except Exception as e:
                print(f"[CLEANUP] failed removing {f}: {e}")
        cached.pop(p, None)
    SESSIONS[token]["cached_pages"] = cached
    save_sessions()

    prepared_items = []
    saved_files_for_page = []

    for i, row in enumerate(page_rows):
        abs_index = start + i
        link = row.get("link", "")
        filename_base = f"p{page}_i{abs_index}"
        tmp_download = os.path.join(session_dir, filename_base + "_orig.pdf")
        compressed = os.path.join(session_dir, filename_base + "_cmp.pdf")

        compressed_url = None

        # Skip if cached already exists
        already_cached = SESSIONS[token].get("cached_pages", {}).get(str(page), [])
        matched = None
        for existing in already_cached:
            if f"i{abs_index}_" in os.path.basename(existing) or f"i{abs_index}" in os.path.basename(existing):
                if os.path.exists(existing):
                    compressed_url = f"{request.host_url.rstrip('/')}/api/serve-pdf/{token}/{os.path.basename(existing)}"
                    matched = existing
                    break

        if matched:
            saved_files_for_page.append(matched)
            prepared_items.append({"index": abs_index, "compressed_url": compressed_url, "original_link": link})
            continue

        # Download remote PDF
        ok = download_file_stream(link, tmp_download)
        if not ok:
            print(f"[PREPARE] download failed for index {abs_index}: {link}")
            # fallback: no compressed_url -> frontend can use original link
            prepared_items.append({"index": abs_index, "compressed_url": None, "original_link": link})
            continue

        # Try compressing (rewrite) - if it fails use original file
        compressed_ok = try_compress_pdf(tmp_download, compressed)
        if compressed_ok:
            # keep compressed path, remove original download if present
            try:
                if os.path.exists(tmp_download):
                    os.remove(tmp_download)
            except Exception:
                pass
            saved_files_for_page.append(compressed)
            compressed_url = f"{request.host_url.rstrip('/')}/api/serve-pdf/{token}/{os.path.basename(compressed)}"
            prepared_items.append({"index": abs_index, "compressed_url": compressed_url, "original_link": link})
        else:
            # compression failed, serve original downloaded file
            fallback_name = os.path.join(session_dir, filename_base + "_fallback.pdf")
            try:
                os.replace(tmp_download, fallback_name)
                saved_files_for_page.append(fallback_name)
                compressed_url = f"{request.host_url.rstrip('/')}/api/serve-pdf/{token}/{os.path.basename(fallback_name)}"
                prepared_items.append({"index": abs_index, "compressed_url": compressed_url, "original_link": link})
            except Exception:
                # last fallback: no cached file
                prepared_items.append({"index": abs_index, "compressed_url": None, "original_link": link})

    # register cached files for this page
    SESSIONS[token].setdefault("cached_pages", {})
    SESSIONS[token]["cached_pages"][str(page)] = saved_files_for_page
    save_sessions()

    return jsonify({"items": prepared_items}), 200

@app.route("/api/serve-pdf/<token>/<filename>", methods=["GET"])
def serve_pdf(token, filename):
    """
    Serve a cached PDF file stored under UPLOAD_FOLDER/<token>/
    """
    # public serving requires valid token and file existence
    session = SESSIONS.get(token)
    if not session:
        return abort(404)
    session_dir = os.path.join(UPLOAD_FOLDER, token)
    safe_name = secure_filename(filename)
    path = os.path.join(session_dir, safe_name)
    if not os.path.exists(path):
        return abort(404)
    # send the file with caching headers to speed up subsequent requests
    return send_file(path, mimetype="application/pdf", as_attachment=False)

# ==========================
# Run
# ==========================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV", "production") != "production"
    print(f"[START] Flask server starting on :{port}")
    app.run(host="0.0.0.0", debug=debug, port=port)
