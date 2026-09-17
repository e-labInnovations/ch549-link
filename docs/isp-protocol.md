# WCH ISP protocol (CH5xx / CH54x bootloader)

Reference for `web/src/isp.js`. Derived from
[isp55e0](https://github.com/frank-zago/isp55e0) (GPL-3.0).

## Device

```
VID:PID   4348:55e0
class     vendor specific
endpoints 0x02 OUT / 0x82 IN, bulk, 64 bytes
```

Entered by holding the board's button while power is applied.

## Framing

```
request   [cmd] [len_lo] [len_hi] [payload...]
response  [cmd] [_]      [len]    [_] [data...]
```

`len` in the request counts payload bytes only.

## Commands

| Cmd | Name | Payload |
|---|---|---|
| `0xa1` | CHIP_TYPE | `type`, `family`, `"MCU ISP & WCH.CN"` (16 B) |
| `0xa2` | REBOOT | `option` (1 B) |
| `0xa3` | SET_KEY | 30 bytes (content ignored); reply carries key checksum |
| `0xa4` | ERASE_CODE | `length` KiB (2 B LE), `_u1` (2 B) |
| `0xa5` | WRITE_CODE | `offset` (4 B LE), `_u1` (1 B), data (≤56 B, encrypted) |
| `0xa6` | VERIFY_CODE | same shape as WRITE_CODE |
| `0xa7` | READ_CONFIG | `what` (2 B LE, use `0x1f`) |
| `0xa8` | WRITE_CONFIG | `what` (2 B LE), `config_data` (12 B) |

CH549: `type = 0x49`, `family = 0x12`, code flash 61440 B, UID length 8.

## READ_CONFIG reply layout

Offsets are from the start of the 4-byte response header.

| Offset | Size | Field |
|---|---|---|
| 4 | 2 | `what` (echo) |
| 6 | 12 | `config_data` |
| 18 | 4 | bootloader version, **big endian** |
| 22 | 8 | chip UID (7 bytes + checksum byte) |

## Encryption

Flash payloads are XOR-obfuscated with an 8-byte key derived from the UID:

```
sum = (sum of all UID bytes) & 0xff
key[0..7] = sum
key[7]    = (key[7] + chip_type) & 0xff      # 0x49 for CH549

data[i] ^= key[i % 8]
```

`SET_KEY` replies with a checksum that must equal `(sum of key bytes) & 0xff`, or the
device has rejected the key.

## Sequence

```
CHIP_TYPE  -> identify
READ_CONFIG -> UID, bootloader version, config bits
(derive key)
SET_KEY    -> verify checksum
WRITE_CONFIG -> write back EXACTLY what was read
ERASE_CODE -> ceil(len/1024) KiB, minimum 8
WRITE_CODE -> 56-byte encrypted chunks, ascending offset
              then one final EMPTY write at offset == len   (CH549 requires this)
VERIFY_CODE -> same chunking, same encryption
REBOOT
```

## Reading back: there is no read, and verify cannot substitute

The bootloader has **no read-flash command**. `VERIFY_CODE` is the only window into
flash contents, and it answers one bit per chunk: "does this match?"

That looks like it should be enough to identify the installed firmware — replay each
known image and see which one is accepted. **It is not.** Measured on a CH549 with
bootloader 2.4.0:

> The first `VERIFY_CODE` after power-up answers truthfully. Once any chunk has been
> rejected, every later `VERIFY_CODE` is rejected too, until the chip is power-cycled.

The evidence, on a board known to be running `WCH-Link_APP_IAP_RV.bin`:

| Sequence (one session unless noted) | Result |
|---|---|
| `rv` alone, fresh power-up | **match**, all 45784 bytes |
| `rv`, `rv` — two *successful* verifies | **both match** |
| `swio` (a true miss), then `rv` | `rv` rejected at offset 0 |
| …+ `SET_KEY` between | still rejected |
| …+ `CHIP_TYPE`/`READ_CONFIG`/`SET_KEY` between | still rejected |
| …+ USB port reset between | still rejected |
| …+ `WRITE_CONFIG` between | still rejected |
| …from a brand-new host process | still rejected |
| unplug and replug | truthful again |

So it is not a per-session limit — two verifies that both *succeed* are fine. It is a
rejection that latches.

`ERASE_CODE` does clear the latch, which is why **programming is unaffected**: a full
erase/write/verify on a latched session succeeds, verified on hardware. Only the
read-only identify path is impossible.

With more than one candidate image this produces confident nonsense — every image
after the first miss looks like a miss, so whichever candidate happens to be checked
first is the only one that can ever be reported. A flasher that scanned three images
in list order was removed for exactly this reason.

### Identify from the USB descriptor instead

Firmware that is *running* says what it is, for free, with no bootloader involved and
nothing to latch:

| ID | Firmware |
|---|---|
| `4348:55e0` | factory ISP bootloader (button was held at power-up) |
| `1209:c550` | this project's SWIO debugger (CH55xduino CDC descriptors) |
| `1a86:8010` | stock WCH-Link, RISC-V mode |

All three observed on real hardware. The ARM / CMSIS-DAP mode PID has not been
observed and is deliberately not guessed here.

## Warnings

**Never alter the config bits.** Write back exactly what `READ_CONFIG` returned. They
are the one plausibly unrecoverable setting on the chip — the wrong value could
disable the bootloader permanently.

They are also **not static**: WCH's stock firmware writes state there while running, so
"config unchanged between flashes" is not a valid integrity check.

**Only address-0 images may be flashed over ISP.** See `vendor-firmware/README.md` —
the app-only `FIRMWARE_*.bin` images belong to WCH's IAP path and would install an
application with no loader in front of it.
