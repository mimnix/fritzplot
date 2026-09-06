import { Agent } from "node:https";
import { buildDigestAuthorization, parseDigestChallenge } from "./digest.js";

/**
 * Minimal TR-064 SOAP client for the FRITZ!Box.
 *
 * TR-064 exposes SOAP actions over HTTP at `/upnp/control/<service>`.
 * The box uses HTTP Digest auth. We only need a single action
 * (`X_AVM-DE_GetMeshListPath` on the `Hosts:1` service) plus fetching the
 * resulting URL, so the client is intentionally small.
 */

export interface FritzBoxConfig {
  /** Base URL, e.g. http://192.168.178.1 (no trailing slash). */
  url: string;
  username: string;
  password: string;
}

export class FritzBoxError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FritzBoxError";
  }
}

const SOAP_ENVELOPE = (service: string, action: string, args: string) =>
  `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="urn:dslforum-org:service:${service}">
      ${args}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

/**
 * Normalize the FRITZ!Box base URL for TR-064 access.
 *
 * TR-064 is served on dedicated ports, NOT the web UI port:
 *   - HTTP  -> port 49000
 *   - HTTPS -> port 49443
 *
 * If the user provides a URL without a port (e.g. `http://192.168.0.1` or
 * `https://fritz.box`), we append the correct TR-064 port. If a port is
 * already present, we leave it untouched.
 */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  if (parsed.port) return trimmed;
  parsed.port = parsed.protocol === "https:" ? "49443" : "49000";
  return parsed.toString().replace(/\/+$/, "");
}

/**
 * HTTPS agent that accepts the FRITZ!Box's self-signed certificate.
 * The box ships with a self-signed cert, so strict TLS verification fails.
 *
 * Node's `fetch` (undici) accepts a `node:https` Agent as its dispatcher at
 * runtime, but the TypeScript types differ. We cast through `unknown` to
 * bridge the two type systems.
 */
const insecureAgent = new Agent({ rejectUnauthorized: false }) as unknown as {
  dispatch: unknown;
};

export class Tr064Client {
  private readonly baseUrl: string;
  private readonly credentials: { username: string; password: string };

  constructor(config: FritzBoxConfig) {
    this.baseUrl = normalizeBaseUrl(config.url);
    this.credentials = {
      username: config.username,
      password: config.password,
    };
  }

  /**
   * Perform a SOAP action. Handles the digest challenge transparently:
   * first request without auth, then retry with the computed digest header.
   */
  async callAction(
    service: string,
    action: string,
    args: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    // The service type is e.g. "Hosts:1" (with instance suffix), but the
    // control URL path is just the service name without the ":1" suffix
    // (e.g. "/upnp/control/hosts").
    const serviceName = service.split(":")[0]!;
    const controlPath = `/upnp/control/${serviceName.toLowerCase()}`;
    const controlUrl = `${this.baseUrl}${controlPath}`;
    const body = SOAP_ENVELOPE(
      service,
      action,
      Object.entries(args)
        .map(([k, v]) => `<s:${k}>${v}</s:${k}>`)
        .join(""),
    );

    const headers: Record<string, string> = {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPAction: `urn:dslforum-org:service:${service}#${action}`,
    };

    const first = await this.request(controlUrl, body, headers);
    if (first.status === 401) {
      const challenge = first.headers.get("www-authenticate");
      if (!challenge) {
        throw new FritzBoxError("Digest challenge missing", first.status);
      }
      const auth = buildDigestAuthorization(
        parseDigestChallenge(challenge),
        this.credentials,
        "POST",
        controlPath,
      );
      headers.Authorization = auth;
      const second = await this.request(controlUrl, body, headers);
      if (second.status === 401) {
        throw new FritzBoxError("Authentication failed (401)", second.status);
      }
      return this.parseSoapResponse(await second.text());
    }

    if (!first.ok) {
      throw new FritzBoxError(`SOAP request failed (${first.status})`, first.status);
    }
    return this.parseSoapResponse(await first.text());
  }

  /** Fetch an arbitrary authenticated URL (used for the mesh list path). */
  async fetchAuthenticated(path: string): Promise<string> {
    // The mesh list path may be relative (e.g. "/net/mesh.lua") or absolute.
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const first = await this.request(url, undefined, {});
    if (first.status === 401) {
      const challenge = first.headers.get("www-authenticate");
      if (!challenge) throw new FritzBoxError("Digest challenge missing", first.status);
      const auth = buildDigestAuthorization(
        parseDigestChallenge(challenge),
        this.credentials,
        "GET",
        url,
      );
      const second = await this.request(url, undefined, { Authorization: auth });
      if (second.status === 401) {
        throw new FritzBoxError("Authentication failed (401)", second.status);
      }
      return second.text();
    }
    if (!first.ok) {
      throw new FritzBoxError(`Fetch failed (${first.status})`, first.status);
    }
    return first.text();
  }

  private async request(
    url: string,
    body: string | undefined,
    headers: Record<string, string>,
  ): Promise<Response> {
    const isHttps = url.startsWith("https:");
    return fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body,
      // Accept the FRITZ!Box self-signed certificate over HTTPS.
      ...(isHttps
        ? { dispatcher: insecureAgent as unknown as import("undici-types").Dispatcher }
        : {}),
    });
  }

  private parseSoapResponse(xml: string): Record<string, string> {
    const result: Record<string, string> = {};
    // Extract all leaf elements (e.g. <NewX_AVM-DE_MeshListPath>...</...>).
    // Note: AVM field names contain hyphens (e.g. "X_AVM-DE_MeshListPath"),
    // so the character class must include "-".
    const tagRe = /<([A-Za-z0-9_-]+)>([^<]*)<\/\1>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRe.exec(xml)) !== null) {
      const [, name, value] = match;
      if (name && !name.startsWith("s:") && !name.startsWith("u:")) {
        result[name] = value ?? "";
      }
    }
    return result;
  }
}
