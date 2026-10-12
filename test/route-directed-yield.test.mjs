import { test } from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { routeDirectedYield } from "../scripts/route-directed-yield.mjs";

const VAULT = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61";
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER = "0xCd6FA157359E3b9F88C31B95DD63A3D73A1F34cA";
const POOL = "0xCd6FA157359E3b9F88C31B95DD63A3D73A1F34cA";
const vaultIface = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function convertToShares(uint256) view returns (uint256)",
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
]);

function fetchImpl(url, init) {
  if (url === "https://api.morpho.org/graphql") {
    return { ok: true, status: 200, json: async () => ({ data: { vaultByAddress: { state: { apy: 0.045, netApy: 0.042, netApyExcludingRewards: 0.04 } } } }) };
  }
  const { to, data } = JSON.parse(init.body).params[0];
  const selector = data.slice(0, 10);
  const encoded = {
    [`${VAULT}:${vaultIface.getFunction("balanceOf").selector}`]: vaultIface.encodeFunctionResult("balanceOf", [1_000_000n]),
    [`${VAULT}:${vaultIface.getFunction("decimals").selector}`]: vaultIface.encodeFunctionResult("decimals", [18]),
    [`${VAULT}:${vaultIface.getFunction("asset").selector}`]: vaultIface.encodeFunctionResult("asset", [ASSET]),
    [`${ASSET}:${vaultIface.getFunction("decimals").selector}`]: vaultIface.encodeFunctionResult("decimals", [6]),
    [`${VAULT}:${vaultIface.getFunction("convertToAssets").selector}`]: vaultIface.encodeFunctionResult("convertToAssets", [1_050_000n]),
    [`${VAULT}:${vaultIface.getFunction("convertToShares").selector}`]: vaultIface.encodeFunctionResult("convertToShares", [47_619n]),
  };
  const result = encoded[`${to}:${selector}`];
  return result === undefined
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
}

test("routeDirectedYield(): a positive accrued yield is converted to shares and emitted as a paper intent with no mandate", async () => {
  const result = await routeDirectedYield(
    { memberAddress: OWNER, vault: VAULT, principalAssets: "1000000", poolAddress: POOL, cycleId: "cycle-1" }, { fetchImpl },
  );
  assert.equal(result.routed, true);
  assert.equal(result.paper, true);
  assert.equal(result.mandate, null);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].label, "redeem");
  assert.equal(result.transactions[1].label, "transfer");
  assert.equal(result.amounts.accruedAssetsRaw, "50000");
  assert.equal(result.amounts.accruedSharesRaw, "47619");
});

test("routeDirectedYield(): a deployed helper contract collapses the intent to one atomic call", async () => {
  const result = await routeDirectedYield(
    { memberAddress: OWNER, vault: VAULT, principalAssets: "1000000", poolAddress: POOL, cycleId: "cycle-1", contractAddress: "0x1111111111111111111111111111111111111111" },
    { fetchImpl },
  );
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].label, "redeemAndForward");
});

test("routeDirectedYield(): zero accrued yield is refused, never routed as a zero-amount intent", async () => {
  const zeroYieldFetch = (url, init) => {
    if (url === "https://api.morpho.org/graphql") return fetchImpl(url, init);
    const { to, data } = JSON.parse(init.body).params[0];
    if (to === VAULT && data.startsWith(vaultIface.getFunction("convertToAssets").selector)) {
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: vaultIface.encodeFunctionResult("convertToAssets", [1_000_000n]) }) };
    }
    return fetchImpl(url, init);
  };
  const result = await routeDirectedYield(
    { memberAddress: OWNER, vault: VAULT, principalAssets: "1000000", poolAddress: POOL, cycleId: "cycle-1" }, { fetchImpl: zeroYieldFetch },
  );
  assert.equal(result.routed, false);
  assert.match(result.reason, /no positive accrued yield/);
});

test("routeDirectedYield(): an empty position is refused, never routed", async () => {
  const emptyFetch = (url, init) => {
    if (url === "https://api.morpho.org/graphql") return fetchImpl(url, init);
    const { to, data } = JSON.parse(init.body).params[0];
    if (to === VAULT && data.startsWith(vaultIface.getFunction("balanceOf").selector)) {
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: vaultIface.encodeFunctionResult("balanceOf", [0n]) }) };
    }
    return fetchImpl(url, init);
  };
  const result = await routeDirectedYield(
    { memberAddress: OWNER, vault: VAULT, principalAssets: "1000000", poolAddress: POOL, cycleId: "cycle-1" }, { fetchImpl: emptyFetch },
  );
  assert.equal(result.routed, false);
  assert.match(result.reason, /holds no shares/);
});
