# How it works

## The problem

The CH32V003 is debugged over **1-wire SWIO** on `PD1`. There is no clock pin.
WCH-Link firmware for the CH549 only implements **2-wire SDI** (`SWDIO` + `SWCLK`),
which is why the vendor marks CH32V003 unsupported on this hardware.

That was verified rather than assumed. In RISC-V mode the stock firmware *accepts*
`CHIP_CH32V003` (0x09) via `81 0c 02 09 <speed>` and replies `82 0c 01 01` — which
looks like recognition. It is not: **every** byte gets the same reply, valid or
nonsense. The firmware rubber-stamps the chip type. Attach then fails identically for
1-wire and 2-wire parts.

## The fix

Replace the firmware. The CH549 is an E8051 at **48 MHz** — 20.8 ns per cycle, which
is **3× finer** than the 16 MHz AVR that already bit-bangs SWIO successfully. Speed
was never the obstacle.

`firmware/swio/swio.c` is a port of
[arduino-ch32v003-swio](https://gitlab.com/BlueSyncLine/arduino-ch32v003-swio),
bit-banging `P1.1`.

## Pin mapping

From WCH's own WCH-LINK reference schematic (CH549G, SOP-16):

| Pin | Name | Net |
|---|---|---|
| 1 | `P1.1/T2EX/CAP2/AIN1` | `D_SWDIO` → R2 → SWDIO pad |
| 2 | `P1.4` | `D_SWCLK` → R1 → SWCLK pad |
| 4 | `P1.6` | `LED_RUN` |
| 5 | `P1.7` | `LED_CON` |
| 7 / 8 | `P3.0` / `P3.1` | UART RX / TX |
| 12 / 13 | `P5.1/DP` / `P5.0/DM` | USB |

`P1.1` also carries **Timer2 capture (`CAP2`)** — unused so far, but it means receive
edges could be timed in hardware rather than by counted nops.

## Signal timing

```
T = 1 / 8 MHz = 125 ns
short pulse:  T-4T  low   (125-500 ns)
long pulse:  6T-64T low   (750 ns - 8 us)
between bits:  T-16T high (125 ns - 2 us)
```

Measured on-chip with Timer0 clocked at Fsys:

| | total | low phase | in T |
|---|---|---|---|
| short | 28 cyc (583 ns) | ~10 cyc (208 ns) | 1.7T |
| long | 70 cyc (1458 ns) | ~50 cyc (1042 ns) | 8.3T |
| inter-bit high | — | ~18 cyc (375 ns) | 3T |

A `nop` is exactly 1 cycle at 48 MHz.

### Bit polarity is inverted relative to the reference's comment

In the original `swio.c`, `swio_send_one()` emits the **short** pulse and
`swio_send_zero()` the **long** one — the opposite of the comment block above them.
The implementation is what works. Do not "fix" it.

### Drive modes

Transmit is **push-pull**, so both edges are actively driven. Only the receive window
switches to **open-drain + pull-up** so the target can pull low, and `recv_bit`
actively precharges high before releasing. `P1_MOD_OC` selects the mode:

```
Pn_MOD_OC=0, Pn_DIR_PU=1  ->  push-pull
Pn_MOD_OC=1, Pn_DIR_PU=1  ->  open-drain + pull-up
```

### Sample delay must be MINIMAL

The delay between releasing the line and sampling it is the parameter that decides
whether this works at all:

| delay | result |
|---|---|
| **minimum** | works |
| +2 nops | corrupt reads |
| more | no link at all |

The target drives each bit low only briefly then releases. Sampling late reads the
line already back high, giving `0xffffffff`. **If you see all-ones, you are sampling
too late, not too early.**

Keep the receive path free of function calls — an `LCALL`/`RET` plus a switch costs
tens of cycles and breaks the link at every setting.

## USB

The USB-CDC stack is vendored from ch55xduino. SWIO is cycle-counted, so an interrupt
mid-bit would corrupt a frame: `EA = 0` at the start of each transaction and `EA = 1`
at the end. A 32-bit transaction is ~70 µs of interrupts-off, which USB tolerates
because the hardware NAKs on its own and the host retries.

`delayMicroseconds()` **must be accurate**. `USBSerial_write()` waits on a busy flag
using `delayMicroseconds(5)` up to 50000 times for a nominal 250 ms timeout. If the
delay is too short the wait expires early, returns 0 and **silently drops the byte** —
which shifts the whole reply stream and produces plausible but wrong values.

## Gotchas

| Gotcha | Detail |
|---|---|
| **1 kΩ pull-up is required** | Without it: garbage IDs, failed writes. Verified by removing and refitting |
| **Reading flash halts the CPU** | After `-r` the target stays halted. Finish with `minichlink -b` |
| Bootloader entry | Button must be held **as power arrives** — D+ pull-up is sampled only at reset |
| Use `ch5xx.h`, not `CH549.H` | `CH549.H` is Keil syntax and fails under every SDCC `--std-` setting |
| `--model-small` | `--model-large` pushes locals to xdata and slows the SWIO loop |
| `<stdint.h>` before `ch5xx_usb.h` | otherwise `syntax error: token -> 'uint8_t'` |
| `EP*_ADDR` | not defined in any source; passed as `-D`, values from ch55xduino's `boards.txt` |
| Board state | `4348:55e0` = bootloader; `1209:c550` = our firmware; nothing = unpowered |
