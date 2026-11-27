# bin/start

## Flow
```mermaid
flowchart TD
    A([bin/start\nsafetrust hotel_industry]) --> B[docker compose up -d --build\npostgres + hasura + webhook]
    B --> C[Wait for Hasura /healthz\n0.5s poll interval\n120s timeout]
    C --> D[Register database sources\npg_add_source for each tenant]
    D --> E[Apply migrations\nhasura migrate apply × N tenants\nDDL window: grant CREATE, revoke after]
    E --> F[Deploy metadata\nsetup-tenant.sh × N tenants]
    F --> G[Reload metadata\nhasura metadata reload]
    G --> H[Apply seeds\nhasura seed apply × N tenants]
    H --> I([Ready\n127.0.0.1:8080 Hasura\n127.0.0.1:3000 Webhook])
    D --> E[Apply migrations\nhasura migrate apply × N tenants]
    E --> F[Deploy metadata\nsetup-tenant.sh × N tenants, in parallel]
    F --> G[Reload metadata\nhasura metadata reload]
    G --> H[Apply seeds\nhasura seed apply × N tenants]
    H --> I[Health checks\nHasura · Postgres · webhook]
    I --> J([DEPLOYMENT SUMMARY\nlogs + JSON report])
```

## Prerequisites
- Bash 4.3 or newer (on macOS: `brew install bash`)
- Docker with Compose v2
- hasura CLI
- yq
- `.env` created from `.env.example` — `POSTGRES_PASSWORD`,
  `HASURA_DB_PASSWORD`, `HASURA_METADATA_DB_PASSWORD` and `WEBHOOK_DB_PASSWORD`
  are required and have no defaults.
- `curl`, `jq`, `yq`

`bin/start` checks for these before it starts anything and names any that are
missing.

## Usage

```bash
bin/start safetrust                              # one tenant
bin/start safetrust hotel_industry               # both tenants
bin/start --reset safetrust hotel_industry       # remove volumes, start fresh
bin/start --restart safetrust hotel_industry     # recreate containers, keep data
bin/start --verbose safetrust hotel_industry     # also print full metadata logs
```

`--restart` skips migrations and seeds. `--reset` and `--restart` cannot be
combined. An unknown tenant name fails before any container starts.

## Deployment summary

Every run ends with one summary covering all tenants, including runs that fail
or are interrupted with Ctrl+C:

```text
════════════════════════════════════════════════════════════════════════
  DEPLOYMENT SUMMARY — ✅ all tenants ready
════════════════════════════════════════════════════════════════════════
  Tenant            Migrations    Metadata       Seeds       Total   Status
  ────────────────────────────────────────────────────────────────────────
  safetrust               1.9s       24.4s        1.3s       27.8s   ✅ ready
  hotel_industry          1.4s       21.2s        1.3s       24.1s   ✅ ready
  ────────────────────────────────────────────────────────────────────────
  Shared steps       containers 15.3s · Hasura health 0.0s · sources 0.1s · metadata reload 1.7s
  Metadata deploy    24.4s wall-clock for 45.7s of work across 2 tenants (parallel)
  Total time         48.1s
  Logs               tests/results/bin-start/20261114-230449/
  Report             tests/results/bin-start-report.json
  ────────────────────────────────────────────────────────────────────────
  Health
    Hasura           ✅ healthy · ✅ metadata consistent
    PostgreSQL       ✅ accepting connections (localhost:5433)
    Webhook          ✅ live · ⚠️  not ready: firebase unavailable (HTTP 503)
    safetrust        23 tables · 14 with select perms · 16 relationships · 7 functions · 6 function perms
    hotel_industry   14 tables · 4 with select perms · 13 relationships · 2 functions · 4 function perms
════════════════════════════════════════════════════════════════════════
```

- **Tenant rows**: time per phase. `skipped` means `--restart` skipped the
  phase, `FAILED` marks the step that failed, `STOPPED` a step cut short by
  Ctrl+C, and `-` a step that was never reached.
- **Metadata deploy**: tenants deploy in parallel, so the wall-clock time is
  shorter than the sum of the per-tenant times.
- **Health**: checks never fail the run; they report what is running. Hasura
  must report no inconsistent metadata objects. The tenant lines count what
  Hasura actually has, so a permission that was never applied shows up here.
  The webhook line names any dependency `/health/ready` reports as down; with
  empty `FIREBASE_*` values in `.env`, `firebase` is expected to be down.

## Logs and reports

| Path | Contents |
|---|---|
| `tests/results/bin-start/<run-id>/` | One log per tenant and phase (`<tenant>-migrations.log`, `<tenant>-metadata.log`, `<tenant>-seeds.log`, `metadata-reload.log`). The last 10 runs are kept. |
| `tests/results/bin-start-report.json` | The last run: status, exit code, failed phase, per-phase and per-tenant durations in milliseconds, Hasura counts per tenant, and health results. |
| `tests/results/dc-prep-timings.json` | Legacy cumulative timings, in whole seconds, read by the `@timing` Karate feature. Written only by a successful `bin/start safetrust`. |

The metadata deploy prints one line per tenant. Its full output goes to the
tenant's log, and is printed with `--verbose`. When a tenant fails, the last 30
lines of its log are printed automatically.

```bash
jq '{status, failed_phase, total_ms, tenants: (.tenants | map_values(.total_ms))}' \
  tests/results/bin-start-report.json
```

## Ports
Nothing in `docker-compose.yml` is published on all host interfaces.

| Service | Binding | Notes |
| --- | --- | --- |
| Postgres | not published | `docker compose exec postgres psql -U postgres` |
| Hasura | `127.0.0.1:${HASURA_PORT:-8080}` | reverse proxy / platform exposes it |
| Webhook | `127.0.0.1:${WEBHOOK_PORT:-3000}` | reverse proxy / platform exposes it |

Local tools that need Postgres can copy `docker-compose.override.example.yml`
to `docker-compose.override.yml` (git-ignored); it publishes
`127.0.0.1:${POSTGRES_PORT:-5433}` only. `docker-compose-test.yml` binds every
port — including the Hasura console on 9696 — to `127.0.0.1`.

## Database roles
`docker/postgres/init/01-init-roles.sh` runs once, as the postgres superuser,
when the data directory is empty (it is mounted at
`/docker-entrypoint-initdb.d`). On an existing volume, re-run it:

```bash
docker compose exec -T postgres bash /docker-entrypoint-initdb.d/01-init-roles.sh
```

| Role | Used by | Rights |
| --- | --- | --- |
| `postgres` | migrations only (`bin/start`, `migrate-test`) | superuser, never used by a running service |
| `hasura` | Hasura data source | `USAGE` + table privileges on the `safetrust` and `hotel_industry` schemas; `CREATE` only inside the migration run; no superuser, no access to the catalog database |
| `hasura_metadata` | Hasura metadata | owns the separate `hasura_metadata` database |
| `webhook` | webhook | `SELECT/INSERT/UPDATE/DELETE` on `safetrust`; no `CREATE`, no `TRUNCATE`, no `COPY … PROGRAM` |

Migrations run through the Hasura data source, so they are the only step that
needs DDL. The init script never grants `CREATE`: the migration step itself —
`bin/start` for the stack, `bin/prepare-test-db` for the test stack — grants it
on the tenant schemas (and on `public`, where legacy migrations stage tables
before moving them) immediately before `hasura migrate apply` and revokes it
immediately after. An `EXIT` trap closes the window when a migration fails or
the run is interrupted, so a stack that is only `docker compose up`-ed, and
every phase after migrations, has no role that can create or drop objects.
New tables inherit the webhook grants through `ALTER DEFAULT PRIVILEGES`; the
tables moved out of `public` are covered by migration
`1779400000000_grant_webhook_role`.

`bin/test` runs `tests/db/assert-webhook-role.sh` (compose service
`db-privileges`) after migrations; it fails the suite if the webhook role can
`CREATE TABLE`, create a schema, drop/truncate a table, or run
`COPY … PROGRAM`, and if the hasura role still holds `CREATE` on `safetrust`,
`hotel_industry` or `public` once the migration run is over.

## Secrets
Required variables (no defaults, so a missing value fails fast):

- `POSTGRES_PASSWORD` — admin/migration role
- `HASURA_DB_PASSWORD` — `hasura` role
- `HASURA_METADATA_DB_PASSWORD` — `hasura_metadata` role
- `WEBHOOK_DB_PASSWORD` — `webhook` role
- `HASURA_GRAPHQL_ADMIN_SECRET` — Hasura admin secret

Use URL-safe passwords: they are embedded in connection URLs.

For production, prefer file-backed secrets — they are not visible to
`docker inspect` or to every process in the container:

```bash
mkdir -p secrets
install -m 0400 /secure/firebase_private_key secrets/firebase_private_key
install -m 0400 /secure/trustlesswork_api_key secrets/trustlesswork_api_key
install -m 0400 /secure/webhook_db_password secrets/webhook_db_password
cp docker-compose.secrets.example.yml docker-compose.secrets.yml   # git-ignored
docker compose -f docker-compose.yml -f docker-compose.secrets.yml up -d
```

The webhook reads `FIREBASE_PRIVATE_KEY_FILE`, `TRUSTLESS_WORK_API_KEY_FILE`
(and the `TRUSTLESSWORK_API_KEY_FILE` spelling used by Compose) and
`POSTGRES_PASSWORD_FILE`; the official Postgres image reads
`POSTGRES_PASSWORD_FILE` the same way. Plain variables still work for local
development.

## Logs
Every service uses the `json-file` driver with `max-size: 10m` and
`max-file: 5`. Hasura logs `startup, http-log, webhook-log` by default —
`query-log` is off because it writes every GraphQL query and its variables
(emails, phone numbers, wallet addresses) to the log. Enable it per run with
`HASURA_GRAPHQL_ENABLED_LOG_TYPES="startup, http-log, webhook-log, query-log"`.

## Common failures and fixes
- Port already in use — Hasura/webhook bind 127.0.0.1; check `HASURA_PORT` /
  `WEBHOOK_PORT`
- `POSTGRES_PASSWORD is required` — copy `.env.example` to `.env`
- `role "webhook" does not exist` on an existing volume — re-run the init script
  shown above
- Hasura health timeout
- Seed duplicate key errors
- **Port 5433 already in use**: set `POSTGRES_PORT` in `.env`.
- **Hasura health timeout**: the summary shows `failed during: hasura_health`
  and the last 20 `graphql-engine` log lines are printed. Check
  `docker compose logs graphql-engine`.
- **Failed to register source**: the error from Hasura is printed. Usually a
  wrong `HASURA_ADMIN_SECRET` or an unreachable `PG_DATABASE_URL`.
- **Metadata deployment failed**: the tail of `<tenant>-metadata.log` is
  printed; Hasura's error names the table, role and column at fault.
- **Seed errors**: the summary shows `failed in seeds` for the tenant; the full
  error is in `<tenant>-seeds.log`.
- **Untrack obsolete PostGIS system tables**: on existing environments that previously tracked `geography_columns`, `geometry_columns`, and `spatial_ref_sys`, untrack them with `pg_untrack_table`:
  ```bash
  for tbl in geography_columns geometry_columns spatial_ref_sys; do
    echo "Untracking public.$tbl..."
    curl -fsS --fail-with-body -X POST "${HASURA_ENDPOINT:-http://localhost:8080}/v1/metadata" \
      -H "X-Hasura-Admin-Secret: ${HASURA_ADMIN_SECRET}" \
      -H "Content-Type: application/json" \
      -d "{\"type\":\"pg_untrack_table\",\"args\":{\"table\":{\"name\":\"$tbl\",\"schema\":\"public\"},\"source\":\"safetrust\",\"cascade\":false}}" || {
        echo "Failed to untrack public.$tbl. If dependent objects exist, review and resolve them before retrying." >&2
        break
      }
  done
  ```
  If Hasura reports dependent objects when `cascade` is `false`, review and resolve those dependencies before retrying the untrack.

  > [!WARNING]
  > Alternatively, `bin/start --reset safetrust` starts fresh from clean volumes. Note that `--reset` removes **all** stack Docker volumes, deleting data across all tenants (including `hotel_industry`). Only use `--reset` when all volume data can safely be discarded.

## Metadata Configuration Reconciliation & Recovery

### How Configuration is Reconciled
`metadata/deploy-tenant.sh` reconciles metadata incrementally for each tenant:
1. **Missing objects**: Tables and functions not yet tracked in Hasura are registered with their full YAML configuration using `pg_track_tables` and `pg_track_function`.
2. **Tracked objects with changed configuration**: For tables and functions already tracked in Hasura whose `configuration` (`custom_name`, `custom_root_fields`, `column_config`) differs from the local YAML, the deploy calls `pg_set_table_customization` and `pg_set_function_customization` in bulk.
3. **Idempotency**: Tracked objects whose configuration already matches YAML are left untouched. Running the deploy twice in a row executes zero customization calls on the second run.
4. **Permissions & Relationships**: Missing foreign-key relationships and select/function permissions are reconciled against the post-tracking metadata state.

#### Why `pg_set_*_customization` instead of `replace_metadata`
Multi-tenant deploys (`safetrust`, `hotel_industry`) execute per-tenant in parallel. `replace_metadata` is global across all sources, which would cause concurrent tenant deploys to overwrite one another's changes or drop non-tenant configurations. In contrast, calling `pg_set_table_customization` and `pg_set_function_customization`:
- Scopes changes strictly to the target tenant source.
- Safely runs in parallel without lock contention or cross-tenant overwrites.
- Only mutates configuration for objects that actually drifted, leaving existing relationships and permissions undisturbed.

### Recovering an Existing Environment
Existing environments that were initialized before custom root fields were introduced (e.g., exposing default `safetrust_users` instead of `users`, or missing `getEscrowAnalyticsByDay`) can be updated in-place without losing database data:

```bash
bin/start --restart safetrust hotel_industry
```

`bin/start --restart` executes the metadata deployment against the running containers. `deploy-tenant.sh` detects the differences between the live metadata and the YAML configurations, issues the customization commands, and reloads the Hasura metadata cache.

Alternatively, to start completely from scratch with fresh volumes:
```bash
bin/start --reset safetrust hotel_industry
```

### Clean Test Database per Run (`bin/test`)
`bin/test` executes:
```bash
docker compose -p safetrust-test -f docker-compose-test.yml "${ENV_FILE_FLAGS[@]}" down -v --remove-orphans
```
prior to starting Karate tests. This ensures that:
- The named volume `db_data_test` is deleted before the run begins, giving `postgres_test` and Hasura a pristine database every time.
- No stale metadata, old root fields, or test data persist between consecutive local test runs.
- The teardown adds minimal overhead (~1–2 seconds) while guaranteeing deterministic, reproducible test runs locally and in CI.
