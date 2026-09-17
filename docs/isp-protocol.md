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

## Reading back: there is no read

The bootloader has **no read-flash command**. `VERIFY_CODE` is the only way to learn
anything about what is on the chip, and it answers one bit: "does this chunk match?"

The web flasher uses that to name the installed firmware. It replays each known image
through `VERIFY_CODE` and watches for the first rejection:

```
connect (CHIP_TYPE, READ_CONFIG, SET_KEY)
for each candidate image:
    VERIFY_CODE from offset 0
    first rejected chunk  -> not this one, try the next
    no rejection at all   -> this is what is installed
```

Two properties make it cheap and safe:

- **A wrong guess costs one transfer.** The first chunk differs, the device rejects it,
  and the candidate is dropped. Only the image that actually matches is streamed in
  full.
- **Nothing is written.** `VERIFY_CODE` compares; it does not erase or program. The
  identify path deliberately skips `WRITE_CONFIG` as well, so a session that only
  identifies touches no flash at all.

Whether `VERIFY_CODE` is fully reliable without a preceding `WRITE_CONFIG` has not been
established against WCH's own tooling, which always writes config first. If it turns
out not to be, the failure mode is benign: every candidate is rejected and the flasher
reports "not recognised".

## Warnings

**Never alter the config bits.** Write back exactly what `READ_CONFIG` returned. They
are the one plausibly unrecoverable setting on the chip — the wrong value could
disable the bootloader permanently.

They are also **not static**: WCH's stock firmware writes state there while running, so
"config unchanged between flashes" is not a valid integrity check.

**Only address-0 images may be flashed over ISP.** See `vendor-firmware/README.md` —
the app-only `FIRMWARE_*.bin` images belong to WCH's IAP path and would install an
application with no loader in front of it.
