import crypto from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "rss_reader_session";

function getSecret(): string {
  const pw = process.env.READER_UI_PASSWORD || "";
  if (pw) return pw;
  // Fallback chỉ dùng khi chưa đặt mật khẩu trong môi trường dev
  return "rss-home-dev-secret";
}

export function isPasswordConfigured(): boolean {
  return Boolean((process.env.READER_UI_PASSWORD || "").trim());
}

export function verifyPassword(input: string): boolean {
  const expected = process.env.READER_UI_PASSWORD || "";
  if (!expected) {
    return true;
  }
  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createSessionToken(): string {
  const issuedAt = Date.now().toString();
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(issuedAt)
    .digest("hex");
  return `${issuedAt}.${sig}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!isPasswordConfigured()) {
    return true;
  }
  if (!token || !token.includes(".")) return false;
  const [issuedAt, sig] = token.split(".", 2);
  if (!issuedAt || !sig) return false;
  const expectedSig = crypto
    .createHmac("sha256", getSecret())
    .update(issuedAt)
    .digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  const ts = Number(issuedAt);
  if (!Number.isFinite(ts)) return false;
  // Phiên đăng nhập có hiệu lực 30 ngày
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  return Date.now() - ts < maxAgeMs;
}

export async function isAuthenticated(): Promise<boolean> {
  if (!isPasswordConfigured()) return true;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}
