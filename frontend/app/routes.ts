import { type RouteConfig, route, index } from "@react-router/dev/routes";

export default [
  // User routes
  index("routes/login.tsx"),
  route("login", "routes/login-redirect.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("home", "routes/home.tsx"),
  route("viewer", "routes/viewer.tsx"),
  
  // Admin routes
  route("admin/login", "routes/admin.login.tsx"),
  route("admin/dashboard", "routes/admin.dashboard.tsx"),
  route("admin/assign-work", "routes/admin.assign-work.tsx"),  // ✅ Add this
] satisfies RouteConfig;