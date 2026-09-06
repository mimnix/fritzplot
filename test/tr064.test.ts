import { describe, it, expect } from "vitest";
import { normalizeBaseUrl } from "../src/server/fritzbox/tr064.js";

describe("normalizeBaseUrl", () => {
  it("appends TR-064 HTTP port 49000 when no port is given", () => {
    expect(normalizeBaseUrl("http://192.168.0.1")).toBe("http://192.168.0.1:49000");
  });

  it("appends TR-064 HTTPS port 49443 when no port is given", () => {
    expect(normalizeBaseUrl("https://192.168.0.1")).toBe("https://192.168.0.1:49443");
  });

  it("appends the port to a hostname URL", () => {
    expect(normalizeBaseUrl("http://fritz.box")).toBe("http://fritz.box:49000");
  });

  it("keeps an explicit port untouched", () => {
    expect(normalizeBaseUrl("http://192.168.0.1:49000")).toBe("http://192.168.0.1:49000");
    expect(normalizeBaseUrl("https://192.168.0.1:49443")).toBe("https://192.168.0.1:49443");
  });

  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("http://192.168.0.1/")).toBe("http://192.168.0.1:49000");
  });
});
