#!/usr/bin/env node
/**
 * Reads one member's Morpho vault position, computes the accrued shares to redeem (never
 * principal), and emits one routing intent -- paper unless a mandate is supplied and admitted.
 * Composes treasury-observation-service for observation and key-management for signing; this
 * file adds only orchestration, CLI parsing, and the refusal/receipt shapes.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { JsonRpcProvider } from "ethers";
import { chain } from "@red-cup-engineering/treasury-observation-service/chains";
import { observeMorphoConvertToShares } from "@red-cup-engineering/treasury-observation-service/morpho";
import { observeMorphoVaultPositionReport } from "@red-cup-engineering/treasury-observation-service/observe-morpho-vault-position";
import { attemptMandateExecution } from "../src/mandate-execution.mjs";
import { buildIntent, encodeRedeemAndForwardTransaction, encodeRedeemTransaction, encodeTransferTransaction } from "../src/intent.mjs";

/**
 * @param {{memberAddress: string, vault: string, principalAssets: string, poolAddress: string,
 *   cycleId: string, chainId?: string, mandate?: object, contractAddress?: string}} input
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, keystorePath?: string, passphrase?: string,
 *   provider?: object, journalRoot?: string, now?: () => string}} [options]
 * @returns {Promise<object>}
 */
export async function routeDirectedYield(input, options = {}) {
  const { memberAddress, vault, principalAssets, poolAddress, cycleId, mandate = null, contractAddress = null } = input;
  const chainId = input.chainId ?? "base";
  const now = (options.now ?? (() => new Date().toISOString()))();

  const report = await observeMorphoVaultPositionReport({ owner: memberAddress, vault, principalAssetsRaw: principalAssets, chainId }, options);
  if (!report.checked) return { routed: false, cycleId, reason: report.reason };
  if (report.empty) return { routed: false, cycleId, reason: `member ${memberAddress} holds no shares in vault ${vault}` };
  if (!report.accrued?.checked) return { routed: false, cycleId, reason: report.accrued?.reason ?? "accrued yield was not computed" };
  if (!report.accrued.nonNegative || BigInt(report.accrued.accruedRaw) === 0n) {
    return { routed: false, cycleId, reason: `no positive accrued yield to route this cycle (accrued ${report.accrued.accruedRaw})` };
  }

  const chainDescriptor = chain(chainId);
  const sharesResult = await observeMorphoConvertToShares(chainDescriptor, vault, report.accrued.accruedRaw, options);
  if (!sharesResult.checked) return { routed: false, cycleId, reason: sharesResult.reason };

  const amounts = {
    accruedAssetsRaw: report.accrued.accruedRaw, accruedAssetsAmount: report.accrued.accruedAmount,
    accruedSharesRaw: sharesResult.sharesRaw, assetDecimals: report.asset.decimals, assetAddress: report.asset.address,
  };
  const sources = [...report.sources, ...sharesResult.sources];

  // Atomicity: two separate calls (redeem, then transfer) cannot be made atomic from here, so
  // that shape always stays paper; only the single deployed-contract call may ever be signed.
  const transactions = contractAddress
    ? [encodeRedeemAndForwardTransaction({ contractAddress, vault, sharesRaw: sharesResult.sharesRaw, poolAddress })]
    : [
      encodeRedeemTransaction({ vault, sharesRaw: sharesResult.sharesRaw, ownerAddress: memberAddress }),
      encodeTransferTransaction({ token: report.asset.address, toAddress: poolAddress, amountRaw: report.accrued.accruedRaw }),
    ];

  const base = { routed: true, cycleId, memberAddress, vault, poolAddress, apy: report.apy };
  if (mandate == null || contractAddress == null || !options.keystorePath) {
    return { ...base, ...buildIntent({ transactions, amounts, sources }) };
  }

  const outcome = await attemptMandateExecution({
    mandate, transaction: transactions[0], chainId,
    keystorePath: options.keystorePath, passphrase: options.passphrase, provider: options.provider,
    journalRoot: options.journalRoot, journalType: "route-directed-yield",
    journalCategory: "route-directed-yield", journalRecord: { cycleId, memberAddress, vault, poolAddress, amounts }, now,
  });
  if (!outcome.executed) return { ...base, ...buildIntent({ transactions, amounts, sources }), mandateRefusal: outcome.reason };

  return {
    ...base, ...buildIntent({ transactions, amounts, sources, mandate: outcome.walletId, paper: false }),
    transactionHashes: outcome.transactionHash ? [outcome.transactionHash] : [], receipt: outcome.receipt,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { request: { type: "string" }, "keystore-path": { type: "string" }, "journal-root": { type: "string" } } });
  const request = JSON.parse(values.request ? readFileSync(values.request, "utf8") : readFileSync(0, "utf8"));
  const provider = values["keystore-path"] ? new JsonRpcProvider(chain(request.chainId ?? "base").rpc[0]) : undefined;
  const result = await routeDirectedYield(request, {
    keystorePath: values["keystore-path"], passphrase: process.env.KEY_PASSPHRASE, journalRoot: values["journal-root"], provider,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.routed === false) process.exitCode = 1;
}
