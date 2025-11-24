import React, { useEffect, useState } from "react";
import {
  Search,
  Download,
  Filter,
  Users,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  X,
  Globe,
  Calendar,
  ChevronDown,
  Settings,
  BarChart3,
} from "lucide-react";

const API_URL = "http://13.201.123.132:5000";
const PDF_LANGUAGES = [
  "Japanese",
  "Hindi",
  "Russian",
  "Polish",
  "Arabic",
  "German",
];

const getLocalStorage = (key) => {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
};

const removeLocalStorage = (key) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch (e) {}
};

function pickTokenFromStorage() {
  const adminToken = getLocalStorage("auth_token_admin");
  if (adminToken) return adminToken;
  const generic = getLocalStorage("auth_token");
  if (generic) return generic;
  if (typeof window !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("auth_token_")) {
        const v = getLocalStorage(k);
        if (v) return v;
      }
    }
  }
  return null;
}

export default function AdminDashboard() {
  const [allPdfs, setAllPdfs] = useState([]);
  const [qcs, setQcs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [message, setMessage] = useState(null);
  const [tokenToUse, setTokenToUse] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [selectedLanguages, setSelectedLanguages] = useState([]);
  const [showLanguageFilter, setShowLanguageFilter] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkQCTarget, setBulkQCTarget] = useState("");
  const [onlyUnassignedWhenAll, setOnlyUnassignedWhenAll] = useState(true);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setTokenToUse(pickTokenFromStorage());
  }, []);

  useEffect(() => {
    if (tokenToUse) {
      fetchAll();
      fetchUsers();
    }
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
      const res = await fetch(`${API_URL}/api/admin/users`, {
        headers: { "X-Auth-Token": tokenToUse },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers(data.users || []);
        setQcs((data.users || []).filter((u) => u.role === "qc"));
      } else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Failed to fetch users");
    }
  }

  async function assign(pdfId, qcUsername) {
    if (!tokenToUse) return;
    setActionLoading((s) => ({ ...s, [pdfId]: true }));
    try {
      const res = await fetch(`${API_URL}/api/admin/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": tokenToUse,
        },
        body: JSON.stringify({ pdf_id: pdfId, qc_username: qcUsername }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage("✅ Successfully assigned to QC");
        fetchAll();
        setTimeout(() => setMessage(null), 3000);
      } else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Assign failed");
    } finally {
      setActionLoading((s) => ({ ...s, [pdfId]: false }));
    }
  }

  async function adminSetStatus(pdfId, status, feedback = "") {
    if (!tokenToUse) return;
    setActionLoading((s) => ({ ...s, [pdfId]: true }));
    try {
      const res = await fetch(
        `${API_URL}/api/admin/global-pdfs/${pdfId}/status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": tokenToUse,
          },
          body: JSON.stringify({ status, feedback }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(`✅ Status updated to ${status}`);
        fetchAll();
        setTimeout(() => setMessage(null), 3000);
      } else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Update failed");
    } finally {
      setActionLoading((s) => ({ ...s, [pdfId]: false }));
    }
  }

  async function bulkAssign({
    pdf_ids = [],
    assign_all = false,
    qc_username,
    only_unassigned = true,
  }) {
    if (!tokenToUse) return;
    if (!qc_username) {
      setMessage("❌ Select a QC user first");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/assign-multiple`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": tokenToUse,
        },
        body: JSON.stringify({
          pdf_ids,
          qc_username,
          assign_all,
          only_unassigned,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(
          `✅ Assigned ${data.assigned_count || 0} PDFs to ${qc_username}`
        );
        clearSelection();
        fetchAll();
        setTimeout(() => setMessage(null), 3000);
      } else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      setMessage("❌ Bulk assign failed");
    } finally {
      setLoading(false);
    }
  }

  async function viewPdf(pdfId) {
    if (!tokenToUse) {
      setMessage("❌ No auth token");
      return;
    }
    setActionLoading((s) => ({ ...s, [pdfId]: true }));
    try {
      const res = await fetch(`${API_URL}/api/global-pdfs/${pdfId}`, {
        method: "GET",
        headers: { "X-Auth-Token": tokenToUse, Accept: "application/pdf" },
      });
      if (res.status === 401) {
        removeLocalStorage("auth_token_admin");
        setMessage("❌ Unauthorized");
        return;
      }
      if (!res.ok) {
        setMessage(`❌ Failed: ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const newWin = window.open("", "_blank");
      if (!newWin) window.location.assign(blobUrl);
      else {
        newWin.document.write(
          `<!doctype html><html><head><title>PDF</title><style>html,body{height:100%;margin:0}iframe{border:0;width:100%;height:100vh}</style></head><body><iframe src="${blobUrl}"></iframe></body></html>`
        );
        newWin.document.close();
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    } catch (err) {
      setMessage("❌ Error loading PDF");
    } finally {
      setActionLoading((s) => ({ ...s, [pdfId]: false }));
    }
  }

  async function exportAcceptedPdfs(scope) {
    if (!tokenToUse) return;
    if (scope === "user" && !selectedUser) {
      setMessage("❌ Select a user from the sidebar to export their PDFs");
      return;
    }
    const params = new URLSearchParams();
    if (scope === "user" && selectedUser) {
      params.append("username", selectedUser);
    }
    if (exportFrom) params.append("from_date", exportFrom);
    if (exportTo) params.append("to_date", exportTo);
    const url = `${API_URL}/api/admin/export-accepted${params.toString() ? `?${params.toString()}` : ""}`;
    setExporting(true);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "X-Auth-Token": tokenToUse },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(`❌ ${data.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename =
        scope === "user" && selectedUser
          ? `accepted_pdfs_${selectedUser}.zip`
          : "accepted_pdfs_all_users.zip";
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 120000);
      setMessage("✅ Export started (check your downloads)");
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      setMessage("❌ Failed to export PDFs");
    } finally {
      setExporting(false);
    }
  }

  const handleLogout = () => {
    removeLocalStorage("auth_token_admin");
    removeLocalStorage("auth_current_role");
    window.location.href = "/admin-login";
  };

  const toggleLanguageFilter = (lang) => {
    setSelectedLanguages((prev) => {
      if (prev.includes(lang)) return prev.filter((l) => l !== lang);
      return [...prev, lang];
    });
  };

  const clearAllFilters = () => {
    setSelectedLanguages([]);
    setStatusFilter("all");
    setSearchQuery("");
  };

  const languageCounts = allPdfs.reduce((acc, pdf) => {
    const lang = pdf.language || "";
    if (lang) acc[lang] = (acc[lang] || 0) + 1;
    else acc["_none"] = (acc["_none"] || 0) + 1;
    return acc;
  }, {});

  const getLanguageBadge = (lang) => {
    if (!lang) return null;
    const colors = {
      Japanese: "bg-purple-100 text-purple-700 border-purple-200",
      Hindi: "bg-orange-100 text-orange-700 border-orange-200",
      Russian: "bg-blue-100 text-blue-700 border-blue-200",
      Polish: "bg-pink-100 text-pink-700 border-pink-200",
      Arabic: "bg-green-100 text-green-700 border-green-200",
      German: "bg-yellow-100 text-yellow-700 border-yellow-200",
    };
    return (
      <span
        className={`px-2 py-0.5 ${colors[lang] || "bg-gray-100 text-gray-700 border-gray-200"} text-xs font-medium rounded-full border`}
      >
        {lang}
      </span>
    );
  };

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      (u.name || "").toLowerCase().includes(userSearchQuery.toLowerCase())
  );

  const pdfsToShow = selectedUser
    ? allPdfs.filter((p) => p.uploaded_by === selectedUser)
    : allPdfs;

  const filteredPdfs = pdfsToShow.filter((pdf) => {
    const matchesSearch =
      pdf.original_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pdf.uploaded_by.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "pending" && !pdf.assigned_to) ||
      (statusFilter === "assigned" && pdf.assigned_to && !pdf.status) ||
      (statusFilter === "accepted" && pdf.status === "Accepted") ||
      (statusFilter === "rejected" && pdf.status === "Rejected");
    let matchesLanguage = true;
    if (selectedLanguages.length > 0) {
      const pdfLang = pdf.language || "";
      matchesLanguage = selectedLanguages.includes(pdfLang);
    }
    return matchesSearch && matchesStatus && matchesLanguage;
  });

  const stats = {
    total: allPdfs.length,
    pending: allPdfs.filter((p) => !p.assigned_to).length,
    assigned: allPdfs.filter((p) => p.assigned_to && !p.status).length,
    accepted: allPdfs.filter((p) => p.status === "Accepted").length,
    rejected: allPdfs.filter((p) => p.status === "Rejected").length,
  };

  const getStatusBadge = (item) => {
    if (item.status === "Accepted")
      return (
        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full flex items-center gap-1.5">
          <CheckCircle size={12} /> Accepted
        </span>
      );
    if (item.status === "Rejected")
      return (
        <span className="px-2.5 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full flex items-center gap-1.5">
          <XCircle size={12} /> Rejected
        </span>
      );
    if (item.assigned_to)
      return (
        <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full flex items-center gap-1.5">
          <Clock size={12} /> In Review
        </span>
      );
    return (
      <span className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full flex items-center gap-1.5">
        <AlertCircle size={12} /> Pending
      </span>
    );
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());
  const selectAllVisible = () =>
    setSelectedIds(new Set(filteredPdfs.map((p) => p.id)));
  const toggleSelectAllVisible = () => {
    const vis = filteredPdfs.map((p) => p.id);
    if (vis.length > 0 && vis.every((id) => selectedIds.has(id)))
      clearSelection();
    else {
      const ids = new Set(selectedIds);
      vis.forEach((id) => ids.add(id));
      setSelectedIds(ids);
    }
  };

  if (tokenToUse === null)
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading...</div>
      </div>
    );

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="backdrop-blur-md bg-gray-50 border-b border-gray-200 sticky top-0 z-20">
        <div className="px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-black">Admin Dashboard</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Manage documents and user assignments
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full">
              <BarChart3 size={14} className="text-gray-400" />
              <span className="text-xs font-medium text-gray-600">
                {filteredPdfs.length} / {pdfsToShow.length} PDFs
              </span>
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
        <aside className="w-80 bg-gray-50 border-r border-gray-200 h-[calc(100vh-73px)] sticky top-[73px] overflow-hidden flex flex-col">
          <div className="p-5 border-b border-gray-200 bg-white">
            <div className="flex items-center gap-2 mb-3">
              <Users size={18} className="text-black" />
              <h2 className="text-sm font-bold text-black">Users</h2>
              <span className="ml-auto text-xs text-gray-500 bg-gray-200 px-2.5 py-1 rounded-full font-medium">
                {users.length}
              </span>
            </div>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search users..."
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-full text-xs text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <button
              onClick={() => setSelectedUser(null)}
              className={`w-full text-left px-4 py-3 rounded-xl mb-2 transition-all text-xs ${selectedUser === null ? "bg-black text-white font-semibold shadow-md" : "hover:bg-gray-100 text-black"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">All Users</span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium ${selectedUser === null ? "bg-white/20 text-white" : "bg-gray-200 text-gray-600"}`}
                >
                  {allPdfs.length}
                </span>
              </div>
            </button>
            {filteredUsers.map((u) => {
              const cnt = allPdfs.filter(
                (p) => p.uploaded_by === u.username
              ).length;
              return (
                <button
                  key={u.user_id}
                  onClick={() => setSelectedUser(u.username)}
                  className={`w-full text-left px-4 py-3 rounded-xl mb-2 transition-all ${selectedUser === u.username ? "bg-black text-white font-semibold shadow-md" : "hover:bg-gray-100 text-black"}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold">{u.username}</span>
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${selectedUser === u.username ? "bg-white/20 text-white" : "bg-gray-200 text-gray-600"}`}
                    >
                      {cnt}
                    </span>
                  </div>
                  <div className="text-[11px] opacity-80 flex items-center gap-2">
                    <span>{u.name}</span>
                    <span>•</span>
                    <span
                      className={`px-2 py-0.5 rounded-full ${u.role === "qc" ? "bg-purple-500/30 text-purple-200" : selectedUser === u.username ? "bg-white/20" : "bg-gray-300 text-gray-700"}`}
                    >
                      {u.role}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8 bg-white">
          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4 mb-6">
            {[
              {
                label: "Total PDFs",
                value: stats.total,
                icon: <FileText className="text-gray-400" size={20} />,
                bgColor: "bg-gray-50",
              },
              {
                label: "Pending",
                value: stats.pending,
                icon: <AlertCircle className="text-amber-500" size={20} />,
                bgColor: "bg-amber-50",
              },
              {
                label: "In Review",
                value: stats.assigned,
                icon: <Clock className="text-blue-500" size={20} />,
                bgColor: "bg-blue-50",
              },
              {
                label: "Accepted",
                value: stats.accepted,
                icon: <CheckCircle className="text-emerald-500" size={20} />,
                bgColor: "bg-emerald-50",
              },
              {
                label: "Rejected",
                value: stats.rejected,
                icon: <XCircle className="text-red-500" size={20} />,
                bgColor: "bg-red-50",
              },
            ].map((stat, idx) => (
              <div
                key={idx}
                className={`${stat.bgColor} border border-gray-200 rounded-2xl p-5 transition-all hover:shadow-md`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-medium mb-1">
                      {stat.label}
                    </p>
                    <p className="text-2xl font-bold text-black">{stat.value}</p>
                  </div>
                  {stat.icon}
                </div>
              </div>
            ))}
          </div>

          {/* Message Banner */}
          {message && (
            <div
              className={`mb-6 p-4 rounded-xl text-sm font-medium flex items-center gap-2 ${message.includes("❌") ? "bg-red-100 text-red-700 border border-red-200" : "bg-emerald-100 text-emerald-700 border border-emerald-200"}`}
            >
              {message.includes("❌") ? (
                <XCircle size={16} />
              ) : (
                <CheckCircle size={16} />
              )}
              {message}
            </div>
          )}

          {/* Filters Section */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Filter size={16} className="text-gray-600" />
              <h3 className="text-sm font-bold text-black">Filters & Search</h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 relative min-w-[250px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Search by filename or uploader..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-full text-xs text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2.5 bg-white border border-gray-200 rounded-full text-xs text-black focus:outline-none focus:ring-2 focus:ring-gray-300 font-medium"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="assigned">In Review</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
              </select>
              <div className="relative">
                <button
                  onClick={() => setShowLanguageFilter(!showLanguageFilter)}
                  className={`flex items-center gap-2 px-4 py-2.5 border rounded-full text-xs font-medium transition-all ${selectedLanguages.length > 0 ? "bg-black text-white border-black" : "bg-white border-gray-200 text-black hover:bg-gray-50"}`}
                >
                  <Globe size={14} />
                  Language{" "}
                  {selectedLanguages.length > 0 &&
                    `(${selectedLanguages.length})`}
                  <ChevronDown size={12} />
                </button>
                {showLanguageFilter && (
                  <div className="absolute top-full mt-2 right-0 w-72 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-black">
                        Filter by Language
                      </span>
                      <button
                        onClick={() => setShowLanguageFilter(false)}
                        className="text-gray-400 hover:text-black"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-auto">
                      {PDF_LANGUAGES.map((lang) => {
                        const count = languageCounts[lang] || 0;
                        return (
                          <label
                            key={lang}
                            className="flex items-center gap-3 p-2.5 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={selectedLanguages.includes(lang)}
                              onChange={() => toggleLanguageFilter(lang)}
                              className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black"
                            />
                            <span className="text-sm text-black flex-1 font-medium">
                              {lang}
                            </span>
                            <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
                              {count}
                            </span>
                          </label>
                        );
                      })}
                      {languageCounts["_none"] > 0 && (
                        <label className="flex items-center gap-3 p-2.5 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors">
                          <input
                            type="checkbox"
                            checked={selectedLanguages.includes("")}
                            onChange={() => toggleLanguageFilter("")}
                            className="w-4 h-4 rounded border-gray-300"
                          />
                          <span className="text-sm text-gray-500 flex-1 italic">
                            No Language
                          </span>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
                            {languageCounts["_none"]}
                          </span>
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {(selectedLanguages.length > 0 ||
                statusFilter !== "all" ||
                searchQuery) && (
                <button
                  onClick={clearAllFilters}
                  className="px-4 py-2.5 bg-red-50 border border-red-200 text-red-600 rounded-full text-xs font-medium hover:bg-red-100 transition-all flex items-center gap-1.5"
                >
                  <X size={12} />
                  Clear All
                </button>
              )}
            </div>
            {selectedLanguages.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedLanguages.map((lang) => (
                  <span
                    key={lang || "_none"}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-black text-white text-xs rounded-full font-medium"
                  >
                    {lang || "No Language"}
                    <button
                      onClick={() => toggleLanguageFilter(lang)}
                      className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Bulk Actions */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Settings size={16} className="text-gray-600" />
              <h3 className="text-sm font-bold text-black">Bulk Actions</h3>
              {selectedIds.size > 0 && (
                <span className="ml-2 text-xs bg-black text-white px-2.5 py-1 rounded-full font-medium">
                  {selectedIds.size} selected
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={
                    filteredPdfs.length > 0 &&
                    filteredPdfs.every((p) => selectedIds.has(p.id))
                  }
                  onChange={toggleSelectAllVisible}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-xs text-gray-700 font-medium">
                  Select all visible ({filteredPdfs.length})
                </span>
              </div>
              <button
                onClick={selectAllVisible}
                className="text-xs px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full font-medium transition-colors"
              >
                Select all
              </button>
              <button
                onClick={clearSelection}
                className="text-xs px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full font-medium transition-colors"
              >
                Clear
              </button>
              <div className="h-6 w-px bg-gray-300"></div>
              <select
                value={bulkQCTarget}
                onChange={(e) => setBulkQCTarget(e.target.value)}
                className="px-4 py-2 bg-white border text-gray-600 border-gray-300 rounded-full text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <option value="">Choose QC User...</option>
                {qcs.map((q) => (
                  <option key={q.user_id} value={q.username}>
                    {q.username} ({q.name})
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (!bulkQCTarget) {
                    setMessage("❌ Select a QC user");
                    return;
                  }
                  if (selectedIds.size === 0) {
                    setMessage("❌ No PDFs selected");
                    return;
                  }
                  if (
                    !confirm(
                      `Assign ${selectedIds.size} PDFs to ${bulkQCTarget}?`
                    )
                  )
                    return;
                  bulkAssign({
                    pdf_ids: Array.from(selectedIds),
                    qc_username: bulkQCTarget,
                  });
                }}
                disabled={loading || selectedIds.size === 0}
                className="px-4 py-2 bg-black hover:bg-gray-800 text-white rounded-full text-xs font-medium disabled:opacity-40 transition-all"
              >
                Assign Selected
              </button>
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-full border border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors">
                <input
                  type="checkbox"
                  checked={onlyUnassignedWhenAll}
                  onChange={(e) => setOnlyUnassignedWhenAll(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-xs text-gray-700 font-medium">
                  Only unassigned
                </span>
              </label>
              <button
                onClick={() => {
                  if (!bulkQCTarget) {
                    setMessage("❌ Select a QC user");
                    return;
                  }
                  if (!confirm(`Assign ALL PDFs to ${bulkQCTarget}?`)) return;
                  bulkAssign({
                    assign_all: true,
                    qc_username: bulkQCTarget,
                    only_unassigned: onlyUnassignedWhenAll,
                  });
                }}
                disabled={loading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-xs font-medium disabled:opacity-40 transition-all"
              >
                Assign All PDFs
              </button>
            </div>
          </div>

          {/* Export Section */}
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Download size={16} className="text-gray-600" />
              <h3 className="text-sm font-bold text-black">
                Export Accepted PDFs
              </h3>
            </div>
            <p className="text-xs text-gray-600 mb-4">
              Download a ZIP file of accepted PDFs. Select a user from the
              sidebar to export their PDFs, or export all users' PDFs.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1.5 font-medium flex items-center gap-1">
                  <Calendar size={10} />
                  From Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={exportFrom}
                    onChange={(e) => setExportFrom(e.target.value)}
                    className="pl-3 pr-3 py-2 bg-white border border-gray-300 rounded-full text-xs text-black focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-1.5 font-medium flex items-center gap-1">
                  <Calendar size={10} />
                  To Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={exportTo}
                    onChange={(e) => setExportTo(e.target.value)}
                    className="pl-3 pr-3 py-2 bg-white border border-gray-300 rounded-full text-xs text-black focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                </div>
              </div>
              <button
                onClick={() => exportAcceptedPdfs("user")}
                disabled={exporting || !selectedUser}
                className="px-4 py-2 bg-black text-white rounded-full text-xs font-medium disabled:opacity-40 flex items-center gap-2 hover:bg-gray-800 transition-all"
              >
                <Download size={12} />
                {selectedUser
                  ? `Export for ${selectedUser}`
                  : "Select a user first"}
              </button>
              <button
                onClick={() => exportAcceptedPdfs("all")}
                disabled={exporting}
                className="px-4 py-2 bg-gray-800 text-white rounded-full text-xs font-medium disabled:opacity-40 flex items-center gap-2 hover:bg-gray-700 transition-all"
              >
                <Download size={12} />
                Export All Users
              </button>
            </div>
          </div>

          {/* PDF List */}
          {loading ? (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-16 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-black mb-4"></div>
              <div className="text-sm text-gray-500 font-medium">
                Loading PDFs...
              </div>
            </div>
          ) : filteredPdfs.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-16 text-center">
              <FileText size={48} className="text-gray-300 mx-auto mb-4" />
              <p className="text-sm font-medium text-gray-600 mb-1">
                No documents found
              </p>
              <p className="text-xs text-gray-400">
                Try adjusting your filters or search query
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPdfs.map((item) => (
                <div
                  key={item.id}
                  className="bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md transition-all"
                >
                  <div className="flex gap-6">
                    {/* Left: Checkbox & Info */}
                    <div className="flex-1">
                      <div className="flex items-start gap-3 mb-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="w-4 h-4 mt-0.5"
                        />
                        <div className="flex-1">
                          <div className="flex items-center flex-wrap gap-2 mb-2">
                            <FileText size={16} className="text-gray-400" />
                            <h3 className="text-sm font-bold text-black">
                              {item.original_name}
                            </h3>
                            {getStatusBadge(item)}
                            {item.language && getLanguageBadge(item.language)}
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            <div>
                              <span className="text-gray-500 font-medium">
                                Uploaded by:
                              </span>{" "}
                              <span className="font-semibold text-black">
                                {item.uploaded_by}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500 font-medium">
                                Uploaded at:
                              </span>{" "}
                              <span className="text-gray-700">
                                {new Date(item.uploaded_at).toLocaleString()}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500 font-medium">
                                Assigned to:
                              </span>{" "}
                              <span className="font-semibold text-black">
                                {item.assigned_to || "—"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {item.feedback && (
                        <div className="ml-7 p-3 bg-red-50 border border-red-200 rounded-xl">
                          <p className="text-xs text-red-700">
                            <span className="font-bold">Feedback:</span>{" "}
                            {item.feedback}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-col gap-2.5 min-w-[220px]">
                      <button
                        onClick={() => viewPdf(item.id)}
                        disabled={!!actionLoading[item.id]}
                        className="flex items-center  justify-center gap-2 text-xs text-black hover:text-gray-600 font-medium py-2 px-4 bg-gray-50 rounded-full hover:bg-gray-100 transition-all disabled:opacity-50"
                      >
                        <Download size={12} />
                        {actionLoading[item.id]
                          ? "Opening..."
                          : "View Document"}
                      </button>
                      <select
                        value={item.assigned_to || ""}
                        onChange={(e) => assign(item.id, e.target.value)}
                        disabled={actionLoading[item.id]}
                        className="w-full px-3 py-2 bg-white text-gray-600 border border-gray-200 rounded-full text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50"
                      >
                        <option value="">Assign to QC...</option>
                        {qcs.map((q) => (
                          <option key={q.user_id} value={q.username}>
                            {q.username} ({q.name})
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          onClick={() => adminSetStatus(item.id, "Accepted")}
                          disabled={
                            actionLoading[item.id] || item.status === "Accepted"
                          }
                          className="flex-1 px-3 py-2 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 disabled:opacity-40 text-xs font-medium transition-all"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => {
                            const r = prompt(
                              "Rejection reason (optional):",
                              ""
                            );
                            if (r !== null)
                              adminSetStatus(item.id, "Rejected", r);
                          }}
                          disabled={
                            actionLoading[item.id] || item.status === "Rejected"
                          }
                          className="flex-1 px-3 py-2 bg-red-500 text-white rounded-full hover:bg-red-600 disabled:opacity-40 text-xs font-medium transition-all"
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