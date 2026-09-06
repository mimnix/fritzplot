/**
 * Shared types for FritzPlot.
 *
 * These types describe the *normalized* mesh topology that the backend
 * produces from the raw FRITZ!OS mesh JSON (see AVM "Mesh-Topologie" schema).
 * The frontend consumes exactly this shape over SSE.
 */

export type MeshRole = "master" | "slave" | "unknown";

export type LinkType = "LAN" | "WLAN" | "PLC" | "DECT" | "unknown";

export type LinkState = "CONNECTED" | "DISCONNECTED";

/** Wireless band, derived from the channel frequency. */
export type WifiBand = "2.4" | "5" | "6" | null;

/** A mesh node: the FRITZ!Box (master) or a repeater/powerline (slave). */
export interface MeshNode {
  uid: string;
  name: string;
  friendlyName: string | null;
  model: string;
  manufacturer: string;
  firmwareVersion: string;
  macAddress: string;
  role: MeshRole;
  isMeshed: boolean;
  /** WAN counters (bytes rx/tx) for this node, if reported. */
  wanBytes: { rx: number; tx: number } | null;
}

/** A client device (laptop, phone, TV, ...) attached to a mesh node. */
export interface ClientDevice {
  uid: string;
  name: string;
  friendlyName: string | null;
  model: string;
  manufacturer: string;
  macAddress: string;
  /** UID of the mesh node this client is attached to. */
  attachedToNodeUid: string | null;
  /** Connection type of the active link (WLAN/LAN/PLC). */
  connectionType: LinkType;
  /** Wireless band (2.4/5/6 GHz), if the client is on WLAN. */
  band: WifiBand;
  /** Signal strength (RCPI) in dBm, if available. */
  signalDbm: number | null;
  /** Current data rates in kbit/s. */
  dataRate: { rx: number; tx: number } | null;
  /** Max (negotiated) data rates in kbit/s. */
  maxDataRate: { rx: number; tx: number } | null;
  online: boolean;
}

/** A link between two mesh nodes (e.g. master <-> repeater). */
export interface MeshLink {
  uid: string;
  type: LinkType;
  state: LinkState;
  node1Uid: string;
  node2Uid: string;
  /** Wireless band (2.4/5/6 GHz), if this is a WLAN link. */
  band: WifiBand;
  /** Current data rates in kbit/s. */
  dataRate: { rx: number; tx: number } | null;
  /** Max data rates in kbit/s. */
  maxDataRate: { rx: number; tx: number } | null;
  /** Signal (RCPI) in dBm, if available. */
  signalDbm: number | null;
}

/** The fully normalized topology sent to the frontend. */
export interface MeshTopology {
  schemaVersion: string;
  nodes: MeshNode[];
  clients: ClientDevice[];
  links: MeshLink[];
  /** UNIX ms timestamp of when this snapshot was fetched. */
  fetchedAt: number;
}

/** SSE event payloads. */
export type SseEvent =
  | { type: "topology"; data: MeshTopology }
  | { type: "error"; message: string }
  | { type: "status"; connected: boolean; message: string };
