"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rss, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || t("loginFailed"));
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(t("loginConnErr"));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-100 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-lg border border-slate-200 dark:border-slate-800 p-6">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-600 text-white flex items-center justify-center">
              <Rss className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">RSS Home</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("loginSubtitle")}
              </p>
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setLocale("vi")}
              className={`px-2 py-0.5 rounded ${
                locale === "vi" ? "bg-green-600 text-white font-semibold" : "text-slate-500"
              }`}
            >
              VI
            </button>
            <button
              type="button"
              onClick={() => setLocale("en")}
              className={`px-2 py-0.5 rounded ${
                locale === "en" ? "bg-green-600 text-white font-semibold" : "text-slate-500"
              }`}
            >
              EN
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("loginPasswordLabel")}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("loginPlaceholder")}
                autoFocus
                required
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium text-sm transition-colors"
          >
            {loading ? t("loginChecking") : t("loginBtn")}
          </button>
        </form>
      </div>
    </div>
  );
}
