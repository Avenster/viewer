import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";
import { Shield, AlertCircle } from "lucide-react";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { login, verifyToken } = useAuth();

  useEffect(() => {
    // Only check for admin token specifically
    (async () => {
      const adminToken = localStorage.getItem("auth_token_admin");
      if (adminToken) {
        const ok = await verifyToken(adminToken);
        if (ok) {
          navigate("/admindashboard");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    
    try {
      const res = await login(username.trim(), password);
      if (!res.success) {
        setError(res.error || "Login failed");
        return;
      }
      
      const role = (res.user?.role || "").toLowerCase();
      if (role !== "admin") {
        setError("Not an admin account");
        return;
      }

      navigate("/admindashboard");
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 backdrop-blur-md bg-black/5 border border-black/10 rounded-full mb-4">
            <Shield size={28} className="text-black" />
          </div>
          <h1 className="text-3xl font-bold text-black mb-2">Admin Login</h1>
          <p className="text-sm text-gray-500">Sign in with your admin credentials</p>
        </div>

        {/* Login Card */}
        <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 text-sm flex items-start gap-3">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-black mb-2">
                Username or Email
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all"
                placeholder="Enter your username or email"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-black mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-black text-white rounded-full font-semibold text-sm hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-all"
            >
              {loading ? "Please wait..." : "Sign In as Admin"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-black/10 text-center">
            <p className="text-xs text-gray-500 mb-3">
              If you don't have an admin account, create one via the backend or ask an existing admin.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs">
              <a href="/login" className="text-black hover:text-gray-600 font-medium transition-colors">
                User Login
              </a>
              <span className="text-gray-300">•</span>
              <a href="/qc-login" className="text-black hover:text-gray-600 font-medium transition-colors">
                QC Login
              </a>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-400">
            Secure admin access • Protected by authentication
          </p>
        </div>
      </div>
    </div>
  );
}