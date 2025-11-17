import React, { useEffect, useState, useCallback } from "react";
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
const ITEMS_PER_PAGE = 5;
const REVIEW_TOKEN_KEY = "review_token";
const DIAGNOSTICS = false; // set true to see raw debug info box

export default function Viewer() {
  const navigate = useNavigate();

  // Core state
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState<boolean>(false);
  const [data, setData] = useState<DataItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [checkingSession, setCheckingSession] = useState<boolean>(true);

  // UI / filters / messages
  const [message, setMessage] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const [verifierFilter, setVerifierFilter] = useState<string>("");
  const [activeVerifier, setActiveVerifier] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState<boolean>(false);
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});

  // Diagnostics
  const [lastFetchCount, setLastFetchCount] = useState<number>(0);
  const [lastRawResponse, setLastRawResponse] = useState<any>(null);

  // Utilities
  const buildHeaders = (tokenOverride?: string) => {
    const t = tokenOverride ?? sessionToken ?? localStorage.getItem(REVIEW_TOKEN_KEY);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (t) headers["X-Session-Token"] = t;
    return headers;
  };

  const setTransientMessage = (msg: string, ms = 2500) => {
    setMessage(msg);
    if (ms > 0) {
      setTimeout(() => setMessage(""), ms);
    }
  };

  // Load token from storage (initial + on storage events)
  useEffect(() => {
    const initialToken = localStorage.getItem(REVIEW_TOKEN_KEY);
    if (initialToken) {
      setSessionToken(initialToken);
    }
    // Listen for changes to review_token (e.g. other component sets it after upload)
    const onStorage = (e: StorageEvent) => {
      if (e.key === REVIEW_TOKEN_KEY) {
        setSessionToken(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Whenever sessionToken changes, re-check session & data
  useEffect(() => {
    if (!sessionToken) {
      // No token present
      setHasSession(false);
      setData([]);
      setLoading(false);
      setCheckingSession(false);
      return;
    }
    // With token, validate session
    (async () => {
      setCheckingSession(true);
      try {
        const res = await fetch(`${API_URL}/api/session-check`, {
          headers: buildHeaders(sessionToken),
        });
        const json = await res.json().catch(() => ({}));
        const valid = !!json?.hasSession;
        setHasSession(valid);
        if (valid) {
          await reloadData(); // fetch data right away
        } else {
          // invalid token -> clear
          localStorage.removeItem(REVIEW_TOKEN_KEY);
          setSessionToken(null);
          setData([]);
        }
      } catch (err) {
        console.error("[Viewer] Session check error:", err);
        setHasSession(false);
        setData([]);
      } finally {
        setCheckingSession(false);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  // Fetch data with optional verifier
  const fetchData = useCallback(
    async (verifierParam?: string | null): Promise<DataItem[]> => {
      if (!sessionToken) return [];
      try {
        const url = new URL(`${API_URL}/api/data`);
        if (verifierParam) url.searchParams.set("verifier", verifierParam);

        const response = await fetch(url.toString(), { headers: buildHeaders() });

        if (response.status === 401) {
            // invalid/expired (though backend sessions never expire unless token wrong)
          localStorage.removeItem(REVIEW_TOKEN_KEY);
          setSessionToken(null);
          setHasSession(false);
          setData([]);
          setTransientMessage("❌ Session invalid. Please upload again.", 3000);
          return [];
        }

        const result = await response.json().catch(() => ({}));
        setLastRawResponse(result);

        const items = Array.isArray(result.data) ? result.data : [];
        setLastFetchCount(items.length);

        const normalized = items
          .map((it: any) => {
            const rawLink = (it.link ?? it.Link ?? it.URL ?? "").toString().trim();
            if (!rawLink) return null; // skip empty
            const verified = it["Verified By"] ?? it.verified_by ?? it.Verified ?? it["VerifiedBy"] ?? "";
            const status = it.Status ?? it.status ?? "";
            const feedback = it.Feedback ?? it.feedback ?? "";
            return {
              ...it,
              link: rawLink,
              "Verified By": verified,
              Status: status,
              Feedback: feedback,
            };
          })
          .filter(Boolean) as DataItem[];

        return normalized;
      } catch (error) {
        console.error("[Viewer] fetchData error:", error);
        setTransientMessage("❌ Failed to connect to server", 3000);
        return [];
      }
    },
    [sessionToken]
  );

  const applyPendingFilter = (items: DataItem[]) =>
    pendingOnly
      ? items.filter((it) => {
          const s = (it.Status ?? "").toString().trim().toLowerCase();
          return s === "" || s === "pending";
        })
      : items;

  const reloadData = useCallback(
    async (verifier?: string | null) => {
      const items = await fetchData(verifier);
      const filtered = applyPendingFilter(items);
      setData(filtered);
      setPage(0);
    },
    [fetchData, pendingOnly]
  );

  // Filter handlers
  const applyVerifierFilter = async () => {
    const name = verifierFilter.trim();
    if (!name) {
      setTransientMessage("Enter a name to filter");
      return;
    }
    setActiveVerifier(name);
    await reloadData(name);
  };

  const clearVerifierFilter = async () => {
    setVerifierFilter("");
    setActiveVerifier(null);
    setPendingOnly(false);
    setFeedbacks({});
    await reloadData(null);
  };

  const togglePendingOnly = async (checked: boolean) => {
    setPendingOnly(checked);
    await reloadData(activeVerifier);
  };

  // Status update
  const updateStatus = async (link: string, status: string, providedFeedback = "") => {
    if (!sessionToken) {
      setTransientMessage("❌ No session token. Upload again.");
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
        headers: buildHeaders(),
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        localStorage.removeItem(REVIEW_TOKEN_KEY);
        setSessionToken(null);
        setHasSession(false);
        setData([]);
        setTransientMessage("❌ Session invalid. Upload again.", 3000);
        return;
      }

      if (response.ok) {
        setTransientMessage(`✅ Marked as ${status}`, 1800);
        setData((prev) =>
            prev.map((item) =>
              (item.link ?? "").toString().trim() === link
                ? {
                    ...item,
                    Status: status,
                    Feedback: status === "Rejected"
                      ? providedFeedback || item.Feedback
                      : item.Feedback,
                  }
                : item
            )
        );
        setFeedbacks((prev) => {
          const copy = { ...prev };
          delete copy[link];
          return copy;
        });
      } else {
        const err = await response.json().catch(() => ({}));
        setTransientMessage(`❌ Update failed: ${err.error || response.statusText}`, 3000);
      }
    } catch (e) {
      console.error("[Viewer] updateStatus error:", e);
      setTransientMessage("❌ Update failed (network)", 3000);
    }
  };

  const handleAccept = (link: string) => updateStatus(link, "Accepted");
  const handleReject = (link: string) => updateStatus(link, "Rejected", feedbacks[link] || "");
  const handleFeedbackChange = (link: string, v: string) =>
    setFeedbacks((prev) => ({ ...prev, [link]: v }));

  // Pagination
  const totalPages = Math.max(1, Math.ceil(data.length / ITEMS_PER_PAGE));
  const start = page * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, data.length);
  const pageItems = data.slice(start, end);

  const handlePrevPage = () => setPage((p) => Math.max(0, p - 1));
  const handleNextPage = () => setPage((p) => Math.min(totalPages - 1, p + 1));

  // Distinguish between “no session” vs “empty data”
  if (loading || checkingSession) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-700 border-t-white mb-4"></div>
          <div className="text-xl font-medium text-white mb-2">Loading session...</div>
          <div className="text-sm text-gray-500">Please wait</div>
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mb-8">
            <div className="text-6xl mb-4">🗂️</div>
            <h2 className="text-3xl font-bold mb-3 text-white">No Active Session</h2>
            <p className="text-gray-400 text-lg">
              Upload a CSV file (or request assignment) to start reviewing PDFs.
            </p>
          </div>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="px-6 py-3 bg-white text-black rounded-lg hover:bg-gray-200 transition-all font-semibold shadow-lg"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Session valid but zero rows:
  if (hasSession && data.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mb-8">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-3xl font-bold mb-3 text-white">Empty Session</h2>
            <p className="text-gray-400 text-lg">
              Your uploaded file has 0 unique PDFs after duplicate filtering or data hasn’t loaded.
            </p>
            <p className="text-gray-500 text-sm mt-2">
              Raw fetch count: {lastFetchCount}. If this seems wrong, re-upload or refresh.
            </p>
          </div>
          <div className="flex justify-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => reloadData(activeVerifier)}
              className="px-6 py-3 bg-white text-black rounded-lg hover:bg-gray-200 font-semibold"
            >
              🔄 Retry Load
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="px-6 py-3 border-2 border-gray-600 text-white rounded-lg hover:bg-gray-900 font-semibold"
            >
              ← Dashboard
            </button>
          </div>
          {DIAGNOSTICS && (
            <pre className="mt-6 text-xs text-left bg-gray-900 p-3 rounded-lg text-gray-300 overflow-auto max-h-64">
{JSON.stringify({ lastFetchCount, lastRawResponse }, null, 2)}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">PDF Review Dashboard</h1>
            <p className="text-gray-400 text-sm">
              Viewing {ITEMS_PER_PAGE} items per page • Total: {data.length}
            </p>
          </div>
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
              onClick={() => reloadData(activeVerifier)}
              className="px-4 py-2.5 border-2 border-gray-700 text-white rounded-lg hover:bg-gray-900 transition-all font-medium"
            >
              🔄 Refresh
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!sessionToken) return;
                try {
                  const response = await fetch(`${API_URL}/api/download`, {
                    headers: { "X-Session-Token": sessionToken },
                  });
                  if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    setTransientMessage(`❌ Download failed: ${err.error || response.statusText}`);
                    return;
                  }
                  const blob = await response.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "reviewed_results.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  console.error("[Viewer] export failed", e);
                  setTransientMessage("❌ Download failed");
                }
              }}
              className="px-4 py-2.5 bg-white text-black rounded-lg hover:bg-gray-200 transition-all font-medium shadow-lg"
            >
              📤 Export CSV
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gray-950 border-2 border-gray-800 rounded-xl p-5 mb-6">
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-end">
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-300 mb-2">Filter by Verifier</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verifierFilter}
                  onChange={(e) => setVerifierFilter(e.target.value)}
                  placeholder="Enter verifier name"
                  className="flex-1 px-4 py-2.5 rounded-lg bg-black text-white border-2 border-gray-700 focus:border-white focus:outline-none transition-colors"
                  onKeyDown={(e) => e.key === "Enter" && applyVerifierFilter()}
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
            <label className="flex items-center gap-2.5 cursor-pointer select-none group pb-1">
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

          {activeVerifier && (
            <div className="mt-4 pt-4 border-t-2 border-gray-800 flex items-center justify-between">
              <div className="text-sm text-gray-300">
                Filtering by: <span className="font-semibold text-white">{activeVerifier}</span>
                {pendingOnly && (
                  <span className="ml-2 px-2 py-1 bg-yellow-500/10 text-yellow-400 rounded text-xs font-medium">
                    Pending Only
                  </span>
                )}
              </div>
              <button
                onClick={clearVerifierFilter}
                className="text-sm text-gray-400 hover:text-white underline transition-colors"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>

        {/* Messages */}
        {message && (
          <div className="mb-6 p-4 bg-gray-950 border-2 border-gray-700 rounded-lg text-sm text-white font-medium animate-pulse">
            {message}
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
          {pageItems.map((item, idx) => {
            const link = (item.link ?? item.Link ?? "").toString().trim();
            const verifierName = item["Verified By"] ?? "";
            const status = item.Status || "";
            const isAccepted = status === "Accepted";
            const isRejected = status === "Rejected";
            const viewerSrc = `https://docs.google.com/gview?url=${encodeURIComponent(link)}&embedded=true`;

            return (
              <div
                key={link || idx}
                className="bg-gray-950 border-2 border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-all shadow-xl"
              >
                <div className="p-4 border-b-2 border-gray-800 flex items-center justify-between bg-black">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-white">#{start + idx + 1}</span>
                    {verifierName && (
                      <span className="text-xs text-gray-400 font-medium">
                        by {verifierName}
                      </span>
                    )}
                  </div>
                  <div
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${
                      isAccepted
                        ? "bg-white text-black"
                        : isRejected
                        ? "bg-gray-800 text-white border-2 border-gray-600"
                        : "bg-gray-900 text-gray-500 border-2 border-gray-800"
                    }`}
                  >
                    {status || "Pending"}
                  </div>
                </div>

                <div className="relative bg-white" style={{ height: "240px" }}>
                  <iframe
                    src={viewerSrc}
                    className="w-full h-full border-0"
                    title={`PDF ${start + idx + 1}`}
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

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                      Rejection Reason
                    </label>
                    <textarea
                      value={feedbacks[link] || ""}
                      onChange={(e) => handleFeedbackChange(link, e.target.value)}
                      className="w-full px-3 py-2.5 bg-black border-2 border-gray-800 text-white rounded-lg focus:border-gray-600 focus:outline-none text-sm placeholder-gray-600 resize-none transition-colors"
                      rows={2}
                      placeholder={
                        item.Feedback
                          ? `Current: ${item.Feedback}`
                          : "Optional: Provide reason for rejection..."
                      }
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
            Page <span className="text-white font-bold">{page + 1}</span> of{" "}
            <span className="text-white font-bold">{Math.max(1, totalPages)}</span>
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
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
              Total Items
            </div>
          </div>
          <div className="bg-gray-950 border-2 border-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white mb-1">
              {data.filter((d) => d.Status === "Accepted").length}
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
              Accepted
            </div>
          </div>
            <div className="bg-gray-950 border-2 border-gray-800 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white mb-1">
                {data.filter((d) => d.Status === "Rejected").length}
              </div>
              <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
                Rejected
              </div>
            </div>
          <div className="bg-gray-950 border-2 border-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white mb-1">
              {data.filter((d) => {
                const s = (d.Status ?? "").toString().trim().toLowerCase();
                return s === "" || s === "pending";
              }).length}
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
              Pending
            </div>
          </div>
        </div>

        {DIAGNOSTICS && (
          <div className="mt-8 p-4 bg-gray-900 border border-gray-800 rounded-lg text-xs text-gray-300 overflow-auto">
            <strong>Diagnostics</strong>
            <pre className="mt-2">
{JSON.stringify(
  {
    sessionToken,
    hasSession,
    lastFetchCount,
    activeVerifier,
    pendingOnly,
    dataPreview: data.slice(0, 3),
  },
  null,
  2
)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}