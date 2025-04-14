# 🌟 SafeTrust 🌟

**SafeTrust** is a decentralized platform designed to revolutionize P2P transactions, providing secure deposits and payments powered by blockchain and trustless technologies. 🌐✨ Experience transparency and reliability in every cryptocurrency transaction. 💸🔒

---

## 🚀 **Why Choose SafeTrust?**

🔐 **Trustless Technology**: Secure and block deposits without intermediaries.  
💾 **Blockchain-Powered Transparency**: Immutable, auditable, and verifiable transactions.  
💱 **Crypto-Payment Support**: Manage cryptocurrency payments safely and efficiently.  
✅ **Automated Refunds**: Streamlined processes ensure refunds and payment releases happen automatically.

---

## 🌟 **Key Features**

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

## ⚙️ **How It Works**

1. **Create Escrow**: The renter creates a secure escrow account. 🏗️
2. **Fund Escrow**: The deposit is funded by the renter. 💵
3. **Rental Agreement**: Terms are agreed upon and stored on the blockchain. 📃
4. **Completion or Cancellation**: Funds are released based on contract outcomes. 🎯

---

## 📋 **Getting Started**

### **Prerequisites**

0. Install Docker and Docker Compose
1. Run

```shell
bin/dc_prep
bin/dc_console
```
2. Multi-Tenant Architecture (Database per Tenant).

Metadata folder contains the architecture, the database per tenant,


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
        │   ├── version.yaml
        └── build/
        │   └── tenant_a/
        │   └── tenant_b/
        │   └── ....
        └── tenants/
        │   └── tenant_a/
        │   │          ├── databases/
        │   │          ├── tables/
        │   │          ├── functions/
        │   │          ├── databases.yaml
        │   └── tenant_b/
        │   │          ├── databases/
        │   │          ├── tables/
        │   │          ├── functions/
        │   │          ├── databases.yaml
        │   └── ....
        │   ├── build-metadata.sh
        │   ├── deploy-tenant.sh
            
```
Architecture multitenant guide:

- base/ folder: contains all graphql and hasura dependencies necessary for tenants.
- build/ folder: prepare tenants with all graphql and hasura dependencies. 
- tenants/ folder: contains all tenant database files, tables, functions, relations, triggers, etc.
- build-metadata.sh file: prepares the tenants with their dependencies and corresponding configurations.
- deploy-tenant.sh: deploys to the database with the tenants, their tables and relationships.

Steps to execute the metadata:

- Run commands to build tenants individually: /build-metadata.sh "tenant_name" --admin-secret myadminsecretkey --endpoint "endpoint"
- Verify build folder contains correct tenant data
- Successfully deploy tenants: ./deploy-tenant.sh "tenant_name" "tenant_name" --admin-secret myadminsecretkey --endpoint "endpoint"


3. Adding migrations.

You can add migrations either with the hasura console or by the command:

```shell
hasura migrate create [enable_postgis] --admin-secret myadminsecretkey
```

where `enable_postgis` is the name of the migration. Please make sure to use descriptive names with verbs about what the migration is doing!

Then to apply them, stop the `bin/dc_worker` running with CTRL + C and re-start it again. Migrations are applied when the console runs in docker-compose.

If you wanna use the hasura web console and access it on `http://localhost:9695/`:

```shell
hasura console --admin-secret myadminsecretkey
```

Don't forget to apply the metadata. Migrations and metadata are applied each time you stop the `bin/dc_console` command and run it again.

And you should be good to go to start and work on this.

## 📋 **Known Issues**

### 📝 **Title**

**Error Running Docker Compose**

### ❌ **Error Message**

> `Rosetta error: Rosetta is only intended to run on Apple Silicon with a macOS host using Virtualization.framework with Rosetta mode enabled`

### 🔍 **Error Description**

1. Run `docker compose up -d`.
2. If the **Backend postgres-1 module** can't start and shows the error above:
   - This is due to an issue with Rosetta settings on Apple Silicon devices.
3. ✅ **Solution:**
   - Go to **Docker Settings** and disable the:  
     `Use Rosetta for x86_64/amd64 emulation on Apple Silicon` selection button.
   - 🔄 Restart Docker.
   - 🚀 It should now run great!

# Backend Tests

This project uses Karate framework for API testing. The tests are designed to run in a Docker environment.

## Prerequisites

- Docker
- Docker Compose

## Project Structure

```
backend/
├── docker-compose-test.yml
├── Dockerfile.test
└── tests/
    ├── karate.jar
    └── karate/
        ├── features/
        │   ├── auth/
        │   │   ├── login.feature
        │   │   └── permissions.feature
        │   └── users/
        │       ├── create.feature
        │       └── query.feature
        └── src/
            └── test/
                └── resources/
                    └── karate-config.js
```

## Running Tests

To run all tests:

```bash
docker compose -f docker-compose-test.yml run --rm --build karate
```

This command will:

1. Build the test container
2. Start PostgreSQL and Hasura containers
3. Run all Karate tests
4. Show test results in the console
5. Generate HTML reports in `target/karate-reports/`

## Test Reports

After running the tests, you can find the HTML reports at:

- Summary: `tests/results/karate-summary.html`
- Detailed: `tests/results/karate-tags.html`

## Development

### Adding New Tests

1. Create new `.feature` files in `tests/karate/features/`
2. Follow the Karate DSL syntax
3. Tests will be automatically picked up when running the test command

### Configuration

- Main config: `tests/karate/src/test/resources/karate-config.js`
- Database config: `docker-compose-test.yml`
- Test environment: `Dockerfile.test`

## Seeds 🌱

Seeds are files that allow you to create test data in an automated way

Creating a seed:
``` bash
hasura seed create seed_name
```

At this moment you need to write the SQL code in the seed file

Applying all seeds:
``` bash
hasura seed apply
```

Applying an specific seed:
``` bash
hasura seed apply --file seed_name.sql
```



