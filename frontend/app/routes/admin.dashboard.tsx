import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

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
        setMessage("Session removed successfully");
        fetchDashboardData();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage("Failed to remove session");
      }
    } catch (error) {
      console.error("Remove error:", error);
      setMessage("Failed to remove session");
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

    setMessage(`Deleted ${deleted} session(s)`);
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

    setMessage(`Deleted ${deleted} empty session(s)`);
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
        setMessage("Report exported successfully");
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage("Failed to export report");
      }
    } catch (error) {
      console.error("Export error:", error);
      setMessage("Failed to export report");
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
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black flex items-center justify-center">
        <div className="text-white text-xl">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">🔐 Admin Dashboard</h1>
            <p className="text-gray-400">Monitor all user sessions and review statistics</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate("/admin/assign-work")}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              📤 Assign Work
            </button>
            <button
              onClick={fetchDashboardData}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              🔄 Refresh
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {message && (
          <div className="mb-6 p-4 bg-green-900/50 border border-green-700 rounded-lg text-green-200">
            {message}
          </div>
        )}

        {/* Stats Cards - Updated with more details */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Sessions</div>
            <div className="text-2xl font-bold text-white">{stats?.total_sessions || 0}</div>
          </div>
          
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Users</div>
            <div className="text-2xl font-bold text-white">{stats?.total_users || 0}</div>
          </div>
          
          <div className="bg-gray-800/50 border border-blue-700 rounded-lg p-4">
            <div className="text-blue-400 text-sm mb-1">Total Uploaded</div>
            <div className="text-2xl font-bold text-blue-400">{stats?.total_uploaded_links || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Original links</div>
          </div>
          
          <div className="bg-gray-800/50 border border-cyan-700 rounded-lg p-4">
            <div className="text-cyan-400 text-sm mb-1">Total Assigned</div>
            <div className="text-2xl font-bold text-cyan-400">{stats?.total_assigned_links || 0}</div>
            <div className="text-xs text-gray-500 mt-1">After deduplication</div>
          </div>
          
          <div className="bg-gray-800/50 border border-orange-700 rounded-lg p-4">
            <div className="text-orange-400 text-sm mb-1">Duplicates</div>
            <div className="text-2xl font-bold text-orange-400">{stats?.total_duplicates || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Removed links</div>
          </div>
        </div>

        {/* Second row of stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800/50 border border-green-700 rounded-lg p-4">
            <div className="text-green-400 text-sm mb-1">Accepted</div>
            <div className="text-2xl font-bold text-green-400">{stats?.total_accepted || 0}</div>
          </div>
          
          <div className="bg-gray-800/50 border border-red-700 rounded-lg p-4">
            <div className="text-red-400 text-sm mb-1">Rejected</div>
            <div className="text-2xl font-bold text-red-400">{stats?.total_rejected || 0}</div>
          </div>
          
          <div className="bg-gray-800/50 border border-yellow-700 rounded-lg p-4">
            <div className="text-yellow-400 text-sm mb-1">Pending</div>
            <div className="text-2xl font-bold text-yellow-400">{stats?.total_pending || 0}</div>
          </div>
          
          <div className="bg-gray-800/50 border border-purple-700 rounded-lg p-4">
            <div className="text-purple-400 text-sm mb-1">Completion</div>
            <div className="text-2xl font-bold text-purple-400">{stats?.completion_rate || 0}%</div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideEmptySessions}
                  onChange={(e) => setHideEmptySessions(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Hide Empty Sessions</span>
              </label>
              
              {filteredSessions.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSessions.size === filteredSessions.length && filteredSessions.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4"
                  />
                  <span>Select All ({filteredSessions.length})</span>
                </label>
              )}
            </div>

            <div className="flex gap-2">
              {selectedSessions.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
                >
                  🗑️ Delete Selected ({selectedSessions.size})
                </button>
              )}
              
              <button
                onClick={handleDeleteEmptySessions}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg transition-colors"
              >
                🧹 Delete Empty Sessions
              </button>
            </div>
          </div>
        </div>

        {/* Sessions List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white mb-4">
            Active Sessions ({filteredSessions.length})
          </h2>

          {filteredSessions.length === 0 ? (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-12 text-center">
              <div className="text-gray-400 text-lg">No sessions found</div>
              <p className="text-gray-500 text-sm mt-2">
                {hideEmptySessions ? "All sessions are empty. Uncheck 'Hide Empty Sessions' to view them." : "Assign work to users to see sessions here."}
              </p>
            </div>
          ) : (
            filteredSessions.map((session) => (
              <div
                key={session.full_token}
                className={`bg-gray-800/50 border rounded-lg p-6 transition-all ${
                  selectedSessions.has(session.full_token)
                    ? 'border-blue-500 bg-blue-900/20'
                    : 'border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      checked={selectedSessions.has(session.full_token)}
                      onChange={() => toggleSessionSelection(session.full_token)}
                      className="w-5 h-5 mt-1"
                    />
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-xl font-semibold text-white">
                          @{session.username || 'Unknown'}
                        </h3>
                        {session.assigned_by_admin && (
                          <span className="px-2 py-1 bg-blue-900 text-blue-300 text-xs rounded">
                            👤 Assigned by Admin
                          </span>
                        )}
                        {session.assigned_range && (
                          <span className="px-2 py-1 bg-purple-900 text-purple-300 text-xs rounded">
                            Range: {session.assigned_range}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-400">
                        {session.name} • {session.email}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-gray-700 text-gray-300 text-sm rounded">
                      Session #{session.token}
                    </span>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                  <div>
                    <div className="text-gray-400 text-xs mb-1">Total PDFs</div>
                    <div className="text-2xl font-bold text-white">{session.total_pdfs}</div>
                  </div>
                  <div>
                    <div className="text-green-400 text-xs mb-1">Accepted</div>
                    <div className="text-2xl font-bold text-green-400">{session.accepted}</div>
                  </div>
                  <div>
                    <div className="text-red-400 text-xs mb-1">Rejected</div>
                    <div className="text-2xl font-bold text-red-400">{session.rejected}</div>
                  </div>
                  <div>
                    <div className="text-yellow-400 text-xs mb-1">Pending</div>
                    <div className="text-2xl font-bold text-yellow-400">{session.pending}</div>
                  </div>
                  <div>
                    <div className="text-orange-400 text-xs mb-1">Duplicates</div>
                    <div className="text-2xl font-bold text-orange-400">{session.duplicates_removed}</div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-400 mb-2">
                    <span>Progress</span>
                    <span>
                      {session.total_pdfs > 0
                        ? Math.round(((session.accepted + session.rejected) / session.total_pdfs) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all"
                      style={{
                        width: `${session.total_pdfs > 0
                          ? ((session.accepted + session.rejected) / session.total_pdfs) * 100
                          : 0}%`
                      }}
                    />
                  </div>
                </div>

                {/* Timestamps */}
                <div className="grid grid-cols-3 gap-4 text-xs text-gray-400 mb-4">
                  <div>
                    <span className="font-medium">Created:</span> {new Date(session.created_at).toLocaleString()}
                  </div>
                  <div>
                    <span className="font-medium">Expires:</span> {new Date(session.expires_at).toLocaleString()}
                  </div>
                  <div>
                    <span className="font-medium">Last Active:</span> {new Date(session.last_accessed).toLocaleString()}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  {session.total_pdfs > 0 && (
                    <button
                      onClick={() => handleExportReport(session.full_token)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                    >
                      📊 Export Report
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveSession(session.full_token)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
                  >
                    🗑️ Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}