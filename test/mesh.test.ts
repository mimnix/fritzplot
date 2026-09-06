import { describe, it, expect } from "vitest";
import { parseTopology } from "../src/server/fritzbox/mesh.js";

/** A realistic mock topology mirroring the AVM schema (master + slave + clients). */
const mockTopology = {
  schema_version: "7.8",
  nodes: [
    {
      uid: "n-master",
      device_name: "FRITZ!Box 7590",
      device_friendly_name: "FRITZ!Box 7590",
      device_model: "FRITZ!Box 7590",
      device_manufacturer: "AVM",
      device_firmware_version: "154.06.92",
      device_mac_address: "AA:BB:CC:DD:EE:01",
      is_meshed: true,
      mesh_role: "master",
      metrics: { wan_counters: { bytes: { rx: 1000, tx: 2000 } } },
      node_interfaces: [
        {
          uid: "ni-master-wlan",
          type: "WLAN",
          mac_address: "AA:BB:CC:DD:EE:01",
          current_channel_info: { primary_freq: 5580000 },
          node_links: [
            {
              uid: "nl-1",
              type: "WLAN",
              state: "CONNECTED",
              node_1_uid: "n-master",
              node_2_uid: "n-slave",
              node_interface_1_uid: "ni-master-wlan",
              node_interface_2_uid: "ni-slave-wlan",
              cur_data_rate_rx: 500000,
              cur_data_rate_tx: 300000,
              max_data_rate_rx: 866000,
              max_data_rate_tx: 866000,
              rx_rcpi: 60,
            },
          ],
        },
        {
          uid: "ni-master-client",
          type: "WLAN",
          mac_address: "AA:BB:CC:DD:EE:01",
          current_channel_info: { primary_freq: 2437000 },
          node_links: [
            {
              uid: "nl-2",
              type: "WLAN",
              state: "CONNECTED",
              node_1_uid: "n-master",
              node_2_uid: "n-client1",
              node_interface_1_uid: "ni-master-client",
              node_interface_2_uid: "ni-client1",
              cur_data_rate_rx: 10000,
              cur_data_rate_tx: 5000,
              max_data_rate_rx: 144000,
              max_data_rate_tx: 144000,
              rx_rcpi: 80,
            },
          ],
        },
      ],
    },
    {
      uid: "n-slave",
      device_name: "FRITZ!Repeater 6000",
      device_friendly_name: "Repeater Office",
      device_model: "FRITZ!Repeater 6000",
      device_manufacturer: "AVM",
      device_firmware_version: "7.30",
      device_mac_address: "AA:BB:CC:DD:EE:02",
      is_meshed: true,
      mesh_role: "slave",
      metrics: { wan_counters: null },
      node_interfaces: [
        {
          uid: "ni-slave-wlan",
          type: "WLAN",
          mac_address: "AA:BB:CC:DD:EE:02",
          node_links: [],
        },
      ],
    },
    {
      uid: "n-client1",
      device_name: "iPhone",
      device_friendly_name: "Alice's iPhone",
      device_model: "iPhone 15",
      device_manufacturer: "Apple",
      device_firmware_version: "",
      device_mac_address: "AA:BB:CC:DD:EE:03",
      is_meshed: false,
      mesh_role: "unknown",
      metrics: { wan_counters: null },
      node_interfaces: [
        {
          uid: "ni-client1",
          type: "WLAN",
          mac_address: "AA:BB:CC:DD:EE:03",
          node_links: [],
        },
      ],
    },
    {
      uid: "n-client2",
      device_name: "SmartTV",
      device_friendly_name: null,
      device_model: "TV",
      device_manufacturer: "Samsung",
      device_firmware_version: "",
      device_mac_address: "AA:BB:CC:DD:EE:04",
      is_meshed: false,
      mesh_role: "unknown",
      metrics: { wan_counters: null },
      node_interfaces: [],
    },
  ],
};

describe("parseTopology", () => {
  it("classifies mesh nodes (master/slave) correctly", () => {
    const result = parseTopology(mockTopology);
    expect(result.nodes).toHaveLength(2);
    const master = result.nodes.find((n) => n.role === "master");
    const slave = result.nodes.find((n) => n.role === "slave");
    expect(master?.name).toBe("FRITZ!Box 7590");
    expect(slave?.name).toBe("FRITZ!Repeater 6000");
    expect(slave?.friendlyName).toBe("Repeater Office");
  });

  it("classifies clients and extracts their details", () => {
    const result = parseTopology(mockTopology);
    expect(result.clients).toHaveLength(2);
    const iphone = result.clients.find((c) => c.name === "iPhone");
    expect(iphone?.friendlyName).toBe("Alice's iPhone");
    expect(iphone?.manufacturer).toBe("Apple");
  });

  it("resolves client attachments to mesh nodes", () => {
    const result = parseTopology(mockTopology);
    const iphone = result.clients.find((c) => c.name === "iPhone");
    expect(iphone?.attachedToNodeUid).toBe("n-master");
    expect(iphone?.online).toBe(true);
    expect(iphone?.connectionType).toBe("WLAN");
    expect(iphone?.signalDbm).toBe(80);
  });

  it("builds uplink links between mesh nodes with rates", () => {
    const result = parseTopology(mockTopology);
    expect(result.links).toHaveLength(1);
    const link = result.links[0];
    expect(link?.node1Uid).toBe("n-master");
    expect(link?.node2Uid).toBe("n-slave");
    expect(link?.dataRate?.rx).toBe(500000);
    expect(link?.signalDbm).toBe(60);
  });

  it("derives the 5 GHz band from the link interface frequency", () => {
    const result = parseTopology(mockTopology);
    const link = result.links[0];
    expect(link?.band).toBe("5");
  });

  it("derives the 2.4 GHz band and max rate for a client", () => {
    const result = parseTopology(mockTopology);
    const iphone = result.clients.find((c) => c.name === "iPhone");
    expect(iphone?.band).toBe("2.4");
    expect(iphone?.maxDataRate).toEqual({ rx: 144000, tx: 144000 });
  });

  it("extracts WAN counters for the master node", () => {
    const result = parseTopology(mockTopology);
    const master = result.nodes.find((n) => n.role === "master");
    expect(master?.wanBytes).toEqual({ rx: 1000, tx: 2000 });
  });

  it("handles empty topology gracefully", () => {
    const result = parseTopology({ schema_version: "7.8", nodes: [] });
    expect(result.nodes).toHaveLength(0);
    expect(result.clients).toHaveLength(0);
    expect(result.links).toHaveLength(0);
  });

  it("treats RCPI 255 as unknown signal", () => {
    const topo = {
      schema_version: "7.8",
      nodes: [
        {
          uid: "n-master",
          device_name: "Box",
          device_mac_address: "AA",
          is_meshed: true,
          mesh_role: "master",
          metrics: { wan_counters: null },
          node_interfaces: [
            {
              uid: "i1",
              type: "WLAN",
              mac_address: "AA",
              node_links: [
                {
                  uid: "l1",
                  type: "WLAN",
                  state: "CONNECTED",
                  node_1_uid: "n-master",
                  node_2_uid: "n-client",
                  node_interface_1_uid: "i1",
                  node_interface_2_uid: "i2",
                  rx_rcpi: 255,
                },
              ],
            },
          ],
        },
        {
          uid: "n-client",
          device_name: "Client",
          device_mac_address: "BB",
          is_meshed: false,
          mesh_role: "unknown",
          metrics: { wan_counters: null },
          node_interfaces: [{ uid: "i2", type: "WLAN", mac_address: "BB", node_links: [] }],
        },
      ],
    };
    const result = parseTopology(topo);
    const client = result.clients[0];
    expect(client?.signalDbm).toBeNull();
  });
});
