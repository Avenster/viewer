import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:5000";

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

  // Show loading while token is being initialized
  if (tokenToUse === null && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold">QC Dashboard</h1>
            <div className="text-sm text-gray-400">{user?.username}</div>
          </div>
          <div className="flex gap-3">
            <button onClick={()=>navigate("/home")} className="px-3 py-2 border rounded">Home</button>
            <button onClick={handleLogout} className="px-3 py-2 border rounded">Logout</button>
          </div>
        </header>

        {message && <div className="mb-4 p-2 bg-gray-800 rounded">{message}</div>}

        <div>
          {loading ? <div>Loading...</div> : tasks.length === 0 ? <div>No tasks assigned</div> : (
            <div className="space-y-4">
              {tasks.map(t => (
                <div key={t.id} className="p-4 bg-gray-900 rounded border flex justify-between">
                  <div>
                    <div className="font-medium">{t.original_name}</div>
                    <div className="text-xs text-gray-400">Uploaded by {t.uploaded_by} at {t.uploaded_at}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <a className="text-sm underline" href={`${API_URL}/api/global-pdfs/${t.id}?auth_token=${tokenToUse}`} target="_blank" rel="noreferrer">Open</a>
                    <div className="flex gap-2">
                      <button onClick={()=>setStatus(t.id, "Accepted")} disabled={actionLoading[t.id]} className="px-3 py-1 bg-white text-black rounded">Accept</button>
                      <button onClick={()=>{
                        const reason = prompt("Reason for rejection (optional):", "");
                        if (reason !== null) setStatus(t.id, "Rejected", reason || "");
                      }} disabled={actionLoading[t.id]} className="px-3 py-1 border rounded">Reject</button>
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