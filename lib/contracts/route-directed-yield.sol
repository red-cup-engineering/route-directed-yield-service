// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface IERC4626Minimal {
    function redeem(uint256 shares, address receiver, address owner)
        external
        returns (uint256 assets);
    function asset() external view returns (address);
}

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Stateless helper: redeems a caller-specified ERC-4626 share count and forwards the
/// resulting assets to a fixed pool address in one transaction. Holds no balance between calls,
/// custodies no key, and carries no yield-vs-principal logic of its own -- the exact share
/// count to redeem is computed off-chain (never principal) and passed in explicitly.
contract RouteDirectedYield {
    error ZeroShares();
    error ZeroPoolAddress();
    error AssetTransferFailed();

    event YieldRouted(
        address indexed vault,
        address indexed owner,
        address indexed pool,
        uint256 shares,
        uint256 assets
    );

    /// @notice Redeems `shares` from `vault` on behalf of `msg.sender` (who must already have
    /// approved this contract to redeem on their behalf, per ERC-4626) and forwards the
    /// resulting assets to `pool` in the same call.
    /// @param vault The ERC-4626 vault to redeem from.
    /// @param shares The exact accrued-yield share count to redeem.
    /// @param pool The fixed receiving address.
    /// @return assets The asset amount forwarded to `pool`.
    function redeemAndForward(address vault, uint256 shares, address pool)
        external
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroShares();
        if (pool == address(0)) revert ZeroPoolAddress();
        assets = IERC4626Minimal(vault).redeem(shares, address(this), msg.sender);
        address asset = IERC4626Minimal(vault).asset();
        bool ok = IERC20Minimal(asset).transfer(pool, assets);
        if (!ok) revert AssetTransferFailed();
        emit YieldRouted(vault, msg.sender, pool, shares, assets);
    }
}
