import React, { useEffect, useState } from "react";
import { Search, Download, Filter, Users, FileText, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";

const API_URL = "http://13.201.123.132:5000";

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
  const [allPdfs, setAllPdfs] = useState<any[]>([]);
  const [qcs, setQcs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [tokenToUse, setTokenToUse] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [userSearchQuery, setUserSearchQuery] = useState("");

  useEffect(() => {
    const token = pickTokenFromStorage();
    setTokenToUse(token);
  }, []);

  useEffect(() => {
    if (tokenToUse === null) return;
    if (!tokenToUse) return;
    fetchAll();
    fetchUsers();
  }, [tokenToUse]);

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
        setMessage("✅ Successfully assigned to QC");
        fetchAll();
        setTimeout(() => setMessage(null), 3000);
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
        setMessage(`✅ Status updated to ${status}`);
        fetchAll();
        setTimeout(() => setMessage(null), 3000);
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
    window.location.href = "/admin-login";
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
    u.name?.toLowerCase().includes(userSearchQuery.toLowerCase())
  );

  const pdfsToShow = selectedUser ? allPdfs.filter(p => p.uploaded_by === selectedUser) : allPdfs;
  
  const filteredPdfs = pdfsToShow.filter(pdf => {
    const matchesSearch = pdf.original_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          pdf.uploaded_by.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || 
                          (statusFilter === "pending" && !pdf.assigned_to) ||
                          (statusFilter === "assigned" && pdf.assigned_to && !pdf.status) ||
                          (statusFilter === "accepted" && pdf.status === "Accepted") ||
                          (statusFilter === "rejected" && pdf.status === "Rejected");
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: allPdfs.length,
    pending: allPdfs.filter(p => !p.assigned_to).length,
    assigned: allPdfs.filter(p => p.assigned_to && !p.status).length,
    accepted: allPdfs.filter(p => p.status === "Accepted").length,
    rejected: allPdfs.filter(p => p.status === "Rejected").length,
  };

  const getStatusBadge = (item: any) => {
    if (item.status === "Accepted") return <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 text-xs font-medium rounded-full flex items-center gap-1.5"><CheckCircle size={12} /> Accepted</span>;
    if (item.status === "Rejected") return <span className="px-2.5 py-1 bg-red-500/10 text-red-600 text-xs font-medium rounded-full flex items-center gap-1.5"><XCircle size={12} /> Rejected</span>;
    if (item.assigned_to) return <span className="px-2.5 py-1 bg-blue-500/10 text-blue-600 text-xs font-medium rounded-full flex items-center gap-1.5"><Clock size={12} /> In Review</span>;
    return <span className="px-2.5 py-1 bg-gray-500/10 text-gray-600 text-xs font-medium rounded-full flex items-center gap-1.5"><AlertCircle size={12} /> Pending</span>;
  };

  // ---------- NEW: viewPdf using blob fetch ----------
  // This only implements the preview behavior — everything else is unchanged.
  async function viewPdf(pdfId: string) {
    if (!tokenToUse) {
      setMessage("❌ No auth token available");
      return;
    }
    setActionLoading(s => ({ ...s, [pdfId]: true }));
    let blobUrl: string | null = null;

    try {
      const res = await fetch(`${API_URL}/api/global-pdfs/${pdfId}`, {
        method: "GET",
        headers: { "X-Auth-Token": tokenToUse, "Accept": "application/pdf" },
      });

      if (res.status === 401) {
        removeLocalStorage("auth_token_admin");
        removeLocalStorage("auth_token");
        setMessage("❌ Unauthorized");
        return;
      }

      if (!res.ok) {
        const body = await res.text().catch(()=>"");
        setMessage(`❌ Failed to fetch PDF: ${res.status} ${body || res.statusText}`);
        return;
      }

      const blob = await res.blob();
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

      // keep URL alive for a bit (2 minutes) then revoke
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

  if (tokenToUse === null) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="backdrop-blur-md bg-black/5 border-b border-black/10 sticky top-0 z-10">
        <div className="px-8 py-5">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-xl font-bold text-black">Admin Dashboard</h1>
              <p className="text-xs text-gray-500 mt-1">Manage documents and user assignments</p>
            </div>
            <button 
              onClick={handleLogout}
              className="px-5 py-2 bg-black text-white text-xs font-medium rounded-full hover:bg-gray-800 transition-all"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-80 backdrop-blur-md bg-black/5 border-r border-black/10 h-[calc(100vh-85px)] sticky top-[85px] overflow-hidden flex flex-col">
          <div className="p-5 border-b border-black/10">
            <div className="flex items-center gap-2 mb-4">
              <Users size={18} className="text-black" />
              <h2 className="text-sm font-bold text-black">Users</h2>
              <span className="ml-auto text-xs text-gray-500 bg-black/5 px-2 py-1 rounded-full">{users.length}</span>
            </div>
            
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search users..."
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 backdrop-blur-md bg-black/5 border border-black/10 rounded-full text-xs text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <button
              onClick={() => setSelectedUser(null)}
              className={`w-full text-left px-4 py-2.5 rounded-2xl mb-2 transition-all text-xs ${
                selectedUser === null
                  ? 'backdrop-blur-md bg-black text-white font-semibold'
                  : 'hover:bg-black/5 text-black'
              }`}
            >
              <div className="flex items-center justify-between">
                <span>All Users</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${selectedUser === null ? 'bg-white/20' : 'bg-black/5'}`}>{allPdfs.length}</span>
              </div>
            </button>

            {filteredUsers.map(u => {
              const userPdfCount = allPdfs.filter(p => p.uploaded_by === u.username).length;
              return (
                <button
                  key={u.user_id}
                  onClick={() => setSelectedUser(u.username)}
                  className={`w-full text-left px-4 py-2.5 rounded-2xl mb-2 transition-all ${
                    selectedUser === u.username
                      ? 'backdrop-blur-md bg-black text-white font-semibold'
                      : 'hover:bg-black/5 text-black'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">{u.username}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${selectedUser === u.username ? 'bg-white/20' : 'bg-black/5'}`}>{userPdfCount}</span>
                  </div>
                  <div className="text-xs opacity-70 flex items-center gap-2">
                    <span>{u.name}</span>
                    <span>•</span>
                    <span className={`px-2 py-0.5 rounded-full ${u.role === 'qc' ? 'bg-purple-500/20 text-purple-600' : 'bg-black/10'}`}>
                      {u.role}
                    </span>
                  </div>
                </button>
              );
            })}

            {filteredUsers.length === 0 && (
              <div className="text-center text-gray-400 text-xs py-8">No users found</div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4 mb-6">
            <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Total PDFs</p>
                  <p className="text-xl font-bold text-black mt-1">{stats.total}</p>
                </div>
                <FileText className="text-gray-400" size={20} />
              </div>
            </div>
            <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Pending</p>
                  <p className="text-xl font-bold text-black mt-1">{stats.pending}</p>
                </div>
                <AlertCircle className="text-gray-400" size={20} />
              </div>
            </div>
            <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">In Review</p>
                  <p className="text-xl font-bold text-black mt-1">{stats.assigned}</p>
                </div>
                <Clock className="text-blue-500" size={20} />
              </div>
            </div>
            <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Accepted</p>
                  <p className="text-xl font-bold text-black mt-1">{stats.accepted}</p>
                </div>
                <CheckCircle className="text-emerald-500" size={20} />
              </div>
            </div>
            <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Rejected</p>
                  <p className="text-xl font-bold text-black mt-1">{stats.rejected}</p>
                </div>
                <XCircle className="text-red-500" size={20} />
              </div>
            </div>
          </div>

          {message && (
            <div className={`mb-4 p-3 rounded-2xl backdrop-blur-md text-xs font-medium ${message.includes('❌') ? 'bg-red-500/10 text-red-600 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'}`}>
              {message}
            </div>
          )}

          {/* Filters */}
          <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by filename or uploader..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white/50 border border-black/10 rounded-full text-xs text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20"
                />
              </div>
              
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-gray-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-white/50 border border-black/10 rounded-full text-xs text-black focus:outline-none focus:ring-2 focus:ring-black/20"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="assigned">In Review</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              <div className="text-xs text-gray-500">
                Showing {filteredPdfs.length} of {pdfsToShow.length} PDFs
                {selectedUser && ` for ${selectedUser}`}
              </div>
            </div>
          </div>

          {/* PDFs List */}
          {loading ? (
            <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-12 text-center">
              <div className="text-xs text-gray-500">Loading documents...</div>
            </div>
          ) : filteredPdfs.length === 0 ? (
            <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-12 text-center">
              <FileText size={40} className="text-gray-300 mx-auto mb-3" />
              <p className="text-xs text-gray-500">No documents found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPdfs.map(item => (
                <div key={item.id} className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-5 hover:bg-black/10 transition-all">
                  <div className="flex justify-between gap-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <FileText size={16} className="text-gray-400" />
                        <h3 className="text-sm font-semibold text-black">{item.original_name}</h3>
                        {getStatusBadge(item)}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
                        <div>
                          <span className="text-gray-500">Uploaded by:</span>
                          <span className="ml-2 font-medium text-black">{item.uploaded_by}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Uploaded at:</span>
                          <span className="ml-2">{new Date(item.uploaded_at).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Assigned to:</span>
                          <span className="ml-2 font-medium text-black">{item.assigned_to || "—"}</span>
                        </div>
                      </div>

                      {item.feedback && (
                        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                          <p className="text-xs text-red-600">
                            <span className="font-semibold">Feedback:</span> {item.feedback}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 items-end min-w-[200px]">
                      {/* REPLACED: anchor -> blob-based preview button (keeps other logic same) */}
                      <button
                        onClick={() => viewPdf(item.id)}
                        className="flex items-center gap-2 text-xs text-black hover:text-gray-600 font-medium"
                        disabled={!!actionLoading[item.id]}
                      >
                        <Download size={12} />
                        {actionLoading[item.id] ? "Opening..." : "Open Document"}
                      </button>

                      <select
                        value={item.assigned_to || ""}
                        onChange={(e) => assign(item.id, e.target.value)}
                        disabled={actionLoading[item.id]}
                        className="w-full px-3 py-2 bg-white/50 border border-black/10 rounded-full text-xs text-black focus:outline-none focus:ring-2 focus:ring-black/20 disabled:opacity-50"
                      >
                        <option value="">Assign to QC...</option>
                        {qcs.map(q => (
                          <option key={q.user_id} value={q.username}>
                            {q.username} ({q.name})
                          </option>
                        ))}
                      </select>

                      <div className="flex gap-2 w-full">
                        <button
                          onClick={() => adminSetStatus(item.id, "Accepted")}
                          disabled={actionLoading[item.id] || item.status === "Accepted"}
                          className="flex-1 px-3 py-2 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs font-medium"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => {
                            const reason = prompt("Reason for rejection (optional):", "");
                            if (reason !== null) adminSetStatus(item.id, "Rejected", reason || "");
                          }}
                          disabled={actionLoading[item.id] || item.status === "Rejected"}
                          className="flex-1 px-3 py-2 bg-red-500 text-white rounded-full hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs font-medium"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
