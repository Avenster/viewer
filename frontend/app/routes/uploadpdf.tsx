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

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
    }
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
              onClick={async () => { await logout(); navigate("/login"); }}
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
          <div>
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
                onClick={handleSubmit}
                disabled={!file || uploading}
                className="px-6 py-3 bg-white text-black rounded-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-200 transition-all"
              >
                {uploading ? "Uploading..." : "Upload PDF"}
              </button>
              <button
                onClick={() => { setFile(null); setMessage(null); setResult(null); }}
                className="px-6 py-3 border border-gray-700 rounded-lg hover:border-gray-500 transition-all"
              >
                Clear
              </button>
            </div>
          </div>

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
                    onClick={() => navigate("/viewer")}
                  >
                    Start Reviewing
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Notes Section */}
          <div className="mt-10 p-6 bg-gray-900 border border-gray-800 rounded-xl">
            <div className="font-semibold mb-3 text-gray-300">Notes</div>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex gap-2">
                <span>•</span>
                <span>Name similarity threshold is controlled server-side (default 0.85)</span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>If duplicate is found, the backend does not store a second copy</span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>Use "Download existing" to fetch the stored file</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}