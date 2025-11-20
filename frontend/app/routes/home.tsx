import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function meta() {
  return [
    { title: "PDF Reviewer - Upload CSV" },
    { name: "description", content: "Upload your CSV file to start reviewing PDFs" },
  ];
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const { user, authToken, isAuthenticated, logout } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
    }
  }, [isAuthenticated, navigate]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setMessage("");
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setMessage("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !authToken) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("csv_file", file);

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        headers: {
          "X-Auth-Token": authToken,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.token) {
        localStorage.setItem("review_token", data.token);
        setMessage(`✅ ${data.message}! ${data.total} unique links ready.`);
        
        setTimeout(() => {
          navigate("/viewer");
        }, 500);
      } else if (response.status === 401) {
        setMessage("❌ Session expired. Please login again.");
        setTimeout(() => {
          logout();
          navigate("/login");
        }, 2000);
      } else {
        setMessage(`❌ ${data.error || "Upload failed"}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Upload failed. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header with user info */}
      <div className="border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center text-white font-semibold">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500">@{user?.username}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center p-4 pt-12">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-semibold mb-2">PDF Reviewer</h1>
            <p className="text-gray-600">Upload your CSV file to start reviewing PDF documents</p>
          </div>

          {message && (
            <div className={`mb-6 p-4 rounded-lg ${message.includes("❌") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-gray-400 transition-colors cursor-pointer"
              onClick={() => document.getElementById("fileInput")?.click()}
            >
              <div className="text-5xl mb-4">📁</div>
              <h3 className="text-xl font-medium mb-2">Drop your CSV file here</h3>
              <p className="text-gray-500 mb-4">or click to browse</p>

              <input
                type="file"
                id="fileInput"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                required
              />

              {file && (
                <p className="text-sm font-medium text-green-600 mt-4">
                  ✓ Selected: {file.name}
                </p>
              )}
            </div>

            <div className="text-center mt-6">
              <button
                type="submit"
                disabled={uploading || !file}
                className="px-8 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? "Uploading..." : "Start Reviewing"}
              </button>
            </div>
          </form>

          <div className="mt-8 p-6 bg-gray-50 rounded-lg">
            <h4 className="font-medium mb-3">📋 CSV Requirements:</h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li>• File must contain a column named <strong>"link"</strong></li>
              <li>• Each row should have a valid PDF URL</li>
              <li>• Duplicate links will be automatically removed</li>
              <li>• A "Status" column will be added for tracking</li>
              <li>• Your name will be set as the default verifier</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}