// QcDashboardInlinePreview.tsx
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";
import { Home, LogOut, RefreshCw, FileText, CheckCircle, XCircle, Clock, AlertCircle, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://13.201.123.132:5000";

const getLocalStorage = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch (e) { console.error(e); return null; }
};
const removeLocalStorage = (key: string): void => {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(key); } catch (e) { console.error(e); }
};
function pickTokenFromStorage() {
  const qcToken = getLocalStorage("auth_token_qc");
  if (qcToken) return qcToken;
  const generic = getLocalStorage("auth_token");
  if (generic) return generic;
  if (typeof window !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (k.startsWith("auth_token_")) {
        const v = getLocalStorage(k);
        if (v) return v;
      }
    }
  }
  return null;
}

type RejectModalState = {
  open: boolean;
  pdfId: string | null;
  initialReason?: string;
};

export default function QcDashboardInlinePreview() {
  const { user, authToken: ctxAuthToken, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [tokenToUse, setTokenToUse] = useState<string | null>(null);

  // preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [rejectFeedbacks, setRejectFeedbacks] = useState<Record<string, string>>({});
  const previewUrlRef = useRef<string | null>(null);

  // modal for rejection reason
  const [rejectModal, setRejectModal] = useState<RejectModalState>({ open: false, pdfId: null, initialReason: "" });

  // initialize token
  useEffect(() => {
    const token = ctxAuthToken || pickTokenFromStorage();
    setTokenToUse(token);
  }, [ctxAuthToken]);

  useEffect(() => {
    if (tokenToUse === null) return;
    if (!isAuthenticated && !tokenToUse) {
      navigate("/qc-login");
      return;
    }
    fetchTasks();
    return () => {
      if (previewUrlRef.current) {
        try { URL.revokeObjectURL(previewUrlRef.current); } catch (e) {}
        previewUrlRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, [isAuthenticated, tokenToUse]);

  async function fetchTasks() {
    if (!tokenToUse) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/qc/tasks`, {
        headers: { "X-Auth-Token": tokenToUse }
      });
      if (res.status === 401) {
        removeLocalStorage("auth_token_qc");
        await logout();
        navigate("/qc-login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) setTasks(data.items || []);
      else setMessage(`❌ ${data.error || res.statusText}`);
    } catch (e) {
      console.error(e);
      setMessage("❌ Failed to fetch");
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 2500);
    }
  }

  async function setStatus(pdfId: string, status: "Accepted" | "Rejected", feedback = "") {
    if (!tokenToUse) return;
    setActionLoading((s) => ({ ...s, [pdfId]: true }));
    try {
      const res = await fetch(`${API_URL}/api/qc/${pdfId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": tokenToUse },
        body: JSON.stringify({ status, feedback })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage("✅ Status saved");
        setTasks((prev) => prev.map((t) => (t.id === pdfId ? { ...t, status: status, feedback: status === "Rejected" ? feedback : "" } : t)));
        fetchTasks();
      } else {
        setMessage(`❌ ${data.error || res.statusText}`);
      }
    } catch (e) {
      console.error(e);
      setMessage("❌ Failed to save status");
    } finally {
      setActionLoading((s) => ({ ...s, [pdfId]: false }));
      setTimeout(() => setMessage(null), 2500);
    }
  }

  const handleLogout = async () => {
    removeLocalStorage("auth_token_qc");
    await logout();
    navigate("/qc-login");
  };

  async function viewPdfInlineByIndex(idx: number) {
    if (!tokenToUse) {
      setMessage("❌ No auth token available");
      return;
    }
    if (!tasks || !tasks[idx]) return;
    const pdfId = tasks[idx].id;
    setPreviewLoading(true);
    setActionLoading((s) => ({ ...s, [pdfId]: true }));
    let blobUrl: string | null = null;
    try {
      const res = await fetch(`${API_URL}/api/global-pdfs/${pdfId}?preview=1`, {
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
        const body = await res.text().catch(() => "");
        setMessage(`❌ Failed to fetch PDF: ${res.status} ${body || res.statusText}`);
        return;
      }

      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);

      if (previewUrlRef.current) {
        try { URL.revokeObjectURL(previewUrlRef.current); } catch (e) {}
      }

      previewUrlRef.current = blobUrl;
      setPreviewUrl(blobUrl);
      setPreviewingId(pdfId);

      setTimeout(() => {
        if (previewUrlRef.current === blobUrl) {
          try { URL.revokeObjectURL(blobUrl); previewUrlRef.current = null; setPreviewUrl(null); setPreviewingId(null); } catch (e) {}
        }
      }, 1000 * 120);
    } catch (err) {
      console.error("viewPdfInline error:", err);
      setMessage("❌ Error loading PDF");
      if (blobUrl) try { URL.revokeObjectURL(blobUrl); } catch (e) {}
    } finally {
      setPreviewLoading(false);
      setActionLoading((s) => ({ ...s, [pdfId]: false }));
      setTimeout(() => setMessage(null), 2500);
    }
  }

  const viewPdfInline = (pdfId: string) => {
    const idx = tasks.findIndex((t) => t.id === pdfId);
    if (idx === -1) return;
    viewPdfInlineByIndex(idx);
  };

  const clearPreview = () => {
    if (previewUrlRef.current) {
      try { URL.revokeObjectURL(previewUrlRef.current); } catch (e) {}
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewingId(null);
  };

  const currentIndex = previewingId ? tasks.findIndex((t) => t.id === previewingId) : -1;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < tasks.length - 1;

  const goPrev = () => {
    if (!canPrev) return;
    viewPdfInlineByIndex(currentIndex - 1);
  };
  const goNext = () => {
    if (!canNext) return;
    viewPdfInlineByIndex(currentIndex + 1);
  };

  const openRejectModal = (pdfId: string) => {
    setRejectModal({ open: true, pdfId, initialReason: rejectFeedbacks[pdfId] || "" });
  };
  const closeRejectModal = () => setRejectModal({ open: false, pdfId: null, initialReason: "" });
  const submitRejectFromModal = async () => {
    const id = rejectModal.pdfId;
    if (!id) return;
    const reason = rejectFeedbacks[id] || "";
    await setStatus(id, "Rejected", reason);
    closeRejectModal();
  };

  const onTaskCardClick = (id: string) => {
    viewPdfInline(id);
  };

  const getStatusBadge = (item: any) => {
    if (item.status === "Accepted") return <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 text-xs font-medium rounded-full flex items-center gap-1.5"><CheckCircle size={12} /> Accepted</span>;
    if (item.status === "Rejected") return <span className="px-2.5 py-1 bg-red-500/10 text-red-600 text-xs font-medium rounded-full flex items-center gap-1.5"><XCircle size={12} /> Rejected</span>;
    return <span className="px-2.5 py-1 bg-gray-500/10 text-gray-600 text-xs font-medium rounded-full flex items-center gap-1.5"><Clock size={12} /> Pending</span>;
  };

  const currentTask = previewingId ? tasks.find(t => t.id === previewingId) : null;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="backdrop-blur-md bg-black/5 border-b border-black/10 sticky top-0 z-10">
        <div className="px-8 py-5">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-xl font-bold text-black">QC Dashboard</h1>
              <p className="text-xs text-gray-500 mt-1">{user?.username} • Quality Control</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => navigate("/home")}
                className="flex items-center gap-2 px-4 py-2 bg-white/50 border border-black/10 rounded-full text-sm font-medium text-black hover:bg-white/80 transition-all"
              >
                <Home size={14} />
                Home
              </button>
              <button 
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-all"
              >
                <LogOut size={14} />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="p-8">
        <div className="max-w-[1800px] mx-auto">
          {/* Message */}
          {message && (
            <div className={`mb-6 p-4 rounded-2xl backdrop-blur-md text-sm font-medium ${
              message.includes('❌') ? 'bg-red-500/10 text-red-600 border border-red-500/20' : 
              'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
            }`}>
              {message}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Task List */}
            <div className="col-span-1">
              <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-5">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-bold text-black">Assigned Tasks</h2>
                  <button 
                    onClick={fetchTasks}
                    className="flex items-center gap-1.5 text-xs text-black hover:text-gray-600 font-medium transition-colors"
                  >
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                    Refresh
                  </button>
                </div>

                <div className="space-y-3 max-h-[calc(100vh-250px)] overflow-auto">
                  {loading ? (
                    <div className="text-center py-8">
                      <RefreshCw size={24} className="animate-spin text-gray-400 mx-auto mb-2" />
                      <div className="text-xs text-gray-500">Loading tasks...</div>
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText size={32} className="text-gray-300 mx-auto mb-2" />
                      <div className="text-xs text-gray-500">No tasks assigned</div>
                    </div>
                  ) : (
                    tasks.map((t) => (
                      <div
                        key={t.id}
                        className={`backdrop-blur-md bg-white/50 border rounded-xl p-4 cursor-pointer transition-all hover:bg-white/80 ${
                          previewingId === t.id ? 'border-black bg-white/80' : 'border-black/10'
                        }`}
                        onClick={() => onTaskCardClick(t.id)}
                      >
                        <div className="flex items-start gap-2 mb-3">
                          <FileText size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm text-black truncate">{t.original_name}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              by {t.uploaded_by}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mb-3">
                          {getStatusBadge(t)}
                          <button
                            onClick={(e) => { e.stopPropagation(); viewPdfInline(t.id); }}
                            disabled={!!actionLoading[t.id]}
                            className="text-xs text-black hover:text-gray-600 font-medium transition-colors"
                          >
                            {actionLoading[t.id] ? "Opening..." : "Preview"}
                          </button>
                        </div>

                        {t.feedback && (
                          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <p className="text-xs text-red-600 line-clamp-2">{t.feedback}</p>
                          </div>
                        )}

                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); setStatus(t.id, "Accepted"); }}
                            disabled={!!actionLoading[t.id] || t.status === "Accepted"}
                            className="flex-1 px-3 py-1.5 bg-emerald-500 text-white rounded-full text-xs font-medium hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          >
                            Accept
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); openRejectModal(t.id); }}
                            disabled={!!actionLoading[t.id] || t.status === "Rejected"}
                            className="flex-1 px-3 py-1.5 bg-red-500 text-white rounded-full text-xs font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right: Preview & Actions */}
            <div className="lg:col-span-2">
              <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl overflow-hidden">
                <div className="flex justify-between items-center p-5 border-b border-black/10">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-black">PDF Preview</h2>
                    {currentTask && getStatusBadge(currentTask)}
                  </div>
                  <button 
                    onClick={clearPreview}
                    className="text-xs text-black hover:text-gray-600 font-medium transition-colors"
                  >
                    Clear
                  </button>
                </div>

                {!previewUrl ? (
                  <div className="flex items-center justify-center p-12 min-h-[70vh]">
                    <div className="text-center">
                      {previewLoading ? (
                        <>
                          <RefreshCw size={40} className="animate-spin text-gray-400 mx-auto mb-3" />
                          <div className="text-sm text-gray-500">Loading preview...</div>
                        </>
                      ) : (
                        <>
                          <FileText size={40} className="text-gray-300 mx-auto mb-3" />
                          <div className="text-sm text-gray-500">Select a task to preview the PDF</div>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col lg:flex-row">
                    <div className="flex-1 bg-gray-50">
                      <iframe
                        title="PDF Preview"
                        src={previewUrl}
                        className="w-full h-[70vh] lg:h-[calc(100vh-200px)] border-0"
                      />
                    </div>

                    <div className="w-full lg:w-96 p-5 bg-white border-l border-black/10">
                      <div className="mb-4">
                        <div className="text-xs font-semibold text-black mb-1">Current File</div>
                        <div className="text-xs text-gray-500 font-mono break-all">{previewingId}</div>
                      </div>

                      <div className="flex gap-2 mb-4">
                        <button
                          onClick={goPrev}
                          disabled={!canPrev || previewLoading}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white/50 border border-black/10 rounded-xl text-sm font-medium text-black hover:bg-white/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          <ChevronLeft size={14} />
                          Previous
                        </button>
                        <button
                          onClick={goNext}
                          disabled={!canNext || previewLoading}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white/50 border border-black/10 rounded-xl text-sm font-medium text-black hover:bg-white/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          Next
                          <ChevronRight size={14} />
                        </button>
                      </div>

                      <div className="space-y-2 mb-4">
                        <button
                          onClick={() => previewingId && setStatus(previewingId, "Accepted")}
                          disabled={previewLoading || (previewingId ? !!actionLoading[previewingId] : true) || currentTask?.status === "Accepted"}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white rounded-xl font-semibold text-sm hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          <CheckCircle size={16} />
                          Accept PDF
                        </button>

                        <button
                          onClick={() => previewingId && openRejectModal(previewingId)}
                          disabled={previewLoading || (previewingId ? !!actionLoading[previewingId] : true) || currentTask?.status === "Rejected"}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-500 text-white rounded-xl font-semibold text-sm hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          <XCircle size={16} />
                          Reject PDF
                        </button>
                      </div>

                      <div className="mb-4">
                        <label className="block text-xs font-semibold text-black mb-2">
                          Rejection Reason
                        </label>
                        <textarea
                          value={previewingId ? (rejectFeedbacks[previewingId] || "") : ""}
                          onChange={(e) => {
                            if (!previewingId) return;
                            const v = e.target.value;
                            setRejectFeedbacks((s) => ({ ...s, [previewingId]: v }));
                          }}
                          className="w-full min-h-[100px] px-3 py-2 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all resize-none"
                          placeholder="Enter reason for rejection (will be saved when you press Reject)"
                        />
                      </div>

                      <button
                        onClick={() => {
                          if (!previewingId || !previewUrl) return;
                          const open = window.open(previewUrl, "_blank");
                          if (!open) window.location.assign(previewUrl);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/50 border border-black/10 rounded-xl text-xs font-medium text-black hover:bg-white/80 transition-all"
                      >
                        <ExternalLink size={12} />
                        Open in New Tab
                      </button>

                      <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <p className="text-xs text-blue-600">
                          Preview loaded securely with your QC token. Auto-revokes after 2 minutes.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reject Modal */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg backdrop-blur-md bg-white border border-black/10 rounded-2xl shadow-2xl p-6">
            <h3 className="text-lg font-bold text-black mb-2">Reject PDF</h3>
            <p className="text-sm text-gray-500 mb-4">
              Provide a reason for rejection. This will be saved with the PDF and visible to the uploader.
            </p>
            <textarea
              value={(rejectModal.pdfId && rejectFeedbacks[rejectModal.pdfId]) || rejectModal.initialReason || ""}
              onChange={(e) => {
                const id = rejectModal.pdfId;
                if (!id) return;
                const v = e.target.value;
                setRejectFeedbacks((s) => ({ ...s, [id]: v }));
              }}
              className="w-full min-h-[120px] px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all resize-none mb-4"
              placeholder="Enter rejection reason..."
            />
            <div className="flex justify-end gap-2">
              <button 
                onClick={closeRejectModal}
                className="px-5 py-2.5 bg-white/50 border border-black/10 rounded-full text-sm font-medium text-black hover:bg-white/80 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={submitRejectFromModal}
                className="px-5 py-2.5 bg-red-500 text-white rounded-full text-sm font-medium hover:bg-red-600 transition-all"
              >
                Submit Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}