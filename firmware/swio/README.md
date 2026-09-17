# swio — CH32V003 debugger

Single-wire (SWIO) debugger for the CH32V003. Enumerates as USB-CDC and speaks
the [ardulink][ardulink] protocol, so stock `minichlink` drives it unmodified.

[ardulink]: https://gitlab.com/BlueSyncLine/arduino-ch32v003-swio

```bash
minichlink -C ardulink -c /dev/ttyACM0 -i
minichlink -C ardulink -c /dev/ttyACM0 -w prog.bin flash -b
```

⚠️ Reading flash halts the target and leaves it halted. Finish with
`minichlink -b` or your program will not run.

## Wiring

```
CH549 P1.1 ──┬── SWDIO pad ── CH32V003 PD1
             │
            1kΩ        ← required, not optional
             │
           +3.3V
```

`SWCLK` stays unconnected — the CH32V003 has no clock pin. Slide switch to
**3V3**; the CH549 drives 3.3 V logic.

## Files

| File | Job |
|---|---|
| `main.c` | ardulink protocol state machine |
| `swio.{c,h}` | the wire protocol; timing macros are private to the `.c` |
| `debug.{c,h}` | bring-up commands, output on the UART |

## Protocol

| In | Out | |
|---|---|---|
| | `!` | emitted once when ready |
| `?` | `+` | test |
| `p` / `P` | `+` | target power (handled by the slide switch, so ignored) |
| `w` + addr + val[4] LE | `+` | write debug register |
| `r` + addr | val[4] LE | read debug register |
| `s` + n | `+` | set sample delay — bring-up only, see below |

Debug extensions, printed to the UART: `v` status, `m` measured pulse widths,
`d` debug-module probe, `l`/`h`/`o` park the line low/high/released.

## The one tunable

`s` sets the delay between releasing the line and sampling it. **0 is the only
value that works** and is the default. The target drives each bit low only
briefly before releasing, so sampling late reads the line already back high and
every register returns `0xffffffff`.

If you see all-ones, you are sampling too **late**, not too early.

## Background

Timing budget, measured cycle counts, drive-mode reasoning and the full list of
gotchas: [`docs/how-it-works.md`](../../docs/how-it-works.md).
