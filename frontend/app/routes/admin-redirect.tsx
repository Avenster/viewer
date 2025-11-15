import { redirect } from "react-router";

export async function loader() {
  return redirect("/admin/login");
}

export default function AdminRedirect() {
  return null;
}