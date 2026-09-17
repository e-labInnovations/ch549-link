#!/usr/bin/env python3
"""Serve the web flasher against a simulated CH549 bootloader.

Hardware is the bottleneck on this project, and the flasher's interesting
states - a successful flash, "write failed at offset N", an unsupported
browser - are all awkward to reach on a real board. This builds dist/ into a throwaway
directory, injects tools/mock-usb.js ahead of the app module, and serves it, so
every path can be walked in a browser with nothing plugged in.

  python3 tools/mockserve.py
  open http://localhost:8731/?flash=swio&delay=2

Query parameters are documented at the top of tools/mock-usb.js.

This is a development tool. Nothing it produces ends up in dist/ - mock-usb.js
lives in tools/, and make_manifest.py only copies web/.
"""
import argparse
import functools
import http.server
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP_SCRIPT = '<script type="module" src="./src/app.js">'
MOCK_SCRIPT = '<script src="./mock-usb.js"></script>\n'


def build(out: pathlib.Path) -> None:
    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "make_manifest.py"), "--out", str(out)],
        check=True,
    )

    shutil.copyfile(ROOT / "tools" / "mock-usb.js", out / "mock-usb.js")

    index = out / "index.html"
    html = index.read_text()
    if APP_SCRIPT not in html:
        raise SystemExit(
            f"cannot find {APP_SCRIPT!r} in index.html - update MOCK_SCRIPT injection"
        )
    index.write_text(html.replace(APP_SCRIPT, MOCK_SCRIPT + APP_SCRIPT))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8731)
    args = ap.parse_args()

    with tempfile.TemporaryDirectory(prefix="ch549-mock-") as tmp:
        out = pathlib.Path(tmp) / "site"
        build(out)

        handler = functools.partial(
            http.server.SimpleHTTPRequestHandler, directory=str(out)
        )
        server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)

        print(f"\nmock bootloader serving on http://localhost:{args.port}/")
        print("  ?flash=swio        board already runs the SWIO debugger")
        print("  ?flash=blank       erased board")
        print("  ?delay=2           slow the transfers down to watch progress")
        print("  ?failAt=2016       make the write fail at that offset")
        print("\nctrl-c to stop.\n")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
