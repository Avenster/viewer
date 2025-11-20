import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../components/AuthContext";

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
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">PDF Reviewer</h1>
          <p className="text-gray-400">
            {isLogin ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8">
          {/* Tab Switcher */}
          <div className="flex gap-2 mb-6">
            <button
              type="button"
              onClick={() => {
                setIsLogin(true);
                setError("");
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                isLogin ? "bg-white text-black" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
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
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                !isLogin ? "bg-white text-black" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
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
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition-colors"
                  placeholder="John Doe"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Username {isLogin && "or Email"}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition-colors"
                placeholder={isLogin ? "username or email" : "username"}
                required
              />
            </div>

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-black border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition-colors"
                  placeholder="you@example.com"
                  required
                />
              </div>
            )}

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
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-400">
            {isLogin ? (
              <p>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(false);
                    setError("");
                  }}
                  className="text-white hover:underline"
                >
                  Sign up
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(true);
                    setError("");
                  }}
                  className="text-white hover:underline"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          <p>By continuing, you agree to our Terms of Service and Privacy Policy</p>
        </div>
      </div>
    </div>
  );
}