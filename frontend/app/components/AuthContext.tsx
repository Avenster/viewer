import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://13.201.123.132:5000";

interface User {
  user_id?: string;
  username: string;
  email: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  authToken: string | null;
  isAuthenticated: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (username: string, email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setAuthToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Keys we normalize to
const KEY_TOKEN = "auth_token";
const KEY_USER = "user";

// Legacy keys we’ll read for backward compatibility
const LEGACY_KEYS = {
  token: "token",
  user: "user_data",
};

function getStoredToken(): string | null {
  const t = localStorage.getItem(KEY_TOKEN) || localStorage.getItem(LEGACY_KEYS.token);
  return t || null;
}

function getStoredUser(): User | null {
  const raw = localStorage.getItem(KEY_USER) || localStorage.getItem(LEGACY_KEYS.user);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearAllAuthStorage() {
  localStorage.removeItem(KEY_TOKEN);
  localStorage.removeItem(KEY_USER);
  localStorage.removeItem(LEGACY_KEYS.token);
  localStorage.removeItem(LEGACY_KEYS.user);
  localStorage.removeItem("review_token");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const storedToken = getStoredToken();
        const storedUser = getStoredUser();

        console.log("[AuthContext] Loading from localStorage:");
        console.log("- Token key(s):", storedToken ? "Present" : "Missing");
        console.log("- User key(s):", storedUser ? "Present" : "Missing");

        if (storedToken) {
          const response = await fetch(`${API_URL}/api/auth/verify`, {
            headers: { "X-Auth-Token": storedToken },
          });

          if (response.ok) {
            const data = await response.json();
            const userData: User = data.user;

            // Normalize to current keys
            localStorage.setItem(KEY_TOKEN, storedToken);
            localStorage.setItem(KEY_USER, JSON.stringify(userData));
            // Clean legacy keys (optional)
            localStorage.removeItem(LEGACY_KEYS.token);
            localStorage.removeItem(LEGACY_KEYS.user);

            setAuthToken(storedToken);
            setUser(userData);
            setIsAuthenticated(true);

            console.log("[AuthContext] ✅ Auth restored via verify");
            console.log("[AuthContext] User:", userData);
          } else {
            console.log("[AuthContext] ❌ Token invalid/expired, clearing storage");
            clearAllAuthStorage();
            setAuthToken(null);
            setUser(null);
            setIsAuthenticated(false);
          }
        } else {
          // No token; don’t trust any leftover user cache
          if (storedUser) {
            console.log("[AuthContext] Clearing stale user cache (no token)");
          }
          clearAllAuthStorage();
          setAuthToken(null);
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error("[AuthContext] Error loading auth:", error);
        clearAllAuthStorage();
        setAuthToken(null);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    loadAuth();
  }, []);

  const login = async (usernameOrEmail: string, password: string) => {
    try {
      console.log("[AuthContext] Login attempt for:", usernameOrEmail);

      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Backend accepts either username or email in "username" field
        body: JSON.stringify({ username: usernameOrEmail, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        console.log("[AuthContext] ✅ Login successful");
        console.log("[AuthContext] User data received:", data.user);

        // Normalize storage
        localStorage.setItem(KEY_TOKEN, data.token);
        localStorage.setItem(KEY_USER, JSON.stringify(data.user));
        // (Optional) clear legacy keys to avoid confusion
        localStorage.removeItem(LEGACY_KEYS.token);
        localStorage.removeItem(LEGACY_KEYS.user);

        setAuthToken(data.token);
        setUser(data.user);
        setIsAuthenticated(true);

        // Debug: verify they’re actually persisted
        console.log("[AuthContext] Stored auth_token:", !!localStorage.getItem(KEY_TOKEN));
        console.log("[AuthContext] Stored user:", !!localStorage.getItem(KEY_USER));

        return { success: true };
      } else {
        console.log("[AuthContext] ❌ Login failed:", data.error);
        return { success: false, error: data.error || "Login failed" };
      }
    } catch (error) {
      console.error("[AuthContext] Login error:", error);
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const signup = async (username: string, email: string, password: string, name: string) => {
    try {
      console.log("[AuthContext] Signup attempt for:", username);

      const response = await fetch(`${API_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, name }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        console.log("[AuthContext] ✅ Signup successful");
        console.log("[AuthContext] User data received:", data.user);

        localStorage.setItem(KEY_TOKEN, data.token);
        localStorage.setItem(KEY_USER, JSON.stringify(data.user));
        localStorage.removeItem(LEGACY_KEYS.token);
        localStorage.removeItem(LEGACY_KEYS.user);

        setAuthToken(data.token);
        setUser(data.user);
        setIsAuthenticated(true);

        return { success: true };
      } else {
        console.log("[AuthContext] ❌ Signup failed:", data.error);
        return { success: false, error: data.error || "Signup failed" };
      }
    } catch (error) {
      console.error("[AuthContext] Signup error:", error);
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const logout = async () => {
    try {
      console.log("[AuthContext] Logging out...");

      if (authToken) {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: "POST",
          headers: { "X-Auth-Token": authToken },
        }).catch(() => {});
      }

      clearAllAuthStorage();

      setAuthToken(null);
      setUser(null);
      setIsAuthenticated(false);

      console.log("[AuthContext] ✅ Logged out successfully");
    } catch (error) {
      console.error("[AuthContext] Logout error:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        authToken,
        isAuthenticated,
        login,
        signup,
        logout,
        setUser,
        setAuthToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}