import { describe, it, expect } from "vitest";
import {
  createToken,
  verifyToken,
  verifyCredentials,
} from "../src/server/auth.js";

const config = { username: "admin", password: "secret123" };

describe("auth tokens", () => {
  it("creates a token that verifies successfully", () => {
    const token = createToken(config, false);
    expect(verifyToken(token, config)).toBe(true);
  });

  it("rejects a token signed with a different password", () => {
    const token = createToken(config, false);
    const otherConfig = { username: "admin", password: "different" };
    expect(verifyToken(token, otherConfig)).toBe(false);
  });

  it("rejects a tampered token", () => {
    const token = createToken(config, false);
    const tampered = token.slice(0, -2) + "xx";
    expect(verifyToken(tampered, config)).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = Date.now();
    const token = createToken(config, false, now);
    // 25 hours later (session TTL is 24h).
    expect(verifyToken(token, config, now + 25 * 60 * 60 * 1000)).toBe(false);
  });

  it("accepts a 'remember me' token for 6 months", () => {
    const now = Date.now();
    const token = createToken(config, true, now);
    // 5 months later — still valid.
    expect(verifyToken(token, config, now + 5 * 30 * 24 * 60 * 60 * 1000)).toBe(true);
    // 7 months later — expired.
    expect(verifyToken(token, config, now + 7 * 30 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("rejects undefined or malformed tokens", () => {
    expect(verifyToken(undefined, config)).toBe(false);
    expect(verifyToken("", config)).toBe(false);
    expect(verifyToken("not-a-token", config)).toBe(false);
  });
});

describe("verifyCredentials", () => {
  it("accepts correct credentials", () => {
    expect(verifyCredentials("admin", "secret123", config)).toBe(true);
  });

  it("rejects wrong password", () => {
    expect(verifyCredentials("admin", "wrong", config)).toBe(false);
  });

  it("rejects wrong username", () => {
    expect(verifyCredentials("root", "secret123", config)).toBe(false);
  });
});
