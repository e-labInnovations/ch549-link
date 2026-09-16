# Licensing

This project is **MIT** (see `LICENSE`), with two exceptions that carry their own
terms. Both are honoured in-tree; nothing here is relicensed.

| Path | Licence | Why |
|---|---|---|
| everything not listed below | MIT | project code |
| `web/src/isp.js` | **GPL-3.0** | derived from [isp55e0](https://github.com/frank-zago/isp55e0) |
| `firmware/common/USB*.{c,h}`, `firmware/common/usbCommonDescriptors/`, `firmware/common/include/` | **LGPL-2.1** | vendored unmodified from [ch55xduino](https://github.com/DeqingSun/ch55xduino) |
| `vendor-firmware/*.bin` | WCH proprietary | see `vendor-firmware/README.md` |

## web/src/isp.js — GPL-3.0

The WCH ISP protocol implementation was written by working from isp55e0's source:
packet framing, the XOR key derivation, the 56-byte chunking and the
erase/write/verify sequence. Protocol facts are not copyrightable, but the
derivation is close enough that claiming a clean-room implementation would be
dishonest. It is therefore GPL-3.0, as its parent is.

It is a separate program from the firmware — the web flasher and the firmware do
not link together — so this does not affect the MIT licensing of the rest.

## firmware/common — LGPL-2.1

The USB-CDC stack and CH549 headers are vendored **unmodified** from ch55xduino.
LGPL-2.1 requires that users can modify the library and rebuild the work using it.
That holds here: the sources are in this repository and `make firmware` rebuilds
everything from them.

## firmware/swio — MIT

The SWIO implementation is a port of
[arduino-ch32v003-swio](https://gitlab.com/BlueSyncLine/arduino-ch32v003-swio),
which is **MIT No Attribution** — it imposes no conditions, so the port is MIT.
Attribution is given anyway, because it is the work this project rests on.
