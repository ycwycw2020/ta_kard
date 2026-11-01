// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Fixed-size, fully public battle state. Slots in Input are local (0..3).
library TalosBattleTypes {
    uint8 internal constant NO_PRIORITY = 2;
    uint8 internal constant SHIELD_CAP = 24;
    struct Input { uint8 kind; uint8 actor; uint8 target; uint8 ally; uint8 hand; }
    struct Ready {
        bool active;
        uint8 target; // global slot 0..7 (can be a friendly injured unit)
        uint8 actor;  // local source attacker slot, for Ember's retaliation
        uint8 side;   // source attacker's side
        uint8 root;
    }
    struct Unit {
        uint8 id;
        uint8 hp;
        uint8 shield;
        bool acted;
        bool comboTriggered;
        bool combo;
        bool ult;
        uint8 ultimateCharge;
        uint8 frozen;
        uint8 burn;
        uint8 burnSide;
        uint8 burnActor;
        bool electric;
        uint8 electricUntil;
        bool vulnerable;
        uint8 vulnerableUntil;
        bool barrier;
        uint8 barrierUntil;
        bool crossedHalf;
        uint8 crystalCharges;
        uint8 crystalUntil;
        uint8 focusTarget;
        uint8 focusUntil;
        uint8 vocalist;
        Ready ready;
    }
    /// Card encoding: 1 + 2 * local character slot + (ultimate ? 1 : 0).
    struct Deck {
        uint8[12] draw;
        uint8 drawCount;
        uint8[6] hand;
        uint8 handCount;
        uint8[12] discard;
        uint8 discardCount;
        uint8[4] removed;
        uint8 removedCount;
        bool cycled;
    }
    struct State {
        Unit[8] units;
        Deck[2] decks;
        uint8[2] ap;
        uint8[2] actions;
        // 0 none, 1 battery, 2 medkit, 3 full restore, 4 barrier, 5 cleanse, 6 reactivation.
        uint8[2] items;
        uint8[2] used;
        uint8[2] last;
        uint8 round;
        uint8 priority; // 0 A, 1 B, 2 none (round pending)
        uint8 initiative;
        uint8 winner; // 0 unfinished, 1 A, 2 B, 3 draw
        bool roundPending;
        bool[2] acks;
        uint32 seq;
        uint32 rng;
        uint8 root; // <= 114 active action roots in a 19-round match
        uint16 turns;
        uint8[2] link;
        uint8[2] linkUntil;
        uint8[2] comboRefund;
        // side * 20 + opposing local target * 5 + element; root bitset.
        uint128[40] hits;
    }
    // Element: physical 0, fire 1, cryo 2, electric 3, nature 4.
    // Role: guard 0, caster 1, support 2, tank 3, assault 4, vanguard 5.
    // Range: front priority 0, any enemy 1, front only 2, all enemies 3,
    // friendly single 4, friendly all 5. Effect: damage 0, heal 1, shield 2.
    struct Stats {
        uint8 hp; uint8 atk; uint8 cost; uint8 element; uint8 role;
        uint8 normalRange; uint8 skillRange; uint8 ultimateRange;
        uint8 skillEffect; uint8 skillValue;
        uint8 ultimateEffect; uint8 ultimateValue; uint8 ultimateElement;
        uint8 requiredCasts;
    }
}
