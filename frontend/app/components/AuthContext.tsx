import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

interface User {
  username: string;
  email: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  authToken: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (username: string, email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setAuthToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load auth token and user from localStorage on mount
  useEffect(() => {
    const loadAuth = async () => {
      try {
        const storedToken = localStorage.getItem("auth_token");
        const storedUser = localStorage.getItem("user");

        console.log("[AuthContext] Loading from localStorage:");
        console.log("- Token:", storedToken ? "Present" : "Missing");
        console.log("- User:", storedUser ? "Present" : "Missing");

        if (storedToken && storedUser) {
          // Verify token is still valid
          const response = await fetch(`${API_URL}/api/auth/verify`, {
            headers: {
              "X-Auth-Token": storedToken,
            },
          });

          if (response.ok) {
            const data = await response.json();
            setAuthToken(storedToken);
            setUser(JSON.parse(storedUser));
            setIsAuthenticated(true);
            console.log("[AuthContext] ✅ Auth restored from localStorage");
          } else {
            // Token expired or invalid
            console.log("[AuthContext] ❌ Token expired, clearing localStorage");
            localStorage.removeItem("auth_token");
            localStorage.removeItem("user");
            setAuthToken(null);
            setUser(null);
            setIsAuthenticated(false);
          }
        }
      } catch (error) {
        console.error("[AuthContext] Error loading auth:", error);
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user");
        setAuthToken(null);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    loadAuth();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      console.log("[AuthContext] Login attempt for:", username);

      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        console.log("[AuthContext] ✅ Login successful");
        
        // Store in localStorage
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));

        // Update state
        setAuthToken(data.token);
        setUser(data.user);
        setIsAuthenticated(true);

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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, email, password, name }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        console.log("[AuthContext] ✅ Signup successful");
        
        // Store in localStorage
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));

        // Update state
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

      // Call backend logout endpoint
      if (authToken) {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: "POST",
          headers: {
            "X-Auth-Token": authToken,
          },
        });
      }

      // Clear localStorage
      localStorage.removeItem("auth_token");
      localStorage.removeItem("user");
      localStorage.removeItem("review_token");

      // Clear state
      setAuthToken(null);
      setUser(null);
      setIsAuthenticated(false);

      console.log("[AuthContext] ✅ Logged out successfully");
    } catch (error) {
      console.error("[AuthContext] Logout error:", error);
    }
  };

  // Don't render children until auth state is loaded
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