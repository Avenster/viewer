import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function meta() {
  return [
    { title: "PDF Reviewer - Upload CSV" },
    { name: "description", content: "Upload your CSV file to start reviewing PDFs" },
  ];
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);  // ✅ Fixed: removed duplicate setFile
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    verifyAuth();
  }, []);

  const verifyAuth = async () => {
    const token = localStorage.getItem("auth_token");
    
    if (!token) {
      navigate("/login");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/verify`, {
        headers: { "X-Auth-Token": token }
      });

      if (!response.ok) {
        localStorage.removeItem("auth_token");
        navigate("/login");
        return;
      }

      const data = await response.json();
      setUser(data.user);
    } catch (error) {
      console.error("Auth error:", error);
      navigate("/login");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setMessage("");
      setDuplicateWarning(null);
      
      // Check for duplicates
      await checkForDuplicates(selectedFile);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selectedFile = e.dataTransfer.files[0];
      setFile(selectedFile);
      setMessage("");
      setDuplicateWarning(null);
      
      // Check for duplicates
      await checkForDuplicates(selectedFile);
    }
  };

  const checkForDuplicates = async (fileToCheck: File) => {
    setChecking(true);
    const token = localStorage.getItem("auth_token");
    
    if (!token) return;

    try {
      const formData = new FormData();
      formData.append("csv_file", fileToCheck);

      const response = await fetch(`${API_URL}/api/check-duplicate-file`, {
        method: "POST",
        headers: { "X-Auth-Token": token },
        body: formData,
      });

      const data = await response.json();

      if (data.is_duplicate) {
        setDuplicateWarning(data);
      } else {
        setDuplicateWarning(null);
      }
    } catch (error) {
      console.error("Duplicate check error:", error);
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    // Show confirmation if duplicate detected
    if (duplicateWarning && duplicateWarning.is_duplicate) {
      const confirm = window.confirm(
        `⚠️ This file appears to be a duplicate!\n\n` +
        `Already uploaded by: ${duplicateWarning.duplicates[0].uploaded_by}\n` +
        `Uploaded on: ${new Date(duplicateWarning.duplicates[0].created_at).toLocaleString()}\n\n` +
        `Do you still want to upload?`
      );
      
      if (!confirm) return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("csv_file", file);

    const token = localStorage.getItem("auth_token");

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        headers: { "X-Auth-Token": token || "" },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.token) {
        localStorage.setItem("review_token", data.token);
        setMessage(`✅ ${data.message}! ${data.total} unique links ready.`);
        
        setTimeout(() => {
          navigate("/viewer");
        }, 500);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black">
      {/* Header */}
      <div className="bg-black/50 backdrop-blur-sm border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-white">PDF Reviewer</h1>
            {user && <p className="text-gray-400 text-sm">Logged in as {user.name}</p>}
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex items-center justify-center p-6 mt-12">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-8">
            <h2 className="text-4xl font-bold text-white mb-2">Upload CSV File</h2>
            <p className="text-gray-400">Upload your CSV file to start reviewing PDF documents</p>
          </div>

          {message && (
            <div className={`mb-6 p-4 rounded-lg ${message.includes("❌") ? "bg-red-900/50 text-red-200 border border-red-700" : "bg-green-900/50 text-green-200 border border-green-700"}`}>
              {message}
            </div>
          )}

          {duplicateWarning && duplicateWarning.is_duplicate && (
            <div className="mb-6 p-4 bg-yellow-900/50 text-yellow-200 border border-yellow-700 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div className="flex-1">
                  <p className="font-semibold mb-2">Duplicate File Detected!</p>
                  <p className="text-sm mb-3">{duplicateWarning.message}</p>
                  {duplicateWarning.duplicates.map((dup: any, idx: number) => (
                    <div key={idx} className="bg-black/30 rounded p-3 text-sm">
                      <p><strong>Uploaded by:</strong> {dup.uploaded_by} (@{dup.username})</p>
                      <p><strong>Date:</strong> {new Date(dup.created_at).toLocaleString()}</p>
                      <p><strong>Source:</strong> {dup.assigned_by_admin ? "Admin Assigned" : "User Upload"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-2xl p-16 text-center transition-all duration-300 cursor-pointer bg-gray-800/30 backdrop-blur-sm"
              onClick={() => document.getElementById("fileInput")?.click()}
            >
              <div className="text-6xl mb-6">
                {checking ? "🔍" : file ? "✅" : "📁"}
              </div>
              
              {checking ? (
                <p className="text-xl text-blue-400 mb-4">Checking for duplicates...</p>
              ) : (
                <>
                  <h3 className="text-2xl font-semibold text-white mb-3">
                    {file ? file.name : "Drop your CSV file here"}
                  </h3>
                  <p className="text-gray-400 mb-4">or click to browse</p>
                </>
              )}

              <input
                type="file"
                id="fileInput"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                required
              />

              {file && !checking && (
                <p className="text-sm text-green-400 font-medium mt-4">
                  ✓ File selected: {(file.size / 1024).toFixed(2)} KB
                </p>
              )}
            </div>

            <div className="text-center mt-8">
              <button
                type="submit"
                disabled={uploading || !file || checking}
                className="px-10 py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-semibold text-lg disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all duration-300 shadow-lg hover:shadow-xl"
              >
                {uploading ? "Uploading..." : checking ? "Checking..." : "Start Reviewing"}
              </button>
            </div>
          </form>

          <div className="mt-10 p-6 bg-gray-800/50 border border-gray-700 rounded-xl">
            <h4 className="font-semibold mb-4 text-white text-lg">📋 CSV Requirements:</h4>
            <ul className="space-y-3 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">✓</span>
                <span>File must contain a column named <strong className="text-white">"link"</strong> or <strong className="text-white">"URL"</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">✓</span>
                <span>Each row should have a valid PDF URL</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">✓</span>
                <span>Duplicate links will be automatically removed</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-yellow-400 mt-0.5">⚠️</span>
                <span>System checks if file was already uploaded</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}