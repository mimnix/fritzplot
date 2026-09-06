import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { MeshPoller } from "./poller.js";
import type { SseEvent } from "../shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the built frontend directory. The compiled server entry lives at
 * `dist/server/server/index.js`, and the frontend is built to `dist/client`,
 * so we walk up to the `dist` root and into `client`.
 */
function resolveClientDir(): string {
  const candidates = [
    join(__dirname, "../../client"),
    join(__dirname, "../client"),
    join(process.cwd(), "dist/client"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]!;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const poller = new MeshPoller(config);

  // Serve the built frontend (dist/client) if present.
  const clientDir = resolveClientDir();
  if (existsSync(clientDir)) {
    await app.register(fastifyStatic, { root: clientDir });
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html");
    });
  }

  // Health check.
  app.get("/api/health", async () => ({ ok: true }));

  // Snapshot endpoint (for initial page load / debugging).
  app.get("/api/topology", async (_req, reply) => {
    const topology = poller.getLastTopology();
    if (!topology) {
      return reply.code(503).send({ error: "No topology available yet" });
    }
    return topology;
  });

  // Server-Sent Events stream for real-time updates.
  app.get("/events", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 3000\n\n");

    const send = (event: SseEvent): void => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // Send the current status immediately so the client doesn't stay stuck
    // on "Connecting…" (the status event is otherwise only broadcast on
    // connection-state transitions, which may have happened before this
    // client subscribed).
    const status = poller.getStatus();
    send({ type: "status", ...status });

    // Send the current snapshot immediately if available.
    const current = poller.getLastTopology();
    if (current) send({ type: "topology", data: current });

    const unsubscribe = poller.subscribe(send);

    req.raw.on("close", () => {
      unsubscribe();
    });
  });

  // Polling starts on demand when the first client connects (see MeshPoller).

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
