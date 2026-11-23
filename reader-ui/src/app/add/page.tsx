import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import AddSourcePage from "@/components/AddSourcePage";

export const dynamic = "force-dynamic";

export default async function AddPage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }
  return <AddSourcePage />;
}
