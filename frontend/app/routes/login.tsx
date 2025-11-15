import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function Login() {
  const [isSignup, setIsSignup] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    name: ""
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("auth_token");
      
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/auth/verify`, {
          headers: { "X-Auth-Token": token }
        });

        if (response.ok) {
          // User is already authenticated, redirect immediately
          console.log("[LOGIN] User already authenticated, redirecting to dashboard");
          navigate("/dashboard", { replace: true });
        } else {
          // Token invalid, clear it
          localStorage.removeItem("auth_token");
          setLoading(false);
        }
      } catch (error) {
        console.error("Auth check failed:", error);
        localStorage.removeItem("auth_token");
        setLoading(false);
      }
    };

    checkAuth();
  }, [navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
    const payload = isSignup 
      ? formData 
      : { username: formData.username, password: formData.password };

    const token = localStorage.getItem("auth_token");

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token && { 'X-Auth-Token': token })
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      // Handle already authenticated (403 from backend middleware)
      if (response.status === 403 && data.code === 'ALREADY_AUTHENTICATED') {
        console.log("[LOGIN] Already authenticated, redirecting");
        navigate("/dashboard", { replace: true });
        return;
      }

      if (response.ok && data.success) {
        // Save auth token
        localStorage.setItem("auth_token", data.token);
        
        // Redirect to dashboard (replace: true prevents back button issue)
        navigate("/dashboard", { replace: true });
      } else {
        setError(data.error || "Authentication failed");
        setSubmitting(false);
      }
    } catch (err) {
      console.error(err);
      setError("Connection failed. Please try again.");
      setSubmitting(false);
    }
  };

  // Show loading screen while checking auth
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black flex items-center justify-center">
        <div className="text-white text-xl">Checking authentication...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">PDF Reviewer</h1>
          <p className="text-gray-400">Streamline your PDF review workflow</p>
        </div>

        {/* Auth Card */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl p-8 shadow-xl">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-white mb-2">
              {isSignup ? "Create Account" : "Welcome Back"}
            </h2>
            <p className="text-gray-400 text-sm">
              {isSignup ? "Sign up to get started" : "Log in to continue"}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required={isSignup}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="John Doe"
                />
              </div>
            )}

            {isSignup && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required={isSignup}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="john@example.com"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {isSignup ? "Username" : "Username or Email"}
              </label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder={isSignup ? "johndoe" : "johndoe or john@example.com"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                minLength={6}
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="••••••••"
              />
              {isSignup && (
                <p className="mt-1 text-xs text-gray-500">
                  Minimum 6 characters
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg font-semibold disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all duration-300 shadow-lg"
            >
              {submitting ? "Processing..." : (isSignup ? "Sign Up" : "Log In")}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsSignup(!isSignup);
                setError("");
                setFormData({ username: "", email: "", password: "", name: "" });
              }}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              {isSignup ? (
                <>Already have an account? <span className="text-blue-400 font-semibold">Log in</span></>
              ) : (
                <>Don't have an account? <span className="text-blue-400 font-semibold">Sign up</span></>
              )}
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <Link
              to="/admin/login"
              className="block text-center text-sm text-gray-400 hover:text-white transition-colors"
            >
              🔐 Admin Login
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>© 2025 PDF Reviewer. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}