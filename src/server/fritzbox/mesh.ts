import type {
  ClientDevice,
  LinkState,
  LinkType,
  MeshLink,
  MeshNode,
  MeshRole,
  MeshTopology,
  WifiBand,
} from "../../shared/types.js";
import type { Tr064Client } from "./tr064.js";

/**
 * Fetch the raw mesh topology JSON from the FRITZ!Box.
 *
 * Flow:
 *  1. SOAP `Hosts:1` -> `X_AVM-DE_GetMeshListPath` returns a URL to a Lua
 *     script that emits the topology JSON.
 *  2. Fetch that URL (authenticated) to get the raw JSON.
 */
export async function fetchRawTopology(
  client: Tr064Client,
): Promise<unknown> {
  const result = await client.callAction("Hosts:1", "X_AVM-DE_GetMeshListPath");
  const path = result["NewX_AVM-DE_MeshListPath"];
  if (!path) {
    throw new Error("Mesh list path not returned by FRITZ!Box");
  }
  const raw = await client.fetchAuthenticated(path);
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Raw (untyped) shapes as returned by the FRITZ!OS mesh JSON.
// ---------------------------------------------------------------------------

interface RawNode {
  uid?: string;
  device_name?: string;
  device_friendly_name?: string | null;
  device_model?: string;
  device_manufacturer?: string;
  device_firmware_version?: string;
  device_mac_address?: string;
  is_meshed?: boolean;
  mesh_role?: string;
  metrics?: { wan_counters?: { bytes?: { rx?: number; tx?: number } } | null };
  node_interfaces?: RawInterface[];
}

interface RawInterface {
  uid?: string;
  type?: string;
  mac_address?: string;
  node_uid?: string;
  current_channel_info?: { primary_freq?: number | null };
  node_links?: RawLink[];
}

interface RawLink {
  uid?: string;
  type?: string;
  state?: string;
  node_1_uid?: string;
  node_2_uid?: string;
  node_interface_1_uid?: string;
  node_interface_2_uid?: string;
  cur_data_rate_rx?: number;
  cur_data_rate_tx?: number;
  max_data_rate_rx?: number;
  max_data_rate_tx?: number;
  rx_rcpi?: number;
  tx_rcpi?: number;
}

interface RawTopology {
  schema_version?: string;
  nodes?: RawNode[];
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

const asLinkType = (v: string | undefined): LinkType =>
  v === "LAN" || v === "WLAN" || v === "PLC" || v === "DECT" ? v : "unknown";

const asRole = (v: string | undefined): MeshRole =>
  v === "master" || v === "slave" ? v : "unknown";

const asState = (v: string | undefined): LinkState =>
  v === "CONNECTED" ? "CONNECTED" : "DISCONNECTED";

/** RCPI 255 means "unknown" per the AVM schema. */
const rcpi = (v: number | undefined): number | null =>
  v === undefined || v === 255 ? null : v;

const rate = (v: number | undefined): number | null =>
  v === undefined ? null : v;

/**
 * Derive the wireless band from a channel frequency in kHz.
 *   - 2.4 GHz: 2400–2500 MHz
 *   - 5 GHz:   5000–5900 MHz
 *   - 6 GHz:   5900–7100 MHz
 */
const bandFromFreq = (freqKHz: number | null | undefined): WifiBand => {
  if (freqKHz == null) return null;
  const mhz = freqKHz / 1000;
  if (mhz >= 2400 && mhz < 2500) return "2.4";
  if (mhz >= 5000 && mhz < 5900) return "5";
  if (mhz >= 5900 && mhz < 7100) return "6";
  return null;
};

/**
 * Parse the raw FRITZ!OS mesh topology JSON into a normalized MeshTopology.
 *
 * Pure function: same input -> same output, no side effects.
 *
 * The raw topology contains:
 *  - `nodes[]`: every device (mesh nodes AND client devices).
 *  - `node_interfaces[]`: interfaces per node (LAN/WLAN/PLC).
 *  - `node_links[]`: links between interfaces (both node-to-node uplinks
 *    and client-to-node attachments).
 *
 * We classify each node as a mesh node (master/slave) or a client, then
 * resolve links to build the graph.
 */
export function parseTopology(raw: unknown): MeshTopology {
  const topo = raw as RawTopology;
  const rawNodes = topo.nodes ?? [];

  // First pass: classify nodes and index interfaces by uid.
  const meshNodes: MeshNode[] = [];
  const clients: ClientDevice[] = [];
  const interfaceOwner = new Map<string, string>(); // interface uid -> node uid
  const interfaceType = new Map<string, LinkType>();
  const interfaceBand = new Map<string, WifiBand>(); // interface uid -> band
  const nodeByUid = new Map<string, RawNode>();

  for (const node of rawNodes) {
    const uid = node.uid ?? "";
    nodeByUid.set(uid, node);

    const isMeshNode =
      node.is_meshed === true ||
      node.mesh_role === "master" ||
      node.mesh_role === "slave";

    const wanBytes = node.metrics?.wan_counters?.bytes;
    const wan = wanBytes
      ? { rx: wanBytes.rx ?? 0, tx: wanBytes.tx ?? 0 }
      : null;

    if (isMeshNode) {
      meshNodes.push({
        uid,
        name: node.device_name ?? "Unknown",
        friendlyName: node.device_friendly_name ?? null,
        model: node.device_model ?? "Unknown",
        manufacturer: node.device_manufacturer ?? "Unknown",
        firmwareVersion: node.device_firmware_version ?? "",
        macAddress: node.device_mac_address ?? "",
        role: asRole(node.mesh_role),
        isMeshed: node.is_meshed === true,
        wanBytes: wan,
      });
    } else {
      clients.push({
        uid,
        name: node.device_name ?? "Unknown",
        friendlyName: node.device_friendly_name ?? null,
        model: node.device_model ?? "Unknown",
        manufacturer: node.device_manufacturer ?? "Unknown",
        macAddress: node.device_mac_address ?? "",
        attachedToNodeUid: null,
        connectionType: "unknown",
        band: null,
        signalDbm: null,
        dataRate: null,
        maxDataRate: null,
        online: false,
      });
    }

    for (const intf of node.node_interfaces ?? []) {
      if (intf.uid) interfaceOwner.set(intf.uid, uid);
      if (intf.uid) interfaceType.set(intf.uid, asLinkType(intf.type));
      if (intf.uid) {
        interfaceBand.set(
          intf.uid,
          bandFromFreq(intf.current_channel_info?.primary_freq),
        );
      }
    }
  }

  // Second pass: resolve links.
  const links: MeshLink[] = [];
  const clientByUid = new Map(clients.map((c) => [c.uid, c]));

  for (const node of rawNodes) {
    for (const intf of node.node_interfaces ?? []) {
      for (const link of intf.node_links ?? []) {
        const node1 = link.node_1_uid ?? "";
        const node2 = link.node_2_uid ?? "";
        const type = asLinkType(link.type);
        const state = asState(link.state);

        const n1IsMesh = nodeByUid.get(node1)?.is_meshed === true;
        const n2IsMesh = nodeByUid.get(node2)?.is_meshed === true;

        // The band is read from the interface this link belongs to.
        const band = interfaceBand.get(intf.uid ?? "") ?? null;

        if (n1IsMesh && n2IsMesh) {
          // Uplink between two mesh nodes.
          links.push({
            uid: link.uid ?? `${node1}-${node2}`,
            type,
            state,
            node1Uid: node1,
            node2Uid: node2,
            band,
            dataRate:
              rate(link.cur_data_rate_rx) !== null ||
              rate(link.cur_data_rate_tx) !== null
                ? {
                    rx: link.cur_data_rate_rx ?? 0,
                    tx: link.cur_data_rate_tx ?? 0,
                  }
                : null,
            maxDataRate:
              rate(link.max_data_rate_rx) !== null ||
              rate(link.max_data_rate_tx) !== null
                ? {
                    rx: link.max_data_rate_rx ?? 0,
                    tx: link.max_data_rate_tx ?? 0,
                  }
                : null,
            signalDbm: rcpi(link.rx_rcpi),
          });
        } else {
          // Attachment: a client connected to a mesh node.
          const meshUid = n1IsMesh ? node1 : n2IsMesh ? node2 : null;
          const clientUid = n1IsMesh ? node2 : node1;
          const client = clientByUid.get(clientUid);
          if (client && meshUid) {
            client.attachedToNodeUid = meshUid;
            client.connectionType = type;
            client.band = band;
            client.online = state === "CONNECTED";
            client.signalDbm = rcpi(link.rx_rcpi);
            client.dataRate =
              rate(link.cur_data_rate_rx) !== null ||
              rate(link.cur_data_rate_tx) !== null
                ? {
                    rx: link.cur_data_rate_rx ?? 0,
                    tx: link.cur_data_rate_tx ?? 0,
                  }
                : null;
            client.maxDataRate =
              rate(link.max_data_rate_rx) !== null ||
              rate(link.max_data_rate_tx) !== null
                ? {
                    rx: link.max_data_rate_rx ?? 0,
                    tx: link.max_data_rate_tx ?? 0,
                  }
                : null;
          }
        }
      }
    }
  }

  return {
    schemaVersion: topo.schema_version ?? "unknown",
    nodes: meshNodes,
    clients,
    links,
    fetchedAt: Date.now(),
  };
}
