export function reconcileTestWallet(storage, resetId) {
 if(!resetId)return false;
 if(!/^0x[0-9a-fA-F]{64}$/.test(resetId))throw Error('无效的测试链重建标识');
 const marker='talos-wallet-reset-id';
 if(storage.getItem(marker)===resetId)return false;
 storage.removeItem('talos-test-wallet-v1');
 storage.setItem(marker,resetId);
 return true;
}
