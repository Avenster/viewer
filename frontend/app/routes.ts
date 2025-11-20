// routes.ts
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/viewer", "routes/viewer.tsx"),
  route("/login", "routes/login.tsx"),
  route("/pdf", "routes/uploadpdf.tsx"),
  route("/admin-login", "routes/admin-login.tsx"),
  route("/admindashboard", "routes/admindashboard.tsx"),
  route("/qc-login", "routes/qc-login.tsx"),
  route("/qcdashboard", "routes/qcdashboard.tsx"),
] satisfies RouteConfig;
