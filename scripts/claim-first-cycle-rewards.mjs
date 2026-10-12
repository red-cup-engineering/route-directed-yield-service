#!/usr/bin/env node
/**
 * The org's own Moonwell WELL claim, as the first-cycle special case: reads outstanding WELL
 * across every Moonwell market for `holderAddress`, then emits the claim-and-transfer intent
 * for that WELL to the pool's Base address, the same intent shape as ordinary cycle routing.
 * Composes treasury-observation-service's reward read; no reward accounting is reimplemented.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { JsonRpcProvider } from "ethers";
import { observeMoonwellClaimableRewards } from "@red-cup-engineering/treasury-observation-service/observe-moonwell-claimable-rewards";
import { attemptMandateExecution } from "../src/mandate-execution.mjs";
import { buildIntent, encodeClaimRewardTransaction, encodeTransferTransaction } from "../src/intent.mjs";

/**
 * Claim then transfer is inherently two transactions (WELL lands in the holder's wallet before
 * it can move on), so it is executed as two mandate-checked legs -- the claim first, then (when
 * `options.readActualWellBalance` is supplied) a transfer of the *actual* post-claim balance,
 * never the pre-claim estimate, since a block can accrue more between the read and the claim.
 * A mandate whose `allowedTokenTransfers` ceiling names the estimate as `maxAmountRaw` refuses
 * the transfer outright if the actual balance exceeds it, rather than silently moving more.
 * @param {{holderAddress: string, comptroller: string, distributor: string, wellToken: string,
 *   poolAddress: string, cycleId: string, chainId?: string, mandate?: object}} input
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, keystorePath?: string, passphrase?: string,
 *   custody?: {kind: string, locator: string, derivationPath: (string|null)}, provider?: object,
 *   journalRoot?: string, now?: () => string,
 *   readActualWellBalance?: (input: {wallet: string, token: string, chainId: string}) => Promise<{checked: boolean, raw?: string, reason?: string}>}} [options]
 * @returns {Promise<object>}
 */
export async function claimFirstCycleRewards(input, options = {}) {
  const { holderAddress, comptroller, distributor, wellToken, poolAddress, cycleId, mandate = null } = input;
  const chainId = input.chainId ?? "base";
  const now = (options.now ?? (() => new Date().toISOString()))();

  const rewards = await observeMoonwellClaimableRewards({ wallet: holderAddress, distributor, chainId }, options);
  if (!rewards.checked) return { routed: false, cycleId, reason: rewards.reason };

  const wellRows = rewards.rewards.filter((row) => row.emissionToken.toLowerCase() === wellToken.toLowerCase());
  const totalWellRaw = wellRows.reduce((sum, row) => sum + BigInt(row.totalAmountRaw), 0n);
  if (totalWellRaw === 0n) return { routed: false, cycleId, reason: `no claimable WELL found for ${holderAddress} across ${rewards.rewards.length} reward row(s)` };

  const amounts = { claimableWellRaw: totalWellRaw.toString(), claimableWellAmount: wellRows[0]?.totalAmount ?? null, byMarket: wellRows };
  const sources = ["distributor:getOutstandingRewardsForUser"];

  const claimTransaction = encodeClaimRewardTransaction({ comptroller, holderAddress });
  const estimatedTransferTransaction = encodeTransferTransaction({ token: wellToken, toAddress: poolAddress, amountRaw: totalWellRaw.toString() });
  const transactions = [claimTransaction, estimatedTransferTransaction];

  const base = { routed: true, cycleId, holderAddress, poolAddress };
  const canSignLive = mandate != null && (options.keystorePath || options.custody);
  if (!canSignLive) {
    return { ...base, ...buildIntent({ transactions, amounts, sources }) };
  }

  const claimOutcome = await attemptMandateExecution({
    mandate, transaction: claimTransaction, chainId,
    keystorePath: options.keystorePath, passphrase: options.passphrase, custody: options.custody, provider: options.provider,
    transactionOverrides: options.claimTransactionOverrides,
    journalRoot: options.journalRoot, journalType: "route-directed-yield",
    journalCategory: "claim-first-cycle-rewards", journalRecord: { cycleId, holderAddress, poolAddress, amounts }, now,
  });
  if (!claimOutcome.executed) return { ...base, ...buildIntent({ transactions, amounts, sources }), mandateRefusal: claimOutcome.reason };

  const claimedResult = {
    ...base, ...buildIntent({ transactions, amounts, sources, mandate: claimOutcome.walletId, paper: false }),
    transactionHashes: claimOutcome.transactionHash ? [claimOutcome.transactionHash] : [],
    receipt: claimOutcome.receipt, claimed: true, transferred: false,
  };
  if (!options.readActualWellBalance) return claimedResult;

  const balance = await options.readActualWellBalance({ wallet: holderAddress, token: wellToken, chainId });
  if (!balance.checked || BigInt(balance.raw) === 0n) {
    return { ...claimedResult, transferRefusal: balance.checked ? `actual WELL balance for ${holderAddress} read as zero after claim` : balance.reason };
  }

  const transferTransaction = encodeTransferTransaction({ token: wellToken, toAddress: poolAddress, amountRaw: balance.raw });
  const transferOutcome = await attemptMandateExecution({
    mandate, transaction: transferTransaction, chainId,
    keystorePath: options.keystorePath, passphrase: options.passphrase, custody: options.custody, provider: options.provider,
    transactionOverrides: options.transferTransactionOverrides,
    journalRoot: options.journalRoot, journalType: "route-directed-yield",
    journalCategory: "claim-first-cycle-rewards-transfer", journalRecord: { cycleId, holderAddress, poolAddress, actualWellRaw: balance.raw }, now,
  });
  if (!transferOutcome.executed) return { ...claimedResult, transferRefusal: transferOutcome.reason, actualWellRaw: balance.raw };

  return {
    ...claimedResult,
    transactions: [claimTransaction, transferTransaction],
    amounts: { ...amounts, actualWellRaw: balance.raw },
    transactionHashes: [claimOutcome.transactionHash, transferOutcome.transactionHash].filter(Boolean),
    transferReceipt: transferOutcome.receipt, transferred: true,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      request: { type: "string" }, "keystore-path": { type: "string" }, "journal-root": { type: "string" },
      mandate: { type: "string" }, "custody-locator": { type: "string" }, "custody-derivation-path": { type: "string" },
    },
  });
  const request = JSON.parse(values.request ? readFileSync(values.request, "utf8") : readFileSync(0, "utf8"));
  const mandate = values.mandate ? JSON.parse(readFileSync(values.mandate, "utf8")) : (request.mandate ?? null);
  const custody = values["custody-locator"]
    ? { kind: "env-on-host", locator: values["custody-locator"], derivationPath: values["custody-derivation-path"] ?? null }
    : undefined;
  const liveSigning = Boolean(values["keystore-path"] || custody);
  const { chain } = await import("@red-cup-engineering/treasury-observation-service/chains");
  const { balanceOfToken } = await import("@red-cup-engineering/treasury-observation-service/tokens");
  const provider = liveSigning ? new JsonRpcProvider(chain(request.chainId ?? "base").rpc[0]) : undefined;
  const readActualWellBalance = liveSigning
    ? async ({ wallet, token, chainId }) => balanceOfToken(chain(chainId), token, wallet)
    : undefined;
  const result = await claimFirstCycleRewards({ ...request, mandate }, {
    keystorePath: values["keystore-path"], passphrase: process.env.KEY_PASSPHRASE, custody,
    journalRoot: values["journal-root"], provider, readActualWellBalance,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.routed === false) process.exitCode = 1;
}
