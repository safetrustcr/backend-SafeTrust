import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import {
  DepositVerificationError,
  buildUnsignedFundEscrowXdr,
  verifyAndSignDeposit,
  verifyFundEscrowXdr,
} from '../deposit';
import { SpendingLedger, getDefaultUsdcContract } from '../payments';

const PLATFORM_WALLET =
  'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const TESTNET_USDC = getDefaultUsdcContract('testnet');

function makeLedger(maxDepositUsdc = 50) {
  return new SpendingLedger({
    maxFeePerCallUsdc: 0.1,
    feeBudgetUsdc: 0.5,
    maxDepositUsdc,
    network: 'testnet',
    expectedPayTo: PLATFORM_WALLET,
    expectedAssetContract: TESTNET_USDC,
  });
}

describe('XDR verification & deposit signing', () => {
  const kp = Keypair.random();
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 3));
  const otherContractId = StrKey.encodeContract(Buffer.alloc(32, 9));

  it('verifies a valid fund_escrow XDR matching contract_id and deposit amount', () => {
    const xdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45.0,
      network: 'testnet',
    });

    const verified = verifyFundEscrowXdr({
      unsignedXdr: xdr,
      expectedContractId: contractId,
      expectedAmountUsdc: 45.0,
      network: 'testnet',
      expectedSigner: kp.publicKey(),
    });

    expect(verified.contractId).toBe(contractId);
    expect(verified.functionName).toBe('fund_escrow');
    expect(verified.amountUsdc).toBe(45.0);
    expect(verified.amountAtomic).toBe('450000000');
    expect(verified.assetContract).toBe(TESTNET_USDC);
  });

  it('aborts when XDR targets a different contract_id', () => {
    const xdr = buildUnsignedFundEscrowXdr({
      contractId: otherContractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45.0,
      network: 'testnet',
    });

    try {
      verifyFundEscrowXdr({
        unsignedXdr: xdr,
        expectedContractId: contractId,
        expectedAmountUsdc: 45.0,
        network: 'testnet',
      });
      fail('Expected CONTRACT_ID_MISMATCH');
    } catch (err) {
      expect(err).toBeInstanceOf(DepositVerificationError);
      expect((err as DepositVerificationError).code).toBe(
        'CONTRACT_ID_MISMATCH'
      );
    }
  });

  it('aborts when XDR invokes a function other than fund_escrow', () => {
    const xdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45.0,
      network: 'testnet',
      functionName: 'drain_escrow',
    });

    try {
      verifyFundEscrowXdr({
        unsignedXdr: xdr,
        expectedContractId: contractId,
        expectedAmountUsdc: 45.0,
        network: 'testnet',
      });
      fail('Expected WRONG_FUNCTION_NAME');
    } catch (err) {
      expect(err).toBeInstanceOf(DepositVerificationError);
      expect((err as DepositVerificationError).code).toBe(
        'WRONG_FUNCTION_NAME'
      );
    }
  });

  it('aborts when XDR deposit amount differs from quoted deposit', () => {
    const xdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 48.0,
      network: 'testnet',
    });

    try {
      verifyFundEscrowXdr({
        unsignedXdr: xdr,
        expectedContractId: contractId,
        expectedAmountUsdc: 45.0,
        network: 'testnet',
      });
      fail('Expected AMOUNT_MISMATCH');
    } catch (err) {
      expect(err).toBeInstanceOf(DepositVerificationError);
      expect((err as DepositVerificationError).code).toBe('AMOUNT_MISMATCH');
    }
  });

  it('aborts when XDR specifies a non-USDC asset contract', () => {
    const xdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45.0,
      network: 'testnet',
      assetContract: otherContractId,
    });

    try {
      verifyFundEscrowXdr({
        unsignedXdr: xdr,
        expectedContractId: contractId,
        expectedAmountUsdc: 45.0,
        network: 'testnet',
      });
      fail('Expected ASSET_MISMATCH');
    } catch (err) {
      expect(err).toBeInstanceOf(DepositVerificationError);
      expect((err as DepositVerificationError).code).toBe('ASSET_MISMATCH');
    }
  });

  it('aborts when XDR contains multiple operations', () => {
    const account = new Account(kp.publicKey(), '100');
    const tx = new TransactionBuilder(account, {
      fee: '10000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: 'fund_escrow',
          args: [
            nativeToScVal(kp.publicKey(), { type: 'address' }),
            nativeToScVal(450000000n, { type: 'i128' }),
            nativeToScVal(TESTNET_USDC, { type: 'address' }),
          ],
        })
      )
      .addOperation(
        Operation.payment({
          destination: PLATFORM_WALLET,
          asset: (
            require('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk')
          ).Asset.native(),
          amount: '10',
        })
      )
      .setTimeout(300)
      .build();

    try {
      verifyFundEscrowXdr({
        unsignedXdr: tx.toXDR(),
        expectedContractId: contractId,
        expectedAmountUsdc: 45.0,
        network: 'testnet',
      });
      fail('Expected MULTIPLE_OPERATIONS');
    } catch (err) {
      expect(err).toBeInstanceOf(DepositVerificationError);
      expect((err as DepositVerificationError).code).toBe(
        'MULTIPLE_OPERATIONS'
      );
    }
  });

  it('never signs without humanConfirmed === true', () => {
    const ledger = makeLedger();
    const xdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45.0,
      network: 'testnet',
    });

    try {
      verifyAndSignDeposit({
        bookingId: 'book_1',
        unsignedXdr: xdr,
        expectedContractId: contractId,
        expectedAmountUsdc: 45.0,
        network: 'testnet',
        secretKey: kp.secret(),
        ledger,
        humanConfirmed: false,
      });
      fail('Expected HUMAN_CONFIRMATION_REQUIRED');
    } catch (err) {
      expect(err).toBeInstanceOf(DepositVerificationError);
      expect((err as DepositVerificationError).code).toBe(
        'HUMAN_CONFIRMATION_REQUIRED'
      );
    }
    expect(ledger.getDepositsLockedUsdc()).toBe(0);
  });

  it('signs valid XDR with humanConfirmed === true and updates ledger', () => {
    const ledger = makeLedger();
    const xdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45.0,
      network: 'testnet',
    });

    const signed = verifyAndSignDeposit({
      bookingId: 'book_1',
      unsignedXdr: xdr,
      expectedContractId: contractId,
      expectedAmountUsdc: 45.0,
      network: 'testnet',
      secretKey: kp.secret(),
      ledger,
      humanConfirmed: true,
    });

    expect(signed.bookingId).toBe('book_1');
    expect(signed.contractId).toBe(contractId);
    expect(signed.signerPublicKey).toBe(kp.publicKey());
    expect(signed.txHash).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.signedXdr).not.toContain(kp.secret());
    expect(ledger.getDepositsLockedUsdc()).toBe(45.0);
  });
});
