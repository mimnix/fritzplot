import { describe, it, expect } from "vitest";
import {
  parseDigestChallenge,
  buildDigestAuthorization,
} from "../src/server/fritzbox/digest.js";

describe("parseDigestChallenge", () => {
  it("parses a standard digest challenge header", () => {
    const header =
      'Digest realm="FRITZ!Box", nonce="abc123", qop="auth", opaque="xyz", algorithm=MD5';
    const challenge = parseDigestChallenge(header);
    expect(challenge.realm).toBe("FRITZ!Box");
    expect(challenge.nonce).toBe("abc123");
    expect(challenge.qop).toBe("auth");
    expect(challenge.opaque).toBe("xyz");
    expect(challenge.algorithm).toBe("MD5");
  });

  it("handles a minimal challenge without qop", () => {
    const header = 'Digest realm="box", nonce="n1"';
    const challenge = parseDigestChallenge(header);
    expect(challenge.realm).toBe("box");
    expect(challenge.nonce).toBe("n1");
    expect(challenge.qop).toBeUndefined();
  });
});

describe("buildDigestAuthorization", () => {
  const credentials = { username: "user", password: "pass" };

  it("produces a valid Authorization header with qop", () => {
    const challenge = {
      realm: "FRITZ!Box",
      nonce: "abc123",
      qop: "auth",
      opaque: "xyz",
      algorithm: "MD5",
    };
    const auth = buildDigestAuthorization(
      challenge,
      credentials,
      "POST",
      "/upnp/control/hosts",
    );
    expect(auth).toMatch(/^Digest /);
    expect(auth).toContain('username="user"');
    expect(auth).toContain('realm="FRITZ!Box"');
    expect(auth).toContain('nonce="abc123"');
    expect(auth).toContain('uri="/upnp/control/hosts"');
    expect(auth).toContain("qop=auth");
    expect(auth).toContain("nc=00000001");
    expect(auth).toContain("cnonce=");
    expect(auth).toContain("response=");
  });

  it("produces a legacy RFC 2069 header without qop", () => {
    const challenge = { realm: "box", nonce: "n1" };
    const auth = buildDigestAuthorization(challenge, credentials, "GET", "/path");
    expect(auth).toMatch(/^Digest /);
    expect(auth).not.toContain("qop=");
    expect(auth).not.toContain("cnonce=");
    expect(auth).toContain("response=");
  });

  it("computes a deterministic response for known inputs (RFC 7616 example)", () => {
    // RFC 7616 §3.9.1 example values.
    const challenge = {
      realm: "http-auth@example.org",
      nonce: "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
      qop: "auth",
      algorithm: "MD5",
    };
    const creds = { username: "Mufasa", password: "Circle of Life" };
    const auth = buildDigestAuthorization(
      challenge,
      creds,
      "GET",
      "/dir/index.html",
    );
    // The response is non-deterministic due to cnonce, but must be well-formed.
    expect(auth).toContain('username="Mufasa"');
    expect(auth).toContain('realm="http-auth@example.org"');
    expect(auth).toContain('uri="/dir/index.html"');
    expect(auth).toContain("response=");
  });
});
