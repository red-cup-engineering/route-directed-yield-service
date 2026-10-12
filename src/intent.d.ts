export interface EvmTransaction {
  readonly label: string;
  readonly to: string;
  readonly contract: string;
  readonly valueWei: string;
  readonly data: string;
}

export interface RoutingIntent {
  readonly paper: boolean;
  readonly mandate: string | null;
  readonly transactions: readonly EvmTransaction[];
  readonly amounts: Record<string, unknown>;
  readonly sources: readonly string[];
}

export declare function encodeRedeemTransaction(input: { vault: string; sharesRaw: string; ownerAddress: string }): EvmTransaction;
export declare function encodeTransferTransaction(input: { token: string; toAddress: string; amountRaw: string }): EvmTransaction;
export declare function encodeRedeemAndForwardTransaction(input: { contractAddress: string; vault: string; sharesRaw: string; poolAddress: string }): EvmTransaction;
export declare function encodeClaimRewardTransaction(input: { comptroller: string; holderAddress: string }): EvmTransaction;
export declare function buildIntent(input: {
  transactions: readonly EvmTransaction[]; amounts: Record<string, unknown>; sources: readonly string[];
  mandate?: string | null; paper?: boolean;
}): RoutingIntent;
