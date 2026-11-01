#!/usr/bin/env bash
set -euo pipefail
PACKAGE_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'This package requires x86_64 Linux.';exit 1; }
missing=()
for tool in curl tar xz sha256sum unzip;do command -v "$tool" >/dev/null || missing+=("$tool");done
if [[ ${#missing[@]} -gt 0 ]];then
 echo "Preparing missing system tools: ${missing[*]}"
 if command -v apt-get >/dev/null;then
  if [[ $EUID == 0 ]];then apt-get update;apt-get install -y curl ca-certificates tar xz-utils unzip coreutils
  else sudo apt-get update;sudo apt-get install -y curl ca-certificates tar xz-utils unzip coreutils;fi
 else echo 'Install curl, tar, xz, unzip and sha256sum, then run this installer again.';exit 1;fi
fi
if [[ -f "$PACKAGE_DIR/SHA256SUMS.txt" ]];then (cd -- "$PACKAGE_DIR" && sha256sum --check --quiet SHA256SUMS.txt);fi
NODE=''
for candidate in "$(command -v node || true)" "$HOME/talos/runtime/node-v24.19.0-linux-x64/bin/node" "${XDG_CACHE_HOME:-$HOME/.cache}/TalosCards/installer-runtime/node-v24.19.0-linux-x64/bin/node";do
 if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' 2>/dev/null;then NODE="$candidate";break;fi
done
if [[ -z "$NODE" ]];then
 CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/TalosCards/installer-runtime";mkdir -p "$CACHE"
 ARCHIVE="$CACHE/node-v24.19.0-linux-x64.tar.xz"
 HASH='14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647'
 if [[ ! -f "$ARCHIVE" ]] || ! echo "$HASH  $ARCHIVE" | sha256sum -c - >/dev/null 2>&1;then
  echo 'Preparing installer runtime…'
  curl --fail --location --retry 3 --connect-timeout 20 -o "$ARCHIVE.part-$$" 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz'
  echo "$HASH  $ARCHIVE.part-$$" | sha256sum -c -
  mv -- "$ARCHIVE.part-$$" "$ARCHIVE"
 fi
 tar -xJf "$ARCHIVE" -C "$CACHE"
 NODE="$CACHE/node-v24.19.0-linux-x64/bin/node"
fi
exec "$NODE" "$PACKAGE_DIR/install.mjs" install "$@"
