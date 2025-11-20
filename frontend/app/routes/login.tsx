import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";
import { FileText, AlertCircle } from "lucide-react";

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { login, signup, verifyToken } = useAuth();

  useEffect(() => {
    // Only check for user token
    (async () => {
      const userToken = localStorage.getItem("auth_token_user");
      if (userToken) {
        const ok = await verifyToken(userToken);
        if (ok) {
          navigate("/pdf");
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
      if (isLogin) {
        const result = await login(username.trim(), password);
        if (!result.success) {
          setError(result.error || "Login failed");
          return;
        }
        navigate("/pdf");
      } else {
        if (!email || !name) {
          setError("All fields are required");
          return;
        }
        const result = await signup(username.trim(), email.trim(), password, name.trim());
        if (!result.success) {
          setError(result.error || "Signup failed");
          return;
        }
        navigate("/pdf");
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
            <FileText size={28} className="text-black" />
          </div>
          <h1 className="text-3xl font-bold text-black mb-2">PDF Reviewer</h1>
          <p className="text-sm text-gray-500">
            {isLogin ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        {/* Login/Signup Card */}
        <div className="backdrop-blur-md bg-black/5 border border-black/10 rounded-2xl p-8">
          {/* Toggle Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              type="button"
              onClick={() => {
                setIsLogin(true);
                setError("");
              }}
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
              onClick={() => {
                setIsLogin(false);
                setError("");
              }}
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
              <div>
                <label className="block text-xs font-semibold text-black mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all"
                  placeholder="John Doe"
                  required
                />
              </div>
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

            {!isLogin && (
              <div>
                <label className="block text-xs font-semibold text-black mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-black/10 rounded-xl text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 transition-all"
                  placeholder="you@example.com"
                  required
                />
              </div>
            )}

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
              {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
            </button>
          </form>

          {/* Footer Links */}
          <div className="mt-6 pt-6 border-t border-black/10 text-center">
            {isLogin ? (
              <p className="text-xs text-gray-500">
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(false);
                    setError("");
                  }}
                  className="text-black font-medium hover:text-gray-600 transition-colors"
                >
                  Sign up
                </button>
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(true);
                    setError("");
                  }}
                  className="text-black font-medium hover:text-gray-600 transition-colors"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Footer Note */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-400">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}