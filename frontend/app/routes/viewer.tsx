// Viewer.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
interface DataItem {
  link?: string;
  Link?: string;
  Status?: string;
  Feedback?: string;
  "Verified By"?: string;
  verified_by?: string;
  [key: string]: any;
}
const API_URL = (import.meta.env.VITE_API_URL as string) || "http://13.201.123.132:3000";
export default function Viewer() {
  const [data, setData] = useState<DataItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<string>("");
  const [noSession, setNoSession] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);
  const [sessionChecking, setSessionChecking] = useState<boolean>(true);
  const [token, setToken] = useState<string | null>(null);
  const [verifierFilter, setVerifierFilter] = useState<string>("");
  const [activeVerifier, setActiveVerifier] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState<boolean>(false);
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({}); // keyed by link
  const itemsPerPage = 5;
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof window !== "undefined") {
      const t = window.localStorage.getItem("review_token");
      setToken(t);
    }
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const buildHeaders = (tokenFromStorage?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const t =
      tokenFromStorage ??
      token ??
      (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);
    if (t) headers["X-Session-Token"] = t;
    return headers;
  };
  const checkSession = async () => {
    if (typeof window === "undefined") {
      setSessionChecking(false);
      setLoading(false);
      return;
    }
    const currentToken = window.localStorage.getItem("review_token");
    if (!currentToken) {
      setNoSession(true);
      setSessionChecking(false);
      setLoading(false);
      setToken(null);
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/session-check`, {
        credentials: "omit",
        headers: buildHeaders(currentToken),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.hasSession) {
        setNoSession(false);
        setToken(currentToken);
        const items = await fetchData();
        setData(items);
      } else {
        window.localStorage.removeItem("review_token");
        setToken(null);
        setNoSession(true);
        setData([]);
      }
    } catch (error) {
      console.error("Session check failed:", error);
      setNoSession(true);
      setData([]);
    } finally {
      setSessionChecking(false);
      setLoading(false);
    }
  };
  const fetchData = async (verifierParam?: string | null): Promise<DataItem[]> => {
    try {
      const currentToken =
        token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);
      if (!currentToken) {
        setNoSession(true);
        return [];
      }
      const url = new URL(`${API_URL}/api/data`);
      if (verifierParam) url.searchParams.set("verifier", verifierParam);
      const response = await fetch(url.toString(), {
        credentials: "omit",
        headers: buildHeaders(currentToken),
      });
      if (response.status === 401) {
        if (typeof window !== "undefined") window.localStorage.removeItem("review_token");
        setToken(null);
        setNoSession(true);
        setData([]);
        setMessage("❌ Session expired. Please upload CSV again.");
        setTimeout(() => setMessage(""), 3000);
        return [];
      }
      const result = await response.json().catch(() => ({}));
      const items = Array.isArray(result.data) ? result.data : [];
      const normalized: DataItem[] = items.map((it: any) => {
        const link = (it.link ?? it.Link ?? it.URL ?? "").toString().trim();
        const verified = it["Verified By"] ?? it.verified_by ?? it.Verified ?? it["VerifiedBy"] ?? "";
        const status = it.Status ?? it.status ?? "";
        const feedback = it.Feedback ?? it.feedback ?? "";
        return {
          ...it,
          link,
          "Verified By": verified,
          Status: status,
          Feedback: feedback,
        };
      });
      return normalized;
    } catch (error) {
      console.error("Failed to fetch data:", error);
      setMessage("❌ Failed to connect to server");
      setTimeout(() => setMessage(""), 3000);
      return [];
    }
  };
  const totalPages = Math.max(1, Math.ceil(data.length / itemsPerPage));
  // IMPORTANT: update now uses link (unique) to identify row on server
  const updateStatus = async (link: string, status: string, providedFeedback = "") => {
    const currentToken =
      token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);
    if (!currentToken) {
      setMessage("❌ No active session/token. Please upload CSV again.");
      setTimeout(() => setMessage(""), 2500);
      return;
    }
    try {
      const body = {
        link,
        status,
        feedback: status === "Rejected" ? providedFeedback : "",
      };
      const response = await fetch(`${API_URL}/api/update-status`, {
        method: "POST",
        headers: buildHeaders(currentToken),
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        setMessage("❌ Session expired. Please upload CSV again.");
        if (typeof window !== "undefined") window.localStorage.removeItem("review_token");
        setToken(null);
        setNoSession(true);
        setTimeout(() => setMessage(""), 3000);
        return;
      }
      if (response.ok) {
        setMessage(`✅ Marked ${link} as ${status}`);
        setTimeout(() => setMessage(""), 1800);
        // update local data by link (so UI stays in sync)
        setData((prev) =>
          prev.map((item) =>
            (item.link ?? "").toString().trim() === link
              ? {
                  ...item,
                  Status: status,
                  Feedback: status === "Rejected" ? providedFeedback || item?.Feedback : item?.Feedback,
                }
              : item
          )
        );
        // clear feedback buffer for this link
        setFeedbacks((prev) => {
          const copy = { ...prev };
          delete copy[link];
          return copy;
        });
      } else {
        const err = await response.json().catch(() => ({}));
        setMessage(`❌ Update failed: ${err.error || response.statusText}`);
      }
    } catch (error) {
      console.error("Failed to update status:", error);
      setMessage("❌ Update failed (network error)");
    }
  };
  const handleAccept = (link: string) => updateStatus(link, "Accepted");
  const handleReject = (link: string) => updateStatus(link, "Rejected", feedbacks[link] || "");
  const handleFeedbackChange = (link: string, value: string) =>
    setFeedbacks((prev) => ({ ...prev, [link]: value }));
  const handlePrevPage = () => setPage((p) => Math.max(0, p - 1));
  const handleNextPage = () => setPage((p) => Math.min(totalPages - 1, p + 1));
  const handleExport = async () => {
    const currentToken =
      token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);
    if (!currentToken) {
      setMessage("❌ No active session/token. Please upload CSV again.");
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/download`, {
        credentials: "omit",
        headers: currentToken ? { "X-Session-Token": currentToken } : undefined,
      });
      if (response.status === 401) {
        setMessage("❌ Session expired. Please upload CSV again.");
        if (typeof window !== "undefined") window.localStorage.removeItem("review_token");
        setToken(null);
        setNoSession(true);
        return;
      }
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "reviewed_results.csv";
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        const err = await response.json().catch(() => ({}));
        setMessage(`❌ Download failed: ${err.error || response.statusText}`);
      }
    } catch (error) {
      console.error("Download failed:", error);
      setMessage("❌ Download failed (network error)");
    }
  };
  const applyVerifierFilter = async () => {
    if (!verifierFilter || verifierFilter.trim() === "") {
      setMessage("Enter a name to filter by Verified By");
      setTimeout(() => setMessage(""), 2000);
      return;
    }
    const name = verifierFilter.trim();
    setActiveVerifier(name);
    setPage(0);
    const items = await fetchData(name);
    const filtered = pendingOnly
      ? items.filter((it) => {
          const s = (it.Status ?? "").toString().trim().toLowerCase();
          return s === "" || s === "pending";
        })
      : items;
    setData(filtered);
  };
  const clearVerifierFilter = async () => {
    setVerifierFilter("");
    setActiveVerifier(null);
    setPendingOnly(false);
    setPage(0);
    const items = await fetchData(null);
    setData(items);
    setFeedbacks({});
  };
  const togglePendingOnly = async (checked: boolean) => {
    setPendingOnly(checked);
    setPage(0);
    // re-apply filter (with or without active verifier)
    if (activeVerifier) {
      const items = await fetchData(activeVerifier);
      const filtered = checked
        ? items.filter((it) => {
            const s = (it.Status ?? "").toString().trim().toLowerCase();
            return s === "" || s === "pending";
          })
        : items;
      setData(filtered);
    } else {
      const items = await fetchData(null);
      const filtered = checked
        ? items.filter((it) => {
            const s = (it.Status ?? "").toString().trim().toLowerCase();
            return s === "" || s === "pending";
          })
        : items;
      setData(filtered);
    }
  };
  if (loading || sessionChecking) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-700 border-t-white mb-4"></div>
          <div className="text-xl font-medium text-white mb-2">Loading your session</div>
          <div className="text-sm text-gray-500">Please wait...</div>
        </div>
      </div>
    );
  }
  if (!token || data.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mb-8">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-3xl font-bold mb-3 text-white">
              {noSession ? "No Active Session" : "No Data Available"}
            </h2>
            <p className="text-gray-400 text-lg">
              {noSession 
                ? "Your session has expired or you haven't uploaded a CSV yet." 
                : "Upload a CSV file to begin reviewing PDFs."}
            </p>
          </div>
          <div className="flex justify-center gap-3">
            <button 
              type="button" 
              onClick={() => navigate("/dashboard")} 
              className="px-6 py-3 bg-white text-black rounded-lg hover:bg-gray-200 transition-all font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              Go to Dashboard
            </button>
            {token && (
              <button 
                type="button" 
                onClick={() => { 
                  if (typeof window !== "undefined") window.localStorage.removeItem("review_token"); 
                  setToken(null); 
                  setNoSession(true); 
                }} 
                className="px-6 py-3 border-2 border-gray-600 text-white rounded-lg hover:bg-gray-900 transition-all font-semibold"
              >
                Clear Session
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  const start = page * itemsPerPage;
  const end = Math.min(start + itemsPerPage, data.length);
  const pageItems = data.slice(start, end);
  return (
    <div className="min-h-screen bg-black p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">PDF Review Dashboard</h1>
              <p className="text-gray-400 text-sm">Reviewing {itemsPerPage} items per page</p>
            </div>
            
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <button 
                type="button" 
                onClick={() => navigate("/dashboard")} 
                className="px-4 py-2.5 border-2 border-gray-700 text-white rounded-lg hover:bg-gray-900 transition-all font-medium"
              >
                ← Dashboard
              </button>
              <button 
                type="button" 
                onClick={handleExport} 
                className="px-4 py-2.5 bg-white text-black rounded-lg hover:bg-gray-200 transition-all font-medium shadow-lg"
              >
                📤 Export CSV
              </button>
            </div>
          </div>
        </div>

        {/* Filter Section */}
        <div className="bg-gray-950 border-2 border-gray-800 rounded-xl p-5 mb-6">
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-end">
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-300 mb-2">Filter by Verifier</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={verifierFilter} 
                  onChange={(e) => setVerifierFilter(e.target.value)} 
                  placeholder="Enter verifier name (e.g., Arun)" 
                  className="flex-1 px-4 py-2.5 rounded-lg bg-black text-white border-2 border-gray-700 focus:border-white focus:outline-none transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && applyVerifierFilter()}
                />
                <button 
                  onClick={applyVerifierFilter} 
                  className="px-5 py-2.5 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-all"
                >
                  Apply
                </button>
                <button 
                  onClick={clearVerifierFilter} 
                  className="px-5 py-2.5 border-2 border-gray-700 text-white rounded-lg hover:bg-gray-900 transition-all font-semibold"
                >
                  Clear
                </button>
              </div>
            </div>
            
            <div className="flex items-center gap-3 pb-1">
              <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                <input 
                  type="checkbox" 
                  checked={pendingOnly} 
                  onChange={(e) => togglePendingOnly(e.target.checked)} 
                  className="w-5 h-5 rounded border-2 border-gray-600 bg-black checked:bg-white checked:border-white cursor-pointer transition-all"
                />
                <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                  Pending Only
                </span>
              </label>
            </div>
          </div>

          {activeVerifier && (
            <div className="mt-4 pt-4 border-t-2 border-gray-800">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-300">
                  Filtering by: <span className="font-semibold text-white">{activeVerifier}</span>
                  {pendingOnly && <span className="ml-2 px-2 py-1 bg-yellow-500/10 text-yellow-400 rounded text-xs font-medium">Pending Only</span>}
                </div>
                <button 
                  onClick={clearVerifierFilter} 
                  className="text-sm text-gray-400 hover:text-white underline transition-colors"
                >
                  Clear filter
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Message Alert */}
        {message && (
          <div className="mb-6 p-4 bg-gray-950 border-2 border-gray-700 rounded-lg text-sm text-white font-medium animate-pulse">
            {message}
          </div>
        )}

        {/* PDF Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
          {pageItems.map((item) => {
            const link = (item.link ?? item.Link ?? "").toString().trim();
            const idx = data.findIndex((d) => (d.link ?? "").toString().trim() === link);
            const absoluteIndex = idx;
            const viewerSrc = `https://docs.google.com/gview?url=${encodeURIComponent(link)}&embedded=true`;
            const verifierName = item["Verified By"] ?? "";
            const currentStatus = item.Status || "";
            const isAccepted = currentStatus === "Accepted";
            const isRejected = currentStatus === "Rejected";
            const isPending = !currentStatus || currentStatus.toLowerCase() === "pending";
            
            return (
              <div 
                key={link || absoluteIndex} 
                className="bg-gray-950 border-2 border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-all shadow-xl"
              >
                {/* Card Header */}
                <div className="p-4 border-b-2 border-gray-800 flex items-center justify-between bg-black">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-white">#{absoluteIndex + 1}</span>
                    {verifierName && (
                      <span className="text-xs text-gray-400 font-medium">
                        by {verifierName}
                      </span>
                    )}
                  </div>
                  <div className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${
                    isAccepted 
                      ? "bg-white text-black" 
                      : isRejected 
                        ? "bg-gray-800 text-white border-2 border-gray-600" 
                        : "bg-gray-900 text-gray-500 border-2 border-gray-800"
                  }`}>
                    {currentStatus || "Pending"}
                  </div>
                </div>

                {/* PDF Preview */}
                <div className="relative bg-white" style={{ height: '240px' }}>
                  <iframe 
                    src={viewerSrc} 
                    className="w-full h-full border-0" 
                    title={`PDF ${absoluteIndex + 1}`} 
                    loading="lazy" 
                  />
                  <div className="absolute bottom-2 right-2">
                    <a 
                      href={link} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="px-3 py-1.5 bg-black text-white text-xs font-semibold rounded-lg hover:bg-gray-900 transition-all shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open PDF ↗
                    </a>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="p-4 space-y-3">
                  <div className="flex gap-2">
                    <button 
                      type="button" 
                      onClick={() => handleAccept(link)} 
                      className={`flex-1 px-4 py-3 rounded-lg font-bold transition-all transform hover:scale-105 ${
                        isAccepted
                          ? "bg-white text-black shadow-lg ring-2 ring-white ring-offset-2 ring-offset-black"
                          : "bg-gray-900 text-white border-2 border-gray-700 hover:bg-white hover:text-black"
                      }`}
                    >
                      {isAccepted ? "✓ Accepted" : "Accept"}
                    </button>
                    <button 
                      type="button" 
                      onClick={() => handleReject(link)} 
                      className={`flex-1 px-4 py-3 rounded-lg font-bold transition-all transform hover:scale-105 ${
                        isRejected
                          ? "bg-gray-800 text-white border-2 border-white shadow-lg"
                          : "bg-gray-900 text-white border-2 border-gray-700 hover:border-white"
                      }`}
                    >
                      {isRejected ? "✗ Rejected" : "Reject"}
                    </button>
                  </div>

                  {/* Feedback Section */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                      Rejection Reason
                    </label>
                    <textarea 
                      value={feedbacks[link] || ""} 
                      onChange={(e) => handleFeedbackChange(link, e.target.value)} 
                      className="w-full px-3 py-2.5 bg-black border-2 border-gray-800 text-white rounded-lg focus:border-gray-600 focus:outline-none text-sm placeholder-gray-600 resize-none transition-colors"
                      rows={2} 
                      placeholder={item.Feedback ? `Current: ${item.Feedback}` : "Optional: Provide reason for rejection..."}
                    />
                    {item.Feedback && !feedbacks[link] && (
                      <div className="mt-2 text-xs text-gray-500 p-2 bg-gray-900 rounded border border-gray-800">
                        <span className="font-semibold">Saved feedback:</span> {item.Feedback}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-950 border-2 border-gray-800 rounded-xl p-5">
          <div className="text-sm text-gray-400 font-medium">
            Page <span className="text-white font-bold">{page + 1}</span> of <span className="text-white font-bold">{Math.max(1, totalPages)}</span>
          </div>
          <div className="flex gap-2">
            <button 
              type="button" 
              onClick={handlePrevPage} 
              disabled={page === 0} 
              className="px-5 py-2.5 border-2 border-gray-700 text-white rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-900 transition-all font-semibold"
            >
              ← Previous
            </button>
            <button 
              type="button" 
              onClick={handleNextPage} 
              disabled={page >= totalPages - 1} 
              className="px-5 py-2.5 border-2 border-gray-700 text-white rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-900 transition-all font-semibold"
            >
              Next →
            </button>
          </div>
        </div>

        {/* Statistics */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-950 border-2 border-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white mb-1">{data.length}</div>
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Total Items</div>
          </div>
          <div className="bg-gray-950 border-2 border-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white mb-1">
              {data.filter((d) => (d.Status ?? "") === "Accepted").length}
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Accepted</div>
          </div>
          <div className="bg-gray-950 border-2 border-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white mb-1">
              {data.filter((d) => (d.Status ?? "") === "Rejected").length}
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Rejected</div>
          </div>
          <div className="bg-gray-950 border-2 border-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white mb-1">
              {data.filter((d) => { 
                const s = (d.Status ?? "").toString().trim().toLowerCase(); 
                return s === "" || s === "pending"; 
              }).length}
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Pending</div>
          </div>
        </div>
      </div>
    </div>
  );
}