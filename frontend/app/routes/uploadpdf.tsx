// src/pages/UploadPdf.tsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";
import {
  Upload,
  Download,
  RefreshCw,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Home,
  LogOut,
  AlertTriangle,
} from "lucide-react";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://13.201.123.132:5000";

export default function UploadPdf() {
  const { user, authToken, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  // note: switched to an array of files to support multi upload
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const [myPdfs, setMyPdfs] = useState<any[]>([]);
  const [loadingPdfs, setLoadingPdfs] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    fetchMyPdfs();
    // eslint-disable-next-line
  }, [isAuthenticated]);

  // ---------------- file selection / drag & drop (multi) ----------------
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // convert FileList to array and append to existing files, avoid duplicates by name+size
      const selected = Array.from(e.target.files);
      setFiles((prev) => mergeFileArrays(prev, selected));
      setMessage(null);
      setResult(null);
      // clear input value to allow selecting same files again if user wants
      e.currentTarget.value = "";
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const dropped = Array.from(e.dataTransfer.files);
      setFiles((prev) => mergeFileArrays(prev, dropped));
      setMessage(null);
      setResult(null);
    }
  };

  function mergeFileArrays(oldFiles: File[], newFiles: File[]) {
    const map = new Map<string, File>();
    // key by name|size to avoid duplicates
    for (const f of oldFiles) map.set(`${f.name}::${f.size}`, f);
    for (const f of newFiles) map.set(`${f.name}::${f.size}`, f);
    return Array.from(map.values());
  }

  const removeFileAtIndex = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---------------- upload (single file) reused for internal loop ----------------
  const uploadSingle = async (fileToUpload: File) => {
    if (!fileToUpload || !authToken) return { ok: false, error: "No auth token or file" };
    const form = new FormData();
    form.append("pdf_file", fileToUpload);
    try {
      const res = await fetch(`${API_URL}/api/upload-pdf`, {
        method: "POST",
        headers: { "X-Auth-Token": authToken },
        body: form,
      });
      if (res.status === 401) {
        return { ok: false, status: 401, error: "Unauthorized" };
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return { ok: true, data };
      } else {
        return { ok: false, error: data.error || res.statusText || "Upload failed" };
      }
    } catch (err) {
      console.error("uploadSingle error:", err);
      return { ok: false, error: "Network error" };
    }
  };

  // If single file selected use old upload behaviour; if multiple, upload sequentially
  const upload = async () => {
    if (files.length === 0) {
      setMessage("Select a PDF file first");
      return;
    }
    if (!authToken) {
      setMessage("❌ No auth token. Please login again.");
      return;
    }

    setUploading(true);
    setMessage(null);
    setResult(null);

    // if only one file, mimic previous single-file flow (keeps UX same)
    if (files.length === 1) {
      const f = files[0];
      const r = await uploadSingle(f);
      if (r.status === 401) {
        setMessage("❌ Unauthorized. Please login again.");
        setTimeout(() => {
          logout();
          navigate("/login");
        }, 1000);
        setUploading(false);
        return;
      }
      if (r.ok) {
        const data = r.data;
        if (data.duplicate) {
          setMessage("⚠️ Duplicate detected");
          setResult(data);
        } else {
          setMessage("✅ Uploaded successfully");
          setResult(data);
          await fetchMyPdfs();
          // remove uploaded file from selection
          setFiles([]);
        }
      } else {
        setMessage(`❌ Upload failed: ${r.error}`);
      }
      setUploading(false);
      return;
    }

    // multiple files: upload sequentially, collect results
    const results: Array<{ file: string; ok: boolean; data?: any; error?: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setMessage(`Uploading ${i + 1}/${files.length}: ${f.name}`);
      const res = await uploadSingle(f);
      if (res.status === 401) {
        setMessage("❌ Unauthorized. Please login again.");
        setTimeout(() => {
          logout();
          navigate("/login");
        }, 1000);
        results.push({ file: f.name, ok: false, error: "Unauthorized" });
        break;
      }
      if (res.ok) {
        results.push({ file: f.name, ok: true, data: res.data });
      } else {
        results.push({ file: f.name, ok: false, error: res.error });
      }
    }

    // summary message
    const successCount = results.filter((r) => r.ok).length;
    const failCount = results.length - successCount;
    setMessage(`✅ ${successCount} uploaded, ❌ ${failCount} failed`);
    setResult({ multi: true, results });
    await fetchMyPdfs();
    // clear successful uploads from selection
    setFiles((prev) => prev.filter((f) => {
      const resItem = results.find((r) => r.file === f.name);
      return resItem ? !resItem.ok : true;
    }));
    setUploading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return setMessage("Select a PDF file first");
    upload();
  };

  async function fetchMyPdfs() {
    if (!authToken) return;
    setLoadingPdfs(true);
    try {
      const res = await fetch(`${API_URL}/api/my-pdfs`, { headers: { "X-Auth-Token": authToken } });
      if (res.status === 401) {
        logout();
        navigate("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) setMyPdfs(data.items || []);
      else setMessage(`❌ Could not fetch uploads: ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Could not fetch uploads (network error)");
    } finally {
      setLoadingPdfs(false);
    }
  }

  async function exportAccepted() {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/export-accepted`, { headers: { "X-Auth-Token": authToken } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(`❌ Export failed: ${data.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `accepted_pdfs_${user?.username || "me"}.zip`;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setMessage("❌ Export failed (network error)");
    }
  }

  const getStatusBadge = (item: any) => {
    if (item.status === "Accepted")
      return (
        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 text-xs font-medium rounded-full flex items-center gap-1.5">
          <CheckCircle size={12} /> Accepted
        </span>
      );
    if (item.status === "Rejected")
      return (
        <span className="px-2.5 py-1 bg-red-500/10 text-red-600 text-xs font-medium rounded-full flex items-center gap-1.5">
          <XCircle size={12} /> Rejected
        </span>
      );
    if (item.assigned_to)
      return (
        <span className="px-2.5 py-1 bg-blue-500/10 text-blue-600 text-xs font-medium rounded-full flex items-center gap-1.5">
          <Clock size={12} /> In Review
        </span>
      );
    return (
      <span className="px-2.5 py-1 bg-gray-500/10 text-gray-600 text-xs font-medium rounded-full flex items-center gap-1.5">
        <AlertCircle size={12} /> Pending
      </span>
    );
  };

  // ---------- viewPdf using blob fetch (no other logic changed) ----------
  async function viewPdf(pdfId: string) {
    if (!authToken) {
      setMessage("❌ No auth token available");
      return;
    }
    setActionLoading((s) => ({ ...s, [pdfId]: true }));
    let blobUrl: string | null = null;

    try {
      const res = await fetch(`${API_URL}/api/global-pdfs/${pdfId}`, {
        method: "GET",
        headers: { "X-Auth-Token": authToken, Accept: "application/pdf" },
      });

      if (res.status === 401) {
        setMessage("❌ Unauthorized. Please login again.");
        logout();
        navigate("/login");
        return;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setMessage(`❌ Failed to fetch PDF: ${res.status} ${body || res.statusText}`);
        return;
      }

      const blob = await res.blob();
      // create object URL and open new tab with iframe
      blobUrl = URL.createObjectURL(blob);
      const newWin = window.open("", "_blank");
      if (!newWin) {
        // popup blocked fallback
        window.location.assign(blobUrl);
      } else {
        newWin.document.open();
        newWin.document.write(`
          <!doctype html>
          <html>
            <head>
              <meta charset="utf-8"/>
              <title>PDF Preview</title>
              <style>html,body{height:100%;margin:0}iframe{border:0;width:100%;height:100vh;}</style>
            </head>
            <body>
              <iframe src="${blobUrl}" frameborder="0" allowfullscreen></iframe>
            </body>
          </html>
        `);
        newWin.document.close();
      }

      // revoke after a reasonable delay (2 minutes)
      setTimeout(() => {
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch (e) {}
        }
      }, 1000 * 120);
    } catch (err) {
      console.error("viewPdf error:", err);
      setMessage("❌ Error loading PDF");
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch (e) {}
      }
    } finally {
      setActionLoading((s) => ({ ...s, [pdfId]: false }));
    }
  }
  // -------------------------------------------------------------------------

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="backdrop-blur-md bg-black/5 border-b border-black/10 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-5">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 backdrop-blur-md bg-black text-white rounded-full flex items-center justify-center font-bold text-lg">
                {user?.name?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <div className="font-semibold text-black">{user?.name}</div>
                <div className="text-xs text-gray-500">@{user?.username}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigate("/home")}
                className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-black/10 rounded-full text-sm font-medium text-black hover:bg-white/80 transition-all"
              >
                <Home size={14} />
                Back
              </button>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-all"
              >
                <LogOut size={14} />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-8">
        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-2xl backdrop-blur-md text-sm font-medium ${
              message.includes("❌")
                ? "bg-red-500/10 text-red-600 border border-red-500/20"
                : message.includes("⚠️")
                ? "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20"
                : "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
            }`}
          >
            {message}
          </div>
        )}

        {/* Upload Form */}
        <form onSubmit={handleSubmit}>
          <div
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => document.getElementById("pdfInput")?.click()}
            className={`backdrop-blur-md bg-black/5 border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
              dragOver ? "border-black bg-black/10" : "border-black/20 hover:border-black/40"
            }`}
          >
            <input
              id="pdfInput"
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={onFileChange}
              multiple
            />
            <Upload size={48} className={`mx-auto mb-4 ${dragOver ? "text-black" : "text-gray-400"}`} />
            <div className="text-lg font-semibold text-black mb-2">
              {files.length === 0 ? "Drop PDFs here or click to browse" : `${files.length} file(s) selected`}
            </div>
            <div className="text-sm text-gray-500">
              You can select multiple files. Name & binary duplication checks performed per file.
            </div>

            {/* show selected files */}
            {files.length > 0 && (
              <div className="mt-4 max-h-40 overflow-auto">
                {files.map((f, idx) => (
                  <div key={`${f.name}-${f.size}-${idx}`} className="flex items-center justify-between text-xs text-gray-700 bg-white/50 p-2 rounded-md mb-2">
                    <div className="truncate mr-2">{f.name}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] text-gray-500">{(f.size / 1024).toFixed(0)} KB</div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFileAtIndex(idx);
                        }}
                        className="px-2 py-1 bg-red-500 text-white rounded-full text-[11px]"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={files.length === 0 || uploading}
              className="flex items-center gap-2 px-5 py-3 bg-black text-white rounded-full font-semibold text-sm hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-all"
            >
              <Upload size={16} />
              {uploading ? "Uploading..." : files.length > 1 ? `Upload ${files.length} files` : "Upload PDF"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFiles([]);
                setMessage(null);
                setResult(null);
              }}
              className="px-5 py-3 bg-white/50 border border-black/10 rounded-full font-semibold text-sm text-black hover:bg-white/80 transition-all"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={exportAccepted}
              className="flex items-center gap-2 px-5 py-3 bg-white/50 border border-black/10 rounded-full font-semibold text-sm text-black hover:bg-white/80 transition-all"
            >
              <Download size={16} />
              Export Accepted
            </button>
          </div>
        </form>

        {/* Result Area */}
        {result && (
          <div className="mt-6 backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-5">
            {result.duplicate && !result.multi ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={18} className="text-yellow-600" />
                  <div className="font-semibold text-black">Duplicate detected</div>
                </div>
                <div className="text-sm text-gray-600">Reason: {result.reason}</div>
                {result.existing && (
                  <div className="text-sm text-gray-600 mt-2">
                    Existing: {result.existing.original_name} (uploaded by {result.existing.uploaded_by})
                  </div>
                )}
              </div>
            ) : result.multi ? (
              <div>
                <div className="font-semibold text-black mb-2">Upload summary</div>
                <div className="text-sm text-gray-600">
                  {result.results.map((r: any, i: number) => (
                    <div key={i} className={`py-1 ${r.ok ? "text-emerald-700" : "text-red-600"}`}>
                      {r.ok ? "✅" : "❌"} {r.file} {r.ok ? "" : `— ${r.error}`}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={18} className="text-emerald-600" />
                  <div className="font-semibold text-black">Uploaded successfully</div>
                </div>
                <div className="text-sm text-gray-600">File: {result.entry?.original_name}</div>
              </div>
            )}
          </div>
        )}

        {/* My Uploads List */}
        <div className="mt-8 backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-lg font-bold text-black">My Uploads</h2>
            <button
              onClick={fetchMyPdfs}
              disabled={loadingPdfs}
              className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-black/10 rounded-full text-sm font-medium text-black hover:bg-white/80 disabled:opacity-50 transition-all"
            >
              <RefreshCw size={14} className={loadingPdfs ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          {loadingPdfs ? (
            <div className="text-center py-12">
              <RefreshCw size={32} className="animate-spin text-gray-400 mx-auto mb-3" />
              <div className="text-sm text-gray-500">Loading your uploads...</div>
            </div>
          ) : myPdfs.length === 0 ? (
            <div className="text-center py-12">
              <FileText size={40} className="text-gray-300 mx-auto mb-3" />
              <div className="text-sm text-gray-500">No uploads yet</div>
            </div>
          ) : (
            <div className="space-y-3">
              {myPdfs.map((p) => (
                <div
                  key={p.id}
                  className="backdrop-blur-md bg-white/50 border border-black/10 rounded-xl p-4 hover:bg-white/80 transition-all"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <FileText size={16} className="text-gray-400 flex-shrink-0" />
                        <div className="font-semibold text-black">{p.original_name}</div>
                        {getStatusBadge(p)}
                      </div>
                      <div className="text-xs text-gray-500 space-y-1">
                        <div>Uploaded: {new Date(p.uploaded_at).toLocaleString()}</div>
                        <div>Size: {(p.size_bytes / 1024).toFixed(2)} KB</div>
                      </div>
                      {p.feedback && (
                        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                          <p className="text-xs text-red-600">
                            <span className="font-semibold">Feedback:</span> {p.feedback}
                          </p>
                        </div>
                      )}
                    </div>
                    <div>
                      {/* blob-based preview button (keeps other logic same) */}
                      <button
                        onClick={() => viewPdf(p.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-xs font-medium hover:bg-gray-800 transition-all whitespace-nowrap"
                        disabled={!!actionLoading[p.id]}
                      >
                        <Download size={12} />
                        {actionLoading[p.id] ? "Opening..." : "Open"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
