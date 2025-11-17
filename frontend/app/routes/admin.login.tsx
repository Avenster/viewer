import { useState, useEffect } from "react";
import { useNavigate } from "react-router";

const API_URL = import.meta.env.VITE_API_URL || "http://13.201.123.132:5000";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const adminToken = localStorage.getItem("admin_token");
    if (adminToken) {
      navigate("/admin/dashboard");
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        localStorage.setItem("admin_token", data.token);
        navigate("/admin/dashboard");
      } else {
        setError(data.error || "Login failed");
      }
    } catch (err) {
      console.error("Admin login error:", err);
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">🔐 Admin Portal</h1>
          <p className="text-gray-400">Sign in to access the admin dashboard</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Admin Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition-colors"
                placeholder="admin"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition-colors"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← Back to User Login
            </button>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          <p>🔒 Admin access only - Unauthorized access is prohibited</p>
        </div>
      </div>
    </div>
  );
}