![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/sotoJ24/SafeTrust-Backend?utm_source=oss&utm_medium=github&utm_campaign=sotoJ24%2FSafeTrust-Backend&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

### SafeTrust Description:

**SafeTrust** is a decentralized platform designed to revolutionize P2P transactions, providing secure deposits and payments powered by blockchain and trustless technologies. 🌐✨ Experience transparency and reliability in every cryptocurrency transaction. 💸🔒

---

### **Why Choose SafeTrust?**

🔐 **Trustless Technology**: Secure and block deposits without intermediaries.  
💾 **Blockchain-Powered Transparency**: Immutable, auditable, and verifiable transactions.  
💱 **Crypto-Payment Support**: Manage cryptocurrency payments safely and efficiently.  
✅ **Automated Refunds**: Streamlined processes ensure refunds and payment releases happen automatically.

---

## **Key Features**

🛠️ **Trustless Escrow**:  
Funds are securely held in blockchain-based escrow accounts until all terms are met.

🔎 **Blockchain Transparency**:  
Every transaction is logged on the blockchain for full visibility and accountability. 📜

💰 **Crypto Payments**:  
Supports irreversible and secure cryptocurrency payments while reducing risks of fraud or disputes.

🔗 **Trustline Process**:  
Verified trustlines between parties add an extra layer of transaction security. 🔒

📤 **Automated Refund System**:  
Ensures funds are automatically released based on the terms of the agreement, with no manual intervention required.

---

## 📋 **Getting Started**

### **Prerequisites**

| Tool | Version | Notes |
|------|---------|-------|
| [Docker](https://docs.docker.com/get-docker/) & Docker Compose | ≥ 24 | Required |
| [Hasura CLI](https://hasura.io/docs/latest/hasura-cli/install-hasura-cli/) | ≥ 2.x | Required for migrations & seeds |
| [curl](https://curl.se/) | any | Used by health-check loop |

### **One-command setup**

```bash
# 1. Copy and configure environment variables
cp .env_example .env
# Edit .env and fill in values marked <...>

# 2. Run the unified setup script (WSL / Linux / macOS)
bash bin/dc_prep

# 3. Open the Hasura Console (in a separate terminal)
bash bin/dc_console
```

`bin/dc_prep` performs the following steps automatically, in order:

| Step | Action |
|------|--------|
| 1 | Start `postgres`, `data-connector-agent`, and `graphql-engine` via Docker Compose |
| 2 | Poll `GET /healthz` until Hasura is ready (up to 120 s) |
| 3 | Build and deploy tenant metadata (`metadata/setup-tenant.sh safetrust`) |
| 4 | Apply all database migrations (`hasura migrate apply`) |
| 5 | Reload Hasura metadata and verify consistency |
| 6 | Apply seed data (`hasura seed apply`) |

**Options:**

```text
--tenant    TENANT    Tenant name to set up          (default: safetrust)
--endpoint  URL       Hasura GraphQL endpoint         (default: http://localhost:8080)
--secret    SECRET    Hasura admin secret             (default: myadminsecretkey)
--skip-seeds          Skip Step 6 (seed application)
```

> **Windows users:** Run `bin/dc_prep` and `bin/dc_console` inside WSL (Ubuntu) or Git Bash,
> as they are Bash scripts targeting a Linux container environment.

---

## 🗂️ Metadata Architecture

The metadata folder contains the Hasura GraphQL Engine configuration per tenant.

```
backend/
└── metadata/
    └── base/
    │   ├── actions.graphql
    │   ├── actions.yaml
    │   ├── allow_list.yaml
    │   ├── api_limits.yaml
    │   ├── backend_configs.yaml
    │   ├── cron_triggers.yaml
    │   ├── graphql_schema_introspection.yaml
    │   ├── inherited_roles.yaml
    │   ├── metrics_config.yaml
    │   ├── network.yaml
    │   ├── opentelemetry.yaml
    │   ├── query_collections.yaml
    │   ├── remote_schemas.yaml
    │   ├── rest_endpoints.yaml
    │   └── version.yaml
    └── build/
    │   └── tenant_a/
    │   └── tenant_b/
    │   └── ...
    └── tenants/
    │   └── tenant_a/
    │   │   ├── databases/
    │   │   ├── tables/
    │   │   ├── functions/
    │   │   └── databases.yaml
    │   └── tenant_b/
    │   │   ├── databases/
    │   │   ├── tables/
    │   │   ├── functions/
    │   │   └── databases.yaml
    │   └── ...
    ├── build-metadata.sh
    ├── deploy-tenant.sh
    └── setup-tenant.sh
```

**Folder guide:**
- `base/` — Hasura base configuration and GraphQL dependencies shared across all tenants
- `build/` — Generated output: tenants merged with base dependencies, ready to deploy
- `tenants/` — Tenant-specific database files, tables, functions, relations, and triggers
- `build-metadata.sh` — Prepares a tenant by merging it with base configurations
- `deploy-tenant.sh` — Deploys a built tenant to Hasura (tracks tables and relationships)
- `setup-tenant.sh` — **Runs both steps above in one command** ✅

---

## 🚀 Steps to execute the metadata

### Option A — Single command (recommended)

Go to the `metadata/` directory and run:

```shell
./setup-tenant.sh <tenant_name> [--admin-secret SECRET] [--endpoint URL]
```

**Example:**

```shell
./setup-tenant.sh safetrust --endpoint http://localhost:8080
```

This runs `build-metadata.sh` followed by `deploy-tenant.sh` automatically in the correct order.

Default values: `--admin-secret myadminsecretkey` · `--endpoint http://localhost:8080`

---

### Option B — Step by step (manual)

1. Go to the `metadata/` directory and build the tenant:

```shell
./build-metadata.sh <tenant_name> --admin-secret myadminsecretkey --endpoint <endpoint>
```

2. Verify the `build/` folder contains the correct tenant data.

3. Deploy the tenant:

```shell
./deploy-tenant.sh <tenant_name> --admin-secret myadminsecretkey --endpoint <endpoint>
```

- **`tenant_name`** — the name of the tenant you will work on (e.g. `safetrust`)
- **`endpoint`** — the Hasura endpoint, commonly `http://localhost:8080`

---

## 🗃️ Steps to execute the migrations

> **Tip:** `bin/dc_prep` handles migrations automatically. Use the manual steps below only for targeted work.

From the **project root**:

```bash
hasura migrate apply \
  --database-name safetrust \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey
```

To apply a single version:

```bash
hasura migrate apply \
  --database-name safetrust \
  --version <timestamp> \
  --type up
```

---

## 🌱 Steps to execute the seeds

> **Tip:** `bin/dc_prep` applies seeds automatically. Use the manual step below when you need to re-seed.

From the **project root**:

```bash
hasura seed apply \
  --database-name safetrust \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey
```

---

## 🧪 Backend Tests

This project uses the Karate framework for API testing. Tests run in a Docker environment.

### Running Tests

```bash
docker compose -f docker-compose-test.yml run --rm --build karate
```

This command will:

1. Build the test container
2. Start PostgreSQL and Hasura containers
3. Run all Karate tests
4. Show test results in the console
5. Generate HTML reports in `target/karate-reports/`

### Test Reports

After running the tests, find the HTML reports at:

- Summary: `tests/results/karate-summary.html`
- Detailed: `tests/results/karate-tags.html`

### Adding New Tests

1. Create new `.feature` files in `tests/karate/features/`
2. Follow the Karate DSL syntax
3. Tests are automatically picked up when running the test command

### Configuration

- Main config: `tests/karate/src/test/resources/karate-config.js`
- Database config: `docker-compose-test.yml`
- Test environment: `Dockerfile.test`
