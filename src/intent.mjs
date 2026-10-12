/**
 * The directed-yield routing intent algebra: pure encoders for the EVM calls a cycle's routing
 * needs, and the `{paper, mandate, transactions, amounts, sources}` record shape -- the same
 * paper-intent doctrine `pool-service`'s `front-pool-draw.mjs` uses for Hive transfers,
 * generalized to a list of EVM transactions rather than one Hive operation.
 */
import { Interface, getAddress } from "ethers";

const erc4626Interface = new Interface(["function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets)"]);
const erc20Interface = new Interface(["function transfer(address to, uint256 amount) external returns (bool)"]);
const routeDirectedYieldInterface = new Interface(["function redeemAndForward(address vault, uint256 shares, address pool) external returns (uint256 assets)"]);
const comptrollerInterface = new Interface(["function claimReward(address holder) external"]);

/**
 * One `redeem(shares, owner, owner)` call against an ERC-4626 vault: the member redeems their
 * own accrued shares to their own wallet, before a second transaction forwards the assets on.
 * @param {{vault: string, sharesRaw: string, ownerAddress: string}} input
 * @returns {import("./intent.d.ts").EvmTransaction}
 */
export function encodeRedeemTransaction({ vault, sharesRaw, ownerAddress }) {
  const owner = getAddress(ownerAddress);
  return {
    label: "redeem", to: getAddress(vault), contract: getAddress(vault), valueWei: "0",
    data: erc4626Interface.encodeFunctionData("redeem", [BigInt(sharesRaw), owner, owner]),
  };
}

/**
 * One ERC-20 `transfer(to, amount)` call, used to forward redeemed assets (or a claimed reward)
 * to the pool's own Base address.
 * @param {{token: string, toAddress: string, amountRaw: string}} input
 * @returns {import("./intent.d.ts").EvmTransaction}
 */
export function encodeTransferTransaction({ token, toAddress, amountRaw }) {
  return {
    label: "transfer", to: getAddress(token), contract: getAddress(token), valueWei: "0",
    data: erc20Interface.encodeFunctionData("transfer", [getAddress(toAddress), BigInt(amountRaw)]),
  };
}

/**
 * One call to a deployed `RouteDirectedYield` helper: redeems and forwards in a single
 * transaction, the atomic path this service prefers whenever the helper is deployed.
 * @param {{contractAddress: string, vault: string, sharesRaw: string, poolAddress: string}} input
 * @returns {import("./intent.d.ts").EvmTransaction}
 */
export function encodeRedeemAndForwardTransaction({ contractAddress, vault, sharesRaw, poolAddress }) {
  return {
    label: "redeemAndForward", to: getAddress(contractAddress), contract: getAddress(contractAddress), valueWei: "0",
    data: routeDirectedYieldInterface.encodeFunctionData("redeemAndForward", [getAddress(vault), BigInt(sharesRaw), getAddress(poolAddress)]),
  };
}

/**
 * One Moonwell Comptroller `claimReward(holder)` call: claims every market's outstanding
 * reward for `holderAddress` in one transaction.
 * @param {{comptroller: string, holderAddress: string}} input
 * @returns {import("./intent.d.ts").EvmTransaction}
 */
export function encodeClaimRewardTransaction({ comptroller, holderAddress }) {
  return {
    label: "claimReward", to: getAddress(comptroller), contract: getAddress(comptroller), valueWei: "0",
    data: comptrollerInterface.encodeFunctionData("claimReward", [getAddress(holderAddress)]),
  };
}

/**
 * Assembles the intent record every routing script emits: `paper: true` and `mandate: null`
 * unless a mandate was supplied and admitted, in which case the caller supplies its id.
 * @param {{transactions: readonly import("./intent.d.ts").EvmTransaction[], amounts: object,
 *   sources: readonly string[], mandate?: (string|null), paper?: boolean}} input
 * @returns {import("./intent.d.ts").RoutingIntent}
 */
export function buildIntent({ transactions, amounts, sources, mandate = null, paper = true }) {
  return { paper, mandate, transactions, amounts, sources };
}
