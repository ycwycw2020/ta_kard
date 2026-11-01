import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readAvailableArtwork} from '../lib/artwork.mjs';

test('partial image deployment never advertises a broken card; complete variants are per character',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'talos-art-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('talos-art-'));
    fs.rmSync(root,{recursive:true,force:true});
  });
  for(const dir of ['display','4k'])fs.mkdirSync(path.join(root,dir));
  const put=(dir,name)=>fs.writeFileSync(path.join(root,dir,name),'fixture');
  put('display','c01-s01.webp'); // Missing 4K: remain unavailable.
  put('4k','c02-s11.png'); // Missing display image: remain unavailable.
  put('display','c32-s12.webp');put('4k','c32-s12.png');
  put('display','c00-s01.webp');put('4k','c00-s01.png');
  put('display','c01-s18.webp');put('4k','c01-s18.png');
  assert.deepEqual(readAvailableArtwork(root),[3213]);
  put('4k','c01-s01.png');put('display','c02-s11.webp');
  assert.deepEqual(readAvailableArtwork(root),[102,212,3213]);
});
