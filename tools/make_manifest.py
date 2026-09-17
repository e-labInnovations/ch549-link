#!/usr/bin/env python3
"""Assemble the web flasher payload: firmware images + manifest.json.

Copies built firmware and vendor blobs into the output directory and writes a
manifest the web UI reads, so adding a debugger is a data change rather than a
UI change.

  python3 tools/make_manifest.py --out dist
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import sys
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Our debuggers, built from source by firmware/Makefile.
BUILT = [
    {
        "id": "swio",
        "name": "SWIO debugger (CH32V003)",
        "description": "Single-wire debugger. Enumerates as USB-CDC and speaks the "
                       "ardulink protocol, so minichlink drives it unmodified.",
        "src": "firmware/swio/build/swio.bin",
        "targets": ["CH32V003"],
        "usage": "minichlink -C ardulink -c /dev/ttyACM0 -w prog.bin flash -b",
    },
]

# WCH's own images. NOT buildable - redistributed, see vendor-firmware/README.md.
#
# CRITICAL: only the *_APP_IAP_* images are complete from address 0 and can go
# through the factory ISP bootloader. The FIRMWARE_*.bin images are app-only,
# written by WCH's own IAP loader at offset 0xC00; flashing one over ISP would
# install an app with no loader in front of it. Proven by byte comparison:
#   WCH-Link_APP_IAP_XXX.bin == [3072-byte IAP loader] + FIRMWARE_XXX.bin
VENDOR = [
    {
        "id": "wch-riscv",
        "name": "Stock WCH-Link — RISC-V mode",
        "description": "Official WCH firmware. Programs CH32V10x/20x/30x and CH57x. "
                       "Does NOT support CH32V003.",
        "src": "vendor-firmware/WCH-Link_APP_IAP_RV.bin",
        "method": "isp",
        "targets": ["CH32V10x", "CH32V20x", "CH32V30x"],
    },
    {
        "id": "wch-arm",
        "name": "Stock WCH-Link — ARM / CMSIS-DAP mode",
        "description": "Official WCH firmware. ARM SWD debugging plus a USB serial port.",
        "src": "vendor-firmware/WCH-Link_APP_IAP_ARM.bin",
        "method": "isp",
        "targets": ["ARM Cortex-M (SWD)"],
    },
    {
        "id": "wch-riscv-app",
        "name": "WCH RISC-V app image (IAP only)",
        "description": "App-only image for WCH's IAP path. Cannot be flashed over ISP - "
                       "listed for completeness only.",
        "src": "vendor-firmware/FIRMWARE_CH549.bin",
        "method": "iap",
        "targets": [],
    },
    {
        "id": "wch-arm-app",
        "name": "WCH ARM app image (IAP only)",
        "description": "App-only image for WCH's IAP path. Cannot be flashed over ISP - "
                       "listed for completeness only.",
        "src": "vendor-firmware/FIRMWARE_DAP_CH549.bin",
        "method": "iap",
        "targets": [],
    },
]


def add(entry, source, out_dir, missing):
    src = ROOT / entry["src"]
    if not src.exists():
        missing.append(entry["src"])
        return None
    data = src.read_bytes()
    name = f"{entry['id']}.bin"
    (out_dir / "firmware").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, out_dir / "firmware" / name)
    return {
        "id": entry["id"],
        "name": entry["name"],
        "description": entry["description"],
        "file": f"firmware/{name}",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "source": source,
        "method": entry.get("method", "isp"),
        "targets": entry.get("targets", []),
        **({"usage": entry["usage"]} if "usage" in entry else {}),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dist")
    ap.add_argument("--strict", action="store_true",
                    help="fail if any listed image is missing")
    args = ap.parse_args()

    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    # web assets (skip .DS_Store and friends)
    ignore = shutil.ignore_patterns(".*")
    for item in (ROOT / "web").iterdir():
        if item.name.startswith("."):
            continue
        dst = out_dir / item.name
        if item.is_dir():
            shutil.copytree(item, dst, dirs_exist_ok=True, ignore=ignore)
        else:
            shutil.copyfile(item, dst)

    missing, firmwares = [], []
    for e in BUILT:
        r = add(e, "built", out_dir, missing)
        if r:
            firmwares.append(r)
    for e in VENDOR:
        r = add(e, "vendor", out_dir, missing)
        if r:
            firmwares.append(r)

    if missing:
        print("missing images:", file=sys.stderr)
        for m in missing:
            print(f"  {m}", file=sys.stderr)
        if args.strict:
            return 1

    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "bootloader": {"vendorId": "0x4348", "productId": "0x55e0"},
        "firmwares": firmwares,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"wrote {out_dir}/manifest.json with {len(firmwares)} image(s)")
    for f in firmwares:
        flag = "" if f["method"] == "isp" else "  [IAP only, not offered]"
        print(f"  {f['id']:<16} {f['size']:>7} B  {f['source']}{flag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
