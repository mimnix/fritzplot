/**
 * Environment configuration. All settings come from environment variables
 * (no config files), as required for the Docker deployment.
 */

export interface AppConfig {
  fritzboxUrl: string;
  fritzboxUser: string;
  fritzboxPassword: string;
  pollIntervalMs: number;
  port: number;
  host: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const url = env.FRITZBOX_URL;
  const password = env.FRITZBOX_PASSWORD;

  if (!url) {
    throw new Error("FRITZBOX_URL environment variable is required");
  }
  if (!password) {
    throw new Error("FRITZBOX_PASSWORD environment variable is required");
  }

  const pollSeconds = Number(env.POLL_INTERVAL ?? "10");
  const pollIntervalMs = Number.isFinite(pollSeconds)
    ? Math.max(1, pollSeconds) * 1000
    : 10_000;

  return {
    fritzboxUrl: url,
    fritzboxUser: env.FRITZBOX_USER ?? "",
    fritzboxPassword: password,
    pollIntervalMs,
    port: Number(env.PORT ?? "3000"),
    host: env.HOST ?? "0.0.0.0",
  };
}
