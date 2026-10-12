import { test } from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { buildIntent, encodeClaimRewardTransaction, encodeRedeemAndForwardTransaction, encodeRedeemTransaction, encodeTransferTransaction } from "../src/intent.mjs";

const VAULT = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61";
const OWNER = "0xCd6FA157359E3b9F88C31B95DD63A3D73A1F34cA";
const POOL = "0xCd6FA157359E3b9F88C31B95DD63A3D73A1F34cA";
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const HELPER = "0x1111111111111111111111111111111111111111";
const COMPTROLLER = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C";

test("encodeRedeemTransaction(): encodes redeem(shares, owner, owner) against the vault", () => {
  const tx = encodeRedeemTransaction({ vault: VAULT, sharesRaw: "1000", ownerAddress: OWNER });
  assert.equal(tx.to, VAULT);
  assert.equal(tx.contract, VAULT);
  assert.equal(tx.valueWei, "0");
  const iface = new Interface(["function redeem(uint256, address, address) returns (uint256)"]);
  const decoded = iface.decodeFunctionData("redeem", tx.data);
  assert.equal(decoded[0], 1000n);
  assert.equal(decoded[1].toLowerCase(), OWNER.toLowerCase());
  assert.equal(decoded[2].toLowerCase(), OWNER.toLowerCase());
});

test("encodeTransferTransaction(): encodes transfer(to, amount) against the token", () => {
  const tx = encodeTransferTransaction({ token: TOKEN, toAddress: POOL, amountRaw: "5000" });
  assert.equal(tx.to, TOKEN);
  const iface = new Interface(["function transfer(address, uint256) returns (bool)"]);
  const decoded = iface.decodeFunctionData("transfer", tx.data);
  assert.equal(decoded[0].toLowerCase(), POOL.toLowerCase());
  assert.equal(decoded[1], 5000n);
});

test("encodeRedeemAndForwardTransaction(): encodes the single atomic helper call", () => {
  const tx = encodeRedeemAndForwardTransaction({ contractAddress: HELPER, vault: VAULT, sharesRaw: "1000", poolAddress: POOL });
  assert.equal(tx.to, HELPER);
  const iface = new Interface(["function redeemAndForward(address, uint256, address) returns (uint256)"]);
  const decoded = iface.decodeFunctionData("redeemAndForward", tx.data);
  assert.equal(decoded[0].toLowerCase(), VAULT.toLowerCase());
  assert.equal(decoded[1], 1000n);
  assert.equal(decoded[2].toLowerCase(), POOL.toLowerCase());
});

test("encodeClaimRewardTransaction(): encodes claimReward(holder) against the comptroller", () => {
  const tx = encodeClaimRewardTransaction({ comptroller: COMPTROLLER, holderAddress: OWNER });
  assert.equal(tx.to, COMPTROLLER);
  const iface = new Interface(["function claimReward(address)"]);
  const decoded = iface.decodeFunctionData("claimReward", tx.data);
  assert.equal(decoded[0].toLowerCase(), OWNER.toLowerCase());
});

test("buildIntent(): defaults to paper:true, mandate:null", () => {
  const intent = buildIntent({ transactions: [], amounts: {}, sources: [] });
  assert.equal(intent.paper, true);
  assert.equal(intent.mandate, null);
});

test("buildIntent(): a caller may state paper:false with a mandate id once execution is admitted", () => {
  const intent = buildIntent({ transactions: [], amounts: {}, sources: [], mandate: "tidepool-pool-base", paper: false });
  assert.equal(intent.paper, false);
  assert.equal(intent.mandate, "tidepool-pool-base");
});
