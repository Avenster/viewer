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
  const adminToken = getLocalStorage("auth_token_admin");
  if (adminToken) return adminToken;
  const generic = getLocalStorage("auth_token");
  if (generic) return generic;
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

export default function AdminDashboard() {
  const { user, authToken: ctxAuthToken, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const [allPdfs, setAllPdfs] = useState<any[]>([]);
  const [qcs, setQcs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [tokenToUse, setTokenToUse] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  useEffect(() => {
    const token = ctxAuthToken || pickTokenFromStorage();
    setTokenToUse(token);
  }, [ctxAuthToken]);

  useEffect(() => {
    if (tokenToUse === null) return; // still initializing
    if (!isAuthenticated && !tokenToUse) {
      navigate("/admin-login");
      return;
    }
    fetchAll();
    fetchUsers();
    // eslint-disable-next-line
  }, [isAuthenticated, tokenToUse]);

  async function fetchAll() {
    if (!tokenToUse) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/global-pdfs`, {
        headers: { "X-Auth-Token": tokenToUse },
      });
      if (res.status === 401) {
        removeLocalStorage("auth_token_admin");
        removeLocalStorage("auth_token");
        try { await logout(); } catch {}
        navigate("/admin-login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) setAllPdfs(data.items || []);
      else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Failed to fetch");
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsers() {
    if (!tokenToUse) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/users`, { headers: { "X-Auth-Token": tokenToUse }});
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers(data.users || []);
        const qclist = (data.users || []).filter((u:any) => u.role === "qc");
        setQcs(qclist);
      } else {
        setMessage(`❌ ${data.error || res.statusText}`);
      }
    } catch (e) {
      setMessage("❌ Failed to fetch users");
    }
  }

  async function assign(pdfId: string, qcUsername: string) {
    if (!tokenToUse) return;
    setActionLoading(s => ({...s, [pdfId]: true}));
    try {
      const res = await fetch(`${API_URL}/api/admin/assign`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "X-Auth-Token": tokenToUse },
        body: JSON.stringify({ pdf_id: pdfId, qc_username: qcUsername })
      });
      const data = await res.json().catch(()=>({}));
      if (res.ok) {
        setMessage("✅ Assigned");
        fetchAll();
      } else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Assign failed");
    } finally { setActionLoading(s => ({...s, [pdfId]: false})); }
  }

  async function adminSetStatus(pdfId: string, status: "Accepted"|"Rejected", feedback = "") {
    if (!tokenToUse) return;
    setActionLoading(s => ({...s, [pdfId]: true}));
    try {
      const res = await fetch(`${API_URL}/api/admin/global-pdfs/${pdfId}/status`, {
        method: "POST",
        headers: {"Content-Type":"application/json", "X-Auth-Token": tokenToUse},
        body: JSON.stringify({ status, feedback })
      });
      const data = await res.json().catch(()=>({}));
      if (res.ok) {
        setMessage("✅ Status updated");
        fetchAll();
      } else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Update failed");
    } finally { setActionLoading(s => ({...s, [pdfId]: false})); }
  }

  const buildOpenHref = (id: string) => {
    if (!tokenToUse) return `${API_URL}/api/global-pdfs/${id}`;
    return `${API_URL}/api/global-pdfs/${id}?auth_token=${encodeURIComponent(tokenToUse)}`;
  };

  const handleLogout = async () => {
    removeLocalStorage("auth_token_admin");
    removeLocalStorage("auth_current_role");
    await logout();
    navigate("/admin-login");
  };

  const pdfsForSelectedUser = selectedUser ? allPdfs.filter(p => p.uploaded_by === selectedUser) : [];

  if (tokenToUse === null && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto grid grid-cols-4 gap-6">
        <div className="col-span-1">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Users</h2>
            <div className="text-xs text-gray-400">Total: {users.length}</div>
          </div>

          <div className="bg-gray-900 rounded p-2 max-h-[70vh] overflow-auto">
            <button onClick={()=>{ setSelectedUser(null); }} className={`w-full text-left px-2 py-1 rounded ${selectedUser===null? 'bg-gray-700':''}`}>All PDFs</button>
            {users.map(u => (
              <button key={u.user_id} onClick={()=>setSelectedUser(u.username)} className={`w-full text-left px-2 py-2 mt-1 rounded ${selectedUser===u.username? 'bg-gray-700':''}`}>
                <div className="font-medium">{u.username}</div>
                <div className="text-xs text-gray-400">{u.name} • {u.role}</div>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <button onClick={handleLogout} className="px-3 py-2 border rounded">Logout</button>
          </div>
        </div>

        <div className="col-span-3">
          <header className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              <div className="text-sm text-gray-400">Logged in as: {user?.username}</div>
            </div>
            <div className="text-sm text-gray-400">Showing: {selectedUser ? `${selectedUser}'s PDFs` : 'All PDFs'}</div>
          </header>

          {message && <div className="mb-4 p-3 bg-gray-800 rounded">{message}</div>}

          <section className="mb-6">
            <div className="font-semibold mb-2">Assign to QC</div>
            <div className="text-sm text-gray-400 mb-2">Select a PDF and assign it to a QC user</div>
          </section>

          <section>
            {loading ? <div>Loading...</div> : (
              <div className="space-y-4">
                {(selectedUser ? pdfsForSelectedUser : allPdfs).map(item => (
                  <div key={item.id} className="p-4 bg-gray-900 rounded border flex justify-between gap-4">
                    <div>
                      <div className="font-medium">{item.original_name}</div>
                      <div className="text-xs text-gray-400">Uploaded by: {item.uploaded_by} at {item.uploaded_at}</div>
                      <div className="text-xs text-gray-400 mt-1">Assigned to: {item.assigned_to || "—"}</div>
                      {item.feedback && <div className="text-xs text-red-400 mt-1">Feedback: {item.feedback}</div>}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <a className="text-sm underline" href={buildOpenHref(item.id)} target="_blank" rel="noreferrer">Open</a>

                      <div className="flex gap-2 items-center">
                        <select defaultValue={item.assigned_to || ""} onChange={(e)=> assign(item.id, e.target.value)} className="bg-black border px-2 py-1 rounded">
                          <option value="">-- assign to QC --</option>
                          {qcs.map(q => <option key={q.user_id} value={q.username}>{q.username}</option>)}
                        </select>
                      </div>

                      <div className="flex gap-2">
                        <button onClick={()=>adminSetStatus(item.id, "Accepted")} disabled={actionLoading[item.id]} className="px-3 py-1 bg-white text-black rounded">Accept</button>
                        <button onClick={()=> {
                          const reason = prompt("Reason for rejection (optional):", "");
                          if (reason !== null) adminSetStatus(item.id, "Rejected", reason || "");
                        }} disabled={actionLoading[item.id]} className="px-3 py-1 border rounded">Reject</button>
                      </div>
                    </div>
                  </div>
                ))}

                { (selectedUser ? pdfsForSelectedUser : allPdfs).length === 0 && (
                  <div className="text-gray-400 p-4">No PDFs to show.</div>
                ) }
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
