// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface ILegacyCards {
    function balanceOfBatch(address[] calldata accounts,uint256[] calldata ids) external view returns(uint256[] memory);
    function credits(address player) external view returns(uint256);
    function rewardedMatches(bytes32 matchId) external view returns(bool);
    function dailyRewards(address player,uint256 epoch) external view returns(uint256);
}

/// @notice Private-chain test collection. Cosmetics never determine combat stats.
contract TalosCards is ERC1155, AccessControl, ReentrancyGuard, EIP712 {
    bytes32 public constant SEED_ROLE = keccak256("SEED_ROLE");
    bytes32 public immutable deploymentId;
    address public immutable legacyCollection;
    bytes32 public immutable battleRulesHash;
    bytes32 public immutable rewardRulesVersion;
    address public immutable rewardSigner;
    bytes32 public constant SAMPLE_DOMAIN = keccak256("TALOS_SKIN_V1");
    bytes32 public constant REWARD_TYPEHASH = keccak256("Reward(bytes32 deploymentId,bytes32 matchId,address playerA,address playerB,uint8 mode,address winner,uint256 finishedAt,uint256 rewardEpoch,bytes32 rewardRulesVersion,bytes32 battleRulesHash,bytes32 rosterSnapshotHash,bytes32 replayHash,uint256 validUntil)");
    mapping(address=>bool) public starterClaimed;
    mapping(address=>uint256) public credits;
    mapping(address=>mapping(uint256=>uint256)) public dailyRewards;
    mapping(bytes32=>bool) public rewardedMatches;
    mapping(uint256=>bytes32) public commitments;
    uint256 public seedCount;
    uint256 public nextSeedId = 1;
    uint256 public requestCount;
    struct Request { address player; uint8 characterId; uint8 state; uint256 seedId; uint256 deadlineBlock; bytes32 salt; }
    mapping(uint256=>Request) public requests;
    struct Reward {
        bytes32 deploymentId; bytes32 matchId; address playerA; address playerB;
        uint8 mode; address winner; uint256 finishedAt; uint256 rewardEpoch;
        bytes32 rewardRulesVersion; bytes32 battleRulesHash; bytes32 rosterSnapshotHash;
        bytes32 replayHash; uint256 validUntil;
    }
    event SeedCommitted(uint256 indexed seedId, bytes32 commitment);
    event MintRequested(uint256 indexed requestId,address indexed player,uint8 characterId,uint256 seedId,uint256 deadlineBlock,bytes32 salt);
    event MintResolved(uint256 indexed requestId,address indexed player,uint256 tokenId,uint256 seedId,bytes32 seed);
    event MintRefunded(uint256 indexed requestId,address indexed player);
    event RewardClaimed(bytes32 indexed matchId,address indexed player,uint256 epoch);
    event StarterClaimed(address indexed player);
    constructor(address admin,address seeder,address signer,bytes32 deployment,bytes32 rules,bytes32 rewardRules,string memory baseURI,address legacy)
      ERC1155(baseURI) EIP712("TalosCards","1") {
        require(admin!=address(0)&&seeder!=address(0)&&signer!=address(0),"zero role");
        _grantRole(DEFAULT_ADMIN_ROLE,admin); _grantRole(SEED_ROLE,seeder);
        legacyCollection=legacy; rewardSigner=signer; deploymentId=deployment; battleRulesHash=rules; rewardRulesVersion=rewardRules;
    }
    function claimStarter() external nonReentrant {
        require(!starterClaimed[msg.sender],"starter already claimed");_initialize(msg.sender);
    }
    function grantTestAccounts(address[] calldata players) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(players.length>0&&players.length<=8,"batch size");
        for(uint256 i;i<players.length;i++)if(!starterClaimed[players[i]])_initialize(players[i]);
    }
    function _initialize(address player) internal {
        require(player!=address(0),"zero player");starterClaimed[player]=true;
        uint256[] memory amounts=new uint256[](576);
        if(legacyCollection!=address(0)){
            address[] memory owners=new address[](608);uint256[] memory oldIds=new uint256[](608);
            for(uint256 c;c<32;c++)for(uint256 s;s<19;s++){uint256 i=c*19+s;owners[i]=player;oldIds[i]=(c+1)*100+s+1;}
            uint256[] memory oldAmounts=ILegacyCards(legacyCollection).balanceOfBatch(owners,oldIds);
            for(uint256 c;c<32;c++){
                for(uint256 s;s<18;s++)amounts[c*18+s]=oldAmounts[c*19+s];
                // Retired dynamic cards become the highest remaining static quality.
                amounts[c*18+15]+=oldAmounts[c*19+18];
            }
            credits[player]=ILegacyCards(legacyCollection).credits(player);
        }
        uint256 count;
        for(uint256 c;c<32;c++){if(amounts[c*18]==0)amounts[c*18]=1;for(uint256 s;s<18;s++)if(amounts[c*18+s]>0)count++;}
        uint256[] memory ids=new uint256[](count);uint256[] memory values=new uint256[](count);uint256 at;
        for(uint256 c;c<32;c++)for(uint256 s;s<18;s++)if(amounts[c*18+s]>0){ids[at]=(c+1)*100+s+1;values[at++]=amounts[c*18+s];}
        credits[player]+=3000;_mintBatch(player,ids,values,"");emit StarterClaimed(player);
    }
    function commitSeeds(bytes32[] calldata hashes) external onlyRole(SEED_ROLE) {
        require(hashes.length>0&&hashes.length<=256,"batch size");
        for(uint256 i;i<hashes.length;i++){require(hashes[i]!=bytes32(0),"empty seed");commitments[++seedCount]=hashes[i];emit SeedCommitted(seedCount,hashes[i]);}
    }
    function claimReward(Reward calldata r,bytes calldata signature) external nonReentrant {
        require(r.deploymentId==deploymentId&&r.battleRulesHash==battleRulesHash&&r.rewardRulesVersion==rewardRulesVersion,"wrong rules");
        require(r.winner==msg.sender&&r.playerA!=address(0),"wrong winner");
        require((r.mode==0&&r.playerB==address(0)&&r.winner==r.playerA)||(r.mode==1&&r.playerB!=address(0)&&r.playerA!=r.playerB&&(r.winner==r.playerA||r.winner==r.playerB)),"bad participants");
        require(r.finishedAt<=block.timestamp&&r.rewardEpoch==r.finishedAt/1 days&&r.validUntil==r.finishedAt+7 days&&block.timestamp<=r.validUntil,"expired");
        uint256 oldDaily=legacyCollection==address(0)?0:ILegacyCards(legacyCollection).dailyRewards(msg.sender,r.rewardEpoch);
        bool oldClaimed=legacyCollection!=address(0)&&ILegacyCards(legacyCollection).rewardedMatches(r.matchId);
        require(!oldClaimed&&!rewardedMatches[r.matchId]&&dailyRewards[msg.sender][r.rewardEpoch]+oldDaily<3,"reward claimed or daily cap");
        bytes32 structHash=keccak256(abi.encode(REWARD_TYPEHASH,r));
        require(ECDSA.recover(_hashTypedDataV4(structHash),signature)==rewardSigner,"invalid signature");
        rewardedMatches[r.matchId]=true; dailyRewards[msg.sender][r.rewardEpoch]++; credits[msg.sender]++;
        emit RewardClaimed(r.matchId,msg.sender,r.rewardEpoch);
    }
    function requestMint(uint8 characterId,uint256 expectedSeedId,bytes32 salt) external nonReentrant returns(uint256 id) {
        require(characterId>=1&&characterId<=32,"unknown character");
        require(credits[msg.sender]>=3,"need 3 credits");
        require(expectedSeedId==nextSeedId&&nextSeedId<=seedCount,"refresh seed queue");
        credits[msg.sender]-=3;id=++requestCount;uint256 seedId=nextSeedId++;
        requests[id]=Request(msg.sender,characterId,1,seedId,block.number+20,salt);
        emit MintRequested(id,msg.sender,characterId,seedId,block.number+20,salt);
    }
    function skinForSample(uint256 u) public pure returns(uint8) {
        require(u<30000,"sample range");
        if(u<600)return uint8(15+u/200);
        if(u<3600)return uint8(10+(u-600)/600);return uint8((u-3600)/2640);
    }
    function fulfillMint(uint256 id,bytes32 seed) external nonReentrant returns(uint256 tokenId) {
        Request storage r=requests[id];require(r.state==1&&block.number<=r.deadlineBlock,"not pending or expired");
        require(keccak256(abi.encodePacked(seed))==commitments[r.seedId],"seed mismatch");
        // 2^256 mod 30000, expressed without overflowing uint256.
        uint256 remainder=addmod(type(uint256).max,1,30000);
        uint256 limit=type(uint256).max-remainder+1;
        uint256 sample;uint256 counter;
        do {sample=uint256(keccak256(abi.encode(SAMPLE_DOMAIN,block.chainid,address(this),deploymentId,id,r.player,r.characterId,r.seedId,r.salt,seed,counter++)));} while(sample>=limit);
        tokenId=uint256(r.characterId)*100+uint256(skinForSample(sample%30000))+1;
        r.state=2;_mint(r.player,tokenId,1,"");emit MintResolved(id,r.player,tokenId,r.seedId,seed);
    }
    function refundExpired(uint256 id) external nonReentrant {
        Request storage r=requests[id];require(r.state==1&&block.number>r.deadlineBlock,"not expired");
        r.state=3;credits[r.player]+=3;emit MintRefunded(id,r.player);
    }
    function _update(address from,address to,uint256[] memory ids,uint256[] memory values) internal override {
        require(from==address(0),"non-transferable test collection");super._update(from,to,ids,values);
    }
    function supportsInterface(bytes4 id) public view override(ERC1155,AccessControl) returns(bool){return super.supportsInterface(id);}
}
