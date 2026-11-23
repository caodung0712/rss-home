import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import StatusDashboard from "@/components/StatusDashboard";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }
  return <StatusDashboard />;
}
