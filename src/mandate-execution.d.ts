import type { EvmTransaction } from "./intent.d.ts";

export type MandateExecutionOutcome =
  | { readonly executed: false; readonly reason: string }
  | { readonly executed: true; readonly walletId: string; readonly signature: string | object; readonly transactionHash: string | null; readonly receipt: string | null };

export declare function attemptMandateExecution(input: {
  mandate: object;
  transaction: EvmTransaction;
  chainId: string;
  keystorePath?: string;
  passphrase?: string;
  custody?: { kind: string; locator: string; derivationPath: string | null };
  provider?: { broadcastTransaction: (signature: string) => Promise<{ hash: string }> };
  transactionOverrides?: Record<string, unknown>;
  journalRoot?: string;
  journalType: string;
  journalCategory: string;
  journalRecord: Record<string, unknown>;
  now: string;
}): Promise<MandateExecutionOutcome>;
