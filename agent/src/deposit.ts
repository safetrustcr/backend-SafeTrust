import {
  Account,
  Address,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  SpendingLimitError,
  getDefaultUsdcContract,
  usdcToAtomic,
  type SpendingLedger,
  type StellarNetworkName,
} from './payments';

export interface VerifyDepositXdrParams {
  /** Base64-encoded unsigned transaction envelope XDR */
  unsignedXdr: string;
  /** The contract_id returned by create_booking */
  expectedContractId: string;
  /** The quoted deposit amount in USDC (e.g. 45.00) */
  expectedAmountUsdc: number;
  /** Configured Stellar network ('testnet' or 'mainnet') */
  network: StellarNetworkName;
  /** Optional expected USDC SEP-41 contract address (defaults to network USDC contract) */
  expectedAssetContract?: string;
  /** Optional expected signer public key (G...) */
  expectedSigner?: string;
}

export interface VerifiedDepositXdr {
  contractId: string;
  functionName: 'fund_escrow';
  amountUsdc: number;
  amountAtomic: string;
  assetContract: string | null;
  signerAddress: string | null;
  networkPassphrase: string;
  transaction: Transaction;
}

export interface SignVerifiedDepositParams extends VerifyDepositXdrParams {
  /** Booking ID being funded */
  bookingId: string;
  /** Stellar secret key (S...) — never logged or returned */
  secretKey: string;
  /** Session spending ledger */
  ledger: SpendingLedger;
  /** Explicit flag proving human confirmation occurred for this booking */
  humanConfirmed: boolean;
}

export interface SignedDepositResult {
  bookingId: string;
  contractId: string;
  amountUsdc: number;
  amountAtomic: string;
  signerPublicKey: string;
  signedXdr: string;
  txHash: string;
}

export class DepositVerificationError extends Error {
  public readonly code:
    | 'INVALID_XDR'
    | 'FEE_BUMP_NOT_ALLOWED'
    | 'MULTIPLE_OPERATIONS'
    | 'NOT_INVOKE_CONTRACT'
    | 'WRONG_FUNCTION_NAME'
    | 'CONTRACT_ID_MISMATCH'
    | 'AMOUNT_MISMATCH'
    | 'ASSET_MISMATCH'
    | 'SIGNER_MISMATCH'
    | 'HUMAN_CONFIRMATION_REQUIRED';

  constructor(code: DepositVerificationError['code'], message: string) {
    super(message);
    this.name = 'DepositVerificationError';
    this.code = code;
  }
}

export function getStellarNetworkPassphrase(network: StellarNetworkName): string {
  return network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

/**
 * Helper to extract an ScVal field regardless of whether the SDK exposes
 * a method or property on the decoded XDR struct.
 */
function unwrapField<T>(target: unknown, key: string): T {
  const obj = target as Record<string, unknown>;
  const val = obj[key];
  if (typeof val === 'function') {
    return (val as () => T).call(target);
  }
  return val as T;
}

/**
 * Decode an unsigned Stellar transaction XDR and strictly verify that:
 *  1. It is a standard Transaction (not a FeeBumpTransaction) with exactly 1 operation.
 *  2. The single operation is `invokeHostFunction` of type `hostFunctionTypeInvokeContract`.
 *  3. The target contract address matches `expectedContractId` from `create_booking`.
 *  4. The invoked function name is exactly `fund_escrow`.
 *  5. The deposit amount argument in the invocation equals `expectedAmountUsdc` in 7-decimal USDC stroops.
 *  6. Any asset contract argument in the invocation matches the expected USDC SEP-41 contract for the network.
 *  7. Any signer address argument matches `expectedSigner` when provided.
 *
 * Any mismatch throws `DepositVerificationError` and aborts before signing.
 */
export function verifyFundEscrowXdr(
  params: VerifyDepositXdrParams
): VerifiedDepositXdr {
  const {
    unsignedXdr,
    expectedContractId,
    expectedAmountUsdc,
    network,
    expectedSigner,
  } = params;

  if (!unsignedXdr || typeof unsignedXdr !== 'string' || !unsignedXdr.trim()) {
    throw new DepositVerificationError(
      'INVALID_XDR',
      'Unsigned XDR must be a non-empty base64 string'
    );
  }

  if (!expectedContractId || !expectedContractId.trim()) {
    throw new DepositVerificationError(
      'CONTRACT_ID_MISMATCH',
      'Expected contract_id from create_booking is missing'
    );
  }

  const expectedAtomicStr = usdcToAtomic(expectedAmountUsdc);
  const expectedAtomicBigInt = BigInt(expectedAtomicStr);
  const expectedAsset = (
    params.expectedAssetContract ?? getDefaultUsdcContract(network)
  ).trim();
  const networkPassphrase = getStellarNetworkPassphrase(network);

  let parsedTx: Transaction | FeeBumpTransaction;
  try {
    parsedTx = TransactionBuilder.fromXDR(unsignedXdr.trim(), networkPassphrase);
  } catch (err) {
    throw new DepositVerificationError(
      'INVALID_XDR',
      `Failed to decode transaction XDR: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (parsedTx instanceof FeeBumpTransaction || 'innerTransaction' in parsedTx) {
    throw new DepositVerificationError(
      'FEE_BUMP_NOT_ALLOWED',
      'Aborting deposit: FeeBumpTransaction XDR is not allowed for fund_deposit'
    );
  }

  const tx = parsedTx as Transaction;
  if (!tx.operations || tx.operations.length !== 1) {
    throw new DepositVerificationError(
      'MULTIPLE_OPERATIONS',
      `Aborting deposit: expected exactly 1 operation in transaction, found ${tx.operations?.length ?? 0}`
    );
  }

  const op = tx.operations[0] as Operation.InvokeHostFunction;
  if (op.type !== 'invokeHostFunction' || !op.func) {
    throw new DepositVerificationError(
      'NOT_INVOKE_CONTRACT',
      `Aborting deposit: expected invokeHostFunction operation, found "${op.type}"`
    );
  }

  const hostFunc = op.func;
  const switchVal =
    typeof (hostFunc as unknown as { switch?: () => { name?: string } }).switch ===
    'function'
      ? (hostFunc as unknown as { switch: () => { name?: string } }).switch().name
      : (hostFunc as unknown as { type?: string }).type;

  if (switchVal !== 'hostFunctionTypeInvokeContract') {
    throw new DepositVerificationError(
      'NOT_INVOKE_CONTRACT',
      `Aborting deposit: expected hostFunctionTypeInvokeContract, found "${String(switchVal)}"`
    );
  }

  const invokeContract = unwrapField<xdr.InvokeContractArgs>(
    hostFunc,
    'invokeContract'
  );
  if (!invokeContract) {
    throw new DepositVerificationError(
      'NOT_INVOKE_CONTRACT',
      'Aborting deposit: missing invokeContract arguments in HostFunction'
    );
  }

  const rawContractAddr = unwrapField<xdr.ScAddress>(
    invokeContract,
    'contractAddress'
  );
  let decodedContractId: string;
  try {
    decodedContractId = Address.fromScAddress(rawContractAddr).toString();
  } catch (err) {
    throw new DepositVerificationError(
      'CONTRACT_ID_MISMATCH',
      `Aborting deposit: unable to decode contract address from XDR: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (decodedContractId !== expectedContractId.trim()) {
    throw new DepositVerificationError(
      'CONTRACT_ID_MISMATCH',
      `Aborting deposit: XDR targets contract "${decodedContractId}", which does not match create_booking contract_id "${expectedContractId.trim()}"`
    );
  }

  const rawFnName = unwrapField<{ toString: (enc?: string) => string } | Buffer | string>(
    invokeContract,
    'functionName'
  );
  const functionName =
    typeof rawFnName === 'string'
      ? rawFnName
      : Buffer.isBuffer(rawFnName)
        ? rawFnName.toString('utf8')
        : rawFnName?.toString
          ? rawFnName.toString()
          : '';

  if (functionName !== 'fund_escrow') {
    throw new DepositVerificationError(
      'WRONG_FUNCTION_NAME',
      `Aborting deposit: XDR invokes "${functionName}", expected "fund_escrow"`
    );
  }

  const rawArgs = unwrapField<xdr.ScVal[]>(invokeContract, 'args') ?? [];

  let foundAmountBigInt: bigint | null = null;
  let foundAssetContract: string | null = null;
  let foundSignerAddress: string | null = null;

  for (const scVal of rawArgs) {
    const valType =
      typeof (scVal as unknown as { switch?: () => { name?: string } }).switch ===
      'function'
        ? (scVal as unknown as { switch: () => { name?: string } }).switch().name
        : (scVal as unknown as { type?: string }).type;

    if (
      valType === 'scvI128' ||
      valType === 'scvU128' ||
      valType === 'scvI64' ||
      valType === 'scvU64'
    ) {
      const nativeVal = scValToNative(scVal);
      const asBigInt =
        typeof nativeVal === 'bigint'
          ? nativeVal
          : typeof nativeVal === 'number' || typeof nativeVal === 'string'
            ? BigInt(nativeVal)
            : null;
      if (asBigInt !== null) {
        if (foundAmountBigInt !== null && foundAmountBigInt !== asBigInt) {
          throw new DepositVerificationError(
            'AMOUNT_MISMATCH',
            `Aborting deposit: ambiguous numeric arguments in fund_escrow (${foundAmountBigInt.toString()} vs ${asBigInt.toString()})`
          );
        }
        foundAmountBigInt = asBigInt;
      }
    } else if (valType === 'scvAddress') {
      const addrStr = String(scValToNative(scVal));
      if (addrStr.startsWith('C')) {
        // Contract address argument (e.g. USDC token contract or escrow contract)
        if (addrStr !== expectedContractId.trim()) {
          foundAssetContract = addrStr;
        }
      } else if (addrStr.startsWith('G')) {
        foundSignerAddress = addrStr;
      }
    } else if (valType === 'scvMap') {
      const nativeMap = scValToNative(scVal) as Record<string, unknown>;
      if (nativeMap && typeof nativeMap === 'object') {
        if ('amount' in nativeMap && nativeMap.amount !== undefined) {
          foundAmountBigInt = BigInt(String(nativeMap.amount));
        }
        if ('token' in nativeMap && typeof nativeMap.token === 'string') {
          foundAssetContract = nativeMap.token;
        } else if ('asset' in nativeMap && typeof nativeMap.asset === 'string') {
          foundAssetContract = nativeMap.asset;
        }
        if ('signer' in nativeMap && typeof nativeMap.signer === 'string') {
          foundSignerAddress = nativeMap.signer;
        }
      }
    }
  }

  if (foundAmountBigInt === null) {
    throw new DepositVerificationError(
      'AMOUNT_MISMATCH',
      'Aborting deposit: fund_escrow XDR does not contain a deposit amount argument'
    );
  }

  if (foundAmountBigInt !== expectedAtomicBigInt) {
    throw new DepositVerificationError(
      'AMOUNT_MISMATCH',
      `Aborting deposit: XDR fund_escrow amount is ${foundAmountBigInt.toString()} stroops, expected ${expectedAtomicBigInt.toString()} stroops (${expectedAmountUsdc.toFixed(2)} USDC)`
    );
  }

  if (foundAssetContract !== null && foundAssetContract !== expectedAsset) {
    throw new DepositVerificationError(
      'ASSET_MISMATCH',
      `Aborting deposit: XDR specifies asset contract "${foundAssetContract}", expected USDC contract "${expectedAsset}"`
    );
  }

  if (
    expectedSigner &&
    foundSignerAddress !== null &&
    foundSignerAddress !== expectedSigner.trim()
  ) {
    throw new DepositVerificationError(
      'SIGNER_MISMATCH',
      `Aborting deposit: XDR signer "${foundSignerAddress}" does not match wallet address "${expectedSigner.trim()}"`
    );
  }

  return {
    contractId: decodedContractId,
    functionName: 'fund_escrow',
    amountUsdc: Number(expectedAmountUsdc.toFixed(7)),
    amountAtomic: expectedAtomicStr,
    assetContract: foundAssetContract ?? expectedAsset,
    signerAddress: foundSignerAddress,
    networkPassphrase,
    transaction: tx,
  };
}

/**
 * Verify the unsigned XDR, check human confirmation and spending ledger deposit limits,
 * and sign the transaction with the user's Stellar secret key.
 *
 * The secret key is used strictly in-memory to sign and is never logged or returned.
 */
export function verifyAndSignDeposit(
  params: SignVerifiedDepositParams
): SignedDepositResult {
  if (!params.humanConfirmed) {
    throw new DepositVerificationError(
      'HUMAN_CONFIRMATION_REQUIRED',
      `Refusing to sign deposit for booking "${params.bookingId}": human confirmation ("yes") is required before signing.`
    );
  }

  // 1. Enforce AGENT_MAX_DEPOSIT in the spending ledger before decoding/signing
  params.ledger.verifyDepositLimit(params.expectedAmountUsdc);

  const keypair = Keypair.fromSecret(params.secretKey.trim());
  const signerPublicKey = keypair.publicKey();

  // 2. Decode and verify the unsigned XDR calls fund_escrow on expectedContractId for expectedAmountUsdc
  const verified = verifyFundEscrowXdr({
    ...params,
    expectedSigner: params.expectedSigner ?? signerPublicKey,
  });

  // 3. Sign the verified transaction
  verified.transaction.sign(keypair);
  const signedXdr = verified.transaction.toXDR();
  const txHash = Buffer.from(verified.transaction.hash()).toString('hex');

  // 4. Record the deposit in the spending ledger
  params.ledger.recordDeposit({
    bookingId: params.bookingId,
    contractId: verified.contractId,
    amountUsdc: verified.amountUsdc,
    assetContract: verified.assetContract ?? undefined,
  });

  return {
    bookingId: params.bookingId,
    contractId: verified.contractId,
    amountUsdc: verified.amountUsdc,
    amountAtomic: verified.amountAtomic,
    signerPublicKey,
    signedXdr,
    txHash,
  };
}

/**
 * Build a deterministic unsigned Soroban `fund_escrow` transaction XDR for local/testnet
 * workflows or tests when an unsigned XDR is constructed from booking parameters.
 */
export function buildUnsignedFundEscrowXdr(params: {
  contractId: string;
  signerPublicKey: string;
  amountUsdc: number;
  network: StellarNetworkName;
  assetContract?: string;
  sequenceNumber?: string;
  functionName?: string;
}): string {
  const networkPassphrase = getStellarNetworkPassphrase(params.network);
  const assetContract = (
    params.assetContract ?? getDefaultUsdcContract(params.network)
  ).trim();
  const atomicBigInt = BigInt(usdcToAtomic(params.amountUsdc));

  // Ensure contractId is a valid Stellar C... contract address for XDR encoding
  const validContractId = StrKey.isValidContract(params.contractId)
    ? params.contractId
    : StrKey.encodeContract(
        Buffer.from(params.contractId.padEnd(32, '0').slice(0, 32), 'utf8')
      );

  const account = new Account(
    params.signerPublicKey,
    params.sequenceNumber ?? '100'
  );

  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: validContractId,
        function: params.functionName ?? 'fund_escrow',
        args: [
          nativeToScVal(params.signerPublicKey, { type: 'address' }),
          nativeToScVal(atomicBigInt, { type: 'i128' }),
          nativeToScVal(assetContract, { type: 'address' }),
        ],
      })
    )
    .setTimeout(300)
    .build();

  return tx.toXDR();
}
