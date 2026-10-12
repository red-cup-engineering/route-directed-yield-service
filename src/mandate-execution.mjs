/**
 * The one path either routing script uses to turn an admitted single-transaction intent into a
 * signed, broadcast, and journaled live effect. Only a single atomic transaction is ever signed
 * here -- a caller with more than one transaction (no deployed helper contract) never reaches
 * this function, since two separate calls cannot be made atomic from outside a contract.
 */
import { checkMandateAllows } from "@red-cup-engineering/key-management-services-section/mandate";
import { signWithWallet } from "@red-cup-engineering/key-management-services-section/sign-with-wallet";
import { put } from "@red-cup-engineering/semiotic-eavt-services-section/store";

/**
 * Checks `mandate` against `transaction`, and when admitted signs it with `signWithWallet` and
 * (if `provider` is supplied) broadcasts it. Every outcome is a datum: an unadmitted mandate or
 * a signing refusal returns `{executed: false, reason}` rather than throwing. `transactionOverrides`
 * (nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas, chainId) is the caller's own resolved fee
 * envelope -- this function never guesses gas or a nonce; a live cycle must resolve them itself.
 * Exactly one of `keystorePath`+`passphrase` (a keystore file) or `custody` (an `env-on-host`
 * registry row, derived in memory by key-management -- see its `sign-with-wallet` module) signs.
 * @param {{mandate: object, transaction: import("./intent.d.ts").EvmTransaction, chainId: string,
 *   keystorePath?: string, passphrase?: string,
 *   custody?: {kind: string, locator: string, derivationPath: (string|null)},
 *   provider?: {broadcastTransaction: Function},
 *   transactionOverrides?: object, journalRoot?: string, journalType: string,
 *   journalCategory: string, journalRecord: object, now: string}} input
 * @returns {Promise<{executed: false, reason: string}|{executed: true, walletId: string, signature: (string|object), transactionHash: (string|null), receipt: (string|null)}>}
 */
export async function attemptMandateExecution({
  mandate, transaction, chainId, keystorePath, passphrase, custody, provider, transactionOverrides = {},
  journalRoot, journalType, journalCategory, journalRecord, now,
}) {
  const payload = { chain: chainId, contract: transaction.contract, valueWei: transaction.valueWei, transaction: { data: transaction.data, ...transactionOverrides } };
  try {
    checkMandateAllows({ mandate, payload, now });
  } catch (error) {
    return { executed: false, reason: error.message };
  }

  const signResult = await signWithWallet({
    chain: chainId, mandate, payload, keystorePath, passphrase, custody, now, journalRoot,
  });
  if (!signResult.signed) return { executed: false, reason: signResult.reason };

  let transactionHash = null;
  if (provider) {
    const sent = await provider.broadcastTransaction(signResult.signature);
    transactionHash = sent.hash;
  }

  const receipt = journalRoot ? { id: put(journalRoot, journalType, { category: journalCategory, ...journalRecord, transactionHash, at: now }) } : null;

  return { executed: true, walletId: signResult.id, signature: signResult.signature, transactionHash, receipt: receipt?.id ?? null };
}
