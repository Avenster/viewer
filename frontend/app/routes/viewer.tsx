// Viewer.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";

interface DataItem {
  link: string;
  Status: string;
  Feedback: string;
  [key: string]: any;
}

// Use environment variable or fallback to localhost
const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:5000";

export default function Viewer() {
  const [data, setData] = useState<DataItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<string>("");
  const [noSession, setNoSession] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);
  const [sessionChecking, setSessionChecking] = useState<boolean>(true);
  const [token, setToken] = useState<string | null>(null);
  // absoluteIndex -> compressed url string | null (explicit)
  const [compressedUrls, setCompressedUrls] = useState<Record<number, string | null>>({});
  const [preparingPage, setPreparingPage] = useState<boolean>(false);

  // modal state
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalSrc, setModalSrc] = useState<string | null>(null);

  const itemsPerPage = 5; // visible items per page
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
        setNoSession(false);
        setToken(currentToken);
        await fetchData(currentToken);
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

  const fetchData = async (overrideToken?: string) => {
    try {
      const currentToken =
        overrideToken ??
        token ??
        (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);

      if (!currentToken) {
        setNoSession(true);
        setData([]);
        return;
      }

      const response = await fetch(`${API_URL}/api/data`, {
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
        return;
      }

      const result = await response.json().catch(() => ({}));
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

  // prepare current page (ask backend to download+compress 10 items: visible 5 + preload 5)
  useEffect(() => {
    const prepare = async () => {
      const currentToken =
        token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);
      if (!currentToken || data.length === 0) {
        setCompressedUrls({});
        return;
      }

      setPreparingPage(true);

      try {
        // Request server to prepare page (10 items = 5 visible + 5 preload)
        const resp = await fetch(`${API_URL}/api/prepare-page`, {
          method: "POST",
          headers: buildHeaders(currentToken),
          body: JSON.stringify({ page, items_per_page: 10 }),
        });

        if (!resp.ok) {
          console.warn("prepare-page failed", resp.status);
          setCompressedUrls({});
          setPreparingPage(false);
          return;
        }

        const result = await resp.json();
        const map: Record<number, string | null> = {};

        if (Array.isArray(result.items)) {
          result.items.forEach((it: any) => {
            const idx = Number(it.index);
            map[idx] = it.compressed_url ? String(it.compressed_url) : null;
          });
        }

        // merge with previous (keep any existing known entries)
        setCompressedUrls((prev) => ({ ...prev, ...map }));
      } catch (err) {
        console.error("prepare-page error", err);
        setCompressedUrls({});
      } finally {
        setPreparingPage(false);
      }
    };

    prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, token, data.length]);

  const totalPages = Math.ceil(data.length / itemsPerPage);

  const updateStatus = async (absoluteIndex: number, status: string, providedFeedback = "") => {
    const currentToken =
      token ?? (typeof window !== "undefined" ? window.localStorage.getItem("review_token") : null);

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
          feedback: providedFeedback || "",
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
          if (absoluteIndex >= 0 && absoluteIndex < copy.length) {
            copy[absoluteIndex] = {
              ...copy[absoluteIndex],
              Status: status,
              // when rejected, we preserve existing Feedback on server unless provided; frontend not forcing any new feedback
            };
          }
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

  const handleAccept = (absoluteIndex: number) => {
    updateStatus(absoluteIndex, "Accepted");
  };

  const handleReject = (absoluteIndex: number) => {
    // Rejection no longer requires feedback — just call update
    updateStatus(absoluteIndex, "Rejected");
  };

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

  const openModalForIndex = (absoluteIndex: number) => {
    const compressed = compressedUrls[absoluteIndex];
    const src =
      typeof compressed === "string" && compressed
        ? `${compressed}#view=FitH`
        : `${data[absoluteIndex]?.link}#view=FitH`; // fallback to original if compressed missing
    setModalSrc(src);
    setModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold text-white">PDF Reviewer — Grid ({itemsPerPage} per page)</h2>
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

        {preparingPage && (
          <div className="mb-3 text-sm text-gray-300">Preparing PDFs for this page (downloading + compressing)...</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pageItems.map((item, idx) => {
            const absoluteIndex = start + idx;
            const compressed = compressedUrls[absoluteIndex];
            const src = typeof compressed === "string" && compressed ? `${compressed}#view=FitH` : null; // only if prepared
            const displayStatus = item.Status || "Pending";

            return (
              <div key={absoluteIndex} className="bg-black border border-gray-700 rounded-lg p-3">
                <div className="text-sm text-gray-300 mb-2 flex items-center justify-between">
                  <div>#{absoluteIndex + 1}</div>
                  <div className="text-xs">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        displayStatus === "Accepted"
                          ? "bg-green-900 text-green-300"
                          : displayStatus === "Rejected"
                          ? "bg-red-900 text-red-300"
                          : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {displayStatus}
                    </span>
                  </div>
                </div>

                {/* preview area: clickable only if src exists */}
                <div
                  className={`h-48 bg-white rounded overflow-hidden mb-3 cursor-pointer ${src ? "hover:scale-[1.01] transition-transform" : ""}`}
                  onClick={() => {
                    if (src) openModalForIndex(absoluteIndex);
                    else {
                      // if not prepared yet, optionally request prepare again for this page
                      setMessage("Preview not ready yet — preparing on server...");
                      setTimeout(() => setMessage(""), 2000);
                    }
                  }}
                >
                  {src ? (
                    <iframe src={src} className="w-full h-full border-0" title={`PDF ${absoluteIndex + 1}`} loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                      <div className="text-center">
                        <div className="mb-2">Preview not ready</div>
                        <div className="text-xs text-gray-500">Preparing PDF on server...</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* original link (always shown) */}
                <div className="mb-3">
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-300 underline break-all"
                    onClick={(e) => {
                      /* allow manual open in new tab; don't navigate SPA */
                    }}
                  >
                    Open original PDF (external)
                  </a>
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

                {item.Feedback && (
                  <div className="mt-2 text-xs text-gray-400 p-1 bg-gray-900 rounded">Current: {item.Feedback}</div>
                )}
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
              onClick={() => {
                const newPage = Math.min(totalPages - 1, page + 1);
                setPage(newPage);
                // prepare effect triggers automatically
              }}
              disabled={page >= totalPages - 1}
              className="px-3 py-2 border border-gray-700 text-white rounded-lg disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>

        <div className="mt-4 text-gray-400 text-sm">
          Total: {data.length} items | Accepted: {data.filter(d => d.Status === "Accepted").length} | Rejected: {data.filter(d => d.Status === "Rejected").length} | Pending: {data.filter(d => !d.Status || d.Status === "Pending").length}
        </div>
      </div>

      {/* Modal for larger preview */}
      {modalOpen && modalSrc && (
        <div
          className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div className="w-full max-w-5xl h-[80vh] bg-black rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-2 border-b border-gray-800">
              <div className="text-sm text-white">PDF Preview</div>
              <div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-1 bg-gray-800 text-white rounded"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="w-full h-full">
              <iframe src={modalSrc} className="w-full h-full border-0" title="Large PDF preview" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
