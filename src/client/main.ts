import cytoscape from "cytoscape";
import type { MeshTopology, MeshNode, ClientDevice } from "../shared/types";

/**
 * Renders the mesh topology as an interactive Cytoscape graph and keeps it
 * in sync with real-time updates.
 *
 * Node positions are preserved across updates so the graph does not jump
 * around on every refresh. The layout only runs on first load or when the
 * user explicitly changes the layout.
 */

const COLORS = {
  master: "#ffb020",
  slave: "#4f8cff",
  client: "#3ddc97",
  link: "#3a4666",
  linkActive: "#4f8cff",
  linkWired: "#8a94ad",
};

type LayoutName = "cose" | "breadthfirst";

/**
 * Build the layout options for a given layout name.
 *
 * The `breadthfirst` (dendrogram) layout needs the master node as its root,
 * otherwise it lays every node out in a single line. We resolve the master
 * node dynamically from the graph.
 *
 * Both layouts use `nodeDimensionsIncludeLabels` so node spacing accounts
 * for label size, preventing label/node overlap.
 */
function getLayout(name: LayoutName): cytoscape.LayoutOptions {
  const master = cy.nodes('[kind="master"]').first();
  const roots = master.empty() ? undefined : [master.id()];

  switch (name) {
    case "cose":
      return {
        name: "cose",
        animate: true,
        animationDuration: 600,
        padding: 60,
        nodeRepulsion: () => 12000,
        idealEdgeLength: () => 140,
        edgeElasticity: () => 100,
        gravity: 0.25,
        nodeOverlap: 24,
        nodeDimensionsIncludeLabels: true,
      };
    case "breadthfirst":
      return {
        name: "breadthfirst",
        animate: true,
        animationDuration: 600,
        directed: false,
        padding: 60,
        spacingFactor: 1.6,
        nodeDimensionsIncludeLabels: true,
        roots,
      };
  }
}

const cy = cytoscape({
  container: document.getElementById("cy")!,
  style: [
    {
      selector: "node",
      style: {
        "background-color": COLORS.client,
        label: "data(label)",
        "font-size": 11,
        color: "#e6ebf5",
        "text-valign": "bottom",
        "text-margin-y": 6,
        "text-wrap": "wrap",
        "text-max-width": "120px",
        "text-justification": "center",
        "text-outline-width": 2,
        "text-outline-color": "#0b0f1a",
        width: 18,
        height: 18,
      },
    },
    {
      selector: 'node[kind="master"]',
      style: {
        "background-color": COLORS.master,
        width: 44,
        height: 44,
        "border-width": 3,
        "border-color": "#ffd98a",
        "font-size": 12,
        "font-weight": "bold",
      },
    },
    {
      selector: 'node[kind="slave"]',
      style: {
        "background-color": COLORS.slave,
        width: 32,
        height: 32,
        "border-width": 2,
        "border-color": "#9dbdff",
        "font-size": 11,
      },
    },
    {
      selector: 'node[kind="client"]',
      style: {
        "background-color": COLORS.client,
        width: 16,
        height: 16,
      },
    },
    {
      selector: 'node[online="false"]',
      style: {
        opacity: 0.35,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": COLORS.link,
        "target-arrow-shape": "none",
        "curve-style": "bezier",
      },
    },
    {
      selector: 'edge[state="CONNECTED"]',
      style: {
        "line-color": COLORS.linkActive,
        width: 2,
      },
    },
    {
      selector: 'edge[type="LAN"]',
      style: {
        "line-style": "dashed",
        "line-color": COLORS.linkWired,
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-width": 3,
        "border-color": "#ffffff",
      },
    },
  ],
});

let currentLayout: LayoutName = "cose";
let hasLaidOut = false;

/**
 * Prettify a raw device name by inserting spaces between camelCase and
 * digit-letter boundaries, so long names like "fritz-repeater1200axcamera"
 * wrap nicely instead of overflowing.
 */
function prettifyName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nodeLabel(node: MeshNode | ClientDevice): string {
  const raw = node.friendlyName ?? node.name;
  return prettifyName(raw);
}

/** Build the full element list from a topology snapshot. */
function buildElements(topology: MeshTopology): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];

  for (const node of topology.nodes) {
    elements.push({
      data: {
        id: node.uid,
        label: nodeLabel(node),
        kind: node.role === "master" ? "master" : "slave",
        online: "true",
        type: "node",
        name: node.name,
        friendlyName: node.friendlyName,
        model: node.model,
        manufacturer: node.manufacturer,
        firmware: node.firmwareVersion,
        mac: node.macAddress,
        role: node.role,
      },
    });
  }

  for (const client of topology.clients) {
    elements.push({
      data: {
        id: client.uid,
        label: nodeLabel(client),
        kind: "client",
        online: String(client.online),
        type: "client",
        name: client.name,
        friendlyName: client.friendlyName,
        model: client.model,
        manufacturer: client.manufacturer,
        mac: client.macAddress,
        connectionType: client.connectionType,
        band: client.band,
        signalDbm: client.signalDbm,
        dataRate: client.dataRate,
        maxDataRate: client.maxDataRate,
        attachedTo: client.attachedToNodeUid,
      },
    });
  }

  for (const link of topology.links) {
    elements.push({
      data: {
        id: link.uid,
        source: link.node1Uid,
        target: link.node2Uid,
        state: link.state,
        type: link.type,
        band: link.band,
        signalDbm: link.signalDbm,
        dataRate: link.dataRate,
        maxDataRate: link.maxDataRate,
      },
    });
  }

  // Attach clients to their mesh node as edges (visual only).
  for (const client of topology.clients) {
    if (client.attachedToNodeUid) {
      elements.push({
        data: {
          id: `attach-${client.uid}`,
          source: client.attachedToNodeUid,
          target: client.uid,
          state: client.online ? "CONNECTED" : "DISCONNECTED",
          type: client.connectionType,
          band: client.band,
        },
      });
    }
  }

  return elements;
}

/**
 * Update the graph from a topology snapshot.
 *
 * The layout runs ONLY on the first render or when the user explicitly
 * changes the layout. On subsequent updates we preserve existing node
 * positions and only update data/labels/colors in place, so the graph stays
 * perfectly stable across polls.
 *
 * New nodes (devices that just appeared) are positioned near their parent
 * instead of triggering a full re-layout, which would scramble the graph.
 */
function render(topology: MeshTopology): void {
  const elements = buildElements(topology);

  if (!hasLaidOut) {
    // First render: build from scratch and run the layout.
    cy.elements().remove();
    cy.add(elements);
    cy.layout(getLayout(currentLayout)).run();
    hasLaidOut = true;
    return;
  }

  // --- Diff-based update: preserve positions, update data in place. ---

  const existingNodes = new Map<string, cytoscape.NodeSingular>();
  cy.nodes().forEach((n) => {
    existingNodes.set(n.id(), n);
  });

  const existingEdges = new Map<string, cytoscape.EdgeSingular>();
  cy.edges().forEach((e) => {
    existingEdges.set(e.id(), e);
  });

  const newIds = new Set<string>();
  const nodesToAdd: cytoscape.NodeDefinition[] = [];
  const edgesToAdd: cytoscape.ElementDefinition[] = [];
  const newEdgeIds = new Set<string>();

  for (const el of elements) {
    const def = el as cytoscape.NodeDefinition;
    const edgeDef = el as cytoscape.EdgeDefinition;
    const isEdge = edgeDef.data?.source !== undefined;

    if (!isEdge) {
      // Node element.
      newIds.add(def.data.id!);
      const node = existingNodes.get(def.data.id!);
      if (node) {
        node.data(def.data); // update in place, keeps position
      } else {
        nodesToAdd.push(def);
      }
    } else {
      // Edge element.
      newEdgeIds.add(edgeDef.data.id!);
      const edge = existingEdges.get(edgeDef.data.id!);
      if (edge) {
        edge.data(edgeDef.data);
      } else {
        edgesToAdd.push(el);
      }
    }
  }

  // Remove nodes that no longer exist.
  cy.nodes().forEach((n) => {
    if (!newIds.has(n.id())) n.remove();
  });

  // Remove edges that no longer exist.
  cy.edges().forEach((e) => {
    if (!newEdgeIds.has(e.id())) e.remove();
  });

  // Add new nodes, positioned near their parent (no full re-layout).
  if (nodesToAdd.length > 0) {
    cy.add(nodesToAdd);
    for (const def of nodesToAdd) {
      positionNewNode(def.data.id!, def.data.attachedTo as string | undefined);
    }
  }

  // Add new edges.
  if (edgesToAdd.length > 0) {
    cy.add(edgesToAdd);
  }
}

/**
 * Position a newly-added node near its parent (or near the master if it has
 * no parent), so it appears in a sensible spot without re-laying-out the
 * whole graph.
 */
function positionNewNode(id: string, parentId: string | undefined): void {
  const node = cy.getElementById(id);
  if (node.empty()) return;

  const parent = parentId ? cy.getElementById(parentId) : cy.nodes('[kind="master"]').first();
  if (parent.empty()) return;

  const parentPos = parent.position();
  // Offset by a small random amount so multiple new nodes don't overlap.
  const angle = Math.random() * Math.PI * 2;
  const radius = 80 + Math.random() * 60;
  node.position({
    x: parentPos.x + Math.cos(angle) * radius,
    y: parentPos.y + Math.sin(angle) * radius,
  });
}

function updateStats(topology: MeshTopology): void {
  const online = topology.clients.filter((c) => c.online).length;
  setText("stat-nodes", String(topology.nodes.length));
  setText("stat-clients", String(topology.clients.length));
  setText("stat-online", String(online));
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setStatus(connected: boolean, message: string): void {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  if (dot) dot.className = `status-dot ${connected ? "online" : "offline"}`;
  if (text) text.textContent = message;
}

/** Format a rate in kbit/s into a human-readable string (Gbit/s / Mbit/s). */
function formatRate(kbit: number | null | undefined): string {
  if (kbit == null) return "—";
  if (kbit >= 1_000_000) return `${(kbit / 1_000_000).toFixed(2)} Gbit/s`;
  if (kbit >= 1_000) return `${(kbit / 1_000).toFixed(0)} Mbit/s`;
  return `${kbit} kbit/s`;
}

function connectionLabel(type: string | null | undefined): string {
  switch (type) {
    case "LAN":
      return "Wired (LAN)";
    case "WLAN":
      return "Wireless (Wi-Fi)";
    case "PLC":
      return "Powerline (PLC)";
    case "DECT":
      return "DECT";
    default:
      return "Unknown";
  }
}

function bandLabel(band: string | null | undefined): string {
  if (!band) return "—";
  return `${band} GHz`;
}

function showDetails(data: Record<string, unknown>): void {
  const container = document.getElementById("details");
  if (!container) return;

  const kind = data.kind as string;
  const isNode = data.type === "node";
  const roleLabel =
    kind === "master" ? "Master" : kind === "slave" ? "Repeater" : "Client";

  const rows: Array<[string, string]> = [];
  if (isNode) {
    rows.push(["Model", String(data.model ?? "—")]);
    rows.push(["Firmware", String(data.firmware ?? "—")]);
    rows.push(["Manufacturer", String(data.manufacturer ?? "—")]);
    rows.push(["MAC", String(data.mac ?? "—")]);
  } else {
    rows.push(["Model", String(data.model ?? "—")]);
    rows.push(["Connection", connectionLabel(data.connectionType as string)]);
    rows.push(["Band", bandLabel(data.band as string)]);
    rows.push(["Signal", data.signalDbm != null ? `${data.signalDbm} dBm` : "—"]);
    const dr = data.dataRate as { rx: number; tx: number } | null | undefined;
    const mdr = data.maxDataRate as { rx: number; tx: number } | null | undefined;
    rows.push(["RX", formatRate(dr?.rx)]);
    rows.push(["TX", formatRate(dr?.tx)]);
    rows.push(["Max rate", formatRate(mdr?.rx)]);
    rows.push(["MAC", String(data.mac ?? "—")]);
  }

  const online = data.online === "true";
  const badge = `<span class="badge ${online ? "online" : "offline"}">${
    online ? "Online" : "Offline"
  }</span>`;

  container.innerHTML = `
    <div class="detail-card">
      <h3>${escapeHtml(String(data.label ?? data.name ?? "Unknown"))}</h3>
      <div class="role">${roleLabel} ${badge}</div>
      ${rows
        .map(
          ([k, v]) =>
            `<div class="detail-row"><span class="k">${k}</span><span class="v">${escapeHtml(v)}</span></div>`,
        )
        .join("")}
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

cy.on("tap", "node", (event) => {
  showDetails(event.target.data());
});

cy.on("tap", (event) => {
  if (event.target === cy) {
    const container = document.getElementById("details");
    if (container) {
      container.innerHTML = '<p class="muted">Select a node or client to see details.</p>';
    }
  }
});

// ---------------------------------------------------------------------------
// Layout selector
// ---------------------------------------------------------------------------

function setupLayoutSelector(): void {
  const select = document.getElementById("layout-select") as HTMLSelectElement;
  if (!select) return;

  select.addEventListener("change", () => {
    currentLayout = select.value as LayoutName;
    cy.layout(getLayout(currentLayout)).run();
  });
}

// ---------------------------------------------------------------------------
// SSE client
// ---------------------------------------------------------------------------

function connect(): void {
  const source = new EventSource("/events");

  source.addEventListener("topology", (event) => {
    const payload = JSON.parse((event as MessageEvent).data);
    const topology = payload.data as MeshTopology;
    render(topology);
    updateStats(topology);
    // Receiving topology data means we're connected — keep the status in
    // sync even if the initial status event was missed.
    setStatus(true, "Connected");
  });

  source.addEventListener("status", (event) => {
    const payload = JSON.parse((event as MessageEvent).data);
    setStatus(payload.connected, payload.message);
  });

  source.addEventListener("error", (event) => {
    const payload = JSON.parse((event as MessageEvent).data);
    setStatus(false, payload.message);
  });

  source.onerror = () => {
    setStatus(false, "Connection lost — retrying…");
    // If the session expired (401), redirect to the login page.
    void checkAuthAndRedirect();
  };
}

/**
 * Check whether the session is still valid. If not, redirect to the login
 * page (e.g. after the auth cookie expired).
 */
async function checkAuthAndRedirect(): Promise<void> {
  try {
    const res = await fetch("/api/auth/check");
    if (res.status === 401) {
      window.location.replace("/login.html");
    }
  } catch {
    // Network error; the SSE client will keep retrying.
  }
}

setupLayoutSelector();
connect();
