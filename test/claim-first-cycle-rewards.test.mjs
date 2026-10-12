import { test } from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { claimFirstCycleRewards } from "../scripts/claim-first-cycle-rewards.mjs";

const HOLDER = "0x224C08A8526751887a83e2711B167f890c6D078d";
const COMPTROLLER = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C";
const DISTRIBUTOR = "0xe9005b078701e2A0948D2EaC43010D35870Ad9d2";
const WELL = "0xA88594D404727625A9437C3f886C7643872296AE";
const POOL = "0xCd6FA157359E3b9F88C31B95DD63A3D73A1F34cA";
const MARKET_A = "0xdE8Df9d942D78edE3Ca06e60712582F79CFfFC64";
const MARKET_B = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
const distributorIface = new Interface([
  "function getOutstandingRewardsForUser(address _user) view returns (tuple(address mToken, tuple(address emissionToken, uint256 totalAmount, uint256 supplySide, uint256 borrowSide)[] rewards)[])",
]);
const erc20Meta = new Interface(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

function rpcFake(rows) {
  return async (url, init) => {
    const { to, data } = JSON.parse(init.body).params[0];
    for (const row of rows) {
      if (to.toLowerCase() === row.to.toLowerCase() && data.startsWith(row.selector)) {
        return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: row.result }) };
      }
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
}

function twoMarketRows() {
  return [
    {
      to: DISTRIBUTOR, selector: distributorIface.getFunction("getOutstandingRewardsForUser").selector,
      result: distributorIface.encodeFunctionResult("getOutstandingRewardsForUser", [[
        { mToken: MARKET_A, rewards: [{ emissionToken: WELL, totalAmount: 100n, supplySide: 100n, borrowSide: 0n }] },
        { mToken: MARKET_B, rewards: [{ emissionToken: WELL, totalAmount: 200n, supplySide: 200n, borrowSide: 0n }] },
      ]]),
    },
    { to: WELL, selector: erc20Meta.getFunction("symbol").selector, result: erc20Meta.encodeFunctionResult("symbol", ["WELL"]) },
    { to: WELL, selector: erc20Meta.getFunction("decimals").selector, result: erc20Meta.encodeFunctionResult("decimals", [18]) },
  ];
}

test("claimFirstCycleRewards(): sums WELL across every market into one claim-then-transfer paper intent", async () => {
  const fetchImpl = rpcFake(twoMarketRows());
  const result = await claimFirstCycleRewards(
    { holderAddress: HOLDER, comptroller: COMPTROLLER, distributor: DISTRIBUTOR, wellToken: WELL, poolAddress: POOL, cycleId: "first-cycle" },
    { fetchImpl },
  );
  assert.equal(result.routed, true);
  assert.equal(result.paper, true);
  assert.equal(result.mandate, null);
  assert.equal(result.amounts.claimableWellRaw, "300");
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].label, "claimReward");
  assert.equal(result.transactions[1].label, "transfer");
});

test("claimFirstCycleRewards(): no claimable WELL is refused, never routed as a zero-amount intent", async () => {
  const fetchImpl = rpcFake([{
    to: DISTRIBUTOR, selector: distributorIface.getFunction("getOutstandingRewardsForUser").selector,
    result: distributorIface.encodeFunctionResult("getOutstandingRewardsForUser", [[]]),
  }]);
  const result = await claimFirstCycleRewards(
    { holderAddress: HOLDER, comptroller: COMPTROLLER, distributor: DISTRIBUTOR, wellToken: WELL, poolAddress: POOL, cycleId: "first-cycle" },
    { fetchImpl },
  );
  assert.equal(result.routed, false);
  assert.match(result.reason, /no claimable WELL/);
});
