import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://13.201.123.132:5000";

// Safe localStorage access function
const getLocalStorage = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.error('localStorage access error:', error);
    return null;
  }
};

const removeLocalStorage = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('localStorage remove error:', error);
  }
};

function pickTokenFromStorage() {
  // Use safe localStorage access
  const qcToken = getLocalStorage("auth_token_qc");
  if (qcToken) return qcToken;
  const generic = getLocalStorage("auth_token");
  if (generic) return generic;
  // fallback: any auth_token_* (take first)
  if (typeof window !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("auth_token_")) {
        const v = getLocalStorage(k);
        if (v) return v;
      }
    }
  }
  return null;
}

export default function QcDashboard() {
  const { user, authToken: ctxAuthToken, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [tokenToUse, setTokenToUse] = useState<string | null>(null);

  // Initialize token after component mounts (client-side only)
  useEffect(() => {
    const token = ctxAuthToken || pickTokenFromStorage();
    setTokenToUse(token);
  }, [ctxAuthToken]);

  useEffect(() => {
    if (tokenToUse === null) {
      // Still initializing, wait
      return;
    }

    if (!isAuthenticated && !tokenToUse) {
      navigate("/qc-login");
      return;
    }
    fetchTasks();
    // eslint-disable-next-line
  }, [isAuthenticated, tokenToUse]);

  async function fetchTasks() {
    if (!tokenToUse) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/qc/tasks`, { headers: { "X-Auth-Token": tokenToUse }});
      if (res.status === 401) { 
        removeLocalStorage("auth_token_qc");
        await logout(); 
        navigate("/qc-login"); 
        return; 
      }
      const data = await res.json().catch(()=>({}));
      if (res.ok) setTasks(data.items || []);
      else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Failed to fetch");
    } finally { setLoading(false); }
  }

  async function setStatus(pdfId: string, status: "Accepted"|"Rejected", feedback = "") {
    if (!tokenToUse) return;
    setActionLoading(s=>({...s, [pdfId]: true}));
    try {
      const res = await fetch(`${API_URL}/api/qc/${pdfId}/status`, {
        method: "POST",
        headers: {"Content-Type":"application/json", "X-Auth-Token": tokenToUse},
        body: JSON.stringify({ status, feedback })
      });
      const data = await res.json().catch(()=>({}));
      if (res.ok) {
        setMessage("✅ Status saved");
        fetchTasks();
      } else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Failed");
    } finally { setActionLoading(s=>({...s, [pdfId]: false})); }
  }

  const handleLogout = async () => {
    removeLocalStorage("auth_token_qc");
    await logout(); 
    navigate("/qc-login"); 
  };

  // ---------- PDF preview using blob ----------
  // Fetch the PDF as a blob, createObjectURL, open a new tab and render with an iframe.
  async function viewPdf(pdfId: string) {
    if (!tokenToUse) {
      setMessage("❌ No auth token available");
      return;
    }
    setActionLoading(s => ({ ...s, [pdfId]: true }));
    let blobUrl: string | null = null;

    try {
      // Start fetch
      const res = await fetch(`${API_URL}/api/global-pdfs/${pdfId}`, {
        method: "GET",
        headers: {
          "X-Auth-Token": tokenToUse,
          "Accept": "application/pdf"
        }
      });

      if (res.status === 401) {
        removeLocalStorage("auth_token_qc");
        await logout();
        navigate("/qc-login");
        return;
      }

      if (!res.ok) {
        const body = await res.text().catch(()=>"");
        setMessage(`❌ Failed to fetch PDF: ${res.status} ${body || res.statusText}`);
        return;
      }

      const blob = await res.blob();

      // Create object URL
      blobUrl = URL.createObjectURL(blob);

      // Open a new tab/window. Because this is triggered by a click it should not be blocked.
      const newWin = window.open("", "_blank");
      if (!newWin) {
        // Popup blocked — fallback to opening the blob URL directly
        window.location.assign(blobUrl);
      } else {
        // Minimal HTML that embeds the PDF in an iframe (full viewport).
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

      // Revoke the object URL after a reasonable delay to allow the viewer to load.
      // We keep it relatively long (2 minutes) to prevent accidentally revoking before render.
      setTimeout(() => {
        if (blobUrl) {
          try { URL.revokeObjectURL(blobUrl); } catch (e) {}
        }
      }, 1000 * 120);
    } catch (err) {
      console.error("viewPdf error:", err);
      setMessage("❌ Error loading PDF");
      if (blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
      }
    } finally {
      setActionLoading(s => ({ ...s, [pdfId]: false }));
    }
  }
  // -------------------------------------------

  // Show loading while token is being initialized
  if (tokenToUse === null && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-5xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-xl font-bold text-black">QC Dashboard</h1>
            <div className="text-xs text-gray-500 mt-1">{user?.username}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={()=>navigate("/home")} className="px-4 py-2 bg-black text-white text-sm rounded-full hover:bg-gray-800 transition-all">Home</button>
            <button onClick={handleLogout} className="px-4 py-2 bg-black text-white text-sm rounded-full hover:bg-gray-800 transition-all">Logout</button>
          </div>
        </header>

        {message && <div className="mb-6 p-3 backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl text-sm text-black">{message}</div>}

        <div>
          {loading ? <div className="text-sm text-gray-500">Loading...</div> : tasks.length === 0 ? <div className="text-sm text-gray-500">No tasks assigned</div> : (
            <div className="space-y-4">
              {tasks.map(t => (
                <div key={t.id} className="p-5 backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl hover:bg-black/10 transition-all">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-black mb-1">{t.original_name}</div>
                      <div className="text-xs text-gray-500">Uploaded by {t.uploaded_by} • {t.uploaded_at}</div>
                    </div>
                    <div className="flex flex-col items-end gap-3 ml-4">
                      <button
                        onClick={() => viewPdf(t.id)}
                        className="text-xs underline text-black hover:text-gray-600"
                        disabled={!!actionLoading[t.id]}
                      >
                        {actionLoading[t.id] ? "Opening..." : "View PDF"}
                      </button>
                      <div className="flex gap-2">
                        <button onClick={()=>setStatus(t.id, "Accepted")} disabled={actionLoading[t.id]} className="px-4 py-1.5 bg-emerald-500 text-white text-xs font-medium rounded-full hover:bg-emerald-600 disabled:opacity-50 transition-all">Accept</button>
                        <button onClick={()=>{
                          const reason = prompt("Reason for rejection (optional):", "");
                          if (reason !== null) setStatus(t.id, "Rejected", reason || "");
                        }} disabled={actionLoading[t.id]} className="px-4 py-1.5 bg-red-500 text-white text-xs font-medium rounded-full hover:bg-red-600 disabled:opacity-50 transition-all">Reject</button>
                      </div>
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
