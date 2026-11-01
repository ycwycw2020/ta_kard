"""Offline verification of delivered 4K/original art and its SHA-256 manifest."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT, help='Root containing game/assets (default: repository)')
    parser.add_argument('--require-native',action='store_true')
    args=parser.parse_args()
    manifest=json.loads((ROOT/'docs/asset-manifest.json').read_text('utf-8'))
    checked, optional, errors = 0, 0, []
    for item in manifest['files']:
        file=args.root/item['path']
        native='/native/' in item['path'] or item['path'].endswith('-native.png')
        if native and not args.require_native and not file.exists():
            optional+=1
            continue
        if not file.is_file() or file.stat().st_size!=item['size']:
            errors.append(item['path']+' missing or wrong size')
            continue
        h=hashlib.sha256()
        with file.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):
                h.update(chunk)
        if h.hexdigest()!=item['sha256']:
            errors.append(item['path']+' hash mismatch')
        else:
            checked+=1
    print(json.dumps({'passed':not errors,'verified':checked,'optionalNativeAbsent':optional,'errors':errors},ensure_ascii=False,indent=2))
    raise SystemExit(bool(errors))

if __name__=='__main__':
    main()
