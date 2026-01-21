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

## 📋 **Getting Started**

### **Prerequisites**

1. Install Docker and Docker Compose
2. Run

```shell
bin/dc_prep
bin/dc_console
```

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

### Steps to execute the metadata:

1. Go to the directory called metadata and run the following command:

``` shell
./build-metadata.sh <tenant_name> --admin-secret myadminsecretkey --endpoint <endpoint>
```
2. Verify build folder contains correct tenant data
3. Deploy the tenants running the following command:

  ``` shell
  ./deploy-tenant.sh <tenant_name> --admin-secret myadminsecretkey --endpoint <endpoint>
  ```

* **tenant_name** is the name of the tenant that you will work on

* **endpoint** is the endpoint where you are running the hasura, commonly it's localhost:8080

# Steps to execute the migrations:
Go to migrations folder: `cd migrations/`
 ``` shell
    hasura migrate apply
 ```
Then select the tenant to migrate it !

# Steps to execute the seeds:
Go to seeds folder: `cd seeds/`
 ``` shell
    hasura seed apply
 ```
Then select the tenant to seed it !

# Backend Tests

This project uses Karate framework for API testing. The tests are designed to run in a Docker environment.

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
