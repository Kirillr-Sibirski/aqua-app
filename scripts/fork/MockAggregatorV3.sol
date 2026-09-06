// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockAggregatorV3 — drop-in Chainlink feed replacement for anvil forks
/// @notice Designed to be installed AT THE FEED'S ADDRESS with `anvil_setCode` (runtime bytecode,
///         no constructor, no immutables) and driven either with `anvil_setStorageAt` or with the
///         permissionless `setAnswer()` tx. Implements AggregatorV2V3Interface + the EACAggregatorProxy
///         extras (`aggregator()`, `phaseId()`, `typeAndVersion()`).
/// @dev Fixed storage layout — every field is a full 32-byte slot so nothing packs:
///   slot 0  int256  s_answer       price (8 decimals for */USD feeds). 0 is allowed.
///   slot 1  uint256 s_updatedAt    0  => report block.timestamp (never stale, survives evm_increaseTime)
///   slot 2  uint256 s_startedAt    0  => same as updatedAt
///   slot 3  uint256 s_roundId      0  => 1 ; setAnswer() increments it
///   slot 4  uint256 s_decimals     0  => 8
///   slot 5  uint256 s_version      0  => 6 (what the real EACAggregatorProxy returns)
///   slot 6  bytes32 s_description  0  => "MOCK / USD" (short string, <= 31 bytes, left-aligned)
contract MockAggregatorV3 {
    int256  internal s_answer;      // slot 0
    uint256 internal s_updatedAt;   // slot 1
    uint256 internal s_startedAt;   // slot 2
    uint256 internal s_roundId;     // slot 3
    uint256 internal s_decimals;    // slot 4
    uint256 internal s_version;     // slot 5
    bytes32 internal s_description; // slot 6

    /// @dev same signature as Chainlink's AggregatorInterface.AnswerUpdated
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    // ---- write path (permissionless: this only ever lives on a local fork) ----
    /// @param answer   new price (same decimals as `decimals()`)
    /// @param updatedAt 0 => "always fresh" (latestRoundData reports block.timestamp); else fixed timestamp
    function setAnswer(int256 answer, uint256 updatedAt) external {
        s_answer = answer;
        s_updatedAt = updatedAt;
        s_startedAt = 0;
        unchecked { s_roundId = _roundId() + 1; }
        emit AnswerUpdated(answer, s_roundId, updatedAt == 0 ? block.timestamp : updatedAt);
    }
    function setDecimals(uint8 d) external { s_decimals = d; }
    function setDescription(bytes32 d) external { s_description = d; }

    // ---- internal defaults ----
    function _updatedAt() internal view returns (uint256) { return s_updatedAt == 0 ? block.timestamp : s_updatedAt; }
    function _startedAt() internal view returns (uint256) { return s_startedAt == 0 ? _updatedAt() : s_startedAt; }
    function _roundId() internal view returns (uint256) { return s_roundId == 0 ? 1 : s_roundId; }

    // ---- AggregatorV3Interface ----
    function decimals() external view returns (uint8) { return s_decimals == 0 ? 8 : uint8(s_decimals); }
    function version() external view returns (uint256) { return s_version == 0 ? 6 : s_version; }
    function description() external view returns (string memory) {
        bytes32 d = s_description;
        if (d == bytes32(0)) return "MOCK / USD";
        uint256 len;
        while (len < 32 && d[len] != 0) len++;
        bytes memory b = new bytes(len);
        for (uint256 i; i < len; i++) b[i] = d[i];
        return string(b);
    }
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) {
        roundId = uint80(_roundId());
        return (roundId, s_answer, _startedAt(), _updatedAt(), roundId);
    }
    function getRoundData(uint80 _roundId_) external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) {
        return (_roundId_, s_answer, _startedAt(), _updatedAt(), _roundId_);
    }

    // ---- AggregatorInterface (v2) ----
    function latestAnswer() external view returns (int256) { return s_answer; }
    function latestTimestamp() external view returns (uint256) { return _updatedAt(); }
    function latestRound() external view returns (uint256) { return _roundId(); }
    function getAnswer(uint256) external view returns (int256) { return s_answer; }
    function getTimestamp(uint256) external view returns (uint256) { return _updatedAt(); }

    // ---- EACAggregatorProxy extras ----
    function aggregator() external view returns (address) { return address(this); }
    function phaseId() external pure returns (uint16) { return 1; }
    function proposedAggregator() external pure returns (address) { return address(0); }
    function accessController() external pure returns (address) { return address(0); }
    function typeAndVersion() external pure returns (string memory) { return "MockAggregatorV3 1.0.0"; }
}
