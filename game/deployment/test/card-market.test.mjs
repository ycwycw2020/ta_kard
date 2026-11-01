import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,toUtf8Bytes} from 'ethers';
import {cardNumber,verifyCardNumber,parseMarketPrice} from '../web/market.mjs';
test('16 digit QCCC + random8 + Keccak decimal checksum4',()=>{
 for(const prefix of ['1001','2032','3019']){
  const front=prefix+'00012345',last=(BigInt(keccak256(toUtf8Bytes(front)))%10000n).toString().padStart(4,'0'),id=front+last;
  assert.equal(cardNumber(id),id);assert.equal(id.length,16);assert.equal(verifyCardNumber(id),true);
  assert.equal(verifyCardNumber(front+((Number(last)+1)%10000).toString().padStart(4,'0')),false);
 }
 for(const bad of ['0001000123451234','4001000123451234','1000000123451234','1033000123451234','abc',123])assert.equal(verifyCardNumber(bad),false);
});
test('seller sets exact positive TEST ETH prices without a preset price list',()=>{
 assert.equal(parseMarketPrice('0.000000000000000001'),1n);
 assert.equal(parseMarketPrice('17.123456789123456789'),17123456789123456789n);
 for(const bad of ['0','-1','1e3','01','1.0000000000000000001','1,000','NaN','Infinity',''])assert.throws(()=>parseMarketPrice(bad));
});
