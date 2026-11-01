import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileTestWallet} from '../web/wallet-storage.mjs';
function storage(){const m=new Map([['talos-test-wallet-v1','old local test identity'],['unrelated','preserve']]);return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
test('explicit chain reset removes only the old game test wallet',()=>{const s=storage();assert.equal(reconcileTestWallet(s,'0x'+'ab'.repeat(32)),true);assert.equal(s.getItem('talos-test-wallet-v1'),null);assert.equal(s.getItem('unrelated'),'preserve');});
test('refreshing the same rebuilt chain retains a newly created wallet',()=>{const s=storage(),id='0x'+'ab'.repeat(32);reconcileTestWallet(s,id);s.setItem('talos-test-wallet-v1','new identity');assert.equal(reconcileTestWallet(s,id),false);assert.equal(s.getItem('talos-test-wallet-v1'),'new identity');});
test('ordinary deployments without an explicit reset leave identities alone',()=>{const s=storage();assert.equal(reconcileTestWallet(s,null),false);assert.equal(s.getItem('talos-test-wallet-v1'),'old local test identity');});
test('malformed reset identifier cannot delete a wallet',()=>{const s=storage();assert.throws(()=>reconcileTestWallet(s,'bad'));assert.equal(s.getItem('talos-test-wallet-v1'),'old local test identity');});
