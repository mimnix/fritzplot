import { createHash, randomBytes } from "node:crypto";

/**
 * Minimal HTTP Digest authentication (RFC 7616) implementation for the
 * FRITZ!Box TR-064 interface. The box challenges with `WWW-Authenticate:
 * Digest ...` and expects an `Authorization` header computed from the
 * challenge's nonce/realm/qop.
 *
 * Implemented natively (no external deps) to keep the image lightweight.
 */

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

export interface Credentials {
  username: string;
  password: string;
}

/** Parse a `WWW-Authenticate: Digest ...` header value. */
export function parseDigestChallenge(header: string): DigestChallenge {
  const challenge: DigestChallenge = { realm: "", nonce: "" };
  // Strip the leading "Digest " scheme.
  const body = header.replace(/^Digest\s+/i, "");
  const parts = body.split(",");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim().replace(/^"|"$/g, "");
    if (key === "realm") challenge.realm = value;
    else if (key === "nonce") challenge.nonce = value;
    else if (key === "qop") challenge.qop = value;
    else if (key === "opaque") challenge.opaque = value;
    else if (key === "algorithm") challenge.algorithm = value;
  }
  return challenge;
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

/**
 * Build the `Authorization` header value for a digest challenge.
 * Uses qop="auth" with a client nonce and nc=00000001 when the server
 * requests qop, otherwise falls back to the legacy RFC 2069 form.
 */
export function buildDigestAuthorization(
  challenge: DigestChallenge,
  credentials: Credentials,
  method: string,
  uri: string,
): string {
  const { username, password } = credentials;
  const cnonce = randomBytes(8).toString("hex");
  const nc = "00000001";

  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);

  let response: string;
  if (challenge.qop) {
    response = md5(
      `${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`,
    );
  } else {
    response = md5(`${ha1}:${challenge.nonce}:${ha2}`);
  }

  const fields: string[] = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.algorithm) fields.push(`algorithm=${challenge.algorithm}`);
  if (challenge.opaque) fields.push(`opaque="${challenge.opaque}"`);
  if (challenge.qop) {
    fields.push(`qop=${challenge.qop}`);
    fields.push(`nc=${nc}`);
    fields.push(`cnonce="${cnonce}"`);
  }
  return `Digest ${fields.join(", ")}`;
}
