# bin/start

## Flow
```mermaid
flowchart TD
    A([bin/start\nsafetrust hotel_industry]) --> B[docker compose up -d --build\npostgres + hasura + webhook]
    B --> C[Wait for Hasura /healthz\n0.5s poll interval\n120s timeout]
    C --> D[Register database sources\npg_add_source for each tenant]
    D --> E[Apply migrations\nhasura migrate apply × N tenants]
    E --> F[Deploy metadata\nsetup-tenant.sh × N tenants]
    F --> G[Reload metadata\nhasura metadata reload]
    G --> H[Apply seeds\nhasura seed apply × N tenants]
    H --> I([Ready\nlocalhost:8080 Hasura\nlocalhost:3000 Webhook])
```

## Prerequisites
- Docker
- hasura CLI
- yq

## Usage

- `bin/start safetrust` vs `bin/start safetrust hotel_industry`
- `bin/start --reset` — full teardown and fresh start
- `bin/start --restart` — restart containers, skip data
- `TRACK_SAFETRUST_TIMINGS=true` output format

## Common failures and fixes
- Port 5433 already in use
- Hasura health timeout
- Seed duplicate key errors
