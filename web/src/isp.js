/*
 * ch549-link - WCH CH5xx/CH54x ISP protocol over WebUSB
 * Copyright (C) 2026 e-lab innovations
 *
 * Derived from isp55e0 (https://github.com/frank-zago/isp55e0), GPL-3.0.
 * This file is therefore licensed GPL-3.0, unlike the rest of this project
 * which is MIT. See LICENSES.md.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. It is distributed WITHOUT ANY WARRANTY; see the GNU
 * General Public License for more details: https://www.gnu.org/licenses/
 */

/*
 * WCH CH5xx/CH54x ISP protocol over WebUSB.
 *
 * Protocol derived from frank-zago/isp55e0 (see docs/isp-protocol.md).
 * Device is the factory bootloader: VID 0x4348, PID 0x55e0, vendor class,
 * bulk EP 0x02 OUT / 0x82 IN, 64-byte packets.
 *
 * Request framing : [cmd, len_lo, len_hi, ...payload]
 * Response framing: [cmd, _, data_len, _, ...data]
 */

export const BOOTLOADER = { vendorId: 0x4348, productId: 0x55e0 };

const CMD = {
  CHIP_TYPE: 0xa1,
  REBOOT: 0xa2,
  SET_KEY: 0xa3,
  ERASE_CODE: 0xa4,
  WRITE_CODE: 0xa5,
  VERIFY_CODE: 0xa6,
  READ_CONFIG: 0xa7,
  WRITE_CONFIG: 0xa8,
};

const EP_OUT = 2;
const EP_IN = 2;
const CHUNK = 56; // payload bytes per flash write packet
const XOR_KEY_LEN = 8;

// Only CH549 is needed today, but the table keeps the shape for later parts.
export const CHIPS = {
  0x49: { name: "CH549", family: 0x12, type: 0x49, codeFlash: 61440, idLen: 8 },
};

export class IspError extends Error {}

export class WchIsp {
  constructor(device, log = () => {}) {
    this.device = device;
    this.log = log;
    this.chip = null;
    this.uid = null;
    this.key = null;
    this.configData = null;
    this.bootloaderVersion = null;
  }

  static async request() {
    return navigator.usb.requestDevice({ filters: [BOOTLOADER] });
  }

  async open() {
    await this.device.open();
    if (!this.device.configuration) await this.device.selectConfiguration(1);
    await this.device.claimInterface(0);
  }

  async close() {
    try { await this.device.releaseInterface(0); } catch { /* ignore */ }
    try { await this.device.close(); } catch { /* ignore */ }
  }

  /* ---------------------------------------------------------- transport */

  async transfer(cmd, payload = []) {
    const body = Uint8Array.from(payload);
    const pkt = new Uint8Array(3 + body.length);
    pkt[0] = cmd;
    pkt[1] = body.length & 0xff;
    pkt[2] = (body.length >> 8) & 0xff;
    pkt.set(body, 3);

    const out = await this.device.transferOut(EP_OUT, pkt);
    if (out.status !== "ok") throw new IspError(`transferOut: ${out.status}`);

    const inp = await this.device.transferIn(EP_IN, 64);
    if (inp.status !== "ok") throw new IspError(`transferIn: ${inp.status}`);

    const r = new Uint8Array(inp.data.buffer);
    if (r.length < 4) throw new IspError("short response");
    if (r[0] !== cmd) throw new IspError(`response for 0x${r[0].toString(16)}, expected 0x${cmd.toString(16)}`);
    return r.slice(4, 4 + r[2]);
  }

  /* ------------------------------------------------------------ commands */

  async identify() {
    // try each known chip type; the bootloader answers only for its own
    for (const c of Object.values(CHIPS)) {
      const str = Array.from("MCU ISP & WCH.CN", (ch) => ch.charCodeAt(0));
      const d = await this.transfer(CMD.CHIP_TYPE, [c.type, c.family, ...str]);
      if (d.length >= 2 && d[0] === c.type) {
        this.chip = c;
        this.log(`chip: ${c.name} (type 0x${c.type.toString(16)}, family 0x${c.family.toString(16)})`);
        return c;
      }
    }
    throw new IspError("unrecognised chip - is this a CH549?");
  }

  async readConfig() {
    const d = await this.transfer(CMD.READ_CONFIG, [0x1f, 0x00]);
    if (d.length < 26) throw new IspError("read_config: short reply");
    this.configData = d.slice(2, 14);
    // bootloader version is big-endian
    const bv = d.slice(14, 18);
    this.bootloaderVersion = `${bv[1]}.${bv[2]}.${bv[3]}`;
    this.uid = d.slice(18, 18 + this.chip.idLen);
    this.log(`bootloader ${this.bootloaderVersion}`);
    this.log(`uid ${Array.from(this.uid, (b) => b.toString(16).padStart(2, "0")).join("-")}`);
    return this.uid;
  }

  /* key[0..7] = sum(uid bytes); key[7] += chip type */
  deriveKey() {
    let sum = 0;
    for (const b of this.uid) sum = (sum + b) & 0xff;
    this.key = new Uint8Array(XOR_KEY_LEN).fill(sum);
    this.key[7] = (this.key[7] + this.chip.type) & 0xff;
    return this.key;
  }

  async sendKey() {
    this.deriveKey();
    let sum = 0;
    for (const b of this.key) sum = (sum + b) & 0xff;
    const d = await this.transfer(CMD.SET_KEY, new Array(0x1e).fill(0));
    if (d.length < 1 || d[0] !== sum) {
      throw new IspError("device refused the encryption key");
    }
    this.log("key accepted");
  }

  encrypt(buf) {
    const out = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ this.key[i % XOR_KEY_LEN];
    return out;
  }

  async writeConfig() {
    // write back exactly what was read - never alter config bits, they can
    // disable the bootloader permanently
    const d = await this.transfer(CMD.WRITE_CONFIG, [0x07, 0x00, ...this.configData]);
    if (d.length >= 1 && d[0] !== 0) throw new IspError("write_config failed");
  }

  async erase(byteLen) {
    let kib = Math.ceil(byteLen / 1024);
    if (kib < 8) kib = 8; // minimum erase is 8 KiB
    const d = await this.transfer(CMD.ERASE_CODE, [kib & 0xff, (kib >> 8) & 0xff, 0, 0]);
    if (d.length >= 1 && d[0] !== 0) throw new IspError("erase refused");
    this.log(`erased ${kib} KiB`);
  }

  async #stream(cmd, image, onProgress) {
    for (let off = 0; off < image.length; off += CHUNK) {
      const slice = image.slice(off, Math.min(off + CHUNK, image.length));
      const enc = this.encrypt(slice);
      const d = await this.transfer(cmd, [
        off & 0xff, (off >> 8) & 0xff, (off >> 16) & 0xff, (off >> 24) & 0xff,
        0, ...enc,
      ]);
      if (d.length >= 1 && d[0] !== 0) {
        throw new IspError(`${cmd === CMD.WRITE_CODE ? "write" : "verify"} failed at offset ${off}`);
      }
      onProgress?.(Math.min(off + CHUNK, image.length), image.length);
    }
    if (cmd === CMD.WRITE_CODE) {
      // CH549 needs a final empty write (need_last_write in isp55e0)
      const off = image.length;
      await this.transfer(cmd, [off & 0xff, (off >> 8) & 0xff, (off >> 16) & 0xff, (off >> 24) & 0xff, 0]);
    }
  }

  async writeFlash(image, onProgress) { await this.#stream(CMD.WRITE_CODE, image, onProgress); }
  async verifyFlash(image, onProgress) { await this.#stream(CMD.VERIFY_CODE, image, onProgress); }

  async reboot() {
    try { await this.transfer(CMD.REBOOT, [1]); } catch { /* device vanishes mid-reply */ }
    this.log("rebooted into the new firmware");
  }

  /* ------------------------------------------------------- whole sequence */

  /* The upload protocol requires an 8-byte aligned length; pad with 0xff to
   * match erased flash. Without this the device's final aligned compare fails
   * on a short trailing chunk. */
  static pad8(image) {
    const len = (image.length + 7) & ~7;
    if (len === image.length) return image;
    const out = new Uint8Array(len).fill(0xff);
    out.set(image);
    return out;
  }

  async flash(raw, onProgress) {
    if (!(raw instanceof Uint8Array)) throw new IspError("image must be a Uint8Array");
    const image = WchIsp.pad8(raw);
    if (image.length !== raw.length) {
      this.log(`padded ${raw.length} -> ${image.length} bytes (8-byte alignment)`);
    }
    await this.identify();
    await this.readConfig();
    if (image.length > this.chip.codeFlash) {
      throw new IspError(`image ${image.length} B exceeds ${this.chip.codeFlash} B of flash`);
    }
    await this.sendKey();
    await this.writeConfig();
    await this.erase(image.length);
    this.log(`writing ${image.length} bytes...`);
    await this.writeFlash(image, onProgress);
    this.log("verifying...");
    await this.verifyFlash(image, onProgress);
    this.log("verified OK");
    await this.reboot();
  }
}
