import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";
import { CheckCircle, AlertCircle } from "lucide-react";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:5000";

export default function QcLogin() {
  const [isLogin, setIsLogin] = useState(true); // true = login, false = signup
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [signupKey, setSignupKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { login, verifyToken } = useAuth();

  // If a QC token already exists and is valid, activate it and redirect
  useEffect(() => {
    (async () => {
      const qcToken = localStorage.getItem("auth_token_qc");
      if (!qcToken) return;
      const ok = await verifyToken(qcToken);
      if (ok) navigate("/qcdashboard");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function redirectToQc() {
    navigate("/qcdashboard");
  }

  async function handleSignup() {
    setError("");
    setLoading(true);
    try {
      // Create QC account
      const res = await fetch(`${API_URL}/api/qc/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          name: name.trim(),
          password,
          signup_key: signupKey || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Signup failed");
        return;
      }
      // After signup, standard login to centralize token storage
      const logged = await login(username.trim(), password);
      if (!logged.success) {
        setError(logged.error || "Signed up but failed to login");
        return;
      }
      const role = (logged.user?.role || "user").toLowerCase();
      if (role !== "qc") {
        setError("Signed up/logged in but role is not QC");
        return;
      }
      redirectToQc();
    } catch (err) {
      console.error(err);
      setError("Unexpected error during signup");
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isLogin) {
        const res = await login(username.trim(), password);
        if (!res.success) {
          setError(res.error || "Login failed");
          return;
        }
        const role = (res.user?.role || "user").toLowerCase();
        if (role !== "qc") {
          setError("Logged in but not a QC account");
          return;
        }
        redirectToQc();
      } else {
        // signup
        if (!username || !email || !name || !password) {
          setError("All fields are required for signup");
          return;
        }
        await handleSignup();
      }
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
            <CheckCircle size={28} className="text-black" />
          </div>
          <h1 className="text-3xl font-bold text-black mb-2">QC Portal</h1>
          <p className="text-sm text-gray-500">
            {isLogin ? "Sign in to continue" : "Create your QC account"}
          </p>
        </div>

        {/* Login/Signup Card */}
        <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-8">
          {/* Toggle Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              type="button"
              onClick={() => { setIsLogin(true); setError(""); }}
              className={`flex-1 py-2.5 px-4 rounded-full font-semibold text-sm transition-all ${
                isLogin 
                  ? "bg-black text-white" 
                  : "bg-white/50 text-gray-600 hover:bg-white/80"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => { setIsLogin(false); setError(""); }}
              className={`flex-1 py-2.5 px-4 rounded-full font-semibold text-sm transition-all ${
                !isLogin 
                  ? "bg-black text-white" 
                  : "bg-white/50 text-gray-600 hover:bg-white/80"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 text-sm flex items-start gap-3">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form Fields */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-black mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all"
                    placeholder="Your full name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-black mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all"
                    placeholder="you@company.com"
                    required
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-black mb-2">
                Username {isLogin && "or Email"}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all"
                placeholder={isLogin ? "username or email" : "username"}
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

            {!isLogin && (
              <div>
                <label className="block text-xs font-semibold text-black mb-2">
                  Signup Key <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={signupKey}
                  onChange={(e) => setSignupKey(e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all"
                  placeholder="If your org requires a signup key"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Leave empty if no key is required by server
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-black text-white rounded-full font-semibold text-sm hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-all"
            >
              {loading ? "Please wait..." : isLogin ? "Sign In as QC" : "Create QC Account"}
            </button>
          </form>

          {/* Footer Links */}
          <div className="mt-6 pt-6 border-t border-black/10 text-center">
            <p className="text-xs text-gray-500 mb-3">
              QC accounts are managed by admins or self-register (if enabled)
            </p>
            <div className="flex items-center justify-center gap-2 text-xs">
              <a href="/login" className="text-black hover:text-gray-600 font-medium transition-colors">
                User Login
              </a>
              <span className="text-gray-300">•</span>
              <a href="/admin-login" className="text-black hover:text-gray-600 font-medium transition-colors">
                Admin Login
              </a>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-400">
            Quality control access • Secure authentication
          </p>
        </div>
      </div>
    </div>
  );
}