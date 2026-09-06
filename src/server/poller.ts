import type { MeshTopology, SseEvent } from "../shared/types.js";
import { fetchRawTopology, parseTopology } from "./fritzbox/mesh.js";
import { Tr064Client } from "./fritzbox/tr064.js";
import type { AppConfig } from "./config.js";

/**
 * Polls the FRITZ!Box for the mesh topology and broadcasts updates to all
 * connected SSE clients.
 *
 * Polling is "on demand": it only runs while at least one client is
 * connected. When the last client disconnects, polling stops, so the router
 * is not hit continuously when nobody is viewing the app.
 */
export class MeshPoller {
  private readonly client: Tr064Client;
  private readonly intervalMs: number;
  private readonly listeners = new Set<(event: SseEvent) => void>();
  private timer: NodeJS.Timeout | null = null;
  private lastTopology: MeshTopology | null = null;
  private connected = false;
  private lastError: string | null = null;

  constructor(config: AppConfig) {
    this.client = new Tr064Client({
      url: config.fritzboxUrl,
      username: config.fritzboxUser,
      password: config.fritzboxPassword,
    });
    this.intervalMs = config.pollIntervalMs;
  }

  /** Start polling (called when the first client connects). */
  private start(): void {
    if (this.timer) return; // already polling
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  /** Stop polling (called when the last client disconnects). */
  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Latest known topology (may be null before the first successful poll). */
  getLastTopology(): MeshTopology | null {
    return this.lastTopology;
  }

  /** Current connection status, for sending to newly-connected clients. */
  getStatus(): { connected: boolean; message: string } {
    return this.connected
      ? { connected: true, message: "Connected" }
      : { connected: false, message: this.lastError ?? "Connecting…" };
  }

  /**
   * Subscribe a client to topology updates. Polling starts when the first
   * client subscribes and stops when the last one unsubscribes.
   */
  subscribe(listener: (event: SseEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  private broadcast(event: SseEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async poll(): Promise<void> {
    try {
      const raw = await fetchRawTopology(this.client);
      const topology = parseTopology(raw);
      this.lastTopology = topology;
      if (!this.connected) {
        this.connected = true;
        this.lastError = null;
        console.log(
          `[fritzplot] Connected to FRITZ!Box — ${topology.nodes.length} mesh node(s), ${topology.clients.length} client(s)`,
        );
        this.broadcast({ type: "status", connected: true, message: "Connected" });
      }
      this.broadcast({ type: "topology", data: topology });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fritzplot] Poll failed: ${message}`);
      this.lastError = message;
      if (this.connected) {
        this.connected = false;
        this.broadcast({ type: "status", connected: false, message });
      }
      this.broadcast({ type: "error", message });
    }
  }
}
