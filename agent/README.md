# SafeTrust Booking Agent (MCP Server)

An MCP (Model Context Protocol) server that lets any AI assistant search, hold, and book SafeTrust properties with **in-code spending limits**, **automatic `@x402/fetch` fee payments**, and **verified Stellar escrow deposit signing**.

## How It Works

### 1. Free Discovery Session (`/api/auth/wallet-challenge`)
Before calling discovery endpoints (`search_properties`, `check_availability`), the agent authenticates a free session using SafeTrust's existing wallet challenge flow:
1. `POST /api/auth/wallet-challenge/challenge` with the wallet's public key (`G...`)
2. Signs the returned challenge JSON with the same Stellar wallet (`STELLAR_SECRET_KEY`)
3. `POST /api/auth/wallet-challenge/verify` with the Ed25519 signature

Because the session is authenticated, discovery calls are **free** (`0.00 USDC`).

### 2. In-Code Spending Limits & x402 Payments
Paid endpoints (`hold_dates`, `create_booking`) are wrapped with `@x402/fetch` + `@x402/stellar` (`ExactStellarScheme`) and guarded by `SpendingLedger` **before** any payment payload is signed:

| Limit | Env Variable | Default (Testnet) | Behavior When Reached |
| :--- | :--- | :--- | :--- |
| Maximum fee per call | `AGENT_MAX_FEE_PER_CALL` | `0.10` USDC | Refused before paying |
| Session fee budget | `AGENT_FEE_BUDGET` | `0.50` USDC | Paid calls refused; free calls still work |
| Maximum deposit | `AGENT_MAX_DEPOSIT` | `50.00` USDC | Booking / deposit refused |
| Stellar network | `STELLAR_NETWORK` | `testnet` | Rejects 402s or XDRs for any other network |

Every 402 response is also checked against the configured `SAFETRUST_PLATFORM_WALLET` (`payTo`) and USDC SEP-41 contract address before signing.

### 3. Human Confirmation & XDR Verification (`fund_deposit`)
`fund_deposit` **never** signs without human confirmation for that booking:
- **MCP Elicitation (preferred):** If the connected MCP client supports elicitation, `fund_deposit` sends an `elicitation/create` prompt asking the human to confirm locking the exact USDC deposit into the escrow `contract_id`.
- **Two-Step Fallback (`prepare_deposit` / `confirm_deposit`):** If the MCP client does not support elicitation, `fund_deposit` (or `prepare_deposit`) returns a `confirmation_id` and prompt text to show to the human. Once the human replies `"yes"`, the assistant calls `confirm_deposit` (or `fund_deposit`) with `confirmation_id` and `human_confirmed: true`.

Before signing, `verifyFundEscrowXdr` decodes the unsigned transaction XDR and verifies:
- Single `invokeHostFunction` (`hostFunctionTypeInvokeContract`) operation (no fee-bump or multi-op transactions)
- Target contract equals the `contract_id` returned by `create_booking`
- Invoked function name is `fund_escrow`
- Deposit amount equals the exact quoted USDC deposit (in 7-decimal stroops)
- Asset contract matches the configured network's USDC contract

### 4. Secret Key Handling
- Provide the wallet's secret key via the `STELLAR_SECRET_KEY` environment variable (`testnet` is the default when `STELLAR_NETWORK` is unset).
- The secret key is kept strictly in memory for signing wallet challenges, x402 authorizations, and verified `fund_escrow` transactions. It is **never** logged to stdout/stderr or returned by any MCP tool.

---

## Configuration

| Variable | Description | Default |
| :--- | :--- | :--- |
| `STELLAR_SECRET_KEY` | Stellar secret key (`S...`) for the user's wallet | **Required** |
| `STELLAR_NETWORK` | `testnet` or `mainnet` | `testnet` |
| `SAFETRUST_API_URL` | Base URL of the SafeTrust backend API | `http://localhost:3001` |
| `SAFETRUST_PLATFORM_WALLET` | Expected SafeTrust `payTo` address for x402 fees | Testnet platform wallet |
| `AGENT_MAX_FEE_PER_CALL` | Max x402 fee per API call (USDC) | `0.10` |
| `AGENT_FEE_BUDGET` | Max cumulative x402 fees per session (USDC) | `0.50` |
| `AGENT_MAX_DEPOSIT` | Max escrow deposit amount (USDC) | `50.00` |

---

## Testnet Funding

1. Generate or pick a Stellar testnet keypair (`G...` / `S...`).
2. Fund the account with testnet XLM using Stellar Friendbot:
   ```bash
   curl "https://friendbot.stellar.org?addr=<YOUR_PUBLIC_KEY>"
   ```
3. Obtain testnet USDC (contract `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) from the Stellar Testnet faucet / SAC dispenser so your wallet can pay x402 fees and fund escrow deposits.

---

## Build & Test

```bash
cd agent
npm install
npm run build
npm run type-check
npm test
npm run demo:testnet
```

---

## Setup with Claude Desktop / Claude Code

First build the package (`cd agent && npm install && npm run build`), then add the server to your MCP configuration.

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "safetrust-booking": {
      "command": "node",
      "args": ["/absolute/path/to/backend-SafeTrust/agent/dist/index.js"],
      "env": {
        "STELLAR_SECRET_KEY": "S...",
        "STELLAR_NETWORK": "testnet",
        "SAFETRUST_API_URL": "http://localhost:3001",
        "AGENT_MAX_FEE_PER_CALL": "0.10",
        "AGENT_FEE_BUDGET": "0.50",
        "AGENT_MAX_DEPOSIT": "50.00"
      }
    }
  }
}
```

### Claude Code
```bash
claude mcp add safetrust-booking \
  -e STELLAR_SECRET_KEY=S... \
  -e STELLAR_NETWORK=testnet \
  -e SAFETRUST_API_URL=http://localhost:3001 \
  -- node /absolute/path/to/backend-SafeTrust/agent/dist/index.js
```

## Available MCP Tools

- `search_properties` — Search SafeTrust properties (free session)
- `check_availability` — Check dates and get total + deposit quote (free session)
- `hold_dates` — Place a temporary hold on dates (paid via x402)
- `release_hold` — Release a date hold (free)
- `create_booking` — Create booking and deploy escrow contract (paid via x402)
- `fund_deposit` — Verify XDR, confirm with human, sign, and submit deposit
- `prepare_deposit` / `confirm_deposit` — Two-step confirmation fallback for clients without elicitation
- `spending_summary` — View session x402 fees spent, remaining budget, and locked deposits
