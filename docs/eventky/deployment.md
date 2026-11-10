# Eventky deployment

A complete Eventky stack is: a Nexus built from the fork with the projection API enabled, the `eventky-projection` sidecar, and the Pubky App frontend with the Eventky flags on. Everything else (homeserver, Neo4j, Redis) is the standard Pubky stack.

No server credential, homeserver admin password, replication token or account signing key belongs in this repository or in any `PUBKY_RUNTIME_*` variable.

## Components

| Component | Source | Notes |
| --- | --- | --- |
| Nexus | `gillohner/pubky-nexus` branch `feat/eventky-generic-projection` (stacked on `feat/custom-post-kinds`) | Set `NEXUS_PROJECTION_TOKEN` (≥ 32 chars). Keep `/v0/projection/*` off the public proxy. |
| Sidecar | `services/eventky-projection` | `docker build -f services/eventky-projection/Dockerfile -t eventky-projection:<rev> .` from the repo root (Node 24, `node:sqlite`). |
| Frontend | this branch | Standard Dockerfile plus the flags below. |

[compose.example.yaml](compose.example.yaml) shows the sidecar and frontend attached to an existing Nexus network.

### Sidecar environment

| Variable | Meaning |
| --- | --- |
| `EVENTKY_NEXUS_URL` | Private Nexus base URL (e.g. `http://nexus:8080`). |
| `EVENTKY_NEXUS_SYNC_TOKEN` | Same value as Nexus `NEXUS_PROJECTION_TOKEN`. Server-only. |
| `EVENTKY_DATABASE` | SQLite path on a persistent volume (UID 1000), default `/data/eventky.sqlite`. |
| `EVENTKY_WORKERS` | Query worker count; `1` is fine for a small VPS. |
| `EVENTKY_PORT`, `EVENTKY_BIND`, `EVENTKY_POLL_MS` | Listener and replication poll interval. |

Run one sidecar per database volume. The database records the Nexus backend identity and refuses to open against a different backend; rebuild the projection instead of pointing an existing database at another Nexus.

### Frontend environment

- Normal `PUBKY_RUNTIME_*` settings for the homeserver and Nexus of the environment.
- `PUBKY_RUNTIME_EVENTKY_ENABLED=true` enables event/calendar/attendance kinds in the composer and post rendering.
- `PUBKY_RUNTIME_EVENTKY_CALENDAR_ENABLED=true` enables the `/calendar` page; it needs the sidecar.
- `EVENTKY_PROJECTION_URL` (server-only) points the `/api/eventky/*` routes at the sidecar.
- Use a distinct `NEXT_PUBLIC_DB_NAME` per environment so browser caches from another Nexus dataset are not reused.

### Reverse proxy

Expose the frontend and the public Nexus read routes (`/v0/`, `/static/`, and Swagger if wanted). Return 404 for `/v0/projection/` and keep the sidecar reachable only from the frontend container.

## Health checks

```sh
curl --fail https://<host>/v0/info
curl --fail https://<host>/api/eventky/status
curl --fail "https://<host>/v0/stream/posts?kind=event&limit=1"
```

`/api/eventky/status` returns `{ ok, value: { backend_id, coverage, ... } }`. A `200` is not the same as `coverage.complete=true`; an empty calendar is only meaningful once coverage is complete and there are no pending/invalid sources.

## Operational notes

- **Primary-user indexing is sticky.** If the Nexus fork runs with `watcher.primary_user_indexing=true`, keep it on; rolling back to an older backend while the global stream lags can let old deletes overwrite newer per-user state. See the fork's `docs/primary-user-indexing.md`.
- **Retention.** The Nexus projection outbox retains 10,000 post revisions. At the 512 KiB post cap that is up to ~5 GiB before graph, Redis and sidecar storage. Check disk headroom before enabling it on a small host.
- **Rollback order.** Disable `PUBKY_RUNTIME_EVENTKY_CALENDAR_ENABLED` first if the projection is unhealthy; posts stay authoritative on the homeserver and Nexus. Stop the sidecar before restoring or copying its SQLite database (include WAL/SHM files). A fresh projection can always be rebuilt from Nexus.
- **Fail closed.** A failed inventory never replaces the active generation and an unavailable source is never treated as deleted.
- **Staging only.** Test against the staging homeserver with disposable keys. Never publish test data to a production homeserver or copy a production projection database into a staging sidecar.
