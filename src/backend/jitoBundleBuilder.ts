import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';

/**
 * Jito MEV Bundle Builder & Direct Block Engine Dispatcher
 * 
 * Invariants:
 * 1. Index 0: Read-only protection account jitodontfront (sandwich / frontrun defense)
 * 2. Index 1: ComputeBudgetProgram.setComputeUnitLimit (profile + 10% buffer)
 * 3. Index 2: ComputeBudgetProgram.setComputeUnitPrice (micro-lamports)
 * 4. Index 3: Swap instruction (Pump.fun or Raydium)
 * 5. Index 4: SystemProgram.transfer to random official Jito Tip Account
 * 
 * Direct JSON-RPC:
 * POST https://mainnet.block-engine.jito.wtf/api/v1/bundles (sendBundle)
 * Status polling via getBundleStatuses
 */

export const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

// Official Jito Tip Accounts Pool
export const JITO_TIP_ACCOUNTS: string[] = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgqP2Dt2aqUqcZWCf26tNs5i8TQ9',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// Read-only jitodontfront sandwich protection address
export const JITO_DONT_FRONT_PUBKEY = 'jitodontfront111111111111111111111111111111';

export interface BuildJitoBundleParams {
  payerPubkey: PublicKey;
  swapInstruction: TransactionInstruction;
  tipLamports: number;
  cuLimit?: number; // e.g. 150_000
  cuPriceMicroLamports?: number; // e.g. 10_000
}

export interface JitoBundleResult {
  bundleId: string;
  signature: string;
  serializedTxBase64: string;
  tipAccount: string;
  tipLamports: number;
}

export interface JitoBundleStatus {
  bundleId: string;
  status: 'Landed' | 'Pending' | 'Failed' | 'Invalid';
  slot?: number;
  landedTransactions?: string[];
}

export class JitoBundleBuilder {
  private blockEngineUrl: string;

  constructor(customUrl?: string) {
    this.blockEngineUrl = customUrl || JITO_BLOCK_ENGINE_URL;
  }

  /**
   * Randomly select one official Jito Tip account
   */
  public getRandomTipAccount(): PublicKey {
    const randomIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    return new PublicKey(JITO_TIP_ACCOUNTS[randomIndex]);
  }

  /**
   * Build the sandwich-protected transaction with exact 5 instructions:
   * Index 0: jitodontfront (Read-only guard)
   * Index 1: SetComputeUnitLimit
   * Index 2: SetComputeUnitPrice
   * Index 3: Swap Instruction
   * Index 4: Jito Tip Transfer
   */
  public buildBundleTransaction(params: BuildJitoBundleParams, recentBlockhash: string): {
    tx: Transaction;
    tipAccountPubkey: PublicKey;
  } {
    const tx = new Transaction();
    tx.recentBlockhash = recentBlockhash;
    tx.feePayer = params.payerPubkey;

    // Index 0: jitodontfront read-only account instruction
    const dontFrontIx = new TransactionInstruction({
      programId: new PublicKey(JITO_DONT_FRONT_PUBKEY),
      keys: [{ pubkey: params.payerPubkey, isSigner: false, isWritable: false }],
      data: Buffer.from([0]),
    });
    tx.add(dontFrontIx);

    // Index 1: Compute unit limit (+10% profile buffer)
    const cuLimit = params.cuLimit ?? 165_000;
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));

    // Index 2: Priority fee in micro-lamports
    const cuPrice = params.cuPriceMicroLamports ?? 25_000;
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }));

    // Index 3: Core swap instruction
    tx.add(params.swapInstruction);

    // Index 4: Jito tip transfer
    const tipAccount = this.getRandomTipAccount();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: params.payerPubkey,
        toPubkey: tipAccount,
        lamports: Math.max(10_000, params.tipLamports),
      })
    );

    return { tx, tipAccountPubkey: tipAccount };
  }

  /**
   * Direct fetch() JSON-RPC POST to Jito Block Engine sendBundle
   */
  public async sendBundle(serializedTransactions: string[]): Promise<string> {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [serializedTransactions],
    };

    const response = await fetch(this.blockEngineUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Jito Block Engine HTTP ${response.status}: ${await response.text()}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`Jito RPC Error: ${json.error.message || JSON.stringify(json.error)}`);
    }

    return json.result; // Returns bundle UUID
  }

  /**
   * Poll status of submitted bundle via getBundleStatuses
   */
  public async getBundleStatus(bundleId: string): Promise<JitoBundleStatus> {
    try {
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      };

      const response = await fetch(this.blockEngineUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return { bundleId, status: 'Failed' };
      }

      const json = await response.json();
      if (json.error) {
        console.error('[JitoBundleBuilder] RPC response error:', json.error);
        return { bundleId, status: 'Failed' };
      }

      const bundleValue = json.result?.value?.[0];
      if (!bundleValue) {
        return { bundleId, status: 'Failed' };
      }

      const confirmationStatus = bundleValue.confirmation_status;
      if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
        return {
          bundleId,
          status: 'Landed',
          slot: bundleValue.slot,
          landedTransactions: bundleValue.transactions,
        };
      }

      if (bundleValue.err) {
        return { bundleId, status: 'Failed' };
      }

      return { bundleId, status: 'Pending' };
    } catch {
      return { bundleId, status: 'Pending' };
    }
  }

  /**
   * Helper to create a standard Pump.fun / Raydium swap instruction placeholder
   */
  public createSwapInstruction(params: {
    payer: PublicKey;
    mint: PublicKey;
    action: 'BUY' | 'SELL';
    amountLamports: number;
    pctOrTokens?: number;
  }): TransactionInstruction {
    const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    // Discriminator for Buy or Sell
    const discriminator = params.action === 'BUY'
      ? Buffer.from([0x66, 0x06, 0x3d, 0x12, 0x01, 0x08, 0x88, 0xcd])
      : Buffer.from([0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad]);

    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(params.amountLamports));

    return new TransactionInstruction({
      programId: PUMP_FUN_PROGRAM,
      keys: [
        { pubkey: params.payer, isSigner: true, isWritable: true },
        { pubkey: params.mint, isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([discriminator, amountBuf]),
    });
  }
}

export const defaultJitoBundleBuilder = new JitoBundleBuilder();
