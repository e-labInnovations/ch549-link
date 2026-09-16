# Vendor firmware

WCH's own WCH-Link firmware images, taken from the official **WCH-LinkUtility**
package (`Firmware_Link/`). They are redistributed here so the web flasher can
restore a board to stock without the user hunting down the vendor tool.

These are **WCH's copyrighted binaries**, not covered by this project's licence.
Source: <https://www.wch.cn/downloads/WCH-LinkUtility_ZIP.html>

## Two families, and they are not interchangeable

Proven by byte comparison:

```
WCH-Link_APP_IAP_XXX.bin  ==  [3072-byte IAP loader] + FIRMWARE_XXX.bin
                              0x0000 - 0x0BFF          0x0C00 onward
```

| File | Written by | Flash from |
|---|---|---|
| `WCH-Link_APP_IAP_ARM.bin` | factory ISP bootloader | **use these** |
| `WCH-Link_APP_IAP_RV.bin` | factory ISP bootloader | **use these** |
| `FIRMWARE_DAP_CH549.bin` | WCH's own IAP loader (`81 0f 01 01`) | not over ISP |
| `FIRMWARE_CH549.bin` | WCH's own IAP loader | not over ISP |

Flashing an app-only `FIRMWARE_*.bin` through the ISP bootloader installs an
application with no loader in front of it. Recoverable via the button, but
pointless. `tools/make_manifest.py` marks those entries `"method": "iap"` and
the web flasher does not offer them.

## Reset vectors

| Image | First bytes | Meaning |
|---|---|---|
| `WCH-Link_APP_IAP_*.bin` | `02 06 e4` | `LJMP 0x06e4` — into the IAP loader |
| `FIRMWARE_DAP_CH549.bin` | `02 5f 73` | `LJMP 0x5f73` — into the app |
| `FIRMWARE_CH549.bin` | `02 a9 06` | `LJMP 0xa906` — into the app |
