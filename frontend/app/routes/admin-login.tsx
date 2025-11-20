import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";

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
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Admin Login</h1>
          <p className="text-gray-400">Sign in with your admin credentials</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Username or Email</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white"
                placeholder="admin username or email"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-400"
            >
              {loading ? "Please wait..." : "Sign In as Admin"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-400">
            <p>
              If you don't have an admin account, create one via the backend or ask an existing admin.
            </p>
            <p className="mt-2">
              Back to <a href="/login" className="underline">User Login</a> or <a href="/qc-login" className="underline">QC Login</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}