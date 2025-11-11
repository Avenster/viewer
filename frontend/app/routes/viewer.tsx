// Viewer.tsx (modified)
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";

interface DataItem {
  link: string;
  Status: string;
  Feedback: string;
  [key: string]: any;
}

// Use environment variable or fallback to localhost
const API_URL = import.meta.env.VITE_API_URL || "http://13.201.123.132:5000";

export default function Viewer() {
  const [data, setData] = useState<DataItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<string>("");
  const [noSession, setNoSession] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);
  const [sessionChecking, setSessionChecking] = useState<boolean>(true);
  const [token, setToken] = useState<string | null>(null); // <- store token here
  const itemsPerPage = 5;
  const navigate = useNavigate();

  // populate token only on the client
  useEffect(() => {
    if (typeof window !== "undefined") {
      const t = window.localStorage.getItem("review_token");
      setToken(t);
    }
    // then check session (checkSession uses localStorage inside useEffect too)
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildHeaders = (tokenFromStorage?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // prefer provided token, then token state
    const t = tokenFromStorage ?? token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);
    if (t) headers["X-Session-Token"] = t;
    return headers;
  };

  const checkSession = async () => {
    // run only on client - this function is called inside useEffect above
    if (typeof window === "undefined") {
      setSessionChecking(false);
      setLoading(false);
      return;
    }

    const currentToken = window.localStorage.getItem("review_token");
    if (!currentToken) {
      console.warn("No token found in localStorage");
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
        console.log("Session is valid, fetching data...");
        setNoSession(false);
        setToken(currentToken);
        await fetchData();
      } else {
        console.warn("Session is invalid or expired");
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

  const fetchData = async () => {
    try {
      const currentToken = token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);

      if (!currentToken) {
        console.warn("No token found in localStorage");
        setNoSession(true);
        setData([]);
        return;
      }

      const response = await fetch(`${API_URL}/api/data`, {
        credentials: "omit",
        headers: buildHeaders(currentToken),
      });

      if (response.status === 401) {
        // Token expired or invalid
        console.warn("Token expired or invalid");
        if (typeof window !== "undefined") window.localStorage.removeItem("review_token");
        setToken(null);
        setNoSession(true);
        setData([]);
        setMessage("❌ Session expired. Please upload CSV again.");
        setTimeout(() => setMessage(""), 3000);
        return;
      }

      let result: any = {};
      try {
        result = await response.json();
      } catch (err) {
        console.error("JSON parse failed:", err);
        result = {};
      }

      const items = Array.isArray(result.data) ? result.data : [];

      if (response.ok && items.length > 0) {
        setData(items);
        setNoSession(false);
      } else {
        setData([]);
        setNoSession(true);
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
      setData([]);
      setNoSession(true);
      setMessage("❌ Failed to connect to server");
      setTimeout(() => setMessage(""), 3000);
    }
  };

  const totalPages = Math.ceil(data.length / itemsPerPage);

  const updateStatus = async (absoluteIndex: number, status: string, providedFeedback = "") => {
    const currentToken = token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);

    if (!currentToken) {
      setMessage("❌ No active session/token. Please upload CSV again.");
      setTimeout(() => setMessage(""), 2500);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/update-status`, {
        method: "POST",
        headers: buildHeaders(currentToken),
        body: JSON.stringify({
          index: absoluteIndex,
          status,
          feedback: status === "Rejected" ? providedFeedback : "",
        }),
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
        setMessage(`✅ Marked item #${absoluteIndex + 1} as ${status}`);
        setTimeout(() => setMessage(""), 2000);

        setData((prev) => {
          const copy = [...prev];
          copy[absoluteIndex] = {
            ...copy[absoluteIndex],
            Status: status,
            Feedback: status === "Rejected" ? providedFeedback : "",
          };
          return copy;
        });

        setFeedbacks((prev) => {
          const copy = { ...prev };
          delete copy[absoluteIndex];
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

  const [feedbacks, setFeedbacks] = useState<Record<number, string>>({});

  const handleAccept = (absoluteIndex: number) => {
    updateStatus(absoluteIndex, "Accepted");
  };

  const handleReject = (absoluteIndex: number) => {
    const fb = feedbacks[absoluteIndex] || "";

    if (!fb.trim()) {
      setMessage("⚠️ No rejection reason provided — moving to next item (left unchanged)");
      setTimeout(() => setMessage(""), 2000);

      const pageStart = page * itemsPerPage;
      const pageEnd = Math.min(pageStart + itemsPerPage - 1, data.length - 1);

      let nextIndex = absoluteIndex + 1;
      if (nextIndex >= data.length) nextIndex = absoluteIndex;

      const nextPage = Math.floor(nextIndex / itemsPerPage);
      if (nextPage !== page) setPage(nextPage);

      return;
    }

    updateStatus(absoluteIndex, "Rejected", fb);
  };

  const handleFeedbackChange = (absoluteIndex: number, value: string) => {
    setFeedbacks((prev) => ({ ...prev, [absoluteIndex]: value }));
  };

  const handlePrevPage = () => setPage((p) => Math.max(0, p - 1));
  const handleNextPage = () => setPage((p) => Math.min(totalPages - 1, p + 1));

  const handleExport = async () => {
    const currentToken = token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);

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
          <h2 className="text-2xl font-semibold mb-2 text-white">
            {noSession ? "No active review session" : "No data found"}
          </h2>
          <p className="text-gray-400 mb-6">
            {noSession
              ? "Your session has expired or you haven't uploaded a CSV yet."
              : "Upload a CSV file to begin reviewing PDFs."}
          </p>
          <div className="flex justify-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="px-6 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors"
            >
              Upload CSV
            </button>
            {token && (
              <button
                onClick={() => {
                  if (typeof window !== "undefined") window.localStorage.removeItem("review_token");
                  setToken(null);
                  setNoSession(true);
                }}
                className="px-6 py-2 border border-gray-600 text-white rounded-lg hover:bg-gray-900 transition-colors"
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
    <div className="min-h-screen bg-black p-6">
      {/* rest of your render remains unchanged */}
      {/* ... (same UI you had) */}
      {/* I preserved the rest in your original file; keep it as-is */}
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold text-white">PDF Reviewer — Grid (5 per page)</h2>
          <div className="flex gap-2">
            <button
              onClick={() => navigate("/")}
              className="px-3 py-2 border border-gray-700 text-white rounded-lg text-sm hover:bg-gray-900 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-2 border border-gray-700 text-white rounded-lg text-sm hover:bg-gray-900 transition-colors"
            >
              📤 Export
            </button>
          </div>
        </div>

        {message && <div className="text-sm text-green-400 p-2 bg-gray-900 rounded mb-4">{message}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pageItems.map((item, idx) => {
            const absoluteIndex = start + idx;
            return (
              <div key={absoluteIndex} className="bg-black border border-gray-700 rounded-lg p-3">
                <div className="text-sm text-gray-300 mb-2 flex items-center justify-between">
                  <div>#{absoluteIndex + 1}</div>
                  <div className="text-xs">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        item.Status === "Accepted"
                          ? "bg-green-900 text-green-300"
                          : item.Status === "Rejected"
                          ? "bg-red-900 text-red-300"
                          : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {item.Status || "Pending"}
                    </span>
                  </div>
                </div>

                <div className="h-48 bg-white rounded overflow-hidden mb-3">
                  <iframe
                    src={`${item.link}#view=FitH`}
                    className="w-full h-full border-0"
                    title={`PDF ${absoluteIndex + 1}`}
                    loading="lazy"
                  />
                </div>

                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => handleAccept(absoluteIndex)}
                    className="flex-1 px-3 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors font-medium"
                  >
                    ✅ Accept
                  </button>
                  <button
                    onClick={() => handleReject(absoluteIndex)}
                    className="flex-1 px-3 py-2 border border-gray-700 text-white rounded-lg hover:bg-gray-900 transition-colors font-medium"
                  >
                    ❌ Reject
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-white mb-1">Rejection Reason</label>
                  <textarea
                    value={feedbacks[absoluteIndex] || item.Feedback || ""}
                    onChange={(e) => handleFeedbackChange(absoluteIndex, e.target.value)}
                    className="w-full px-2 py-1 bg-black border border-gray-700 text-white rounded-lg focus:outline-none text-sm placeholder-gray-500"
                    rows={2}
                    placeholder="Enter reason for rejection (optional)"
                  />
                  {item.Feedback && (
                    <div className="mt-2 text-xs text-gray-400 p-1 bg-gray-900 rounded">Current: {item.Feedback}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-gray-400">Page {page + 1} of {Math.max(1, totalPages)}</div>
          <div className="flex gap-2">
            <button
              onClick={handlePrevPage}
              disabled={page === 0}
              className="px-3 py-2 border border-gray-700 text-white rounded-lg disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={handleNextPage}
              disabled={page >= totalPages - 1}
              className="px-3 py-2 border border-gray-700 text-white rounded-lg disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>

        <div className="mt-4 text-gray-400 text-sm">
          Total: {data.length} items | Accepted: {data.filter(d => d.Status === "Accepted").length} | Rejected: {data.filter(d => d.Status === "Rejected").length} | Pending: {data.filter(d => !d.Status).length}
        </div>
      </div>
    </div>
  );
}
