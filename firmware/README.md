# Firmware

Each subdirectory is one debugger. They share `common/` and differ only in the
wire protocol they speak.

```
common/     board + clock, UART, USB-CDC wrapper, delay macros,
            and the vendored ch55xduino USB stack
swio/       CH32V003 single-wire debugger
```

## Building

```bash
make            # all debuggers
make -C swio    # just one
make docker     # from the repo root, no local SDCC needed
```

Output lands in `<debugger>/build/<name>.bin`, flashable with `isp55e0` or the
web flasher.

## Adding a debugger

1. `mkdir firmware/<name>` with `main.c`, the protocol as `<name>.{c,h}`, and:

   ```make
   TARGET := <name>
   SRC    := main.c <name>.c
   include ../common/common.mk
   ```

2. Add `<name>` to `DEBUGGERS` in `firmware/Makefile`.
3. Add an entry to `BUILT` in `tools/make_manifest.py` so the web flasher offers it.

No web UI changes are needed — it reads `manifest.json`.

## Rules that are not optional

**Keep function calls out of any per-bit path.** These protocols are timed by
counting instructions. An `LCALL`/`RET` pair costs tens of cycles and will break
the link — this already happened once, see `docs/how-it-works.md`.
Bit-level work belongs in macros, private to the protocol's `.c` file.

**Guard bit-banging with `EA = 0`** and restore `EA = 1` on the way out. USB runs
on interrupts; one firing mid-bit corrupts the frame.

**Build `--model-small`.** `--model-large` defaults locals to `xdata` and slows the
inner loops.

**Do not name a file so it differs from a vendored one only by case.**
`usbcdc.c` vs `USBCDC.c` silently resolves to the wrong file on macOS and Windows.
