import { createHmac, randomInt } from "node:crypto";

export function generateSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashRegisterCode(email: string, code: string): string {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error("APP_SECRET is not set");
  }
  return createHmac("sha256", secret).update(`${email.toLowerCase()}:${code}`).digest("hex");
}
