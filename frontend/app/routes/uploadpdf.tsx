// src/pages/UploadPdf.tsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:5000";

export default function UploadPdf() {
  const { user, authToken, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const [myPdfs, setMyPdfs] = useState<any[]>([]);
  const [loadingPdfs, setLoadingPdfs] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    fetchMyPdfs();
    // eslint-disable-next-line
  }, [isAuthenticated]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setMessage(null);
      setResult(null);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setMessage(null);
      setResult(null);
    }
  };

  const upload = async () => {
    if (!file || !authToken) return;
    setUploading(true);
    setMessage(null);
    setResult(null);

    const form = new FormData();
    form.append("pdf_file", file);

    try {
      const res = await fetch(`${API_URL}/api/upload-pdf`, {
        method: "POST",
        headers: {
          "X-Auth-Token": authToken,
        },
        body: form,
      });

      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setMessage("❌ Unauthorized. Please login again.");
        setTimeout(() => {
          logout();
          navigate("/login");
        }, 1200);
        return;
      }

      if (res.ok) {
        if (data.duplicate) {
          setMessage("⚠️ Duplicate detected");
          setResult(data);
        } else {
          setMessage("✅ Uploaded successfully");
          setResult(data);
          // refresh my list
          fetchMyPdfs();
        }
      } else {
        setMessage(`❌ Upload failed: ${data.error || res.statusText}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Upload failed (network error)");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setMessage("Select a PDF file first");
      return;
    }
    upload();
  };

  const downloadExisting = async (id: string) => {
    if (!authToken) return;
    const url = `${API_URL}/api/global-pdfs/${id}`;
    try {
      const res = await fetch(url, {
        headers: {
          "X-Auth-Token": authToken,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(`❌ Failed to download: ${data.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cd = res.headers.get("content-disposition");
      let filename = "download.pdf";
      if (cd) {
        const match = cd.match(/filename="?(.+)"?/);
        if (match && match[1]) filename = match[1];
      } else if (result?.existing?.original_name) {
        filename = result.existing.original_name;
      }
      a.href = blobUrl;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      setMessage("❌ Download failed (network error)");
    }
  };

  async function fetchMyPdfs() {
    if (!authToken) return;
    setLoadingPdfs(true);
    try {
      const res = await fetch(`${API_URL}/api/my-pdfs`, {
        headers: { "X-Auth-Token": authToken },
      });
      if (res.status === 401) {
        setMessage("❌ Unauthorized. Please login again.");
        setTimeout(() => {
          logout();
          navigate("/login");
        }, 1200);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMyPdfs(data.items || []);
      } else {
        setMessage(`❌ Could not fetch uploads: ${data.error || res.statusText}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Could not fetch uploads (network error)");
    } finally {
      setLoadingPdfs(false);
    }
  }

  async function markStatus(pdfId: string, status: "Accepted" | "Rejected", feedback = "") {
    if (!authToken) return;
    setStatusUpdating(prev => ({ ...prev, [pdfId]: true }));
    try {
      const res = await fetch(`${API_URL}/api/global-pdfs/${pdfId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authToken,
        },
        body: JSON.stringify({ status, feedback }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setMessage("❌ Unauthorized. Please login again.");
        setTimeout(() => {
          logout();
          navigate("/login");
        }, 1200);
        return;
      }
      if (res.ok) {
        setMessage("✅ Status updated");
        // refresh list
        fetchMyPdfs();
      } else {
        setMessage(`❌ Failed to update: ${data.error || res.statusText}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Failed to update status (network error)");
    } finally {
      setStatusUpdating(prev => ({ ...prev, [pdfId]: false }));
    }
  }

  async function exportAccepted() {
    if (!authToken) return;
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/export-accepted`, {
        headers: { "X-Auth-Token": authToken },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(`❌ Export failed: ${data.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      let filename = `accepted_pdfs_${user?.username || "export"}.zip`;
      const cd = res.headers.get("content-disposition");
      if (cd) {
        const m = cd.match(/filename="?(.+)"?/);
        if (m && m[1]) filename = m[1];
      }
      a.href = blobUrl;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      setMessage("❌ Export failed (network error)");
    }
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-10 pb-6 border-b border-gray-800">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-full text-black flex items-center justify-center font-bold text-lg">
              {user?.name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-lg">{user?.name}</div>
              <div className="text-sm text-gray-400">@{user?.username}</div>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              className="px-4 py-2 text-sm text-gray-300 hover:text-white border border-gray-700 rounded-lg hover:border-gray-500 transition-all"
              onClick={() => navigate("/home")}
            >
              Back
            </button>
            <button
              className="px-4 py-2 text-sm text-gray-300 hover:text-white border border-gray-700 rounded-lg hover:border-gray-500 transition-all"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Logout
            </button>
          </div>
        </header>

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Upload PDF</h1>
            <p className="text-gray-400">Global deduplication enabled</p>
          </div>

          {/* Message Alert */}
          {message && (
            <div className={`p-4 rounded-lg border ${
              message.includes("❌")
                ? "bg-red-950 border-red-800 text-red-200"
                : message.includes("⚠️")
                ? "bg-yellow-950 border-yellow-800 text-yellow-200"
                : "bg-green-950 border-green-800 text-green-200"
            }`}>
              {message}
            </div>
          )}

          {/* Upload Area */}
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit(e); }}>
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => document.getElementById("pdfInput")?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                dragOver
                  ? "border-white bg-gray-900"
                  : file
                  ? "border-gray-600 bg-gray-900"
                  : "border-gray-700 hover:border-gray-500 bg-gray-950"
              }`}
            >
              <input
                id="pdfInput"
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={onFileChange}
              />
              <div className="text-6xl mb-4">📄</div>
              <div className="text-lg font-medium mb-2">
                {file ? file.name : "Drop a PDF here or click to browse"}
              </div>
              <div className="text-sm text-gray-500">
                Name and binary duplication checks will be performed
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="submit"
                disabled={!file || uploading}
                className="px-6 py-3 bg-white text-black rounded-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-200 transition-all"
              >
                {uploading ? "Uploading..." : "Upload PDF"}
              </button>
              <button
                type="button"
                onClick={() => { setFile(null); setMessage(null); setResult(null); }}
                className="px-6 py-3 border border-gray-700 rounded-lg hover:border-gray-500 transition-all"
              >
                Clear
              </button>
            </div>
          </form>

          {/* Result Display */}
          {result && (
            <div className="mt-8 p-6 bg-gray-900 border border-gray-800 rounded-xl">
              {result.duplicate ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="text-2xl">⚠️</div>
                    <div className="text-xl font-bold">Duplicate Detected</div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex gap-2">
                      <span className="text-gray-400">Reason:</span>
                      <span className="font-medium">{result.reason}</span>
                    </div>

                    {result.reason === "name_similarity" && (
                      <div className="flex gap-2">
                        <span className="text-gray-400">Similarity:</span>
                        <span className="font-medium">{(result.similarity || 0).toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  {result.existing && (
                    <div className="p-4 bg-black border border-gray-800 rounded-lg space-y-2 text-sm">
                      <div className="flex gap-2">
                        <span className="text-gray-400">File:</span>
                        <span className="font-medium">{result.existing.original_name}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-gray-400">Uploaded by:</span>
                        <span className="font-medium">{result.existing.uploader_name || result.existing.uploaded_by}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-gray-400">Date:</span>
                        <span className="font-medium">{result.existing.uploaded_at}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-gray-400">Size:</span>
                        <span className="font-medium">{result.existing.size_bytes ?? "unknown"} bytes</span>
                      </div>
                    </div>
                  )}

                  {result.existing?.id && (
                    <div className="flex gap-3 pt-2">
                      <button
                        className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition-all"
                        onClick={() => downloadExisting(result.existing.id)}
                      >
                        Download Existing
                      </button>
                      <button
                        className="px-4 py-2 border border-gray-700 rounded-lg hover:border-gray-500 transition-all"
                        onClick={() => { setMessage("You can choose to keep your file or skip."); }}
                      >
                        Keep Mine
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="text-2xl">✅</div>
                    <div className="text-xl font-bold">Upload Successful</div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex gap-2">
                      <span className="text-gray-400">Filename:</span>
                      <span className="font-medium">{result.entry?.original_name}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-400">Uploaded:</span>
                      <span className="font-medium">{result.entry?.uploaded_at}</span>
                    </div>
                  </div>

                  <button
                    className="px-6 py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition-all"
                    onClick={() => fetchMyPdfs()}
                  >
                    Refresh My Uploads
                  </button>
                </div>
              )}
            </div>
          )}

          {/* My uploads list with accept/reject and export */}
          <div className="mt-8 p-6 bg-gray-900 border border-gray-800 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold">My Uploads</div>
              <div className="flex gap-2">
                <button className="px-3 py-2 bg-white text-black rounded" onClick={fetchMyPdfs} disabled={loadingPdfs}>
                  Refresh
                </button>
                <button className="px-3 py-2 border rounded" onClick={exportAccepted}>
                  Export Accepted
                </button>
              </div>
            </div>

            {loadingPdfs ? (
              <div className="text-sm text-gray-400">Loading...</div>
            ) : myPdfs.length === 0 ? (
              <div className="text-sm text-gray-400">No uploads yet</div>
            ) : (
              <div className="space-y-4">
                {myPdfs.map((p) => (
                  <div key={p.id} className="p-4 bg-black border border-gray-800 rounded-lg">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium">{p.original_name}</div>
                        <div className="text-xs text-gray-400">{p.uploaded_at}</div>
                        <div className="text-xs text-gray-400">Size: {p.size_bytes} bytes</div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm mb-2">
                          Status: <span className="font-medium">{p.status || "Pending"}</span>
                        </div>
                        {p.status === "Rejected" && (
                          <div className="text-xs text-gray-400 mb-2">Reason: {p.feedback}</div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex gap-2 items-center">
                      <button
                        className={`px-3 py-2 rounded ${p.status === "Accepted" ? "bg-white text-black" : "border"}`}
                        disabled={statusUpdating[p.id]}
                        onClick={() => markStatus(p.id, "Accepted")}
                      >
                        Accept
                      </button>

                      <RejectControl
                        pdf={p}
                        onReject={(reason) => markStatus(p.id, "Rejected", reason)}
                        disabled={!!statusUpdating[p.id]}
                      />

                      <button
                        className="px-3 py-2 border rounded"
                        onClick={() => {
                          // download single PDF
                          const url = `${API_URL}/api/global-pdfs/${p.id}`;
                          window.open(url + `?auth_token=${authToken}`, "_blank");
                        }}
                      >
                        Open / Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 text-sm text-gray-400">
            <p>Notes:</p>
            <ul className="list-disc ml-5 space-y-1">
              <li>Name similarity threshold is controlled server-side (default 0.85).</li>
              <li>If duplicate is found, the backend does not store a second copy.</li>
              <li>You can mark each uploaded PDF Accepted or Rejected with a reason. Use Export to download all your accepted PDFs at once.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * RejectControl component:
 * small inline UI for entering rejection reason and submitting.
 */
function RejectControl({ pdf, onReject, disabled }: { pdf: any; onReject: (reason: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(pdf.feedback || "");

  return (
    <div className="relative">
      <button
        className={`px-3 py-2 rounded ${pdf.status === "Rejected" ? "bg-white text-black" : "border"}`}
        onClick={() => setOpen((s) => !s)}
        disabled={disabled}
      >
        Reject
      </button>

      {open && (
        <div className="absolute z-10 right-0 mt-2 w-72 bg-gray-900 border border-gray-800 rounded p-3">
          <textarea
            className="w-full h-20 p-2 bg-black border border-gray-700 rounded text-sm"
            placeholder="Reason for rejection..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-2 flex gap-2 justify-end">
            <button
              className="px-3 py-1 bg-white text-black rounded"
              onClick={() => {
                onReject(reason || "");
                setOpen(false);
              }}
            >
              Save
            </button>
            <button
              className="px-3 py-1 border rounded"
              onClick={() => {
                setOpen(false);
                setReason(pdf.feedback || "");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
