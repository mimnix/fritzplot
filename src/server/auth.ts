import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Simple token-based authentication for the web app.
 *
 * Tokens are HMAC-SHA256 signed payloads of the form `base64(payload).signature`.
 * The payload contains the expiry timestamp. The signing secret is derived
 * from the admin password, so tokens survive container restarts.
 *
 * "Keep me signed in" → 6-month expiry; otherwise a short-lived session token.
 */

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (session)
const REMEMBER_TTL_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months

export interface AuthConfig {
  username: string;
  password: string;
}

interface TokenPayload {
  exp: number;
}

function secretFromPassword(password: string): Buffer {
  return createHmac("sha256", "fritzplot-auth").update(password).digest();
}

function sign(payload: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Create a signed token with the given expiry timestamp. */
export function createToken(
  config: AuthConfig,
  remember: boolean,
  now = Date.now(),
): string {
  const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  const payload: TokenPayload = { exp: now + ttl };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded, secretFromPassword(config.password));
  return `${encoded}.${signature}`;
}

/** Verify a token, returning true if it is valid and not expired. */
export function verifyToken(
  token: string | undefined,
  config: AuthConfig,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const secret = secretFromPassword(config.password);

  const expected = sign(encoded, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as TokenPayload;
    return typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

/** Verify the admin credentials (constant-time comparison). */
export function verifyCredentials(
  username: string,
  password: string,
  config: AuthConfig,
): boolean {
  const userBuf = Buffer.from(username);
  const passBuf = Buffer.from(password);
  const expectedUser = Buffer.from(config.username);
  const expectedPass = Buffer.from(config.password);

  // timingSafeEqual throws on length mismatch, so guard lengths first.
  if (userBuf.length !== expectedUser.length) return false;
  if (passBuf.length !== expectedPass.length) return false;

  const userOk = timingSafeEqual(userBuf, expectedUser);
  const passOk = timingSafeEqual(passBuf, expectedPass);
  return userOk && passOk;
}
