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

> **Windows users:** Run `bin/dc_prep` and `bin/dc_console` inside WSL (Ubuntu) or Git Bash,
> as they are Bash scripts targeting a Linux container environment.

---

## 🚀 `bin/dc_prep` — One-Command Setup

`bin/dc_prep` is the **single entry point** to bootstrap the entire backend. It starts all containers, deploys Hasura metadata for every tenant, applies database migrations, and seeds initial data — in the correct order.

### **Quick start**

```bash
cp .env.example .env   # fill in your values first
bin/dc_prep            # boots everything
```

Once it completes, open the Hasura console in a separate terminal:

```bash
bin/dc_console
```

### **What `bin/dc_prep` does (in order)**

| Step | Action |
|------|--------|
| 1 | Start `postgres`, `graphql-engine`, and `webhook` containers via Docker Compose |
| 2 | Poll `GET /healthz` until Hasura is ready (up to 3 min) |
| 3 | Build and deploy tenant metadata for all tenants (`metadata/setup-tenant.sh`) |
| 4 | Apply all database migrations (`hasura migrate apply`) per tenant |
| 5 | Reload Hasura metadata |
| 6 | Apply seed data (`hasura seed apply`) per tenant |

### **Targeting specific tenants**

By default, `bin/dc_prep` deploys **all tenants** (`safetrust` and `hotel_industry`). You can pass tenant names as arguments to limit the scope:

```bash
# Deploy all tenants (default)
bin/dc_prep

# Deploy a single tenant
bin/dc_prep safetrust

# Deploy multiple specific tenants
bin/dc_prep safetrust hotel_industry
```

### **Environment variables**

Copy `.env.example` to `.env` and fill in the required values before running `bin/dc_prep`:

```bash
POSTGRES_PASSWORD=your_postgres_password

# Must be valid JSON with a minimum 32-character key for HS256
HASURA_GRAPHQL_JWT_SECRET={"type":"HS256","key":"replace-with-min-32-char-secret-here"}

HASURA_EVENT_SECRET=your_event_secret
```

> ⚠️ `HASURA_GRAPHQL_JWT_SECRET` must be valid JSON and the key must be **at least 32 characters** for HS256. The script will fail at startup if this is malformed.

---

## 🗂️ Metadata Architecture

The `metadata/` folder contains the Hasura GraphQL Engine configuration per tenant.

```
backend/
└── metadata/
    ├── base/
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
    ├── build/
    │   └── tenant_a/
    │   └── tenant_b/
    │   └── ...
    ├── tenants/
    │   ├── safetrust/
    │   │   ├── databases/
    │   │   ├── tables/
    │   │   ├── functions/
    │   │   └── databases.yaml
    │   └── hotel_industry/
    │       ├── databases/
    │       ├── tables/
    │       ├── functions/
    │       └── databases.yaml
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

## 🔧 Manual Commands (advanced)

> **Tip:** `bin/dc_prep` handles all of the following automatically. Use these only when targeting a specific step or tenant in isolation.

### Metadata — single tenant

```bash
cd metadata
./setup-tenant.sh <tenant_name> [--admin-secret SECRET] [--endpoint URL]
```

**Example:**

```bash
./setup-tenant.sh safetrust --endpoint http://localhost:8080
```

Default values: `--admin-secret myadminsecretkey` · `--endpoint http://localhost:8080`

Or step by step:

```bash
# Step 1 — Build
./build-metadata.sh <tenant_name> --admin-secret myadminsecretkey --endpoint http://localhost:8080

# Step 2 — Verify build/ folder contains the correct tenant data

# Step 3 — Deploy
./deploy-tenant.sh <tenant_name> --admin-secret myadminsecretkey --endpoint http://localhost:8080
```

### Migrations — single tenant

From the **project root**:

```bash
hasura migrate apply \
  --database-name safetrust \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey
```

To apply a single migration version:

```bash
hasura migrate apply \
  --database-name safetrust \
  --version <timestamp> \
  --type up \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey
```

### Seeds — single tenant

```bash
hasura seed apply \
  --database-name safetrust \
  --endpoint http://localhost:8080 \
  --admin-secret myadminsecretkey
```

---

## 🧪 Backend Tests

This project uses the Karate framework for API testing. Tests run in a Docker environment.

- Docs: https://karatelabs.io/

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
