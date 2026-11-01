// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface ITalosMintReceipts {
    function balanceOf(address owner,uint256 artworkId) external view returns(uint256);
}

/// @notice Individually numbered cards on the existing Talos test chain.
/// The immutable ERC-1155 collection is a mint receipt source only. Each receipt
/// can create exactly one ERC-721, even after that ERC-721 leaves its first owner.
contract TalosCardItems is ERC721Enumerable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;
    ITalosMintReceipts public immutable sourceCollection;
    uint256 public issuedCount;
    string private metadataBase;
    mapping(uint256 => uint256) public artworkOf;
    mapping(uint256 => uint256) public prefixSupply;
    mapping(address => mapping(uint256 => uint256)) public materialized;
    struct Listing { address seller; uint256 price; uint256 revision; }
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => uint256) public revisions;
    mapping(address => uint256) public proceeds;
    EnumerableSet.UintSet private listed;
    struct Item { uint256 tokenId; uint256 artworkId; address owner; uint256 price; uint256 revision; }
    event CardMaterialized(uint256 indexed tokenId,address indexed owner,uint256 artworkId,uint256 receiptOrdinal);
    event CardListed(uint256 indexed tokenId,address indexed seller,uint256 price,uint256 revision);
    event ListingCancelled(uint256 indexed tokenId,address indexed seller,uint256 revision);
    event CardSold(uint256 indexed tokenId,address indexed seller,address indexed buyer,uint256 price);
    event ProceedsWithdrawn(address indexed seller,address indexed recipient,uint256 amount);

    constructor(address source,string memory base) ERC721("Talos Cards - Unique Editions","TALOS") {
        require(source.code.length>0,"invalid source");
        sourceCollection=ITalosMintReceipts(source);metadataBase=base;
    }
    function validArtwork(uint256 id) public pure returns(bool) {
        return id/100>=1&&id/100<=32&&id%100>=1&&id%100<=18;
    }
    function pendingFor(address player,uint256[] calldata artworkIds) external view returns(uint256[] memory pending){
        require(artworkIds.length<=64,"batch bounds");pending=new uint256[](artworkIds.length);
        for(uint256 i;i<artworkIds.length;i++){uint256 art=artworkIds[i];require(validArtwork(art),"unknown artwork");uint256 n=sourceCollection.balanceOf(player,art);uint256 done=materialized[player][art];if(n>done)pending[i]=n-done;}
    }
    /// Anyone may pay gas to register the rightful receipt owner's cards.
    /// No caller can choose a different recipient or mint an unbacked item.
    function materializeFor(address player,uint256[] calldata artworkIds,uint256 maxItems) external nonReentrant returns(uint256 created) {
        require(player!=address(0)&&artworkIds.length>0&&artworkIds.length<=64&&maxItems>0&&maxItems<=64,"batch bounds");
        for(uint256 i;i<artworkIds.length&&created<maxItems;i++){
            uint256 art=artworkIds[i];require(validArtwork(art),"unknown artwork");
            uint256 available=sourceCollection.balanceOf(player,art);
            while(materialized[player][art]<available&&created<maxItems){
                uint256 ordinal=++materialized[player][art];uint256 id=_newIdentifier(player,art,ordinal);
                artworkOf[id]=art;created++;_safeMint(player,id);
                emit CardMaterialized(id,player,art,ordinal);
            }
        }
    }
    /// Exactly 16 decimal digits: QCCC RRRRRRRR HHHH.
    /// Checksum = keccak256(UTF-8 decimal first 12 digits) mod 10000.
    /// This detects many typing errors; it is public and is not encryption.
    /// The suffix is cosmetic hash-derived randomness, not a security secret/VRF.
    function _newIdentifier(address player,uint256 art,uint256 ordinal) internal returns(uint256 id){
        uint256 quality=art%100>=16?3:art%100>=11?2:1;
        uint256 prefix=quality*1000+(art/100);uint256 sequence=++issuedCount;uint256 attempt;
        require(prefixSupply[prefix]<1e8,"identifier prefix exhausted");
        do {
            require(attempt<256,"identifier collision; retry");
            uint256 random=uint256(keccak256(abi.encode("TALOS_CARD_NUMBER_V1",block.chainid,address(this),blockhash(block.number-1),player,art,ordinal,sequence,attempt++)));
            uint256 payload=prefix*1e8+random%1e8;
            id=payload*10000+uint256(keccak256(bytes(Strings.toString(payload))))%10000;
        }while(artworkOf[id]!=0);
        prefixSupply[prefix]++;
    }
    function verifyIdentifier(uint256 id) public pure returns(bool){
        uint256 prefix=id/1e12;uint256 quality=prefix/1000;uint256 character=prefix%1000;
        return quality>=1&&quality<=3&&character>=1&&character<=32&&id%10000==uint256(keccak256(bytes(Strings.toString(id/10000))))%10000;
    }
    function tokenURI(uint256 id) public view override returns(string memory) {
        _requireOwned(id);return string.concat(metadataBase,Strings.toString(id));
    }
    function gift(uint256 id,address recipient) external nonReentrant {
        require(ownerOf(id)==msg.sender,"not owner");
        require(recipient!=address(0)&&recipient!=msg.sender&&recipient!=address(this),"invalid recipient");
        _safeTransfer(msg.sender,recipient,id);
    }
    function setListing(uint256 id,uint256 price) external {
        require(ownerOf(id)==msg.sender,"not owner");require(price>0,"price must be positive");
        uint256 revision=++revisions[id];listings[id]=Listing(msg.sender,price,revision);listed.add(id);
        emit CardListed(id,msg.sender,price,revision);
    }
    function cancelListing(uint256 id) external {
        require(ownerOf(id)==msg.sender,"not owner");require(listings[id].seller!=address(0),"not listed");
        _clearListing(id);
    }
    /// Buy only the exact quote the wallet approved. Repricing or relisting
    /// invalidates old quotes, including a cancel-and-relist at the same price.
    function buy(uint256 id,address expectedSeller,uint256 expectedPrice,uint256 expectedRevision) external payable nonReentrant {
        Listing memory sale=listings[id];
        require(sale.seller!=address(0)&&sale.seller==ownerOf(id)&&sale.seller!=msg.sender,"not purchasable");
        require(sale.seller==expectedSeller&&sale.price==expectedPrice&&sale.revision==expectedRevision,"quote changed");
        require(msg.value==sale.price,"exact payment required");
        proceeds[sale.seller]+=msg.value;
        _safeTransfer(sale.seller,msg.sender,id);
        emit CardSold(id,sale.seller,msg.sender,msg.value);
    }
    /// Pull payments keep a seller contract that rejects ETH from blocking sales.
    function withdrawProceeds(address payable recipient) external nonReentrant {
        require(recipient!=address(0),"invalid recipient");uint256 amount=proceeds[msg.sender];require(amount>0,"no proceeds");
        proceeds[msg.sender]=0;(bool ok,)=recipient.call{value:amount}("");require(ok,"payment failed");
        emit ProceedsWithdrawn(msg.sender,recipient,amount);
    }
    function listedCount() external view returns(uint256){return listed.length();}
    function _view(uint256 id) internal view returns(Item memory){Listing memory sale=listings[id];return Item(id,artworkOf[id],ownerOf(id),sale.price,revisions[id]);}
    function itemsOf(address player,uint256 offset,uint256 limit) external view returns(Item[] memory result){
        require(limit>0&&limit<=64,"page size");uint256 size=balanceOf(player);if(offset>=size)return new Item[](0);
        uint256 count=size-offset;if(count>limit)count=limit;result=new Item[](count);
        for(uint256 i;i<count;i++)result[i]=_view(tokenOfOwnerByIndex(player,offset+i));
    }
    function listedItems(uint256 offset,uint256 limit) external view returns(Item[] memory result){
        require(limit>0&&limit<=64,"page size");uint256 size=listed.length();if(offset>=size)return new Item[](0);
        uint256 count=size-offset;if(count>limit)count=limit;result=new Item[](count);
        for(uint256 i;i<count;i++)result[i]=_view(listed.at(offset+i));
    }
    function _clearListing(uint256 id) internal {
        address seller=listings[id].seller;if(seller!=address(0)){delete listings[id];listed.remove(id);emit ListingCancelled(id,seller,++revisions[id]);}
        else revisions[id]++;
    }
    function _update(address to,uint256 id,address auth) internal override returns(address){
        address from=super._update(to,id,auth);if(from!=address(0))_clearListing(id);return from;
    }
}
