import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import ContentManager from "@/components/ContentManager";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }
  return <ContentManager />;
}
