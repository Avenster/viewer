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

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://13.201.123.132:5000";

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
        <div className="text-center text-white">
          <div className="text-xl mb-2">Loading...</div>
          <div className="text-sm text-gray-400">Verifying session...</div>
        </div>
      </div>
    );
  }

  if (!token || data.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-lg text-center">
          <h2 className="text-2xl font-semibold mb-2 text-white">{noSession ? "No active review session" : "No data found"}</h2>
          <p className="text-gray-400 mb-6">{noSession ? "Your session has expired or you haven't uploaded a CSV yet." : "Upload a CSV file to begin reviewing PDFs."}</p>
          <div className="flex justify-center gap-4">
            <button type="button" onClick={() => navigate("/")} className="px-6 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors">Upload CSV</button>
            {token && (
              <button type="button" onClick={() => { if (typeof window !== "undefined") window.localStorage.removeItem("review_token"); setToken(null); setNoSession(true); }} className="px-6 py-2 border border-gray-600 text-white rounded-lg hover:bg-gray-900 transition-colors">Clear Session</button>
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
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 gap-4">
          <h2 className="text-2xl font-semibold text-white">PDF Reviewer — Grid (5 per page)</h2>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch">
            <div className="flex items-center gap-2">
              <input type="text" value={verifierFilter} onChange={(e) => setVerifierFilter(e.target.value)} placeholder="Filter by Verified By (e.g. Arun)" className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm border border-gray-700 focus:outline-none" />
              <button onClick={applyVerifierFilter} className="px-3 py-2 bg-white text-black rounded-lg text-sm hover:bg-gray-200">Apply</button>
              <button onClick={clearVerifierFilter} className="px-3 py-2 border border-gray-700 text-white rounded-lg text-sm hover:bg-gray-900">Clear</button>
            </div>

            <div className="flex items-center gap-2 ml-2">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={pendingOnly} onChange={(e) => togglePendingOnly(e.target.checked)} className="w-4 h-4" />
                <span className="text-sm">Only pending</span>
              </label>
            </div>

            <div className="flex gap-2 ml-0 md:ml-4">
              <button type="button" onClick={() => navigate("/")} className="px-3 py-2 border border-gray-700 text-white rounded-lg text-sm hover:bg-gray-900 transition-colors">← Back</button>
              <button type="button" onClick={handleExport} className="px-3 py-2 border border-gray-700 text-white rounded-lg text-sm hover:bg-gray-900 transition-colors">📤 Export</button>
            </div>
          </div>
        </div>

        {activeVerifier && (
          <div className="mb-4 text-sm text-gray-300">
            Showing results for <span className="font-medium text-white">{activeVerifier}</span>{pendingOnly && <span className="ml-2 text-yellow-300"> (only pending)</span>}.{" "}
            <button onClick={clearVerifierFilter} className="underline text-blue-300">Clear filter</button>
          </div>
        )}

        {message && <div className="text-sm text-green-400 p-2 bg-gray-900 rounded mb-4">{message}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pageItems.map((item) => {
            const link = (item.link ?? item.Link ?? "").toString().trim();
            const idx = data.findIndex((d) => (d.link ?? "").toString().trim() === link);
            const absoluteIndex = idx; // absolute index is position in current data array
            const viewerSrc = `https://docs.google.com/gview?url=${encodeURIComponent(link)}&embedded=true`;
            const verifierName = item["Verified By"] ?? "";

            return (
              <div key={link || absoluteIndex} className="bg-black border border-gray-700 rounded-lg p-3">
                <div className="text-sm text-gray-300 mb-2 flex items-center justify-between">
                  <div>#{absoluteIndex + 1}</div>
                  <div className="text-xs flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs ${item.Status === "Accepted" ? "bg-green-900 text-green-300" : item.Status === "Rejected" ? "bg-red-900 text-red-300" : "bg-gray-800 text-gray-400"}`}>
                      {item.Status || "Pending"}
                    </span>
                  </div>
                </div>

                <div className="h-48 bg-white rounded overflow-hidden mb-3">
                  <iframe src={viewerSrc} className="w-full h-full border-0" title={`PDF ${absoluteIndex + 1}`} loading="lazy" />
                </div>

                <div className="mb-2 text-xs">
                  <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-300 underline break-all" onClick={(e) => e.stopPropagation()}>
                    Open original PDF (external)
                  </a>
                </div>

                {verifierName && <div className="mb-2 text-xs text-gray-400">Verified By: <span className="text-white">{verifierName}</span></div>}

                <div className="flex gap-2 mb-2">
                  <button type="button" onClick={() => handleAccept(link)} className="flex-1 px-3 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors font-medium">✅ Accept</button>
                  <button type="button" onClick={() => handleReject(link)} className="flex-1 px-3 py-2 border border-gray-700 text-white rounded-lg hover:bg-gray-900 transition-colors font-medium">❌ Reject</button>
                </div>

                <div>
                  <label className="block text-xs text-white mb-1">Rejection Reason (optional)</label>
                  <textarea value={feedbacks[link] || ""} onChange={(e) => handleFeedbackChange(link, e.target.value)} className="w-full px-2 py-1 bg-black border border-gray-700 text-white rounded-lg focus:outline-none text-sm placeholder-gray-500" rows={2} placeholder={item.Feedback ? `Current: ${item.Feedback}` : "Enter reason for rejection (optional)"} />
                  {item.Feedback && !feedbacks[link] && <div className="mt-2 text-xs text-gray-400 p-1 bg-gray-900 rounded">Saved: {item.Feedback}</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-gray-400">Page {page + 1} of {Math.max(1, totalPages)}</div>
          <div className="flex gap-2">
            <button type="button" onClick={handlePrevPage} disabled={page === 0} className="px-3 py-2 border border-gray-700 text-white rounded-lg disabled:opacity-40">← Prev</button>
            <button type="button" onClick={handleNextPage} disabled={page >= totalPages - 1} className="px-3 py-2 border border-gray-700 text-white rounded-lg disabled:opacity-40">Next →</button>
          </div>
        </div>

        <div className="mt-4 text-gray-400 text-sm">
          Total: {data.length} items | Accepted: {data.filter((d) => (d.Status ?? "") === "Accepted").length} | Rejected: {data.filter((d) => (d.Status ?? "") === "Rejected").length} | Pending: {data.filter((d) => { const s = (d.Status ?? "").toString().trim().toLowerCase(); return s === "" || s === "pending"; }).length}
        </div>
      </div>
    </div>
  );
}
