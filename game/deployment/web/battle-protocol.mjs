export const ACTION_KINDS=Object.freeze({attack:0,skill:1,ultimate:2,defend:3,item:4,pass:5,combo:6,cycle:7,round:8,surrender:9});
export const ITEM_IDS=Object.freeze({none:0,resource_cell:1,medkit:2,full_restore:3,barrier_generator:4,cleanser:5,reactivation:6});
export const isChainMatchId=id=>typeof id==='string'&&/^0x[0-9a-f]{64}$/i.test(id)&&!/^0x0{64}$/i.test(id);
export function encodeBattleAction(input){
 if(!Object.hasOwn(ACTION_KINDS,input.type))throw Error('未知链上行动');
 const seq=Number(input.expectedSeq);if(!Number.isSafeInteger(seq)||seq<0||seq>4294967295)throw Error('链上行动版本无效');
 const slot=(name,max=3)=>{const n=input[name]??0;if(!Number.isInteger(n)||n<0||n>max)throw Error('行动位置无效：'+name);return n;};
 return [seq,ACTION_KINDS[input.type],slot('actor'),slot('target'),slot('ally'),slot('hand',5)];
}
