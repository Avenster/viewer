import React, { createContext, useContext, useState, useEffect } from "react";

const API_URL = (import.meta.env.VITE_API_URL as string) || "http://13.201.123.132:5000";

export interface User {
  user_id: string;
  username: string;
  email: string;
  name: string;
  role?: string; // "admin" | "qc" | "user"
}

interface AuthContextType {
  user: User | null;
  authToken: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; user?: User | null }>;
  signup: (username: string, email: string, password: string, name: string) => Promise<{ success: boolean; error?: string; user?: User | null }>;
  logoutCurrent: () => Promise<void>;
  logoutAll: () => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isQC: boolean;
  verifyToken: (token: string) => Promise<boolean>;
  switchActiveRole: (role: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};

// Use localStorage but with route isolation
const getRoleKey = (role: string) => `auth_token_${role.toLowerCase()}`;
const getCurrentRoleFromPath = () => {
  if (typeof window === 'undefined') return 'user';
  const path = window.location.pathname;
  if (path.includes('/admin')) return 'admin';
  if (path.includes('/qc')) return 'qc';
  return 'user';
};

// Safe localStorage access
const getLocalStorage = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.error('localStorage access error:', error);
    return null;
  }
};

const setLocalStorage = (key: string, value: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error('localStorage set error:', error);
  }
};

const removeLocalStorage = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('localStorage remove error:', error);
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize auth based on current route
  useEffect(() => {
    (async () => {
      const currentRole = getCurrentRoleFromPath();
      const token = getLocalStorage(getRoleKey(currentRole));
      
      if (token) {
        const ok = await verifyToken(token);
        if (ok) {
          setAuthToken(token);
        } else {
          removeLocalStorage(getRoleKey(currentRole));
        }
      }
      
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyToken = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/verify`, {
        headers: { "X-Auth-Token": token },
      });
      
      if (!response.ok) {
        // Remove from all role slots
        ['admin', 'qc', 'user'].forEach(role => {
          const roleToken = getLocalStorage(getRoleKey(role));
          if (roleToken === token) {
            removeLocalStorage(getRoleKey(role));
          }
        });
        
        setAuthToken(null);
        setUser(null);
        return false;
      }
      
      const data = await response.json().catch(() => ({}));
      if (data && data.user) {
        setUser(data.user as User);
        setAuthToken(token);
        
        // Store token in role-specific slot
        const role = (data.user.role || "user").toLowerCase();
        setLocalStorage(getRoleKey(role), token);
        
        return true;
      }
      
      setUser(null);
      setAuthToken(null);
      return false;
    } catch (err) {
      console.error("verifyToken error", err);
      setUser(null);
      setAuthToken(null);
      return false;
    }
  };

  const login = async (username: string, password: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.auth_token) {
        const token: string = data.auth_token;
        const returnedUser: User | undefined = data.user;
        const role = (returnedUser?.role || "user").toLowerCase();

        // Store in role-specific localStorage
        setLocalStorage(getRoleKey(role), token);

        // Update context state
        setAuthToken(token);
        if (returnedUser) {
          setUser(returnedUser);
        } else {
          await verifyToken(token);
        }

        return { success: true, user: returnedUser || null };
      } else {
        return { success: false, error: data.error || "Login failed" };
      }
    } catch (err) {
      console.error("Login error", err);
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const signup = async (username: string, email: string, password: string, name: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, name }),
      });
      
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.auth_token) {
        const token: string = data.auth_token;
        const returnedUser: User | undefined = data.user;
        const role = (returnedUser?.role || "user").toLowerCase();
        
        setLocalStorage(getRoleKey(role), token);
        setAuthToken(token);
        
        if (returnedUser) setUser(returnedUser);
        else await verifyToken(token);
        
        return { success: true, user: returnedUser || null };
      } else {
        return { success: false, error: data.error || "Signup failed" };
      }
    } catch (err) {
      console.error("Signup error", err);
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const switchActiveRole = async (role: string) => {
    const token = getLocalStorage(getRoleKey(role));
    if (!token) return false;
    
    const ok = await verifyToken(token);
    if (ok) {
      return true;
    } else {
      removeLocalStorage(getRoleKey(role));
      return false;
    }
  };

  const logoutCurrent = async () => {
    try {
      const currentRole = getCurrentRoleFromPath();
      const token = getLocalStorage(getRoleKey(currentRole));
      
      if (token) {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: "POST",
          headers: { "X-Auth-Token": token },
        }).catch(() => {});
      }
    } finally {
      const currentRole = getCurrentRoleFromPath();
      removeLocalStorage(getRoleKey(currentRole));
      setUser(null);
      setAuthToken(null);
    }
  };

  const logoutAll = async () => {
    try {
      // Logout from all roles
      const roles = ['admin', 'qc', 'user'];
      const tokens = roles.map(role => getLocalStorage(getRoleKey(role))).filter(Boolean);
      
      for (const token of tokens) {
        if (token) {
          await fetch(`${API_URL}/api/auth/logout`, {
            method: "POST",
            headers: { "X-Auth-Token": token },
          }).catch(() => {});
        }
      }
    } finally {
      // Clear all role tokens
      ['admin', 'qc', 'user'].forEach(role => {
        removeLocalStorage(getRoleKey(role));
      });
      setUser(null);
      setAuthToken(null);
    }
  };

  const isAdmin = !!(user && user.role && user.role.toLowerCase() === "admin");
  const isQC = !!(user && user.role && user.role.toLowerCase() === "qc");

  return (
    <AuthContext.Provider
      value={{
        user,
        authToken,
        loading,
        login,
        signup,
        logoutCurrent,
        logoutAll,
        logout: logoutCurrent,
        isAuthenticated: !!user,
        isAdmin,
        isQC,
        verifyToken,
        switchActiveRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};