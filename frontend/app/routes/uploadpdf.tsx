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
        headers: { "X-Auth-Token": authToken },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setMessage("❌ Unauthorized. Please login again.");
        setTimeout(() => { logout(); navigate("/login"); }, 1000);
        return;
      }
      if (res.ok) {
        if (data.duplicate) {
          setMessage("⚠️ Duplicate detected");
          setResult(data);
        } else {
          setMessage("✅ Uploaded successfully");
          setResult(data);
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
    if (!file) return setMessage("Select a PDF file first");
    upload();
  };

  async function fetchMyPdfs() {
    if (!authToken) return;
    setLoadingPdfs(true);
    try {
      const res = await fetch(`${API_URL}/api/my-pdfs`, { headers: { "X-Auth-Token": authToken } });
      if (res.status === 401) { logout(); navigate("/login"); return; }
      const data = await res.json().catch(()=>({}));
      if (res.ok) setMyPdfs(data.items || []);
      else setMessage(`❌ Could not fetch uploads: ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Could not fetch uploads (network error)");
    } finally { setLoadingPdfs(false); }
  }

  async function exportAccepted() {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/export-accepted`, { headers: { "X-Auth-Token": authToken } });
      if (!res.ok) {
        const data = await res.json().catch(()=>({}));
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

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-8">
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
            <button onClick={() => navigate("/home")} className="px-3 py-2 border rounded">Back</button>
            <button onClick={async ()=>{ await logout(); navigate("/login"); }} className="px-3 py-2 border rounded">Logout</button>
          </div>
        </header>

        {message && <div className="mb-4 p-3 bg-gray-800 rounded">{message}</div>}

        <form onSubmit={handleSubmit}>
          <div
            onDrop={onDrop}
            onDragOver={(e)=>{ e.preventDefault(); setDragOver(true); }}
            onDragLeave={()=>setDragOver(false)}
            onClick={()=>document.getElementById("pdfInput")?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer ${dragOver ? "border-white" : "border-gray-700"}`}
          >
            <input id="pdfInput" type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
            <div className="text-6xl mb-4">📄</div>
            <div className="text-lg font-medium">{file ? file.name : "Drop a PDF here or click to browse"}</div>
            <div className="text-sm text-gray-400 mt-2">Name & binary duplication checks performed</div>
          </div>

          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={!file || uploading} className="px-4 py-2 bg-white text-black rounded">
              {uploading ? "Uploading..." : "Upload PDF"}
            </button>
            <button type="button" onClick={()=>{ setFile(null); setMessage(null); setResult(null); }} className="px-4 py-2 border rounded">Clear</button>
            <button type="button" onClick={exportAccepted} className="px-4 py-2 border rounded">Export Accepted</button>
          </div>
        </form>

        {/* result area */}
        {result && (
          <div className="mt-6 p-4 bg-gray-900 rounded">
            {result.duplicate ? (
              <div>
                <div className="font-semibold">Duplicate detected</div>
                <div className="text-sm">Reason: {result.reason}</div>
                {result.existing && <div className="text-sm mt-2">Existing: {result.existing.original_name} (uploaded by {result.existing.uploaded_by})</div>}
              </div>
            ) : (
              <div>
                <div className="font-semibold">Uploaded</div>
                <div className="text-sm">File: {result.entry?.original_name}</div>
              </div>
            )}
          </div>
        )}

        {/* My uploads list */}
        <div className="mt-8 p-4 bg-gray-900 rounded">
          <div className="flex justify-between items-center mb-3">
            <div className="font-semibold">My uploads</div>
            <button onClick={fetchMyPdfs} className="px-2 py-1 border rounded">Refresh</button>
          </div>
          {loadingPdfs ? <div>Loading...</div> : myPdfs.length === 0 ? <div className="text-sm text-gray-400">No uploads yet</div> : (
            <div className="space-y-3">
              {myPdfs.map(p => (
                <div key={p.id} className="p-3 bg-black border rounded flex justify-between items-start">
                  <div>
                    <div className="font-medium">{p.original_name}</div>
                    <div className="text-xs text-gray-400">{p.uploaded_at}</div>
                    <div className="text-xs text-gray-400">Size: {p.size_bytes}</div>
                  </div>
                  <div className="text-right">
                    <div>Status: <span className="font-medium">{p.status || "Pending"}</span></div>
                    {p.feedback && <div className="text-xs text-gray-400 mt-1">Reason: {p.feedback}</div>}
                    <div className="mt-2">
                      <a href={`${API_URL}/api/global-pdfs/${p.id}?auth_token=${authToken}`} className="text-sm underline">Open / Download</a>
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
