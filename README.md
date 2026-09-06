# FritzPlot

A lightweight web application that connects to a FRITZ!Box and visualizes the
FRITZ! Mesh topology in real time — showing the master router, repeaters, and
every connected client device with live details, similar to the mesh page in
FRITZ!OS.

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20TypeScript%20%2B%20Cytoscape.js-blue)

## Features

- **Live mesh graph** — interactive, animated topology (master → repeaters → clients)
- **Real-time updates** — pushed to the browser via Server-Sent Events (SSE)
- **Device details** — model, firmware, MAC, connection type, signal strength, TX/RX rates
- **Zero config files** — everything via environment variables
- **Docker-first** — single lightweight container (~alpine)

## How it works

FritzPlot talks to the FRITZ!Box over its **TR-064** interface:

1. SOAP call `Hosts:1` → `X_AVM-DE_GetMeshListPath` returns a URL to a Lua script
2. That URL (authenticated) returns the mesh topology as JSON
3. The backend parses `nodes[] → node_interfaces[] → node_links[]` into a clean graph
4. It polls every `POLL_INTERVAL` seconds and pushes updates to browsers over SSE

Authentication uses native HTTP Digest (RFC 7616) — no external runtime dependencies.

## Prerequisites

- A FRITZ!Box with **mesh enabled** (FRITZ!OS 7.0+)
- A FRITZ!Box user with **Smart Home** or admin rights
  (FRITZ!OS 7.25+ requires a username; older boxes may use an empty username)

## Quick start (Docker)

```bash
# 1. Set your credentials
export FRITZBOX_URL=http://192.168.178.1
export FRITZBOX_PASSWORD=your-password
export FRITZBOX_USER=your-user        # optional, empty for older boxes

# 2. Build and run
docker compose up --build
```

Then open <http://localhost:3000>.

Or run the image directly:

```bash
docker run -d --name fritzplot \
  -p 3000:3000 \
  -e FRITZBOX_URL=http://192.168.178.1 \
  -e FRITZBOX_PASSWORD=your-password \
  -e FRITZBOX_USER=your-user \
  fritzplot
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FRITZBOX_URL` | ✅ | — | Base URL of the FRITZ!Box (e.g. `http://192.168.0.1`). The TR-064 port is added automatically if omitted (`49000` for http, `49443` for https). |
| `FRITZBOX_PASSWORD` | ✅ | — | FRITZ!Box user password |
| `FRITZBOX_USER` | ❌ | *(empty)* | FRITZ!Box username (required on FRITZ!OS 7.25+) |
| `POLL_INTERVAL` | ❌ | `10` | Seconds between topology refreshes |
| `PORT` | ❌ | `3000` | Port the web server listens on |
| `HOST` | ❌ | `0.0.0.0` | Bind address |

## Development

```bash
npm install

# Terminal 1: backend (with hot reload)
npm run dev:server

# Terminal 2: frontend (Vite dev server, proxies /api and /events)
npm run dev:client
```

Set the environment variables before starting (see `env.example`).

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev:server` | Run backend with hot reload |
| `npm run dev:client` | Run Vite dev server |
| `npm run build` | Build frontend + backend |
| `npm start` | Run the production build |
| `npm test` | Run unit tests |
| `npm run typecheck` | Type-check without emitting |

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/topology` | Latest topology snapshot (JSON) |
| `GET /events` | Server-Sent Events stream (`topology`, `status`, `error` events) |

## Project structure

```
src/
├── server/            # Fastify backend
│   ├── index.ts       # entry, routes, SSE
│   ├── config.ts      # env parsing/validation
│   ├── poller.ts      # interval poll → SSE broadcast
│   └── fritzbox/
│       ├── digest.ts  # HTTP Digest auth (RFC 7616)
│       ├── tr064.ts   # SOAP client
│       └── mesh.ts    # topology fetch + pure parser
├── shared/
│   └── types.ts       # shared types
└── client/            # Vite frontend (Cytoscape.js)
    ├── index.html
    ├── main.ts
    └── styles.css
```

## Troubleshooting

- **"Authentication failed (401)"** — verify username/password; FRITZ!OS 7.25+
  requires a username. Check the user has Smart Home/admin rights.
- **"Mesh list path not returned"** — ensure mesh is enabled and FRITZ!OS ≥ 7.0.
- **No repeaters shown** — devices must be part of the FRITZ!Box mesh (not just
  WiFi extenders). See FRITZ!Box UI → Home Network → Mesh.

## Disclaimer

FritzPlot is an independent, open-source project. It is not affiliated with,
endorsed by, or connected to AVM GmbH in any way.
