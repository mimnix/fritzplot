# FritzPlot

A lightweight web application that connects to a FRITZ!Box and visualizes the
FRITZ! Mesh topology in real time — showing the master router, repeaters, and
every connected client device with live details, similar to the mesh page in
FRITZ!OS.

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20TypeScript%20%2B%20Cytoscape.js-blue)

## Features

- **Live mesh graph** — interactive, animated topology (master → repeaters → clients)
- **Real-time updates** — pushed to the browser via Server-Sent Events (SSE)
- **Device details** — model, firmware, MAC, connection type (wired/wireless), band (2.4/5/6 GHz), signal strength, TX/RX rates
- **Multiple layouts** — Graph (force-directed) and Dendrogram (tree)
- **Login screen** — protected by `APP_USER` / `APP_PASSWORD`, with a "Keep me signed in" option (6-month session)
- **On-demand polling** — only polls the router while a client is connected
- **Zero config files** — everything via environment variables
- **Docker-first** — single lightweight container (~alpine), multi-arch (amd64 + arm64)

## How it works

FritzPlot talks to the FRITZ!Box over its **TR-064** interface:

1. SOAP call `Hosts:1` → `X_AVM-DE_GetMeshListPath` returns a URL to a Lua script
2. That URL (authenticated) returns the mesh topology as JSON
3. The backend parses `nodes[] → node_interfaces[] → node_links[]` into a clean graph
4. It polls every `POLL_INTERVAL` seconds (only while a client is connected) and pushes updates to browsers over SSE

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
export APP_USER=admin                 # web app login
export APP_PASSWORD=your-app-password

# 2. Build and run
docker compose up --build
```

Then open <http://localhost:3000> and sign in with `APP_USER` / `APP_PASSWORD`.

Or run the image directly:

```bash
docker run -d --name fritzplot \
  -p 3000:3000 \
  -e FRITZBOX_URL=http://192.168.178.1 \
  -e FRITZBOX_PASSWORD=your-password \
  -e FRITZBOX_USER=your-user \
  -e APP_USER=admin \
  -e APP_PASSWORD=your-app-password \
  fritzplot
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FRITZBOX_URL` | ✅ | — | Base URL of the FRITZ!Box (e.g. `http://192.168.0.1`). The TR-064 port is added automatically if omitted (`49000` for http, `49443` for https). |
| `FRITZBOX_PASSWORD` | ✅ | — | FRITZ!Box user password |
| `FRITZBOX_USER` | ❌ | *(empty)* | FRITZ!Box username (required on FRITZ!OS 7.25+) |
| `APP_USER` | ✅ | — | Web app login username |
| `APP_PASSWORD` | ✅ | — | Web app login password |
| `POLL_INTERVAL` | ❌ | `10` | Seconds between topology refreshes |
| `PORT` | ❌ | `3000` | Port the web server listens on |
| `HOST` | ❌ | `0.0.0.0` | Bind address |

## Authentication

The web app is protected by a login screen. Set `APP_USER` and `APP_PASSWORD`
to the desired credentials. The login screen has a **"Keep me signed in"**
checkbox: when checked, the session persists for ~6 months; otherwise it is a
session cookie that expires when the browser closes.

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

### mise tasks

Build, clean, and Docker operations are also available as [mise](https://mise.jdx.dev) tasks (see `mise.toml`):

| Task | Description |
|------|-------------|
| `mise run build` | Build the full project |
| `mise run test` | Run the unit test suite |
| `mise run typecheck` | Type-check without emitting |
| `mise run clean` | Remove build artifacts and `node_modules` |
| `mise run docker:buildx:setup` | Create the multi-arch buildx builder (with QEMU) |
| `mise run docker:build` | Build the image (multi-arch: amd64 + arm64) |
| `mise run docker:push` | Build and push the multi-arch image |
| `mise run docker:run` | Run the container locally |
| `mise run docker:clean` | Remove the local image and build cache |

## API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/health` | Public | Health check |
| `POST /api/login` | Public | Authenticate (`{ username, password, remember }`) → sets auth cookie |
| `POST /api/logout` | Public | Clear the auth cookie |
| `GET /api/auth/check` | Public | Returns `{ authenticated: true/false }` |
| `GET /api/topology` | Required | Latest topology snapshot (JSON) |
| `GET /events` | Required | Server-Sent Events stream (`topology`, `status`, `error` events) |

## Project structure

```
src/
├── server/            # Fastify backend
│   ├── index.ts       # entry, routes, SSE, auth middleware
│   ├── config.ts      # env parsing/validation
│   ├── auth.ts        # HMAC-signed session tokens
│   ├── poller.ts      # on-demand poll → SSE broadcast
│   └── fritzbox/
│       ├── digest.ts  # HTTP Digest auth (RFC 7616)
│       ├── tr064.ts   # SOAP client
│       └── mesh.ts    # topology fetch + pure parser
├── shared/
│   └── types.ts       # shared types
└── client/            # Vite frontend (Cytoscape.js)
    ├── index.html     # main app
    ├── main.ts        # graph rendering + SSE client
    ├── login.html     # login screen
    ├── login.ts       # login logic
    └── styles.css
```

## Troubleshooting

- **"Authentication failed (401)"** — verify username/password; FRITZ!OS 7.25+
  requires a username. Check the user has Smart Home/admin rights.
- **"Mesh list path not returned"** — ensure mesh is enabled and FRITZ!OS ≥ 7.0.
- **No repeaters shown** — devices must be part of the FRITZ!Box mesh (not just
  WiFi extenders). See FRITZ!Box UI → Home Network → Mesh.
- **"APP_USER and APP_PASSWORD environment variables are required"** — the web
  app login credentials are not set. Set both env vars (see `env.example`).
- **Login page redirects in a loop** — clear the browser cookies for the app
  and sign in again.

## Disclaimer

FritzPlot is an independent, open-source project. It is not affiliated with,
endorsed by, or connected to AVM GmbH in any way.
