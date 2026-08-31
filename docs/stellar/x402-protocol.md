# x402 Agentic Payment Protocol

SafeTrust implements the x402 protocol to enable AI agents to autonomously book escrow contracts without human-operated wallets. The flow mirrors the HTTP 402 pattern but settles on Stellar.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant AG as AI Agent
    participant BE as SafeTrust API
    participant FAC as OpenZeppelin Facilitator
    participant SC as Soroban USDC Contract

    AG->>BE: POST /api/escrows/initialize
    (no X-Payment header)
    BE-->>AG: 402 Payment Required
    { accepts: [{
      scheme: exact
      network: stellar:testnet
      amount: 0.10 USDC
      asset: USDC SEP-41
      facilitator_url: ...
    }]}

    AG->>SC: authorize USDC transfer
    (signed Soroban auth entry)
    AG->>BE: POST /api/escrows/initialize
    X-Payment: x402 <base64-auth>

    BE->>FAC: POST /verify
    { payload, amount, network }
    FAC-->>BE: { isValid: true, payer: GAGENT... }

    BE-->>AG: 200 OK
    { contractId: CAZT... }

    BE->>FAC: POST /settle (async)
    non-blocking background
    FAC->>SC: settle USDC on-chain
```

## Why x402 Matters

AI agents cannot open browser wallets, scan QR codes, or interact with traditional wallet UIs. The x402 flow allows an agent to discover payment requirements, authorize a Soroban transfer, and receive a signed receipt—all via standard HTTP headers and JSON payloads.

## Stellar vs EVM Difference

On EVM chains, a payment is typically an on-chain transaction that the agent must sign and broadcast. On Stellar, the agent creates an **authorization entry** (Soroban auth entry) rather than submitting a standalone transaction to the network. The facilitator batches and settles the actual transfer, which reduces on-chain footprint and simplifies retry logic.

## USDC SEP-41 Contracts

| Network | Address |
|---------|---------|
| Testnet | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Mainnet | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |

## Configuration

`X402_ENABLED=false` by default. Human users are unaffected; the x402 endpoints remain inactive unless explicitly enabled.

## Facilitator

SafeTrust uses the OpenZeppelin x402 facilitator (`channels.openzeppelin.com/x402`) for payment verification and settlement.
