// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title Fmt
/// @notice Just enough number formatting to print a table a person can read in a terminal.
/// @dev `console2.log` prints a `uint256` as a raw integer, which turns "the book made 214.87 dollars"
///      into `214870000000000000000`. Every figure in the markout table is fixed point, and a reader
///      comparing three strategies needs the columns to line up, so amounts are rendered with a fixed
///      number of decimals and right-aligned to a fixed width.
library Fmt {
    /// @notice `value` scaled by `10**decimals`, printed with `places` decimals, half-up.
    function fixedPoint(int256 value, uint256 decimals, uint256 places) internal pure returns (string memory) {
        bool neg = value < 0;
        uint256 v = uint256(neg ? -value : value);

        // Drop to `places` decimals, rounding half away from zero.
        if (decimals > places) {
            uint256 shift = 10 ** (decimals - places);
            v = (v + shift / 2) / shift;
        } else if (places > decimals) {
            v = v * 10 ** (places - decimals);
        }

        uint256 unit = 10 ** places;
        string memory whole = _group(v / unit);
        string memory out = places == 0 ? whole : string.concat(whole, ".", _pad(v % unit, places));
        return neg ? string.concat("-", out) : out;
    }

    /// @notice Right-align `s` in a field of `width` characters. Longer strings are left alone.
    function padLeft(string memory s, uint256 width) internal pure returns (string memory) {
        uint256 len = bytes(s).length;
        if (len >= width) {
            return s;
        }
        bytes memory spaces = new bytes(width - len);
        for (uint256 i = 0; i < spaces.length; i++) {
            spaces[i] = 0x20;
        }
        return string.concat(string(spaces), s);
    }

    /// @notice Left-align `s` in a field of `width` characters.
    function padRight(string memory s, uint256 width) internal pure returns (string memory) {
        uint256 len = bytes(s).length;
        if (len >= width) {
            return s;
        }
        bytes memory spaces = new bytes(width - len);
        for (uint256 i = 0; i < spaces.length; i++) {
            spaces[i] = 0x20;
        }
        return string.concat(s, string(spaces));
    }

    /// @notice A right-aligned fixed-point figure, the shape every cell in the table takes.
    function cell(int256 value, uint256 decimals, uint256 places, uint256 width)
        internal
        pure
        returns (string memory)
    {
        return padLeft(fixedPoint(value, decimals, places), width);
    }

    /// @dev Thousands separators, because a five-figure dollar amount is misread without them.
    function _group(uint256 n) private pure returns (string memory) {
        if (n == 0) {
            return "0";
        }
        bytes memory digits = new bytes(32);
        uint256 len;
        while (n > 0) {
            digits[len++] = bytes1(uint8(48 + n % 10));
            n /= 10;
        }
        uint256 commas = (len - 1) / 3;
        bytes memory out = new bytes(len + commas);
        uint256 j;
        for (uint256 i = 0; i < len; i++) {
            if (i > 0 && i % 3 == 0) {
                out[out.length - 1 - j++] = ",";
            }
            out[out.length - 1 - j++] = digits[i];
        }
        return string(out);
    }

    /// @dev Zero-padded fractional part.
    function _pad(uint256 n, uint256 places) private pure returns (string memory) {
        bytes memory out = new bytes(places);
        for (uint256 i = 0; i < places; i++) {
            out[places - 1 - i] = bytes1(uint8(48 + n % 10));
            n /= 10;
        }
        return string(out);
    }
}
