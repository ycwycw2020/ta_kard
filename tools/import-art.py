"""Verify official release ZIP checksums and safely extract art into this repo."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archives', required=True, help='Directory containing release art ZIPs')
    args = parser.parse_args()
    manifest = json.loads((ROOT/'docs/asset-manifest.json').read_text('utf-8'))
    folder = Path(args.archives).resolve()
    imported = []
    for item in manifest['archives']:
        file = folder/item['name']
        if not file.exists():
            if '-native-' in file.name:
                print('Optional original archive absent:', file.name)
                continue
            raise SystemExit('Missing required archive: '+file.name)
        h = hashlib.sha256()
        with file.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):
                h.update(chunk)
        if file.stat().st_size != item['size'] or h.hexdigest() != item['sha256']:
            raise SystemExit('Archive checksum mismatch: '+file.name)
        with zipfile.ZipFile(file) as archive:
            for member in archive.infolist():
                dest = (ROOT/member.filename).resolve()
                if not dest.is_relative_to(ROOT) or not member.filename.startswith(('game/assets/','LICENSES/')):
                    raise SystemExit('Unsafe archive member rejected')
            archive.extractall(ROOT)
        imported.append(file.name)
        print('Imported:',file.name)
    print('Art import complete. Run python tools/verify-assets.py next.')

if __name__=='__main__':
    main()
