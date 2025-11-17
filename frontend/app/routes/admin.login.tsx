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
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-20 w-64 h-64 bg-white/5 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block mb-4">
            <div className="text-7xl mb-2">🔐</div>
          </div>
          <h1 className="text-5xl font-bold text-white mb-3">Admin Portal</h1>
          <p className="text-gray-400 text-lg">Secure access to dashboard</p>
        </div>

        {/* Login Card */}
        <div className="backdrop-blur-xl bg-white/5 border-2 border-white/10 rounded-2xl p-8 shadow-2xl">
          {error && (
            <div className="mb-6 backdrop-blur-xl bg-white/20 border-2 border-white/30 rounded-xl p-4 text-white font-medium animate-shake">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-white mb-3 uppercase tracking-wider">
                Admin Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-5 py-4 backdrop-blur-xl bg-white/5 border-2 border-white/20 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white focus:bg-white/10 transition-all font-medium"
                placeholder="Enter username"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-white mb-3 uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-5 py-4 backdrop-blur-xl bg-white/5 border-2 border-white/20 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white focus:bg-white/10 transition-all font-medium"
                placeholder="Enter password"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-white text-black rounded-xl font-bold text-lg hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-all shadow-lg transform hover:scale-105 disabled:transform-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                  Signing in...
                </span>
              ) : (
                "Sign In →"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="text-sm text-gray-400 hover:text-white transition-colors font-medium"
            >
              ← Back to User Login
            </button>
          </div>
        </div>

        {/* Footer Warning */}
        <div className="mt-6 backdrop-blur-xl bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
            <span className="text-lg">🔒</span>
            <span className="font-medium">Admin access only • Unauthorized access is prohibited</span>
          </div>
        </div>

        {/* Additional Security Info */}
        <div className="mt-4 text-center text-xs text-gray-600">
          <p>All login attempts are monitored and logged</p>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
          20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        .animate-shake {
          animation: shake 0.5s;
        }
      `}</style>
    </div>
  );
}