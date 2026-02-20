"use strict";

const axios = require("axios");

const trustlessWork = axios.create({
     baseURL: process.env.TRUSTLESS_WORK_API_URL || "https://dev.api.trustlesswork.com",
     timeout: 15000,
     headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.TRUSTLESS_WORK_API_KEY,
     },
});

const hasura = axios.create({
     baseURL: process.env.HASURA_GRAPHQL_URL || "http://localhost:8080/v1/graphql",
     timeout: 10000,
     headers: {
          "Content-Type": "application/json",
          "x-hasura-admin-secret": process.env.HASURA_ADMIN_SECRET,
     },
});

const INSERT_ESCROW = `
  mutation InsertEscrow(
    $contractId: String!
    $engagementId: String!
    $propertyId: String!
    $senderAddress: String!
    $receiverAddress: String!
    $amount: numeric!
    $status: String!
    $unsignedXdr: String!
  ) {
    insert_escrows_one(object: {
      contract_id:      $contractId
      engagement_id:    $engagementId
      property_id:      $propertyId
      sender_address:   $senderAddress
      receiver_address: $receiverAddress
      amount:           $amount
      status:           $status
      unsigned_xdr:     $unsignedXdr
    }) {
      id
      contract_id
      engagement_id
      property_id
      sender_address
      receiver_address
      amount
      status
      unsigned_xdr
      created_at
    }
  }
`;

const STELLAR_REGEX = /^G[A-Z2-7]{55}$/;

function validate(body) {
     const errors = [];

     if (!body.senderAddress) {
          errors.push("senderAddress is required");
     } else if (!STELLAR_REGEX.test(body.senderAddress.trim())) {
          errors.push("senderAddress must be a valid Stellar public key");
     }

     if (!body.receiverAddress) {
          errors.push("receiverAddress is required");
     } else if (!STELLAR_REGEX.test(body.receiverAddress.trim())) {
          errors.push("receiverAddress must be a valid Stellar public key");
     }

     const amount = Number(body.amount);
     if (body.amount === undefined || body.amount === null || body.amount === "") {
          errors.push("amount is required");
     } else if (isNaN(amount) || amount <= 0) {
          errors.push("amount must be a positive number");
     }

     if (!body.propertyId || !String(body.propertyId).trim()) {
          errors.push("propertyId is required");
     }

     return errors;
}

async function createEscrow(req, res) {
     const errors = validate(req.body);
     if (errors.length > 0) {
          return res.status(400).json({ error: "Validation failed", details: errors });
     }

     const {
          senderAddress,
          receiverAddress,
          amount,
          propertyId,
          platformAddress = process.env.PLATFORM_STELLAR_ADDRESS,
          platformFee = Number(process.env.PLATFORM_FEE_PERCENT) || 1,
          title = `Security Deposit - Property ${propertyId}`,
          description = `Security deposit escrow for property ${propertyId}`,
     } = req.body;

     if (!platformAddress || !STELLAR_REGEX.test(platformAddress)) {
          return res.status(500).json({
               error: "PLATFORM_STELLAR_ADDRESS in .env is missing or invalid",
          });
     }

     const engagementId = req.body.engagementId || `ST-${propertyId}-${Date.now()}`;

     const payload = {
          signer: senderAddress,
          engagementId,
          title,
          description,
          roles: {
               approver: receiverAddress,
               serviceProvider: senderAddress,
               platformAddress,
               releaseSigner: receiverAddress,
               disputeResolver: platformAddress,
               receiver: receiverAddress,
          },
          amount: Number(amount),
          platformFee: Number(platformFee),
          milestones: [{ description: "Security deposit held until end of tenancy" }],
          trustline: {
               symbol: process.env.TRUSTLINE_SYMBOL || "USDC",
               address: process.env.TRUSTLINE_ADDRESS || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          },
     };

     console.log(`[escrow] Deploying property=${propertyId} amount=${amount}`);

     let unsignedXdr;
     try {
          const { data } = await trustlessWork.post("/deployer/single-release", payload);

          if (data.status !== "SUCCESS" || !data.unsignedTransaction) {
               return res.status(502).json({ error: "Unexpected response from Trustless Work", raw: data });
          }

          unsignedXdr = data.unsignedTransaction;
          console.log(`[escrow] Deploy success — engagementId=${engagementId}`);
     } catch (err) {
          const status = err.response?.status;
          const body = err.response?.data;
          console.error(`[escrow] Trustless Work error HTTP ${status}:`, body || err.message);

          if (status === 400) return res.status(400).json({ error: "Trustless Work rejected the request", details: body });
          if (status === 401) return res.status(500).json({ error: "Invalid Trustless Work API key" });
          if (status === 429) return res.status(429).json({ error: "Trustless Work rate limit hit" });
          return res.status(500).json({ error: "Failed to deploy escrow", details: body || err.message });
     }

     // Save to Hasura
     try {
          const { data: gql } = await hasura.post("", {
               query: INSERT_ESCROW,
               variables: {
                    contractId: engagementId,
                    engagementId,
                    propertyId: propertyId.trim(),
                    senderAddress: senderAddress.trim(),
                    receiverAddress: receiverAddress.trim(),
                    amount: Number(amount),
                    status: "pending_signature",
                    unsignedXdr,
               },
          });

          if (gql.errors) {
               console.error("[escrow] Hasura errors:", gql.errors);
               return res.status(207).json({
                    warning: "Escrow deployed but DB save failed",
                    contractId: engagementId,
                    unsignedXdr,
                    dbErrors: gql.errors,
               });
          }

          const saved = gql.data.insert_escrows_one;
          console.log(`[escrow] Saved to DB — id=${saved.id}`);

          return res.status(201).json({
               contractId: engagementId,
               unsignedXdr,
               engagementId,
               propertyId,
               senderAddress,
               receiverAddress,
               amount: Number(amount),
               escrow: saved,
          });
     } catch (err) {
          console.error("[escrow] Hasura error:", err.message);
          return res.status(207).json({
               warning: "Escrow deployed but DB save failed",
               contractId: engagementId,
               unsignedXdr,
               details: err.message,
          });
     }
}

module.exports = { createEscrow };