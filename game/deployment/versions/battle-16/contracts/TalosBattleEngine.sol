// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {TalosBattleTypes as T} from "./TalosBattleTypes.sol";
import {TalosBattleCatalog as C} from "./TalosBattleCatalog.sol";

/// @notice Immutable full battle rules, split into linked libraries to respect EIP-170.
library TalosBattleEngine {
    event BattleAction(bytes32 indexed matchId,uint32 indexed seq,uint8 side,uint8 kind,uint8 actor,uint8 target,uint8 ally,uint8 hand);
    event BattleDamage(bytes32 indexed matchId,uint32 indexed seq,uint8 round,uint8 side,uint8 actor,uint8 target,uint8 action,uint8 element,uint16 baseDamage,uint16 bonusDamage,bool barrierBlocked,uint8 shieldAbsorbed,uint8 hpBefore,uint8 finalDamage);
    event BattleEffect(bytes32 indexed matchId,uint32 indexed seq,uint8 kind,uint8 side,uint8 actor,uint8 target,uint16 beforeValue,uint16 afterValue,uint8 detail);
    struct Evt {
        uint8 typ; // 0 hit, 1 fresh status, 2 consume
        uint8 side; uint8 actor; uint8 target; uint8 element; uint8 action; uint8 root;
        uint8 key; uint8 pre; uint8 hpLoss; uint8 priorUnion;
        uint8[5] prior;
        bool effective; bool half;
    }
    struct Events { Evt[16] list; uint8 count; }

    function create(uint8[8] memory ids,uint8[2] memory equipment,uint32 seed,uint8 first) public pure returns(T.State memory s) {
        require(first<2,"initiative");
        s.round=1; s.priority=first; s.initiative=first; s.rng=seed==0?1:seed;
        for(uint8 side;side<2;side++){
            require(equipment[side]<=6,"item");
            s.items[side]=equipment[side]; s.ap[side]=3; s.actions[side]=3;
            uint16 cost;
            for(uint8 i;i<4;i++){
                uint8 g=side*4+i; T.Stats memory c=C.get(ids[g]); cost+=c.cost;
                for(uint8 j;j<i;j++)require(ids[side*4+j]!=ids[g],"duplicate character");
                s.units[g].id=ids[g]; s.units[g].hp=c.hp;
                s.decks[side].draw[i*3]=1+i*2;
                s.decks[side].draw[i*3+1]=1+i*2;
                s.decks[side].draw[i*3+2]=2+i*2;
            }
            require(cost<=16,"team cost");
            s.decks[side].drawCount=12; _shuffle(s,side); _draw(s,side,4);
        }
    }

    function act(T.State memory s,uint8 side,T.Input memory x,bytes32 mid) public returns(T.State memory) {
        require(side<2&&s.round>0&&s.winner==0,"inactive battle");
        require(x.kind<=9,"action");
        if(x.kind<=7)require(x.actor<4&&x.target<4&&x.ally<4,"slot");
        s.seq++;
        emit BattleAction(mid,s.seq,side,x.kind,x.actor,x.target,x.ally,x.hand);
        if(x.kind==9){s.winner=2-side;_effect(s,mid,8,side,x.actor,255,0,s.winner,0);return s;}
        if(x.kind==8){
            require(s.roundPending,"round not pending"); s.acks[side]=true;
            if(s.acks[0]&&s.acks[1])_endRound(s,mid);
            return s;
        }
        require(!s.acks[side],"round acknowledged");
        if(x.kind==6){return TalosBattleCombos.execute(s,side,x,mid);}
        require(s.priority==side&&s.actions[side]>0&&!s.roundPending,"priority");
        if(x.kind==7){
            T.Deck memory d=s.decks[side];
            require(s.actions[side]==3&&!d.cycled&&x.hand<d.handCount,"cycle");
            _discard(s,side,_takeHand(s,side,x.hand)); _draw(s,side,1); d.cycled=true;
            return s;
        }
        if(x.kind==4){_item(s,side,x.ally,mid);_advance(s,side);return s;}
        if(x.kind==5){s.root++;_advance(s,side);return s;}
        uint8 actor=side*4+x.actor;
        T.Unit memory u=s.units[actor]; T.Stats memory c=C.get(u.id);
        require(u.hp>0&&!_frozen(s,u)&&!u.acted,"unit unavailable");
        uint8 range=x.kind==0?c.normalRange:x.kind==1?c.skillRange:c.ultimateRange;
        uint8 effect=x.kind==1?c.skillEffect:c.ultimateEffect;
        if(x.kind==1||x.kind==2){
            require(s.ap[side]>=(x.kind==1?2:0),"AP");
            require(_handIndex(s.decks[side],1+x.actor*2+(x.kind==2?1:0))<6,"skill card");
            if(x.kind==2)require(!u.ult&&s.round>=3&&u.ultimateCharge>=c.requiredCasts,"ultimate");
            if(effect!=0)require(s.units[side*4+x.ally].hp>0,"ally dead");
        }
        if(x.kind!=3&&range<4)require(_target(s,side,x.target,range),"target");
        if(u.id==7&&x.kind==1)require(s.units[side*4+x.ally].hp>0,"ally dead");
        return TalosBattleRules.execute(s,side,x,mid);
    }

    function _effect(T.State memory s,bytes32 mid,uint8 kind,uint8 side,uint8 actor,uint8 target,uint16 beforeValue,uint16 afterValue,uint8 detail) private {
        emit BattleEffect(mid,s.seq,kind,side,actor,target,beforeValue,afterValue,detail);
    }

    function _frozen(T.State memory s,T.Unit memory u) private pure returns(bool){return u.frozen==s.round;}

    function _target(T.State memory s,uint8 side,uint8 target,uint8 r) private pure returns(bool){
        uint8 off=(1-side)*4;if(s.units[off+target].hp==0)return false;
        return r==1||r==3||target<2||(r!=2&&s.units[off].hp==0&&s.units[off+1].hp==0);
    }

    function _rng(T.State memory s) private pure returns(uint32 x){unchecked{x=s.rng;x^=x<<13;x^=x>>17;x^=x<<5;s.rng=x;}}

    function _shuffle(T.State memory s,uint8 side) private pure {
        T.Deck memory d=s.decks[side];
        for(uint8 i=d.drawCount;i>1;i--){uint8 j=uint8((uint64(_rng(s))*i)>>32);uint8 z=d.draw[i-1];d.draw[i-1]=d.draw[j];d.draw[j]=z;}
    }

    function _draw(T.State memory s,uint8 side,uint8 n) private pure {
        T.Deck memory d=s.decks[side];
        for(uint8 k;k<n;k++){
            if(d.drawCount==0&&d.discardCount>0){
                d.drawCount=d.discardCount;
                for(uint8 i;i<d.discardCount;i++){d.draw[i]=d.discard[i];d.discard[i]=0;}
                d.discardCount=0;_shuffle(s,side);
            }
            if(d.drawCount==0)break;
            uint8 card=d.draw[--d.drawCount];d.draw[d.drawCount]=0;
            if(d.handCount<6)d.hand[d.handCount++]=card;else _discard(s,side,card);
        }
    }

    function _discard(T.State memory s,uint8 side,uint8 card) private pure {T.Deck memory d=s.decks[side];require(d.discardCount<12,"discard");d.discard[d.discardCount++]=card;}

    function _takeHand(T.State memory s,uint8 side,uint8 index) private pure returns(uint8 card){
        T.Deck memory d=s.decks[side];require(index<d.handCount,"hand");card=d.hand[index];
        for(uint8 i=index;i+1<d.handCount;i++)d.hand[i]=d.hand[i+1];d.hand[--d.handCount]=0;
    }

    function _handIndex(T.Deck memory d,uint8 card) private pure returns(uint8){for(uint8 i;i<d.handCount;i++)if(d.hand[i]==card)return i;return 255;}

    function _heal(T.State memory s,uint8 target,uint8 amount,uint8 side,uint8 actor,bytes32 mid) private returns(uint8 gained){
        T.Unit memory u=s.units[target];if(u.hp==0)return 0;
        uint8 beforeHp=u.hp;uint16 next=uint16(u.hp)+amount;uint8 cap=C.get(u.id).hp;
        u.hp=next>cap?cap:uint8(next);gained=u.hp-beforeHp;
        if(gained>0)_effect(s,mid,1,side,actor,target,beforeHp,u.hp,0);
    }

    function _shield(T.State memory s,uint8 target,uint8 amount,uint8 side,uint8 actor,bytes32 mid) private {
        T.Unit memory u=s.units[target];if(u.hp==0)return;
        uint8 beforeShield=u.shield;uint16 next=uint16(u.shield)+amount;u.shield=next>24?24:uint8(next);
        if(u.shield!=beforeShield)_effect(s,mid,2,side,actor,target,beforeShield,u.shield,0);
    }

    function _recover(T.State memory s,uint8 side,uint8 amount,bool combo,uint8 actor,bytes32 mid) private {
        uint8 beforeAP=s.ap[side];uint8 gained=amount>6-beforeAP?6-beforeAP:amount;s.ap[side]+=gained;
        if(combo)s.comboRefund[side]+=gained;
        if(gained>0)_effect(s,mid,5,side,actor,255,beforeAP,s.ap[side],0);
    }

    function _win(T.State memory s) private pure returns(bool){
        if(s.winner!=0)return true;bool a;bool b;
        for(uint8 i;i<4;i++){a=a||s.units[i].hp>0;b=b||s.units[4+i].hp>0;}
        if(!a||!b){s.winner=a?1:b?2:3;return true;}return false;
    }

    function _advance(T.State memory s,uint8 side) private pure {
        s.actions[side]--;s.turns++;
        if(s.actions[0]==0&&s.actions[1]==0){s.roundPending=true;s.priority=2;}
        else s.priority=s.actions[1-side]>0?1-side:side;
    }

    function _item(T.State memory s,uint8 side,uint8 allySlot,bytes32 mid) private {
        uint8 id=s.items[side];require(id>0&&id<=6,"no item");uint8 target=side*4+allySlot;T.Unit memory u=s.units[target];
        uint8 first;uint8 max;uint8 cost;uint8 cooldown;
        if(id==1){first=5;max=1;}
        else if(id==2){first=2;max=3;cost=1;cooldown=2;}
        else if(id==3){first=5;max=1;cost=3;}
        else if(id==4){first=2;max=2;cost=2;cooldown=3;}
        else if(id==5){first=2;max=2;cost=1;cooldown=2;}
        else{first=4;max=1;cost=1;}
        require(u.hp>0&&s.round>=first&&s.used[side]<max&&s.ap[side]>=cost,"item unavailable");
        require(s.used[side]==0||s.round>s.last[side]+cooldown,"item cooldown");
        if(id==1)require(s.ap[side]<6&&s.actions[side]>=2,"battery");
        if(id==2||id==3)require(u.hp<C.get(u.id).hp,"full HP");
        if(id==4)require(!u.barrier,"barrier exists");
        if(id==5)require(u.electric||u.vulnerable||u.burn>=s.round||u.frozen>=s.round,"no debuff");
        if(id==6)require(u.acted&&!_frozen(s,u)&&s.actions[side]>=2,"reactivation");
        s.root++;s.used[side]++;s.last[side]=s.round;
        uint8 oldAP=s.ap[side];s.ap[side]-=cost;
        if(id==1)s.ap[side]=6;
        if(oldAP!=s.ap[side])_effect(s,mid,5,side,255,255,oldAP,s.ap[side],0);
        if(id==2)_heal(s,target,10,side,255,mid);
        if(id==3)_heal(s,target,C.get(u.id).hp,side,255,mid);
        if(id==4){u.barrier=true;u.barrierUntil=s.round+1;_effect(s,mid,3,side,255,target,0,1,4);}
        if(id==5){
            if(u.electric)_effect(s,mid,3,side,255,target,1,0,0);
            if(u.vulnerable)_effect(s,mid,3,side,255,target,1,0,1);
            if(u.burn>=s.round)_effect(s,mid,3,side,255,target,1,0,2);
            if(u.frozen>=s.round)_effect(s,mid,3,side,255,target,1,0,3);
            u.electric=false;u.vulnerable=false;u.burn=0;u.frozen=0;
        }
        if(id==6)u.acted=false;
    }

    function _endRound(T.State memory s,bytes32 mid) private {
        for(uint8 g;g<8;g++){
            T.Unit memory u=s.units[g];if(u.hp==0||u.burn<s.round)continue;
            uint8 before=u.hp;uint8 absorbed=u.shield>=2?2:u.shield;u.shield-=absorbed;
            uint8 loss=2-absorbed;if(loss>u.hp)loss=u.hp;u.hp-=loss;
            emit BattleDamage(mid,s.seq,s.round,u.burnSide,u.burnActor,g,10,1,2,0,false,absorbed,before,loss);
        }
        if(_win(s)){_effect(s,mid,8,2,255,255,0,s.winner,0);return;}
        if(s.round>=12){
            uint8 fatigue=(s.round-11)*3;
            for(uint8 g;g<8;g++){T.Unit memory u=s.units[g];if(u.hp==0)continue;uint8 before=u.hp;uint8 loss=u.hp<fatigue?u.hp:fatigue;u.hp-=loss;emit BattleDamage(mid,s.seq,s.round,2,255,g,11,0,fatigue,0,false,0,before,loss);}
        }
        if(_win(s)){_effect(s,mid,8,2,255,255,0,s.winner,0);return;}
        if(s.round>=19){
            uint8[2] memory alive;uint16[2] memory hp;
            for(uint8 g;g<8;g++){if(s.units[g].hp>0)alive[g/4]++;hp[g/4]+=s.units[g].hp;}
            s.winner=alive[0]>alive[1]?1:alive[1]>alive[0]?2:hp[0]>hp[1]?1:hp[1]>hp[0]?2:3;
            _effect(s,mid,8,2,255,255,0,s.winner,0);return;
        }
        for(uint8 side;side<2;side++){
            for(uint8 i;i<4;i++){
                T.Unit memory u=s.units[side*4+i];
                if(u.barrierUntil<=s.round)u.barrier=false;
                if(u.electricUntil<=s.round)u.electric=false;
                if(u.vulnerableUntil<=s.round)u.vulnerable=false;
                if(u.crystalUntil<=s.round)u.crystalCharges=0;
                if(u.focusUntil<=s.round)u.focusUntil=0;
                u.shield=0;u.acted=false;u.combo=false;u.comboTriggered=false;u.ready.active=false;
            }
            if(s.linkUntil[side]<=s.round)s.link[side]=0;
            s.decks[side].cycled=false;_draw(s,side,2);
        }
        uint8 oldRound=s.round;s.round++;s.actions[0]=3;s.actions[1]=3;s.comboRefund[0]=0;s.comboRefund[1]=0;
        s.roundPending=false;s.acks[0]=false;s.acks[1]=false;s.initiative=1-s.initiative;s.priority=s.initiative;
        for(uint8 i;i<40;i++)s.hits[i]=0;
        _recover(s,0,2,false,255,mid);_recover(s,1,2,false,255,mid);
        _effect(s,mid,7,2,255,255,oldRound,s.round,0);
    }
}

library TalosBattleRules {
    event BattleAction(bytes32 indexed matchId,uint32 indexed seq,uint8 side,uint8 kind,uint8 actor,uint8 target,uint8 ally,uint8 hand);
    event BattleDamage(bytes32 indexed matchId,uint32 indexed seq,uint8 round,uint8 side,uint8 actor,uint8 target,uint8 action,uint8 element,uint16 baseDamage,uint16 bonusDamage,bool barrierBlocked,uint8 shieldAbsorbed,uint8 hpBefore,uint8 finalDamage);
    event BattleEffect(bytes32 indexed matchId,uint32 indexed seq,uint8 kind,uint8 side,uint8 actor,uint8 target,uint16 beforeValue,uint16 afterValue,uint8 detail);
    struct Evt {
        uint8 typ; // 0 hit, 1 fresh status, 2 consume
        uint8 side; uint8 actor; uint8 target; uint8 element; uint8 action; uint8 root;
        uint8 key; uint8 pre; uint8 hpLoss; uint8 priorUnion;
        uint8[5] prior;
        bool effective; bool half;
    }
    struct Events { Evt[16] list; uint8 count; }

    function execute(T.State memory s,uint8 side,T.Input memory x,bytes32 mid) public returns(T.State memory){ _active(s,side,x,mid);return s;}
    function _effect(T.State memory s,bytes32 mid,uint8 kind,uint8 side,uint8 actor,uint8 target,uint16 beforeValue,uint16 afterValue,uint8 detail) private {
        emit BattleEffect(mid,s.seq,kind,side,actor,target,beforeValue,afterValue,detail);
    }

    function _frozen(T.State memory s,T.Unit memory u) private pure returns(bool){return u.frozen==s.round;}

    function _popcount(uint128 x) private pure returns(uint8 n){while(x!=0){x&=x-1;n++;}}

    function _ledger(uint8 side,uint8 target,uint8 element) private pure returns(uint8){return side*20+(target%4)*5+element;}

    function _addEvent(Events memory es,Evt memory e) private pure {require(es.count<16,"events");es.list[es.count++]=e;}

    function _heal(T.State memory s,uint8 target,uint8 amount,uint8 side,uint8 actor,bytes32 mid) private returns(uint8 gained){
        T.Unit memory u=s.units[target];if(u.hp==0)return 0;
        uint8 beforeHp=u.hp;uint16 next=uint16(u.hp)+amount;uint8 cap=C.get(u.id).hp;
        u.hp=next>cap?cap:uint8(next);gained=u.hp-beforeHp;
        if(gained>0)_effect(s,mid,1,side,actor,target,beforeHp,u.hp,0);
    }

    function _shield(T.State memory s,uint8 target,uint8 amount,uint8 side,uint8 actor,bytes32 mid) private {
        T.Unit memory u=s.units[target];if(u.hp==0)return;
        uint8 beforeShield=u.shield;uint16 next=uint16(u.shield)+amount;u.shield=next>24?24:uint8(next);
        if(u.shield!=beforeShield)_effect(s,mid,2,side,actor,target,beforeShield,u.shield,0);
    }

    function _recover(T.State memory s,uint8 side,uint8 amount,bool combo,uint8 actor,bytes32 mid) private {
        uint8 beforeAP=s.ap[side];uint8 gained=amount>6-beforeAP?6-beforeAP:amount;s.ap[side]+=gained;
        if(combo)s.comboRefund[side]+=gained;
        if(gained>0)_effect(s,mid,5,side,actor,255,beforeAP,s.ap[side],0);
    }

    function _charge(T.State memory s,uint8 g,bytes32 mid) private {
        T.Unit memory u=s.units[g];uint8 max=C.get(u.id).requiredCasts;
        if(!u.ult&&u.ultimateCharge<max){uint8 old=u.ultimateCharge;u.ultimateCharge++;_effect(s,mid,4,g/4,g%4,g,old,u.ultimateCharge,0);}
    }

    function _lowest(T.State memory s,uint8 side) private pure returns(uint8 best){
        best=255;
        for(uint8 i=side*4;i<side*4+4;i++)if(s.units[i].hp>0){
            if(best==255||uint16(s.units[i].hp)*C.get(s.units[best].id).hp<uint16(s.units[best].hp)*C.get(s.units[i].id).hp)best=i;
        }
    }

    function _win(T.State memory s) private pure returns(bool){
        if(s.winner!=0)return true;bool a;bool b;
        for(uint8 i;i<4;i++){a=a||s.units[i].hp>0;b=b||s.units[4+i].hp>0;}
        if(!a||!b){s.winner=a?1:b?2:3;return true;}return false;
    }

    function _pre(T.State memory s,T.Unit memory u) private pure returns(uint8 p){
        if(u.electric)p|=1;if(u.vulnerable)p|=2;if(u.burn>=s.round)p|=4;if(_frozen(s,u))p|=8;if(u.frozen>=s.round)p|=16;
    }

    function _status(T.State memory s,uint8 side,uint8 actor,uint8 target,uint8 key,uint8 root,Events memory es,bytes32 mid) private {
        T.Unit memory u=s.units[target];if(u.hp==0)return;bool old;
        if(key==0){old=u.electric;u.electric=true;u.electricUntil=s.round+1;}
        else if(key==1){old=u.vulnerable;u.vulnerable=true;u.vulnerableUntil=s.round+1;}
        else if(key==2){old=u.burn>=s.round;u.burn=s.round+1;u.burnSide=side;u.burnActor=actor;}
        else{old=u.frozen>=s.round;if(old)return;u.frozen=s.round+1;}
        _effect(s,mid,3,side,actor,target,old?1:0,1,key);
        if(!old){Evt memory e;e.typ=1;e.side=side;e.actor=actor;e.target=target;e.key=key;e.root=root;_addEvent(es,e);}
    }

    function _consume(Events memory es,uint8 side,uint8 actor,uint8 target,uint8 key,uint8 root) private pure {
        Evt memory e;e.typ=2;e.side=side;e.actor=actor;e.target=target;e.key=key;e.root=root;_addEvent(es,e);
    }

    function _damage(T.State memory s,uint8 g,uint8 target,uint16 base,uint8 element,uint8 action,uint8 root,bool main,Events memory es,bytes32 mid) private returns(Evt memory e){
        T.Unit memory u=s.units[target];e.side=g/4;e.actor=g%4;e.target=target;e.action=action;e.element=element;e.root=root;
        if(u.hp==0)return e;
        uint8 id=s.units[g].id;e.pre=_pre(s,u);
        uint8 offset=_ledger(e.side,target,0);
        for(uint8 k;k<5;k++)e.prior[k]=_popcount(s.hits[offset+k]);
        e.priorUnion=_popcount(s.hits[offset+2]|s.hits[offset+4]);
        uint16 n=base;
        if(action!=6){
            if((action==1&&id==8||action==2&&id==4)&&(e.pre&4)!=0)n+=2;
            if(action==2&&id==9&&(e.pre&8)!=0)n+=2;
            if((id==14&&(action==1||action==2))||(id==31&&action==1)){
                uint8 el=id==14?2:4;uint8 needed=action==2?2:1;if(e.prior[el]>=needed)n+=action==2?2:1;
            }
            if((element!=0||action==1&&id==11)&&u.electric){
                n+=action==1&&id==26?3:2;u.electric=false;_consume(es,e.side,e.actor,target,0,root);_effect(s,mid,3,e.side,e.actor,target,1,0,0);
            }else if(u.vulnerable){
                n+=action==1&&(id==1||id==10)?3:2;u.vulnerable=false;_consume(es,e.side,e.actor,target,1,root);_effect(s,mid,3,e.side,e.actor,target,1,0,1);
            }
            if((action==1||action==2)&&main&&s.link[e.side]>0){n++;s.link[e.side]=0;}
        }
        bool blocked=n>0&&u.barrier;uint8 absorbed;uint8 loss;uint8 beforeHP=u.hp;
        if(blocked){u.barrier=false;_effect(s,mid,3,e.side,e.actor,target,1,0,4);}
        else{absorbed=n>u.shield?u.shield:uint8(n);u.shield-=absorbed;uint16 rest=n-absorbed;loss=rest>u.hp?u.hp:uint8(rest);u.hp-=loss;}
        e.effective=absorbed>0||loss>0;e.hpLoss=loss;
        if(e.effective)s.hits[_ledger(e.side,target,element)]|=uint128(1)<<root;
        uint8 maxHP=C.get(u.id).hp;
        e.half=uint16(beforeHP)*2>maxHP&&uint16(u.hp)*2<=maxHP&&!u.crossedHalf;
        if(e.half)u.crossedHalf=true;
        if(u.hp==0){u.ready.active=false;u.crystalCharges=0;u.focusUntil=0;u.vocalist=0;}
        _addEvent(es,e);
        emit BattleDamage(mid,s.seq,s.round,e.side,e.actor,target,action,element,base,n-base,blocked,absorbed,beforeHP,loss);
    }

    function _eligible(T.State memory s,uint8 g) private pure returns(bool){T.Unit memory u=s.units[g];return u.hp>0&&!_frozen(s,u)&&!u.comboTriggered;}

    function _trigger(T.State memory s,uint8 g,uint8 target,uint8 actor,uint8 side,uint8 root,bytes32 mid) private {
        if(!_eligible(s,g)||s.units[target].hp==0)return;
        T.Unit memory u=s.units[g];u.comboTriggered=true;u.ready=T.Ready(true,target,actor,side,root);
        _effect(s,mid,6,g/4,g%4,target,0,1,0);
    }

    function _process(T.State memory s,Events memory es,bytes32 mid) private {
        for(uint8 g;g<8;g++)if(s.units[g].ready.active&&s.units[s.units[g].ready.target].hp==0){s.units[g].ready.active=false;s.units[g].combo=true;}
        if(_win(s)){_effect(s,mid,8,2,255,255,0,s.winner,0);return;}
        for(uint8 ei;ei<es.count;ei++){
            Evt memory e=es.list[ei];bool hit=e.typ==0&&e.effective;bool normal=hit&&e.action==0;
            if(normal){
                for(uint8 i;i<4;i++){
                    uint8 g=e.side*4+i;T.Unit memory crystal=s.units[g];
                    if(crystal.id!=19||crystal.hp==0||_frozen(s,crystal)||crystal.crystalCharges==0||crystal.crystalUntil<s.round)continue;
                    uint8 low=_lowest(s,e.side);
                    if(low<8&&_heal(s,low,1,e.side,i,mid)>0){
                        crystal.crystalCharges--;
                        if(crystal.crystalCharges==0)_trigger(s,g,low,e.actor,e.side,e.root,mid);
                    }
                }
            }
            if(s.units[e.target].hp==0)continue;
            for(uint8 side;side<2;side++)for(uint8 i;i<4;i++){
                uint8 g=side*4+i;if(!_eligible(s,g))continue;T.Unit memory u=s.units[g];uint8 id=u.id;
                bool yes;bool fresh=e.typ==1;bool consume=e.typ==2;
                bool elemental=fresh&&(e.key==0||e.key==2||e.key==3);
                if(e.side==side){
                    uint8 off=_ledger(side,e.target,0);
                    if(id==1)yes=hit&&e.action==6&&e.actor!=i;
                    else if(id==2)yes=fresh&&e.key==1;
                    else if(id==3)yes=normal;
                    else if(id==4||id==13)yes=elemental;
                    else if(id==5)yes=normal&&(e.pre&23)==0;
                    else if(id==8)yes=fresh&&e.key==2;
                    else if(id==9)yes=normal&&(e.pre&8)!=0;
                    else if(id==10)yes=normal&&(e.pre&2)!=0;
                    else if(id==11)yes=(fresh||consume)&&e.key==0;
                    else if(id==12)yes=hit&&e.half;
                    else if(id==14)yes=hit&&e.prior[2]<2&&_popcount(s.hits[off+2])>=2;
                    else if(id==15)yes=consume&&e.key==1;
                    else if(id==16)yes=consume;
                    else if(id==17||id==26)yes=normal&&(e.pre&1)!=0;
                    else if(id==18)yes=hit&&e.prior[0]<3&&_popcount(s.hits[off])>=3;
                    else if(id==20)yes=fresh&&u.focusUntil>=s.round&&u.focusTarget==e.target;
                    else if(id==22)yes=fresh&&e.key==3;
                    else if(id==23)yes=hit&&(e.element==2||e.element==4)&&e.priorUnion<2&&_popcount(s.hits[off+2]|s.hits[off+4])>=2;
                    else if(id==24)yes=hit&&e.element==2;
                    else if(id==25)yes=fresh&&s.units[e.target].vulnerable&&(s.units[e.target].electric||s.units[e.target].burn>=s.round||s.units[e.target].frozen>=s.round);
                    else if(id==27)yes=consume&&e.key==2;
                    else if(id==28)yes=hit&&e.prior[0]<2&&_popcount(s.hits[off])>=2;
                    else if(id==29)yes=u.vocalist>=s.round&&(elemental||consume&&(e.key==0||e.key==2));
                    else if(id==30){uint8 n;if(s.hits[off+1]!=0)n++;if(s.hits[off+2]!=0)n++;if(s.hits[off+3]!=0)n++;yes=hit&&(e.element==4||n>=2);}
                    else if(id==31)yes=hit&&e.prior[4]<2&&_popcount(s.hits[off+4])>=2;
                }else if(hit&&e.hpLoss>0&&e.target/4==side){
                    if(id==6)yes=uint16(s.units[e.target].hp)*100<uint16(C.get(s.units[e.target].id).hp)*60;
                    else if(id==7||id==32)yes=true;
                    else if(id==21)yes=uint16(s.units[e.target].hp)*100<uint16(C.get(s.units[e.target].id).hp)*40;
                }
                if(yes)_trigger(s,g,e.target,e.actor,e.side,e.root,mid);
            }
        }
    }

    function _comboAmount(uint8 id) private pure returns(uint8){
        bytes memory a=hex"0202010101000103030201010103010103030001000102020302010201010300";return uint8(a[id-1]);
    }

    function _combo(T.State memory s,uint8 side,uint8 i,bytes32 mid) private {
        uint8 g=side*4+i;T.Unit memory u=s.units[g];
        require(u.hp>0&&!_frozen(s,u)&&u.ready.active,"combo");
        T.Ready memory r=u.ready;u.ready.active=false;u.combo=true;
        if(s.units[r.target].hp==0)return;
        uint8 id=u.id;Events memory es;uint8 amount=_comboAmount(id);Evt memory hit;
        if(amount>0){
            uint8 target=id==7?(1-side)*4+r.actor:r.target;
            uint8 element=C.get(id).element;if(id==7||id==11||id==12||id==16||id==22)element=0;
            if(s.units[target].hp>0)hit=_damage(s,g,target,amount,element,6,r.root,false,es,mid);
        }
        if(amount>0&&s.units[hit.target].hp>0){
            if(id==1||id==13||id==22||id==30)_status(s,side,i,hit.target,1,r.root,es,mid);
            else if(id==3||id==20)_status(s,side,i,hit.target,0,r.root,es,mid);
            else if(id==4)_status(s,side,i,hit.target,2,r.root,es,mid);
        }
        if(id==5||id==29){uint8 low=_lowest(s,side);if(low<8)_heal(s,low,2,side,i,mid);}
        if(id==6)_heal(s,r.target,3,side,i,mid);
        if(id==7)_heal(s,r.target,1,side,i,mid);
        if(id==19||id==21)_shield(s,r.target,3,side,i,mid);
        if(id==32){_heal(s,r.target,1,side,i,mid);_shield(s,r.target,1,side,i,mid);}
        if(id==10){s.link[side]=1;s.linkUntil[side]=s.round+1;_effect(s,mid,3,side,i,255,0,1,8);}
        _charge(s,g,mid);if(C.get(id).role==5)_recover(s,side,1,true,i,mid);
        if(id==28)_shield(s,g,1,side,i,mid);
        _process(s,es,mid);
    }

    function _active(T.State memory s,uint8 side,T.Input memory x,bytes32 mid) private {
        uint8 g=side*4+x.actor;T.Unit memory u=s.units[g];T.Stats memory c=C.get(u.id);uint8 id=u.id;
        uint8 action=x.kind;uint8 root=++s.root;Events memory es;u.acted=true;bool refund;
        if(action==1||action==2){
            if(action==1){s.ap[side]-=2;_effect(s,mid,5,side,x.actor,255,s.ap[side]+2,s.ap[side],0);}
            uint8 card=_takeHand(s,side,_handIndex(s.decks[side],1+x.actor*2+(action==2?1:0)));
            if(action==2){s.decks[side].removed[s.decks[side].removedCount++]=card;u.ult=true;uint8 old=u.ultimateCharge;u.ultimateCharge-=c.requiredCasts;_effect(s,mid,4,side,x.actor,g,old,u.ultimateCharge,0);}
            else _discard(s,side,card);
        }
        uint8 effect=action==1?c.skillEffect:c.ultimateEffect;uint8 value=action==1?c.skillValue:c.ultimateValue;
        uint8 r=action==0?c.normalRange:action==1?c.skillRange:c.ultimateRange;
        if(action==3)_shield(s,g,4,side,x.actor,mid);
        else if(action!=0&&effect!=0){
            uint8 ally=side*4+x.ally;
            if(id==12&&action==1)refund=uint16(s.units[ally].hp)*2<=C.get(s.units[ally].id).hp&&s.units[ally].shield<24&&value>0;
            for(uint8 i;i<4;i++)if(r==5||i==x.ally){uint8 target=side*4+i;if(effect==1)_heal(s,target,value,side,x.actor,mid);else _shield(s,target,value,side,x.actor,mid);}
            if(action==1&&(id==6||id==21||id==32))_shield(s,ally,12,side,x.actor,mid);
            if(action==2&&(id==6||id==21))_heal(s,g,4,side,x.actor,mid);
            if(action==2&&(id==5||id==19))_shield(s,ally,id==5?3:5,side,x.actor,mid);
            if(id==19&&action==1){u.crystalCharges=2;u.crystalUntil=s.round+1;_effect(s,mid,3,side,x.actor,g,0,2,5);}
            if(id==29){u.vocalist=s.round+1;_effect(s,mid,3,side,x.actor,g,0,1,7);}
        }else{
            Evt[4] memory results;bool[4] memory present;
            for(uint8 i;i<4;i++){
                if(!(r==3||r==2&&i<2||r!=2&&r!=3&&i==x.target)||s.units[(1-side)*4+i].hp==0)continue;
                uint8 target=(1-side)*4+i;
                results[i]=_damage(s,g,target,action==0?c.atk:value,action==2?c.ultimateElement:c.element,action,root,i==x.target,es,mid);present[i]=true;
            }
            if(action==1||action==2)for(uint8 i;i<4;i++)if(present[i]){
                Evt memory hit=results[i];if(s.units[hit.target].hp==0)continue;
                if(action==1){
                    if(id==2||id==13||id==16||id==18||id==24||id==28||id==30)_status(s,side,x.actor,hit.target,1,root,es,mid);
                    if(id==3)_status(s,side,x.actor,hit.target,0,root,es,mid);
                    if(id==4||id==25)_status(s,side,x.actor,hit.target,2,root,es,mid);
                    if(id==9||id==22)_status(s,side,x.actor,hit.target,3,root,es,mid);
                    if(id==20){u.focusTarget=hit.target;u.focusUntil=s.round+1;_effect(s,mid,3,side,x.actor,hit.target,0,1,6);_status(s,side,x.actor,hit.target,0,root,es,mid);}
                    if(id==27&&(hit.pre&4)!=0){s.units[hit.target].burn=0;_consume(es,side,x.actor,hit.target,2,root);_effect(s,mid,3,side,x.actor,hit.target,1,0,2);}
                }else{
                    if(id==1||id==25||i==x.target&&(id==13||id==22||id==30))_status(s,side,x.actor,hit.target,1,root,es,mid);
                    if(i==x.target&&(id==3||id==17||id==20||id==26))_status(s,side,x.actor,hit.target,0,root,es,mid);
                    if(id==8||id==27)_status(s,side,x.actor,hit.target,2,root,es,mid);
                    if(i==x.target&&id==24)_status(s,side,x.actor,hit.target,3,root,es,mid);
                }
            }
            if(id==7&&action==1){_shield(s,g,5,side,x.actor,mid);_shield(s,side*4+x.ally,12,side,x.actor,mid);}
            if(id==7&&action==2)_shield(s,g,8,side,x.actor,mid);
            if(id==28&&(action==1||action==2))_shield(s,g,action==1?3:4,side,x.actor,mid);
            if(id==32&&action==2)_heal(s,g,5,side,x.actor,mid);
        }
        if(action==1){
            for(uint8 ei;ei<es.count;ei++)if(es.list[ei].typ==2){uint8 k=es.list[ei].key;if(id==11&&k==0||id==15&&k==1||id==16&&(k==0||k==1)||id==27&&k==2)refund=true;}
            _charge(s,g,mid);
        }
        if((action==1||action==2)&&c.role==5&&(action==2||refund))_recover(s,side,action==2?2:1,false,x.actor,mid);
        _advance(s,side);_process(s,es,mid);
    }

    function _advance(T.State memory s,uint8 side) private pure {
        s.actions[side]--;s.turns++;
        if(s.actions[0]==0&&s.actions[1]==0){s.roundPending=true;s.priority=2;}
        else s.priority=s.actions[1-side]>0?1-side:side;
    }

    function _discard(T.State memory s,uint8 side,uint8 card) private pure {T.Deck memory d=s.decks[side];require(d.discardCount<12,"discard");d.discard[d.discardCount++]=card;}

    function _takeHand(T.State memory s,uint8 side,uint8 index) private pure returns(uint8 card){
        T.Deck memory d=s.decks[side];require(index<d.handCount,"hand");card=d.hand[index];
        for(uint8 i=index;i+1<d.handCount;i++)d.hand[i]=d.hand[i+1];d.hand[--d.handCount]=0;
    }

    function _handIndex(T.Deck memory d,uint8 card) private pure returns(uint8){for(uint8 i;i<d.handCount;i++)if(d.hand[i]==card)return i;return 255;}
}

library TalosBattleCombos {
    event BattleAction(bytes32 indexed matchId,uint32 indexed seq,uint8 side,uint8 kind,uint8 actor,uint8 target,uint8 ally,uint8 hand);
    event BattleDamage(bytes32 indexed matchId,uint32 indexed seq,uint8 round,uint8 side,uint8 actor,uint8 target,uint8 action,uint8 element,uint16 baseDamage,uint16 bonusDamage,bool barrierBlocked,uint8 shieldAbsorbed,uint8 hpBefore,uint8 finalDamage);
    event BattleEffect(bytes32 indexed matchId,uint32 indexed seq,uint8 kind,uint8 side,uint8 actor,uint8 target,uint16 beforeValue,uint16 afterValue,uint8 detail);
    struct Evt {
        uint8 typ; // 0 hit, 1 fresh status, 2 consume
        uint8 side; uint8 actor; uint8 target; uint8 element; uint8 action; uint8 root;
        uint8 key; uint8 pre; uint8 hpLoss; uint8 priorUnion;
        uint8[5] prior;
        bool effective; bool half;
    }
    struct Events { Evt[16] list; uint8 count; }

    function execute(T.State memory s,uint8 side,T.Input memory x,bytes32 mid) public returns(T.State memory){ _combo(s,side,x.actor,mid);return s;}
    function _effect(T.State memory s,bytes32 mid,uint8 kind,uint8 side,uint8 actor,uint8 target,uint16 beforeValue,uint16 afterValue,uint8 detail) private {
        emit BattleEffect(mid,s.seq,kind,side,actor,target,beforeValue,afterValue,detail);
    }

    function _frozen(T.State memory s,T.Unit memory u) private pure returns(bool){return u.frozen==s.round;}

    function _popcount(uint128 x) private pure returns(uint8 n){while(x!=0){x&=x-1;n++;}}

    function _ledger(uint8 side,uint8 target,uint8 element) private pure returns(uint8){return side*20+(target%4)*5+element;}

    function _addEvent(Events memory es,Evt memory e) private pure {require(es.count<16,"events");es.list[es.count++]=e;}

    function _heal(T.State memory s,uint8 target,uint8 amount,uint8 side,uint8 actor,bytes32 mid) private returns(uint8 gained){
        T.Unit memory u=s.units[target];if(u.hp==0)return 0;
        uint8 beforeHp=u.hp;uint16 next=uint16(u.hp)+amount;uint8 cap=C.get(u.id).hp;
        u.hp=next>cap?cap:uint8(next);gained=u.hp-beforeHp;
        if(gained>0)_effect(s,mid,1,side,actor,target,beforeHp,u.hp,0);
    }

    function _shield(T.State memory s,uint8 target,uint8 amount,uint8 side,uint8 actor,bytes32 mid) private {
        T.Unit memory u=s.units[target];if(u.hp==0)return;
        uint8 beforeShield=u.shield;uint16 next=uint16(u.shield)+amount;u.shield=next>24?24:uint8(next);
        if(u.shield!=beforeShield)_effect(s,mid,2,side,actor,target,beforeShield,u.shield,0);
    }

    function _recover(T.State memory s,uint8 side,uint8 amount,bool combo,uint8 actor,bytes32 mid) private {
        uint8 beforeAP=s.ap[side];uint8 gained=amount>6-beforeAP?6-beforeAP:amount;s.ap[side]+=gained;
        if(combo)s.comboRefund[side]+=gained;
        if(gained>0)_effect(s,mid,5,side,actor,255,beforeAP,s.ap[side],0);
    }

    function _charge(T.State memory s,uint8 g,bytes32 mid) private {
        T.Unit memory u=s.units[g];uint8 max=C.get(u.id).requiredCasts;
        if(!u.ult&&u.ultimateCharge<max){uint8 old=u.ultimateCharge;u.ultimateCharge++;_effect(s,mid,4,g/4,g%4,g,old,u.ultimateCharge,0);}
    }

    function _lowest(T.State memory s,uint8 side) private pure returns(uint8 best){
        best=255;
        for(uint8 i=side*4;i<side*4+4;i++)if(s.units[i].hp>0){
            if(best==255||uint16(s.units[i].hp)*C.get(s.units[best].id).hp<uint16(s.units[best].hp)*C.get(s.units[i].id).hp)best=i;
        }
    }

    function _win(T.State memory s) private pure returns(bool){
        if(s.winner!=0)return true;bool a;bool b;
        for(uint8 i;i<4;i++){a=a||s.units[i].hp>0;b=b||s.units[4+i].hp>0;}
        if(!a||!b){s.winner=a?1:b?2:3;return true;}return false;
    }

    function _pre(T.State memory s,T.Unit memory u) private pure returns(uint8 p){
        if(u.electric)p|=1;if(u.vulnerable)p|=2;if(u.burn>=s.round)p|=4;if(_frozen(s,u))p|=8;if(u.frozen>=s.round)p|=16;
    }

    function _status(T.State memory s,uint8 side,uint8 actor,uint8 target,uint8 key,uint8 root,Events memory es,bytes32 mid) private {
        T.Unit memory u=s.units[target];if(u.hp==0)return;bool old;
        if(key==0){old=u.electric;u.electric=true;u.electricUntil=s.round+1;}
        else if(key==1){old=u.vulnerable;u.vulnerable=true;u.vulnerableUntil=s.round+1;}
        else if(key==2){old=u.burn>=s.round;u.burn=s.round+1;u.burnSide=side;u.burnActor=actor;}
        else{old=u.frozen>=s.round;if(old)return;u.frozen=s.round+1;}
        _effect(s,mid,3,side,actor,target,old?1:0,1,key);
        if(!old){Evt memory e;e.typ=1;e.side=side;e.actor=actor;e.target=target;e.key=key;e.root=root;_addEvent(es,e);}
    }

    function _consume(Events memory es,uint8 side,uint8 actor,uint8 target,uint8 key,uint8 root) private pure {
        Evt memory e;e.typ=2;e.side=side;e.actor=actor;e.target=target;e.key=key;e.root=root;_addEvent(es,e);
    }

    function _damage(T.State memory s,uint8 g,uint8 target,uint16 base,uint8 element,uint8 action,uint8 root,bool main,Events memory es,bytes32 mid) private returns(Evt memory e){
        T.Unit memory u=s.units[target];e.side=g/4;e.actor=g%4;e.target=target;e.action=action;e.element=element;e.root=root;
        if(u.hp==0)return e;
        uint8 id=s.units[g].id;e.pre=_pre(s,u);
        uint8 offset=_ledger(e.side,target,0);
        for(uint8 k;k<5;k++)e.prior[k]=_popcount(s.hits[offset+k]);
        e.priorUnion=_popcount(s.hits[offset+2]|s.hits[offset+4]);
        uint16 n=base;
        if(action!=6){
            if((action==1&&id==8||action==2&&id==4)&&(e.pre&4)!=0)n+=2;
            if(action==2&&id==9&&(e.pre&8)!=0)n+=2;
            if((id==14&&(action==1||action==2))||(id==31&&action==1)){
                uint8 el=id==14?2:4;uint8 needed=action==2?2:1;if(e.prior[el]>=needed)n+=action==2?2:1;
            }
            if((element!=0||action==1&&id==11)&&u.electric){
                n+=action==1&&id==26?3:2;u.electric=false;_consume(es,e.side,e.actor,target,0,root);_effect(s,mid,3,e.side,e.actor,target,1,0,0);
            }else if(u.vulnerable){
                n+=action==1&&(id==1||id==10)?3:2;u.vulnerable=false;_consume(es,e.side,e.actor,target,1,root);_effect(s,mid,3,e.side,e.actor,target,1,0,1);
            }
            if((action==1||action==2)&&main&&s.link[e.side]>0){n++;s.link[e.side]=0;}
        }
        bool blocked=n>0&&u.barrier;uint8 absorbed;uint8 loss;uint8 beforeHP=u.hp;
        if(blocked){u.barrier=false;_effect(s,mid,3,e.side,e.actor,target,1,0,4);}
        else{absorbed=n>u.shield?u.shield:uint8(n);u.shield-=absorbed;uint16 rest=n-absorbed;loss=rest>u.hp?u.hp:uint8(rest);u.hp-=loss;}
        e.effective=absorbed>0||loss>0;e.hpLoss=loss;
        if(e.effective)s.hits[_ledger(e.side,target,element)]|=uint128(1)<<root;
        uint8 maxHP=C.get(u.id).hp;
        e.half=uint16(beforeHP)*2>maxHP&&uint16(u.hp)*2<=maxHP&&!u.crossedHalf;
        if(e.half)u.crossedHalf=true;
        if(u.hp==0){u.ready.active=false;u.crystalCharges=0;u.focusUntil=0;u.vocalist=0;}
        _addEvent(es,e);
        emit BattleDamage(mid,s.seq,s.round,e.side,e.actor,target,action,element,base,n-base,blocked,absorbed,beforeHP,loss);
    }

    function _eligible(T.State memory s,uint8 g) private pure returns(bool){T.Unit memory u=s.units[g];return u.hp>0&&!_frozen(s,u)&&!u.comboTriggered;}

    function _trigger(T.State memory s,uint8 g,uint8 target,uint8 actor,uint8 side,uint8 root,bytes32 mid) private {
        if(!_eligible(s,g)||s.units[target].hp==0)return;
        T.Unit memory u=s.units[g];u.comboTriggered=true;u.ready=T.Ready(true,target,actor,side,root);
        _effect(s,mid,6,g/4,g%4,target,0,1,0);
    }

    function _process(T.State memory s,Events memory es,bytes32 mid) private {
        for(uint8 g;g<8;g++)if(s.units[g].ready.active&&s.units[s.units[g].ready.target].hp==0){s.units[g].ready.active=false;s.units[g].combo=true;}
        if(_win(s)){_effect(s,mid,8,2,255,255,0,s.winner,0);return;}
        for(uint8 ei;ei<es.count;ei++){
            Evt memory e=es.list[ei];bool hit=e.typ==0&&e.effective;bool normal=hit&&e.action==0;
            if(normal){
                for(uint8 i;i<4;i++){
                    uint8 g=e.side*4+i;T.Unit memory crystal=s.units[g];
                    if(crystal.id!=19||crystal.hp==0||_frozen(s,crystal)||crystal.crystalCharges==0||crystal.crystalUntil<s.round)continue;
                    uint8 low=_lowest(s,e.side);
                    if(low<8&&_heal(s,low,1,e.side,i,mid)>0){
                        crystal.crystalCharges--;
                        if(crystal.crystalCharges==0)_trigger(s,g,low,e.actor,e.side,e.root,mid);
                    }
                }
            }
            if(s.units[e.target].hp==0)continue;
            for(uint8 side;side<2;side++)for(uint8 i;i<4;i++){
                uint8 g=side*4+i;if(!_eligible(s,g))continue;T.Unit memory u=s.units[g];uint8 id=u.id;
                bool yes;bool fresh=e.typ==1;bool consume=e.typ==2;
                bool elemental=fresh&&(e.key==0||e.key==2||e.key==3);
                if(e.side==side){
                    uint8 off=_ledger(side,e.target,0);
                    if(id==1)yes=hit&&e.action==6&&e.actor!=i;
                    else if(id==2)yes=fresh&&e.key==1;
                    else if(id==3)yes=normal;
                    else if(id==4||id==13)yes=elemental;
                    else if(id==5)yes=normal&&(e.pre&23)==0;
                    else if(id==8)yes=fresh&&e.key==2;
                    else if(id==9)yes=normal&&(e.pre&8)!=0;
                    else if(id==10)yes=normal&&(e.pre&2)!=0;
                    else if(id==11)yes=(fresh||consume)&&e.key==0;
                    else if(id==12)yes=hit&&e.half;
                    else if(id==14)yes=hit&&e.prior[2]<2&&_popcount(s.hits[off+2])>=2;
                    else if(id==15)yes=consume&&e.key==1;
                    else if(id==16)yes=consume;
                    else if(id==17||id==26)yes=normal&&(e.pre&1)!=0;
                    else if(id==18)yes=hit&&e.prior[0]<3&&_popcount(s.hits[off])>=3;
                    else if(id==20)yes=fresh&&u.focusUntil>=s.round&&u.focusTarget==e.target;
                    else if(id==22)yes=fresh&&e.key==3;
                    else if(id==23)yes=hit&&(e.element==2||e.element==4)&&e.priorUnion<2&&_popcount(s.hits[off+2]|s.hits[off+4])>=2;
                    else if(id==24)yes=hit&&e.element==2;
                    else if(id==25)yes=fresh&&s.units[e.target].vulnerable&&(s.units[e.target].electric||s.units[e.target].burn>=s.round||s.units[e.target].frozen>=s.round);
                    else if(id==27)yes=consume&&e.key==2;
                    else if(id==28)yes=hit&&e.prior[0]<2&&_popcount(s.hits[off])>=2;
                    else if(id==29)yes=u.vocalist>=s.round&&(elemental||consume&&(e.key==0||e.key==2));
                    else if(id==30){uint8 n;if(s.hits[off+1]!=0)n++;if(s.hits[off+2]!=0)n++;if(s.hits[off+3]!=0)n++;yes=hit&&(e.element==4||n>=2);}
                    else if(id==31)yes=hit&&e.prior[4]<2&&_popcount(s.hits[off+4])>=2;
                }else if(hit&&e.hpLoss>0&&e.target/4==side){
                    if(id==6)yes=uint16(s.units[e.target].hp)*100<uint16(C.get(s.units[e.target].id).hp)*60;
                    else if(id==7||id==32)yes=true;
                    else if(id==21)yes=uint16(s.units[e.target].hp)*100<uint16(C.get(s.units[e.target].id).hp)*40;
                }
                if(yes)_trigger(s,g,e.target,e.actor,e.side,e.root,mid);
            }
        }
    }

    function _comboAmount(uint8 id) private pure returns(uint8){
        bytes memory a=hex"0202010101000103030201010103010103030001000102020302010201010300";return uint8(a[id-1]);
    }

    function _combo(T.State memory s,uint8 side,uint8 i,bytes32 mid) private {
        uint8 g=side*4+i;T.Unit memory u=s.units[g];
        require(u.hp>0&&!_frozen(s,u)&&u.ready.active,"combo");
        T.Ready memory r=u.ready;u.ready.active=false;u.combo=true;
        if(s.units[r.target].hp==0)return;
        uint8 id=u.id;Events memory es;uint8 amount=_comboAmount(id);Evt memory hit;
        if(amount>0){
            uint8 target=id==7?(1-side)*4+r.actor:r.target;
            uint8 element=C.get(id).element;if(id==7||id==11||id==12||id==16||id==22)element=0;
            if(s.units[target].hp>0)hit=_damage(s,g,target,amount,element,6,r.root,false,es,mid);
        }
        if(amount>0&&s.units[hit.target].hp>0){
            if(id==1||id==13||id==22||id==30)_status(s,side,i,hit.target,1,r.root,es,mid);
            else if(id==3||id==20)_status(s,side,i,hit.target,0,r.root,es,mid);
            else if(id==4)_status(s,side,i,hit.target,2,r.root,es,mid);
        }
        if(id==5||id==29){uint8 low=_lowest(s,side);if(low<8)_heal(s,low,2,side,i,mid);}
        if(id==6)_heal(s,r.target,3,side,i,mid);
        if(id==7)_heal(s,r.target,1,side,i,mid);
        if(id==19||id==21)_shield(s,r.target,3,side,i,mid);
        if(id==32){_heal(s,r.target,1,side,i,mid);_shield(s,r.target,1,side,i,mid);}
        if(id==10){s.link[side]=1;s.linkUntil[side]=s.round+1;_effect(s,mid,3,side,i,255,0,1,8);}
        _charge(s,g,mid);if(C.get(id).role==5)_recover(s,side,1,true,i,mid);
        if(id==28)_shield(s,g,1,side,i,mid);
        _process(s,es,mid);
    }

    function _active(T.State memory s,uint8 side,T.Input memory x,bytes32 mid) private {
        uint8 g=side*4+x.actor;T.Unit memory u=s.units[g];T.Stats memory c=C.get(u.id);uint8 id=u.id;
        uint8 action=x.kind;uint8 root=++s.root;Events memory es;u.acted=true;bool refund;
        if(action==1||action==2){
            if(action==1){s.ap[side]-=2;_effect(s,mid,5,side,x.actor,255,s.ap[side]+2,s.ap[side],0);}
            uint8 card=_takeHand(s,side,_handIndex(s.decks[side],1+x.actor*2+(action==2?1:0)));
            if(action==2){s.decks[side].removed[s.decks[side].removedCount++]=card;u.ult=true;uint8 old=u.ultimateCharge;u.ultimateCharge-=c.requiredCasts;_effect(s,mid,4,side,x.actor,g,old,u.ultimateCharge,0);}
            else _discard(s,side,card);
        }
        uint8 effect=action==1?c.skillEffect:c.ultimateEffect;uint8 value=action==1?c.skillValue:c.ultimateValue;
        uint8 r=action==0?c.normalRange:action==1?c.skillRange:c.ultimateRange;
        if(action==3)_shield(s,g,4,side,x.actor,mid);
        else if(action!=0&&effect!=0){
            uint8 ally=side*4+x.ally;
            if(id==12&&action==1)refund=uint16(s.units[ally].hp)*2<=C.get(s.units[ally].id).hp&&s.units[ally].shield<24&&value>0;
            for(uint8 i;i<4;i++)if(r==5||i==x.ally){uint8 target=side*4+i;if(effect==1)_heal(s,target,value,side,x.actor,mid);else _shield(s,target,value,side,x.actor,mid);}
            if(action==1&&(id==6||id==21||id==32))_shield(s,ally,12,side,x.actor,mid);
            if(action==2&&(id==6||id==21))_heal(s,g,4,side,x.actor,mid);
            if(action==2&&(id==5||id==19))_shield(s,ally,id==5?3:5,side,x.actor,mid);
            if(id==19&&action==1){u.crystalCharges=2;u.crystalUntil=s.round+1;_effect(s,mid,3,side,x.actor,g,0,2,5);}
            if(id==29){u.vocalist=s.round+1;_effect(s,mid,3,side,x.actor,g,0,1,7);}
        }else{
            Evt[4] memory results;bool[4] memory present;
            for(uint8 i;i<4;i++){
                if(!(r==3||r==2&&i<2||r!=2&&r!=3&&i==x.target)||s.units[(1-side)*4+i].hp==0)continue;
                uint8 target=(1-side)*4+i;
                results[i]=_damage(s,g,target,action==0?c.atk:value,action==2?c.ultimateElement:c.element,action,root,i==x.target,es,mid);present[i]=true;
            }
            if(action==1||action==2)for(uint8 i;i<4;i++)if(present[i]){
                Evt memory hit=results[i];if(s.units[hit.target].hp==0)continue;
                if(action==1){
                    if(id==2||id==13||id==16||id==18||id==24||id==28||id==30)_status(s,side,x.actor,hit.target,1,root,es,mid);
                    if(id==3)_status(s,side,x.actor,hit.target,0,root,es,mid);
                    if(id==4||id==25)_status(s,side,x.actor,hit.target,2,root,es,mid);
                    if(id==9||id==22)_status(s,side,x.actor,hit.target,3,root,es,mid);
                    if(id==20){u.focusTarget=hit.target;u.focusUntil=s.round+1;_effect(s,mid,3,side,x.actor,hit.target,0,1,6);_status(s,side,x.actor,hit.target,0,root,es,mid);}
                    if(id==27&&(hit.pre&4)!=0){s.units[hit.target].burn=0;_consume(es,side,x.actor,hit.target,2,root);_effect(s,mid,3,side,x.actor,hit.target,1,0,2);}
                }else{
                    if(id==1||id==25||i==x.target&&(id==13||id==22||id==30))_status(s,side,x.actor,hit.target,1,root,es,mid);
                    if(i==x.target&&(id==3||id==17||id==20||id==26))_status(s,side,x.actor,hit.target,0,root,es,mid);
                    if(id==8||id==27)_status(s,side,x.actor,hit.target,2,root,es,mid);
                    if(i==x.target&&id==24)_status(s,side,x.actor,hit.target,3,root,es,mid);
                }
            }
            if(id==7&&action==1){_shield(s,g,5,side,x.actor,mid);_shield(s,side*4+x.ally,12,side,x.actor,mid);}
            if(id==7&&action==2)_shield(s,g,8,side,x.actor,mid);
            if(id==28&&(action==1||action==2))_shield(s,g,action==1?3:4,side,x.actor,mid);
            if(id==32&&action==2)_heal(s,g,5,side,x.actor,mid);
        }
        if(action==1){
            for(uint8 ei;ei<es.count;ei++)if(es.list[ei].typ==2){uint8 k=es.list[ei].key;if(id==11&&k==0||id==15&&k==1||id==16&&(k==0||k==1)||id==27&&k==2)refund=true;}
            _charge(s,g,mid);
        }
        if((action==1||action==2)&&c.role==5&&(action==2||refund))_recover(s,side,action==2?2:1,false,x.actor,mid);
        _advance(s,side);_process(s,es,mid);
    }

    function _advance(T.State memory s,uint8 side) private pure {
        s.actions[side]--;s.turns++;
        if(s.actions[0]==0&&s.actions[1]==0){s.roundPending=true;s.priority=2;}
        else s.priority=s.actions[1-side]>0?1-side:side;
    }

    function _discard(T.State memory s,uint8 side,uint8 card) private pure {T.Deck memory d=s.decks[side];require(d.discardCount<12,"discard");d.discard[d.discardCount++]=card;}

    function _takeHand(T.State memory s,uint8 side,uint8 index) private pure returns(uint8 card){
        T.Deck memory d=s.decks[side];require(index<d.handCount,"hand");card=d.hand[index];
        for(uint8 i=index;i+1<d.handCount;i++)d.hand[i]=d.hand[i+1];d.hand[--d.handCount]=0;
    }

    function _handIndex(T.Deck memory d,uint8 card) private pure returns(uint8){for(uint8 i;i<d.handCount;i++)if(d.hand[i]==card)return i;return 255;}
}
