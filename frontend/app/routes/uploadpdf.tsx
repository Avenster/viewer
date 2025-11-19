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
    // open in new tab with auth token via fetch -> blob then download
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
      // try to get suggested filename from response headers else fallback
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
    <div className="min-h-screen bg-white p-6">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-full text-white flex items-center justify-center font-semibold">
              {user?.name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <div className="font-medium">{user?.name}</div>
              <div className="text-xs text-gray-500">@{user?.username}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="text-sm text-gray-600" onClick={() => navigate("/home")}>Back</button>
            <button className="text-sm text-gray-600" onClick={async () => { await logout(); navigate("/login"); }}>Logout</button>
          </div>
        </header>

        <h1 className="text-2xl font-semibold mb-4">Upload PDF (global dedupe)</h1>

        {message && (
          <div className={`mb-4 p-3 rounded ${message.includes("❌") ? "bg-red-50 text-red-700" : message.includes("⚠️") ? "bg-yellow-50 text-yellow-700" : "bg-green-50 text-green-700"}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => document.getElementById("pdfInput")?.click()}
            className={`border-2 rounded-lg p-10 text-center cursor-pointer ${dragOver ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}
          >
            <input id="pdfInput" type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
            <div className="text-4xl mb-2">📄</div>
            <div className="font-medium">{file ? file.name : "Drop a PDF here or click to browse"}</div>
            <div className="text-sm text-gray-500 mt-2">Name and binary duplication checks will be performed</div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={!file || uploading}
              className="px-4 py-2 bg-black text-white rounded disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload PDF"}
            </button>
            <button
              type="button"
              onClick={() => { setFile(null); setMessage(null); setResult(null); }}
              className="px-4 py-2 border rounded"
            >
              Clear
            </button>
          </div>
        </form>

        {/* Result / Duplicate info */}
        {result && (
          <div className="mt-6 p-4 border rounded">
            {result.duplicate ? (
              <div>
                <div className="font-medium mb-2">Duplicate detected</div>
                <div className="text-sm mb-2">Reason: <span className="font-medium">{result.reason}</span></div>

                {result.reason === "name_similarity" && (
                  <div className="text-sm mb-2">Similarity: {(result.similarity || 0).toFixed(2)}</div>
                )}

                {result.existing && (
                  <div className="text-sm mb-2">
                    <div>Existing file: <span className="font-medium">{result.existing.original_name}</span></div>
                    <div>Uploaded by: <span className="font-medium">{result.existing.uploader_name || result.existing.uploaded_by}</span></div>
                    <div>Uploaded at: <span className="font-medium">{result.existing.uploaded_at}</span></div>
                    <div>Size: <span className="font-medium">{result.existing.size_bytes ?? "unknown"} bytes</span></div>
                  </div>
                )}

                {result.existing?.id && (
                  <div className="flex gap-2 mt-3">
                    <button className="px-3 py-2 bg-white border rounded" onClick={() => downloadExisting(result.existing.id)}>Download existing</button>
                    <button className="px-3 py-2 border rounded" onClick={() => { setMessage("You can choose to keep your file or skip."); }}>Keep mine</button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="font-medium mb-2">Upload successful</div>
                <div className="text-sm">Filename: <span className="font-medium">{result.entry?.original_name}</span></div>
                <div className="text-sm">Uploaded at: <span className="font-medium">{result.entry?.uploaded_at}</span></div>
                <div className="mt-3">
                  <button className="px-3 py-2 bg-black text-white rounded" onClick={() => {
                    // go directly to list view or viewer
                    navigate("/viewer");
                  }}>Start Reviewing</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 text-sm text-gray-600">
          <p>Notes:</p>
          <ul className="list-disc ml-5">
            <li>Name similarity threshold is controlled server-side (default 0.85).</li>
            <li>If duplicate is found, the backend does not store a second copy.</li>
            <li>Use "Download existing" to fetch the stored file.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
