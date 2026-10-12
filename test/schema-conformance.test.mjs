import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJson } from "@red-cup-engineering/json-schema-services-section/validation";
import routeInputSchema from "../schemas/route-directed-yield.input.schema.json" with { type: "json" };
import routeOutputSchema from "../schemas/route-directed-yield.output.schema.json" with { type: "json" };
import claimInputSchema from "../schemas/claim-first-cycle-rewards.input.schema.json" with { type: "json" };
import claimOutputSchema from "../schemas/claim-first-cycle-rewards.output.schema.json" with { type: "json" };

function assertValid(value, schema, label) {
  const result = validateJson({ value, schema });
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.errors)}`);
}

test("route-directed-yield schemas: input and both output shapes validate", () => {
  assertValid({ memberAddress: "0xCd6FA157359E3b9F88C31B95DD63A3D73A1F34cA", vault: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61", principalAssets: "1000000", poolAddress: "0xCd6FA157359E3b9F88C31B95DD63A3D73A1F34cA", cycleId: "c1" }, routeInputSchema, "input");
  assertValid({ routed: false, cycleId: "c1", reason: "x" }, routeOutputSchema, "output (refused)");
  assertValid({ routed: true, cycleId: "c1", memberAddress: "m", vault: "v", poolAddress: "p", apy: {}, paper: true, mandate: null, transactions: [], amounts: {}, sources: [] }, routeOutputSchema, "output (routed)");
});

test("claim-first-cycle-rewards schemas: input and both output shapes validate", () => {
  assertValid({ holderAddress: "0x224C08A8526751887a83e2711B167f890c6D078d", comptroller: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C", distributor: "0xe9005b078701e2A0948D2EaC43010D35870Ad9d2", wellToken: "0xA88594D404727625A9437C3f886C7643872296AE", poolAddress: "0xCd6FA157359E3b9F88C31B95DD63A3D73A1F34cA", cycleId: "first-cycle" }, claimInputSchema, "input");
  assertValid({ routed: false, cycleId: "first-cycle", reason: "x" }, claimOutputSchema, "output (refused)");
  assertValid({ routed: true, cycleId: "first-cycle", holderAddress: "h", poolAddress: "p", paper: true, mandate: null, transactions: [], amounts: {}, sources: [] }, claimOutputSchema, "output (routed)");
});
