/* A fake CH549 factory bootloader behind navigator.usb.
 *
 * Development only. `tools/mockserve.py` injects this into a throwaway copy of
 * dist/ so the whole flasher flow can be driven in a browser with no hardware
 * attached; `make dist` never copies it, because it does not live under web/.
 *
 * It implements enough of the ISP protocol for the real isp.js to talk to it:
 * chip type, config read, key exchange, erase, write, verify, reboot - against
 * a Uint8Array standing in for the 60 KB of code flash.
 *
 * Query parameters:
 *
 *   ?flash=swio      preload flash with firmware/swio.bin  (identify should hit)
 *   ?flash=blank     preload flash with 0xff               (identify: unknown)
 *   ?delay=2         milliseconds per USB transfer, to watch progress move
 *   ?failAt=2016     reject every WRITE_CODE at or past this offset
 */
(() => {
  const params = new URLSearchParams(location.search);
  const DELAY = Number(params.get("delay") ?? 0);
  const PRELOAD = params.get("flash") ?? "swio";
  const FAIL_AT = params.has("failAt") ? Number(params.get("failAt")) : -1;

  const CODE_FLASH = 61440;
  const UID = [0x6e, 0x87, 0xab, 0xcd, 0xd8, 0x2b, 0xbd, 0xd7];
  const CHIP_TYPE = 0x49;

  const key = (() => {
    let sum = 0;
    for (const b of UID) sum = (sum + b) & 0xff;
    const k = new Uint8Array(8).fill(sum);
    k[7] = (k[7] + CHIP_TYPE) & 0xff;
    return k;
  })();

  const flash = new Uint8Array(CODE_FLASH).fill(0xff);
  let ready = Promise.resolve();
  if (PRELOAD !== "blank") {
    ready = fetch(`./firmware/${PRELOAD}.bin`)
      .then((r) => r.arrayBuffer())
      .then((b) => flash.set(new Uint8Array(b), 0))
      .catch(() => console.warn("[mock] preload failed, flash left blank"));
  }

  const dec = (buf) => buf.map((b, i) => b ^ key[i % 8]);
  const sleep = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : null);

  let pending = null;

  function handle(pkt) {
    const cmd = pkt[0];
    const body = pkt.slice(3);
    let data;

    switch (cmd) {
      case 0xa1: // CHIP_TYPE
        data = [CHIP_TYPE, 0x12];
        break;
      case 0xa7: { // READ_CONFIG
        const cfg = new Array(12).fill(0xa5);
        data = [0, 0, ...cfg, 0x00, 0x02, 0x03, 0x01, ...UID];
        break;
      }
      case 0xa3: { // SET_KEY - reply is the checksum of the key we derived
        let s = 0;
        for (const b of key) s = (s + b) & 0xff;
        data = [s];
        break;
      }
      case 0xa8: // WRITE_CONFIG
        data = [0];
        break;
      case 0xa4: { // ERASE_CODE
        const kib = body[0] | (body[1] << 8);
        flash.fill(0xff, 0, Math.min(kib * 1024, CODE_FLASH));
        data = [0];
        break;
      }
      case 0xa5: { // WRITE_CODE
        const off = body[0] | (body[1] << 8) | (body[2] << 16) | (body[3] << 24);
        if (FAIL_AT >= 0 && off >= FAIL_AT) { data = [1]; break; }
        const payload = dec(body.slice(5));
        flash.set(payload, off);
        data = [0];
        break;
      }
      case 0xa6: { // VERIFY_CODE
        const off = body[0] | (body[1] << 8) | (body[2] << 16) | (body[3] << 24);
        const payload = dec(body.slice(5));
        let same = true;
        for (let i = 0; i < payload.length; i++) {
          if (flash[off + i] !== payload[i]) { same = false; break; }
        }
        data = [same ? 0 : 1];
        break;
      }
      case 0xa2: // REBOOT
        data = [0];
        break;
      default:
        data = [0xff];
    }

    const out = new Uint8Array(4 + data.length);
    out[0] = cmd;
    out[2] = data.length;
    out.set(data, 4);
    return out;
  }

  const device = {
    vendorId: 0x4348,
    productId: 0x55e0,
    productName: "mock CH549 bootloader",
    configuration: null,
    async open() { await ready; this.configuration = { configurationValue: 1 }; },
    async selectConfiguration() { this.configuration = { configurationValue: 1 }; },
    async claimInterface() {},
    async releaseInterface() {},
    async close() {},
    async transferOut(_ep, data) {
      await sleep(DELAY);
      pending = handle(new Uint8Array(data.buffer ?? data));
      return { status: "ok", bytesWritten: data.byteLength };
    },
    async transferIn() {
      const out = pending ?? new Uint8Array(4);
      pending = null;
      return { status: "ok", data: new DataView(out.buffer) };
    },
  };

  // navigator.usb is a prototype getter; plain assignment is a no-op.
  Object.defineProperty(navigator, "usb", {
    configurable: true,
    value: {
      async requestDevice() { return device; },
      async getDevices() { return []; },
      addEventListener() {},
      removeEventListener() {},
    },
  });

  console.log(`[mock] CH549 bootloader active — preload=${PRELOAD} delay=${DELAY}ms`);
})();
