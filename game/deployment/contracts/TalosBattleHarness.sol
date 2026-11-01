// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {TalosBattleTypes as T} from "./TalosBattleTypes.sol";
import {TalosBattleEngine as Rules} from "./TalosBattleEngine.sol";
/// @notice Isolated test helper. No storage or authority over a real TalosBattle.
/// eth_call evaluates supplied memory states without changing any match.
contract TalosBattleHarness {
    function make(uint8[8] memory ids,uint8[2] memory equipment,uint32 seed,uint8 initiative) external pure returns(T.State memory) {
        return Rules.create(ids,equipment,seed,initiative);
    }
    function step(T.State memory state,uint8 side,T.Input memory input) external returns(T.State memory) {
        return Rules.act(state,side,input,bytes32(uint256(1)));
    }
}
