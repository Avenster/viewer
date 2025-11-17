import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";

const API_URL = import.meta.env.VITE_API_URL || "http://13.201.123.132:5000";

interface Session {
  token: string;
  full_token: string;
  username: string;
  email: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_accessed: string;
  total_pdfs: number;
  accepted: number;
  rejected: number;
  pending: number;
  duplicates_removed: number;
  assigned_by_admin: boolean;
  assigned_count: number;
  assigned_range?: string;
  assigned_percentage?: number;
}

interface Stats {
  total_sessions: number;
  total_users: number;
  total_pdfs: number;
  total_accepted: number;
  total_rejected: number;
  total_pending: number;
  total_duplicates: number;
  total_uploaded_links: number;
  total_assigned_links: number;
  completion_rate: number;
}

export default function AdminDashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [hideEmptySessions, setHideEmptySessions] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    const adminToken = localStorage.getItem("admin_token");

    if (!adminToken) {
      navigate("/admin/login");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/admin/dashboard`, {
        headers: { "X-Admin-Token": adminToken }
      });

      if (response.status === 401) {
        localStorage.removeItem("admin_token");
        navigate("/admin/login");
        return;
      }

      const data = await response.json();
      setSessions(data.sessions || []);
      setStats(data.stats || null);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
      setMessage("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSession = async (sessionToken: string) => {
    const adminToken = localStorage.getItem("admin_token");
    
    if (!confirm("Are you sure you want to remove this session?")) return;

    try {
      const response = await fetch(`${API_URL}/api/admin/remove-session/${sessionToken}`, {
        method: "DELETE",
        headers: { "X-Admin-Token": adminToken || "" }
      });

      if (response.ok) {
        setMessage("✅ Session removed successfully");
        fetchDashboardData();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage("❌ Failed to remove session");
      }
    } catch (error) {
      console.error("Remove error:", error);
      setMessage("❌ Failed to remove session");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSessions.size === 0) {
      alert("Please select sessions to delete");
      return;
    }

    if (!confirm(`Delete ${selectedSessions.size} session(s)?`)) return;

    const adminToken = localStorage.getItem("admin_token");
    let deleted = 0;

    for (const token of Array.from(selectedSessions)) {
      try {
        const response = await fetch(`${API_URL}/api/admin/remove-session/${token}`, {
          method: "DELETE",
          headers: { "X-Admin-Token": adminToken || "" }
        });

        if (response.ok) deleted++;
      } catch (error) {
        console.error("Delete error:", error);
      }
    }

    setMessage(`✅ Deleted ${deleted} session(s)`);
    setSelectedSessions(new Set());
    fetchDashboardData();
    setTimeout(() => setMessage(""), 3000);
  };

  const handleDeleteEmptySessions = async () => {
    const emptySessions = sessions.filter(s => s.total_pdfs === 0);
    
    if (emptySessions.length === 0) {
      alert("No empty sessions to delete");
      return;
    }

    if (!confirm(`Delete ${emptySessions.length} empty session(s)?`)) return;

    const adminToken = localStorage.getItem("admin_token");
    let deleted = 0;

    for (const session of emptySessions) {
      try {
        const response = await fetch(`${API_URL}/api/admin/remove-session/${session.full_token}`, {
          method: "DELETE",
          headers: { "X-Admin-Token": adminToken || "" }
        });

        if (response.ok) deleted++;
      } catch (error) {
        console.error("Delete error:", error);
      }
    }

    setMessage(`✅ Deleted ${deleted} empty session(s)`);
    fetchDashboardData();
    setTimeout(() => setMessage(""), 3000);
  };

  const handleExportReport = async (sessionToken: string) => {
    const adminToken = localStorage.getItem("admin_token");
    
    try {
      const response = await fetch(`${API_URL}/api/admin/export-user-report/${sessionToken}`, {
        headers: { "X-Admin-Token": adminToken || "" }
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `QC_Report_${Date.now()}.txt`;
        a.click();
        window.URL.revokeObjectURL(url);
        setMessage("✅ Report exported successfully");
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage("❌ Failed to export report");
      }
    } catch (error) {
      console.error("Export error:", error);
      setMessage("❌ Failed to export report");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    navigate("/admin/login");
  };

  const toggleSessionSelection = (token: string) => {
    const newSelected = new Set(selectedSessions);
    if (newSelected.has(token)) {
      newSelected.delete(token);
    } else {
      newSelected.add(token);
    }
    setSelectedSessions(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedSessions.size === filteredSessions.length) {
      setSelectedSessions(new Set());
    } else {
      setSelectedSessions(new Set(filteredSessions.map(s => s.full_token)));
    }
  };

  const filteredSessions = hideEmptySessions 
    ? sessions.filter(s => s.total_pdfs > 0)
    : sessions;

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-gray-800 border-t-white mb-4"></div>
          <div className="text-xl font-medium text-white">Loading Dashboard...</div>
          <div className="text-sm text-gray-500 mt-2">Fetching session data</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header with Glassmorphism */}
        <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-2xl p-6 mb-8 shadow-2xl">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="text-4xl">🔐</div>
                <h1 className="text-4xl font-bold text-white">Admin Dashboard</h1>
              </div>
              <p className="text-gray-400 text-lg">Monitor all user sessions and review statistics</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate("/admin/assign-work")}
                className="px-5 py-3 bg-white text-black rounded-xl font-semibold hover:bg-gray-200 transition-all shadow-lg transform hover:scale-105"
              >
                📤 Assign Work
              </button>
              <button
                onClick={fetchDashboardData}
                className="px-5 py-3 backdrop-blur-xl bg-white/10 border-2 border-white/20 text-white rounded-xl font-semibold hover:bg-white/20 transition-all"
              >
                🔄 Refresh
              </button>
              <button
                onClick={handleLogout}
                className="px-5 py-3 backdrop-blur-xl bg-white/5 border-2 border-white/10 text-white rounded-xl font-semibold hover:bg-white/10 transition-all"
              >
                ← Logout
              </button>
            </div>
          </div>
        </div>

        {/* Message Alert */}
        {message && (
          <div className="mb-6 backdrop-blur-xl bg-white/10 border-2 border-white/20 rounded-xl p-4 text-white font-medium shadow-lg animate-pulse">
            {message}
          </div>
        )}

        {/* Main Stats Grid - First Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-gray-400 text-sm font-semibold mb-2 uppercase tracking-wider">Sessions</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.total_sessions || 0}</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-gray-400 text-sm font-semibold mb-2 uppercase tracking-wider">Users</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.total_users || 0}</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/20 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-white text-sm font-semibold mb-2 uppercase tracking-wider">Uploaded</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.total_uploaded_links || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Original links</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/20 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-white text-sm font-semibold mb-2 uppercase tracking-wider">Assigned</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.total_assigned_links || 0}</div>
            <div className="text-xs text-gray-500 mt-1">After deduplication</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-gray-400 text-sm font-semibold mb-2 uppercase tracking-wider">Duplicates</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.total_duplicates || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Removed</div>
          </div>
        </div>

        {/* Second Row Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/20 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-white text-sm font-semibold mb-2 uppercase tracking-wider">✅ Accepted</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.total_accepted || 0}</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-gray-400 text-sm font-semibold mb-2 uppercase tracking-wider">✗ Rejected</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.total_rejected || 0}</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-gray-400 text-sm font-semibold mb-2 uppercase tracking-wider">⏳ Pending</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.total_pending || 0}</div>
          </div>
          
          <div className="backdrop-blur-xl bg-white/5 border-2 border-white/20 rounded-xl p-5 hover:bg-white/10 transition-all group">
            <div className="text-white text-sm font-semibold mb-2 uppercase tracking-wider">📊 Completion</div>
            <div className="text-3xl font-bold text-white group-hover:scale-110 transition-transform">{stats?.completion_rate || 0}%</div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-xl p-5 mb-6 shadow-xl">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-3 text-sm text-gray-300 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={hideEmptySessions}
                  onChange={(e) => setHideEmptySessions(e.target.checked)}
                  className="w-5 h-5 rounded border-2 border-gray-600 bg-transparent checked:bg-white checked:border-white cursor-pointer transition-all"
                />
                <span className="font-medium group-hover:text-white transition-colors">Hide Empty Sessions</span>
              </label>
              
              {filteredSessions.length > 0 && (
                <label className="flex items-center gap-3 text-sm text-gray-300 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={selectedSessions.size === filteredSessions.length && filteredSessions.length > 0}
                    onChange={toggleSelectAll}
                    className="w-5 h-5 rounded border-2 border-gray-600 bg-transparent checked:bg-white checked:border-white cursor-pointer transition-all"
                  />
                  <span className="font-medium group-hover:text-white transition-colors">
                    Select All ({filteredSessions.length})
                  </span>
                </label>
              )}
            </div>

            <div className="flex gap-3">
              {selectedSessions.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  className="px-5 py-2.5 bg-white text-black rounded-xl font-bold hover:bg-gray-200 transition-all shadow-lg transform hover:scale-105"
                >
                  🗑️ Delete ({selectedSessions.size})
                </button>
              )}
              
              <button
                onClick={handleDeleteEmptySessions}
                className="px-5 py-2.5 backdrop-blur-xl bg-white/10 border-2 border-white/20 text-white rounded-xl font-semibold hover:bg-white/20 transition-all"
              >
                🧹 Delete Empty
              </button>
            </div>
          </div>
        </div>

        {/* Sessions List */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">
              Active Sessions <span className="text-gray-500">({filteredSessions.length})</span>
            </h2>
          </div>

          {filteredSessions.length === 0 ? (
            <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-2xl p-16 text-center">
              <div className="text-6xl mb-4">📊</div>
              <div className="text-white text-2xl font-bold mb-2">No Sessions Found</div>
              <p className="text-gray-400 text-lg">
                {hideEmptySessions 
                  ? "All sessions are empty. Uncheck 'Hide Empty Sessions' to view them." 
                  : "Assign work to users to see sessions here."}
              </p>
            </div>
          ) : (
            filteredSessions.map((session) => {
              const progressPercent = session.total_pdfs > 0
                ? Math.round(((session.accepted + session.rejected) / session.total_pdfs) * 100)
                : 0;
              
              return (
                <div
                  key={session.full_token}
                  className={`backdrop-blur-xl rounded-2xl p-6 transition-all shadow-xl ${
                    selectedSessions.has(session.full_token)
                      ? 'bg-white/20 border-2 border-white shadow-2xl'
                      : 'bg-white/5 border-2 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        checked={selectedSessions.has(session.full_token)}
                        onChange={() => toggleSessionSelection(session.full_token)}
                        className="w-6 h-6 mt-1 rounded border-2 border-gray-600 bg-transparent checked:bg-white checked:border-white cursor-pointer transition-all"
                      />
                      <div>
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h3 className="text-2xl font-bold text-white">
                            @{session.username || 'Unknown'}
                          </h3>
                          {session.assigned_by_admin && (
                            <span className="px-3 py-1.5 backdrop-blur-xl bg-white/20 border border-white/30 text-white text-xs rounded-lg font-semibold">
                              👤 Admin Assigned
                            </span>
                          )}
                          {session.assigned_range && (
                            <span className="px-3 py-1.5 backdrop-blur-xl bg-white/10 border border-white/20 text-gray-300 text-xs rounded-lg font-semibold">
                              📊 {session.assigned_range}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-400 font-medium">
                          {session.name} • {session.email}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-4 py-2 backdrop-blur-xl bg-white/10 border border-white/20 text-gray-300 text-sm rounded-lg font-mono">
                        #{session.token}
                      </span>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4">
                      <div className="text-gray-400 text-xs font-semibold mb-1 uppercase">Total PDFs</div>
                      <div className="text-2xl font-bold text-white">{session.total_pdfs}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-white/5 border border-white/20 rounded-lg p-4">
                      <div className="text-white text-xs font-semibold mb-1 uppercase">✅ Accepted</div>
                      <div className="text-2xl font-bold text-white">{session.accepted}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4">
                      <div className="text-gray-400 text-xs font-semibold mb-1 uppercase">✗ Rejected</div>
                      <div className="text-2xl font-bold text-white">{session.rejected}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4">
                      <div className="text-gray-400 text-xs font-semibold mb-1 uppercase">⏳ Pending</div>
                      <div className="text-2xl font-bold text-white">{session.pending}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-4">
                      <div className="text-gray-400 text-xs font-semibold mb-1 uppercase">Duplicates</div>
                      <div className="text-2xl font-bold text-white">{session.duplicates_removed}</div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-5">
                    <div className="flex justify-between text-sm text-gray-400 font-semibold mb-3">
                      <span>Progress</span>
                      <span className="text-white">{progressPercent}%</span>
                    </div>
                    <div className="w-full h-3 backdrop-blur-xl bg-white/10 rounded-full overflow-hidden border border-white/20">
                      <div
                        className="h-full bg-white rounded-full transition-all duration-500 ease-out shadow-lg"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Timestamps */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5 text-xs">
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-3">
                      <span className="font-semibold text-gray-400 uppercase tracking-wide">Created</span>
                      <div className="text-white mt-1">{new Date(session.created_at).toLocaleString()}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-3">
                      <span className="font-semibold text-gray-400 uppercase tracking-wide">Expires</span>
                      <div className="text-white mt-1">{new Date(session.expires_at).toLocaleString()}</div>
                    </div>
                    <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg p-3">
                      <span className="font-semibold text-gray-400 uppercase tracking-wide">Last Active</span>
                      <div className="text-white mt-1">{new Date(session.last_accessed).toLocaleString()}</div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    {session.total_pdfs > 0 && (
                      <button
                        onClick={() => handleExportReport(session.full_token)}
                        className="px-5 py-3 bg-white text-black rounded-xl font-bold hover:bg-gray-200 transition-all shadow-lg transform hover:scale-105"
                      >
                        📊 Export Report
                      </button>
                    )}
                    <button
                      onClick={() => handleRemoveSession(session.full_token)}
                      className="px-5 py-3 backdrop-blur-xl bg-white/10 border-2 border-white/20 text-white rounded-xl font-semibold hover:bg-white/20 transition-all"
                    >
                      🗑️ Remove Session
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}