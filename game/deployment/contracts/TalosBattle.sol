// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TalosBattleTypes as T} from "./TalosBattleTypes.sol";
import {TalosBattleEngine as Rules} from "./TalosBattleEngine.sol";
import {TalosBattleCatalog as Catalog} from "./TalosBattleCatalog.sol";

interface ITalosBattleItems {
    function ownerOf(uint256 tokenId) external view returns (address);
    function artworkOf(uint256 tokenId) external view returns (uint256);
}

/// @notice Public-information, fully EVM-adjudicated battles on the existing test chain.
/// @dev Players submit their own transactions. The AI operator may choose only AI moves,
///      and has no authority to provide HP, resources, results or arbitrary state roots.
contract TalosBattle {
    ITalosBattleItems public immutable items;
    address public immutable aiOperator;
    bytes32 public immutable rulesHash;
    bytes32 public immutable catalogHash;
    string public constant VERSION = "1.1.1-team-cost20";
    uint256 public constant TEAM_COST_CAP = 20;

    struct Info {
        address playerA;
        address playerB;
        bool ai;
        bool exists;
        bool started;
        bool cancelled;
        uint64 createdAt;
        uint64 finishedAt;
        uint64 createdBlock;
        uint64 lastBlock;
        uint64 lastActionAt;
        bytes32 rulesHash;
    }
    struct Match {
        Info info;
        T.State state;
        uint256[8] tokens;
        uint16[8] artworks;
        uint8[2] equipment;
    }
    mapping(bytes32 => Match) private matches;
    mapping(address => bytes32) public activeMatch;
    bytes32[] public matchIds;

    event MatchCreated(bytes32 indexed matchId, address indexed playerA, bool ai, bytes32 rulesHash);
    event MatchJoined(bytes32 indexed matchId, address indexed playerB, bytes32 rosterHash);
    event ActionAccepted(bytes32 indexed matchId,uint32 seq,address actor,uint8 kind,uint8 unitIndex,uint8 target,uint8 ally,uint8 hand,bytes32 stateHash);
    event MatchFinished(bytes32 indexed matchId,uint8 winner,address winnerAddress,uint64 finishedAt,bytes32 stateHash);
    event MatchCancelled(bytes32 indexed matchId,address indexed playerA);

    constructor(address itemCollection,address operator,bytes32 rules,bytes32 catalog) {
        require(itemCollection.code.length>0 && operator!=address(0),"configuration");
        require(rules!=bytes32(0) && catalog!=bytes32(0),"fingerprint");
        items=ITalosBattleItems(itemCollection); aiOperator=operator;
        rulesHash=rules; catalogHash=catalog;
    }

    function matchCount() external view returns(uint256) {return matchIds.length;}
    function matchInfo(bytes32 id) external view returns(Info memory) {return matches[id].info;}
    function getInfo(bytes32 id) external view returns(Info memory) {return matches[id].info;}
    function getMatch(bytes32 id) external view returns(Info memory info,T.State memory state,uint256[8] memory tokenIds,uint16[8] memory artworkIds) {
        Match storage m=matches[id];require(m.info.exists,"unknown match");
        return(m.info,m.state,m.tokens,m.artworks);
    }
    function stateHash(bytes32 id) external view returns(bytes32) {
        require(matches[id].info.exists,"unknown match");return keccak256(abi.encode(matches[id].state));
    }

    function createMatch(bytes32 id,uint256[4] calldata tokenIds,uint8 equipment,bool ai) external {
        require(id!=bytes32(0) && !matches[id].info.exists,"match id");
        require(activeMatch[msg.sender]==bytes32(0),"active match");
        require(equipment<=6,"equipment");
        (uint8[4] memory ids,uint16[4] memory arts)=_resolve(msg.sender,tokenIds);
        Match storage m=matches[id];
        m.info=Info(msg.sender,address(0),ai,true,ai,false,uint64(block.timestamp),0,uint64(block.number),uint64(block.number),uint64(block.timestamp),rulesHash);
        m.equipment[0]=equipment;
        for(uint256 i;i<4;i++){m.tokens[i]=tokenIds[i];m.artworks[i]=arts[i];}
        activeMatch[msg.sender]=id;matchIds.push(id);
        if(ai) {
            uint8[8] memory roster;
            uint8[4] memory bot=[uint8(2),4,5,7];
            for(uint256 i;i<4;i++){roster[i]=ids[i];roster[i+4]=bot[i];m.artworks[i+4]=uint16(bot[i])*100+1;}
            m.equipment[1]=2;
            uint32 seed=_seed(id,msg.sender,address(0));
            m.state=Rules.create(roster,m.equipment,seed,uint8(seed%2));
        }
        emit MatchCreated(id,msg.sender,ai,rulesHash);
    }

    function joinMatch(bytes32 id,uint256[4] calldata tokenIds,uint8 equipment) external {
        Match storage m=matches[id];
        require(m.info.exists && !m.info.ai && !m.info.started && !m.info.cancelled,"room unavailable");
        require(m.info.playerA!=msg.sender && activeMatch[msg.sender]==bytes32(0),"player");
        require(equipment<=6,"equipment");
        uint256[4] memory original;for(uint256 i;i<4;i++)original[i]=m.tokens[i];
        (uint8[4] memory idsA,)=_resolve(m.info.playerA,original);
        (uint8[4] memory idsB,uint16[4] memory artsB)=_resolve(msg.sender,tokenIds);
        uint8[8] memory roster;
        for(uint256 i;i<4;i++) {roster[i]=idsA[i];roster[i+4]=idsB[i];m.tokens[i+4]=tokenIds[i];m.artworks[i+4]=artsB[i];}
        m.equipment[1]=equipment;m.info.playerB=msg.sender;m.info.started=true;
        m.info.lastBlock=uint64(block.number);m.info.lastActionAt=uint64(block.timestamp);
        uint32 seed=_seed(id,m.info.playerA,msg.sender);
        m.state=Rules.create(roster,m.equipment,seed,uint8(seed%2));
        activeMatch[msg.sender]=id;
        emit MatchJoined(id,msg.sender,keccak256(abi.encode(m.tokens,m.artworks,m.equipment)));
    }

    function act(bytes32 id,uint32 expectedSeq,uint8 kind,uint8 actor,uint8 target,uint8 ally,uint8 hand) external {
        Match storage m=matches[id];uint8 side;
        if(msg.sender==m.info.playerA)side=0;
        else {require(!m.info.ai && msg.sender==m.info.playerB && msg.sender!=address(0),"not participant");side=1;}
        _act(m,id,side,expectedSeq,T.Input(kind,actor,target,ally,hand));
    }
    function actAI(bytes32 id,uint32 expectedSeq,uint8 kind,uint8 actor,uint8 target,uint8 ally,uint8 hand) external {
        require(msg.sender==aiOperator && matches[id].info.ai,"not AI operator");
        _act(matches[id],id,1,expectedSeq,T.Input(kind,actor,target,ally,hand));
    }
    function cancelMatch(bytes32 id) external {
        Match storage m=matches[id];
        require(m.info.exists && msg.sender==m.info.playerA && !m.info.started && !m.info.cancelled,"cannot cancel");
        m.info.cancelled=true;m.info.finishedAt=uint64(block.timestamp);
        m.info.lastBlock=uint64(block.number);m.info.lastActionAt=uint64(block.timestamp);
        if(activeMatch[msg.sender]==id)delete activeMatch[msg.sender];
        emit MatchCancelled(id,msg.sender);
    }
    function _act(Match storage m,bytes32 id,uint8 side,uint32 seq,T.Input memory input) internal {
        require(m.info.exists && m.info.started && !m.info.cancelled && m.info.finishedAt==0,"inactive");
        require(m.state.seq==seq,"stale sequence");
        if(input.kind==8)require(!m.state.acks[side],"already confirmed");
        m.state=Rules.act(m.state,side,input,id);
        require(m.state.seq==seq+1,"sequence invariant");
        m.info.lastBlock=uint64(block.number);m.info.lastActionAt=uint64(block.timestamp);
        bytes32 digest=keccak256(abi.encode(m.state));
        emit ActionAccepted(id,m.state.seq,msg.sender,input.kind,input.actor,input.target,input.ally,input.hand,digest);
        if(m.state.winner!=0) {
            m.info.finishedAt=uint64(block.timestamp);
            if(activeMatch[m.info.playerA]==id)delete activeMatch[m.info.playerA];
            if(m.info.playerB!=address(0) && activeMatch[m.info.playerB]==id)delete activeMatch[m.info.playerB];
            address winner=m.state.winner==1?m.info.playerA:m.state.winner==2?m.info.playerB:address(0);
            emit MatchFinished(id,m.state.winner,winner,m.info.finishedAt,digest);
        }
    }
    function _resolve(address owner,uint256[4] memory tokenIds) internal view returns(uint8[4] memory ids,uint16[4] memory arts) {
        uint256 cost;
        for(uint256 i;i<4;i++) {
            require(items.ownerOf(tokenIds[i])==owner,"not card owner");
            uint256 art=items.artworkOf(tokenIds[i]);
            require(art/100>=1 && art/100<=32 && art%100>=1 && art%100<=18,"artwork");
            ids[i]=uint8(art/100);arts[i]=uint16(art);
            for(uint256 j;j<i;j++)require(ids[j]!=ids[i],"duplicate character");
            T.Stats memory stats=Catalog.stats(ids[i]);cost+=stats.cost;
        }
        require(cost<=TEAM_COST_CAP,"team cost");
    }
    function _seed(bytes32 id,address a,address b) internal view returns(uint32) {
        // Public shuffle, intentionally reproducible. No secret/VRF claim.
        uint32 seed=uint32(uint256(keccak256(abi.encode(block.chainid,address(this),id,a,b,blockhash(block.number-1)))));
        return seed==0?1:seed;
    }
}
