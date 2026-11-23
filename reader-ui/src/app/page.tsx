import { redirect } from "next/navigation";
import { isAuthenticated, isPasswordConfigured } from "@/lib/auth";
import ReaderApp from "@/components/ReaderApp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authed = await isAuthenticated();
  if (!authed) {
    redirect("/login");
  }

  return <ReaderApp passwordEnabled={isPasswordConfigured()} />;
}
