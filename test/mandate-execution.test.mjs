import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWallet } from "@red-cup-engineering/key-management-services-section/create-wallet";
import { attemptMandateExecution } from "../src/mandate-execution.mjs";

const CONTRACT = "0x0000000000000000000000000000000000000002";
const DUMMY_ADDRESS = "0x0000000000000000000000000000000000000009";

function tempRoots() {
  return {
    home: mkdtempSync(join(tmpdir(), "route-directed-yield-home-")),
    backupRoot: mkdtempSync(join(tmpdir(), "route-directed-yield-backup-")),
    journalRoot: mkdtempSync(join(tmpdir(), "route-directed-yield-journal-")),
  };
}

test("attemptMandateExecution(): a transaction outside the mandate's allowed contract set is refused before touching the keystore", async () => {
  const mandate = { chain: "base", address: DUMMY_ADDRESS, allowedContracts: [CONTRACT], maxAmountWei: "0", expiresAt: "2026-12-31T00:00:00Z" };
  const outcome = await attemptMandateExecution({
    mandate, transaction: { label: "x", to: "0x0000000000000000000000000000000000000099", contract: "0x0000000000000000000000000000000000000099", valueWei: "0", data: "0x" },
    chainId: "base", keystorePath: "/nonexistent/path.json", passphrase: "irrelevant", now: "2026-09-05T00:00:00Z",
  });
  assert.equal(outcome.executed, false);
  assert.match(outcome.reason, /outside the mandate's allowed set/u);
});

test("attemptMandateExecution(): an admitted transaction is signed and journaled, with no provider it is not broadcast", async () => {
  const { home, backupRoot, journalRoot } = tempRoots();
  const passphrase = "route directed yield test pass!!";
  try {
    const wallet = await createWallet({ id: "test-route-signer", chain: "base", owner: "org", role: "pool", passphrase, backupRoot, home, journalRoot });
    assert.equal(wallet.created, true);
    const mandate = { chain: "base", address: wallet.address, allowedContracts: [CONTRACT], maxAmountWei: "0", expiresAt: "2026-12-31T00:00:00Z" };
    const outcome = await attemptMandateExecution({
      mandate, transaction: { label: "redeem", to: CONTRACT, contract: CONTRACT, valueWei: "0", data: "0x" },
      chainId: "base", keystorePath: wallet.custody.locator, passphrase,
      transactionOverrides: { nonce: 0, gasLimit: 100000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, chainId: 8453 },
      journalRoot, journalType: "route-directed-yield",
      journalCategory: "route-directed-yield", journalRecord: { cycleId: "test-cycle" }, now: "2026-09-05T00:00:00Z",
    });
    assert.equal(outcome.executed, true);
    assert.match(outcome.signature, /^0x[0-9a-f]+$/u);
    assert.equal(outcome.walletId, wallet.address);
    assert.equal(outcome.transactionHash, null);
    assert.ok(outcome.receipt, "a receipt id must be returned");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
    rmSync(journalRoot, { recursive: true, force: true });
  }
});

test("attemptMandateExecution(): a signing refusal (missing passphrase) is reported as data, never thrown", async () => {
  const mandate = { chain: "base", address: DUMMY_ADDRESS, allowedContracts: [CONTRACT], maxAmountWei: "0", expiresAt: "2026-12-31T00:00:00Z" };
  const outcome = await attemptMandateExecution({
    mandate, transaction: { label: "redeem", to: CONTRACT, contract: CONTRACT, valueWei: "0", data: "0x" },
    chainId: "base", keystorePath: "/nonexistent.json", passphrase: undefined, now: "2026-09-05T00:00:00Z",
  });
  assert.equal(outcome.executed, false);
  assert.match(outcome.reason, /KEY_PASSPHRASE is not set/u);
});

test("attemptMandateExecution(): signs live through an env-on-host custody descriptor, never a keystore file", async () => {
  const { randomBytes } = await import("node:crypto");
  const { Mnemonic } = await import("ethers");
  const mnemonic = Mnemonic.fromEntropy(randomBytes(16)).phrase;
  const derivationPath = "m/44'/60'/0'/0/0";
  const { deriveEvmAddressFromMnemonicAtPath } = await import("@red-cup-engineering/key-management-services-section/derive-key-material");
  const locator = "ROUTE_DIRECTED_YIELD_TEST_MNEMONIC";
  process.env[locator] = mnemonic;
  try {
    const address = deriveEvmAddressFromMnemonicAtPath(mnemonic, { path: derivationPath });
    const mandate = { chain: "base", address, allowedContracts: [CONTRACT], maxAmountWei: "0", expiresAt: "2026-12-31T00:00:00Z" };
    const outcome = await attemptMandateExecution({
      mandate, transaction: { label: "redeem", to: CONTRACT, contract: CONTRACT, valueWei: "0", data: "0x" },
      chainId: "base", custody: { kind: "env-on-host", locator, derivationPath },
      transactionOverrides: { nonce: 0, gasLimit: 100000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, chainId: 8453 },
      now: "2026-09-05T00:00:00Z",
    });
    assert.equal(outcome.executed, true);
    assert.equal(outcome.walletId, address);
    assert.match(outcome.signature, /^0x[0-9a-f]+$/u);
  } finally {
    delete process.env[locator];
  }
});
