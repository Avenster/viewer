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
  LogOut,
  AlertTriangle,
  Eye,
  X,
} from "lucide-react";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://13.201.123.132:5000";

export default function UploadPdf() {
  const { user, authToken, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const [language, setLanguage] = useState<string>(""); // selected language

  const [myPdfs, setMyPdfs] = useState<any[]>([]);
  const [loadingPdfs, setLoadingPdfs] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Preview state
  const [previewPdf, setPreviewPdf] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Delete confirmation modal state
  const [deleteConfirmPdf, setDeleteConfirmPdf] = useState<any>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    fetchMyPdfs();
  }, [isAuthenticated]);

  // Cleanup preview URL on unmount or when preview changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = Array.from(e.target.files);
      setFiles((prev) => mergeFileArrays(prev, selected));
      setMessage(null);
      setResult(null);
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
    for (const f of oldFiles) map.set(`${f.name}::${f.size}`, f);
    for (const f of newFiles) map.set(`${f.name}::${f.size}`, f);
    return Array.from(map.values());
  }

  const removeFileAtIndex = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadSingle = async (fileToUpload: File) => {
    if (!fileToUpload || !authToken) return { ok: false, error: "No auth token or file" };
    const form = new FormData();
    form.append("pdf_file", fileToUpload);
    form.append("language", language);

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

  const upload = async () => {
    if (files.length === 0) {
      setMessage("Select a PDF file first");
      return;
    }
    if (!authToken) {
      setMessage("❌ No auth token. Please login again.");
      return;
    }
    if (!language) {
      setMessage("⚠️ Please select a language before uploading.");
      return;
    }

    setUploading(true);
    setMessage(null);
    setResult(null);

    if (files.length === 1) {
      const f = files[0];
      const r = await uploadSingle(f);
      if ((r as any).status === 401) {
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
          setFiles([]);
        }
      } else {
        setMessage(`❌ Upload failed: ${r.error}`);
      }
      setUploading(false);
      return;
    }

    const results: Array<{ file: string; ok: boolean; data?: any; error?: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setMessage(`Uploading ${i + 1}/${files.length}: ${f.name}`);
      const res = await uploadSingle(f);
      if ((res as any).status === 401) {
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

    const successCount = results.filter((r) => r.ok).length;
    const failCount = results.length - successCount;
    setMessage(`✅ ${successCount} uploaded, ❌ ${failCount} failed`);
    setResult({ multi: true, results });
    await fetchMyPdfs();
    setFiles((prev) =>
      prev.filter((f) => {
        const resItem = results.find((r) => r.file === f.name);
        return resItem ? !resItem.ok : true;
      })
    );
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
        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 text-xs font-medium rounded-full flex items-center gap-1.5 whitespace-nowrap">
          <CheckCircle size={12} /> Accepted
        </span>
      );
    if (item.status === "Rejected")
      return (
        <span className="px-2.5 py-1 bg-red-500/10 text-red-600 text-xs font-medium rounded-full flex items-center gap-1.5 whitespace-nowrap">
          <XCircle size={12} /> Rejected
        </span>
      );
    if (item.assigned_to)
      return (
        <span className="px-2.5 py-1 bg-blue-500/10 text-blue-600 text-xs font-medium rounded-full flex items-center gap-1.5 whitespace-nowrap">
          <Clock size={12} /> In Review
        </span>
      );
    return (
      <span className="px-2.5 py-1 bg-gray-500/10 text-gray-600 text-xs font-medium rounded-full flex items-center gap-1.5 whitespace-nowrap">
        <AlertCircle size={12} /> Pending
      </span>
    );
  };

  // Preview PDF function
  async function showPreview(pdf: any) {
    if (!authToken) {
      setMessage("❌ No auth token available");
      return;
    }

    // Clean up previous preview URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    setPreviewPdf(pdf);
    setLoadingPreview(true);

    try {
      const res = await fetch(`${API_URL}/api/global-pdfs/${pdf.id}`, {
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
        closePreview();
        return;
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPreviewUrl(blobUrl);
    } catch (err) {
      console.error("showPreview error:", err);
      setMessage("❌ Error loading PDF preview");
      closePreview();
    } finally {
      setLoadingPreview(false);
    }
  }

  function closePreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setPreviewPdf(null);
    setLoadingPreview(false);
  }

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
      blobUrl = URL.createObjectURL(blob);
      const newWin = window.open("", "_blank");
      if (!newWin) {
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

  // NEW: Delete uploaded PDF
  async function deletePdf(pdfId: string) {
    if (!authToken) {
      setMessage("❌ No auth token available");
      return;
    }

    const key = `delete-${pdfId}`;
    setActionLoading((s) => ({ ...s, [key]: true }));

    try {
      const res = await fetch(`${API_URL}/api/my-pdfs/${pdfId}`, {
        method: "DELETE",
        headers: { "X-Auth-Token": authToken },
      });

      if (res.status === 401) {
        setMessage("❌ Unauthorized. Please login again.");
        logout();
        navigate("/login");
        return;
      }

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        setMessage(`❌ Delete failed: ${data.error || res.statusText}`);
        return;
      }

      setMessage("✅ PDF deleted successfully");
      setMyPdfs((prev) => prev.filter((p) => p.id !== pdfId));

      // If currently previewing this PDF, close preview
      if (previewPdf && previewPdf.id === pdfId) {
        closePreview();
      }
    } catch (err) {
      console.error("deletePdf error:", err);
      setMessage("❌ Delete failed (network error)");
    } finally {
      setActionLoading((s) => {
        const copy = { ...s };
        delete copy[key];
        return copy;
      });
      setDeleteConfirmPdf(null);
    }
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="backdrop-blur-md bg-black/5 border-b border-black/10 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-8 py-5">
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
              {/* Back button removed */}
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

      <div className="max-w-7xl mx-auto p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Upload Form & List */}
          <div className="lg:col-span-2 space-y-6">
            {/* Message */}
            {message && (
              <div
                className={`p-4 rounded-2xl backdrop-blur-md text-sm font-medium ${
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
              {/* Language selector */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="text-sm font-semibold text-black">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="px-4 mx-4 py-2 border border-black/20 text-black rounded-full text-sm bg-white/70 focus:outline-none  focus:ring-black/40"
                >
                  <option value="">Select language</option>
                  <option value="Japanese">Japanese</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Russian">Russian</option>
                  <option value="Polish">Polish</option>
                  <option value="Arabic">Arabic</option>
                  <option value="German">German</option>
                </select>
              </div>

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

                {files.length > 0 && (
                  <div className="mt-4 max-h-40 overflow-auto">
                    {files.map((f, idx) => (
                      <div
                        key={`${f.name}-${f.size}-${idx}`}
                        className="flex items-center justify-between text-xs text-gray-700 bg-white/50 p-2 rounded-md mb-2"
                      >
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
              <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-5">
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
                    {result.entry?.language && (
                      <div className="text-sm text-gray-500 mt-1">
                        Language: {result.entry.language}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* My Uploads List */}
            <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-6">
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
                      <div className="flex flex-col gap-3">
                        {/* Top row: Icon, truncated name, and status badge */}
                        <div className="flex items-start gap-3">
                          <FileText size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div
                              className="font-semibold text-black text-sm truncate"
                              title={p.original_name}
                            >
                              {p.original_name}
                            </div>
                          </div>
                          <div className="flex-shrink-0">
                            {getStatusBadge(p)}
                          </div>
                        </div>

                        {/* File info */}
                        <div className="text-xs text-gray-500 space-y-1 pl-7">
                          <div>Uploaded: {new Date(p.uploaded_at).toLocaleString()}</div>
                          <div>Size: {(p.size_bytes / 1024).toFixed(2)} KB</div>
                          {p.language && (
                            <div>Language: {p.language}</div>
                          )}
                        </div>

                        {/* Feedback section */}
                        {p.feedback && (
                          <div className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                            <p className="text-xs text-red-600">
                              <span className="font-semibold">Feedback:</span> {p.feedback}
                            </p>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 pl-7 flex-wrap">
                          <button
                            onClick={() => showPreview(p)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg.white bg-white border border-black/10 rounded-full text-xs font-medium hover:bg-gray-50 transition-all whitespace-nowrap text-black"
                          >
                            <Eye size={12} />
                            Preview
                          </button>
                          <button
                            onClick={() => viewPdf(p.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white rounded-full text-xs font-medium hover:bg-gray-800 transition-all whitespace-nowrap"
                            disabled={!!actionLoading[p.id]}
                          >
                            <Download size={12} />
                            {actionLoading[p.id] ? "Opening..." : "Open"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmPdf(p)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-600 rounded-full text-xs font-medium hover:bg-red-500/20 transition-all whitespace-nowrap"
                            disabled={!!actionLoading[`delete-${p.id}`]}
                          >
                            <XCircle size={12} />
                            {actionLoading[`delete-${p.id}`] ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Preview Window */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-6 h-[calc(100vh-8rem)]">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-black">Preview</h2>
                {previewPdf && (
                  <button
                    onClick={closePreview}
                    className="p-2 hover:bg-black/5 rounded-full transition-all"
                  >
                    <X size={18} className="text-gray-600" />
                  </button>
                )}
              </div>

              {!previewPdf ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <Eye size={48} className="text-gray-300 mb-4" />
                  <div className="text-sm text-gray-500">
                    Click "Preview" on any PDF to view it here
                  </div>
                </div>
              ) : loadingPreview ? (
                <div className="h-full flex flex-col items-center justify-center">
                  <RefreshCw size={32} className="animate-spin text-gray-400 mb-3" />
                  <div className="text-sm text-gray-500">Loading preview...</div>
                </div>
              ) : previewUrl ? (
                <div className="h-full flex flex-col">
                  <div className="mb-3 p-3 bg-white/50 rounded-xl">
                    <div className="text-sm font-semibold text-black truncate" title={previewPdf.original_name}>
                      {previewPdf.original_name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {(previewPdf.size_bytes / 1024).toFixed(2)} KB
                    </div>
                    {previewPdf.language && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Language: {previewPdf.language}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 bg-white rounded-xl overflow-hidden border border-black/10">
                    <iframe
                      src={previewUrl}
                      className="w-full h-full"
                      title="PDF Preview"
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <AlertCircle size={48} className="text-red-400 mb-4" />
                  <div className="text-sm text-red-600">
                    Failed to load preview
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmPdf && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-black/10">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={24} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-black mb-1">Delete PDF</h3>
                <p className="text-sm text-gray-600">
                  Are you sure you want to delete this file? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="mb-6 p-3 bg-black/5 rounded-xl">
              <div className="text-sm font-semibold text-black truncate" title={deleteConfirmPdf.original_name}>
                {deleteConfirmPdf.original_name}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {(deleteConfirmPdf.size_bytes / 1024).toFixed(2)} KB
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmPdf(null)}
                className="flex-1 px-4 py-2.5 bg-white border border-black/10 rounded-full text-sm font-semibold text-black hover:bg-gray-50 transition-all"
                disabled={!!actionLoading[`delete-${deleteConfirmPdf.id}`]}
              >
                Cancel
              </button>
              <button
                onClick={() => deletePdf(deleteConfirmPdf.id)}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-full text-sm font-semibold hover:bg-red-700 transition-all disabled:bg-red-300 disabled:cursor-not-allowed"
                disabled={!!actionLoading[`delete-${deleteConfirmPdf.id}`]}
              >
                {actionLoading[`delete-${deleteConfirmPdf.id}`] ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}