import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";

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
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">QC Portal</h1>
          <p className="text-gray-400">{isLogin ? "Sign in to continue" : "Create your QC account"}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8">
          <div className="flex gap-2 mb-6">
            <button
              type="button"
              onClick={() => { setIsLogin(true); setError(""); }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${isLogin ? "bg-white text-black" : "bg-gray-800 text-gray-400"}`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => { setIsLogin(false); setError(""); }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${!isLogin ? "bg-white text-black" : "bg-gray-800 text-gray-400"}`}
            >
              Sign Up
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white"
                    placeholder="Your full name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white"
                    placeholder="you@company.com"
                    required
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Username {isLogin && "or Email"}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white"
                placeholder={isLogin ? "username or email" : "username"}
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

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Signup Key (optional)</label>
                <input
                  type="text"
                  value={signupKey}
                  onChange={(e) => setSignupKey(e.target.value)}
                  className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white"
                  placeholder="If your org requires a signup key"
                />
                <div className="text-xs text-gray-400 mt-1">Leave empty if no key is required by server.</div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-400"
            >
              {loading ? "Please wait..." : isLogin ? "Sign In as QC" : "Create QC Account"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-400">
            <p>QC accounts are managed by admins or self-register (if enabled).</p>
            <p className="mt-2">Back to <a href="/login" className="underline">User Login</a> or <a href="/admin-login" className="underline">Admin Login</a>.</p>
          </div>
        </div>
      </div>
    </div>
  );
}