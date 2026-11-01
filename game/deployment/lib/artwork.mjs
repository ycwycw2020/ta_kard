import fs from 'node:fs';
import path from 'node:path';

export function artworkAvailable(tokenId,root=path.resolve('../assets/cards')) {
  if(!Number.isInteger(tokenId))return false;
  const id=Math.floor(tokenId/100),skin=tokenId%100-1;
  if(id<1||id>32||skin<0||skin>17)return false;
  const stem=`c${String(id).padStart(2,'0')}-s${String(skin).padStart(2,'0')}`;
  return [path.join(root,'display',stem+'.webp'),path.join(root,'4k',stem+'.png')]
    .every(file=>{try{const s=fs.statSync(file);return s.isFile()&&s.size>0;}catch{return false;}});
}

// Publish only complete pairs: the game thumbnail and the ERC-1155 4K image.
export function readAvailableArtwork(root=path.resolve('../assets/cards')) {
  return fs.readdirSync(path.join(root,'display')).flatMap(name=>{
    const m=/^c(\d{2})-s(\d{2})\.webp$/.exec(name);
    if(!m)return [];
    const id=Number(m[1]),skin=Number(m[2]);
    if(id<1||id>32||skin>17)return [];
    if(!artworkAvailable(id*100+skin+1,root))return [];
    return [id*100+skin+1];
  }).sort((a,b)=>a-b);
}
