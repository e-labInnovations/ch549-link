/*
 * ch549-link flasher - the flow.
 *
 * Four steps: get into the bootloader, look at the board, pick an image,
 * write it. isp.js talks to the device, ui.js owns the DOM, this file decides
 * what happens when.
 */

import { WchIsp, BOOTLOADER } from "./isp.js";
import {
  $, $$, goto, setView, setStage, setProgress,
  log, clearLog, revealLog, fmtSize, text, commandBlock, setStepLeaveHook,
  markStepComplete,
} from "./ui.js";

const state = {
  manifest: null,
  flashable: [],      // manifest entries that can go through the ISP bootloader
  images: new Map(),  // id -> Uint8Array, so scan and flash fetch once
  isp: null,
  selected: null,     // a manifest entry, or a synthetic one for a custom file
  installed: null,    // id of the image found in flash, or null
};

/* Every USB sequence runs through here, so a background scan can never
 * interleave with a flash on the same endpoint. */
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

class Cancelled extends Error {}
let scanToken = 0;

/* ─────────────────────────────────────────────────────── browser support */

function checkSupport() {
  const box = $("unsupported");
  let msg = null;

  if (!("usb" in navigator)) {
    msg = "This browser has no WebUSB. Use Chrome, Edge or Opera — Firefox and " +
          "Safari do not implement it, and there is no polyfill that can help.";
  } else if (!window.isSecureContext) {
    msg = "WebUSB needs a secure context. Open this page over HTTPS, or from " +
          "localhost if you are running it yourself.";
  }

  if (msg) {
    box.textContent = msg;
    box.hidden = false;
    $("connect").disabled = true;
    return false;
  }
  return true;
}

/* ────────────────────────────────────────────────────────────── manifest */

async function loadManifest() {
  try {
    const r = await fetch("./manifest.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    state.manifest = await r.json();
  } catch (e) {
    $("firmwares").textContent = `Could not load manifest.json: ${e.message}`;
    return;
  }

  // Only images written from address 0 can go through the ISP bootloader. The
  // app-only FIRMWARE_*.bin images belong to WCH's IAP path and would install
  // an app with no loader in front of it.
  state.flashable = state.manifest.firmwares.filter((f) => f.method === "isp");
  renderFirmwares();
}

function renderFirmwares() {
  const host = $("firmwares");
  host.textContent = "";
  host.classList.remove("muted");

  if (!state.flashable.length) {
    host.textContent = "The manifest contains no ISP-flashable images.";
    return;
  }

  for (const fw of state.flashable) {
    const label = text("label", "fw");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "fw";
    input.value = fw.id;
    input.checked = state.selected?.id === fw.id;

    const body = text("div");
    const name = text("div", "name");
    name.append(fw.name, tag(fw.source, fw.source));
    if (state.installed === fw.id) name.append(tag("current", "installed"));

    body.append(name, text("div", "desc", fw.description));
    body.append(text("div", "meta",
      [fw.file, fmtSize(fw.size), fw.targets?.length ? fw.targets.join(", ") : null]
        .filter(Boolean).join("  ·  ")));

    input.addEventListener("change", () => { state.selected = fw; });
    label.append(input, body);
    host.append(label);
  }

  if (!state.selected) {
    const first = host.querySelector("input");
    if (first) { first.checked = true; state.selected = state.flashable[0]; }
  }
}

function tag(cls, label) {
  return text("span", `tag ${cls}`, label);
}

async function imageFor(fw) {
  if (state.images.has(fw.id)) return state.images.get(fw.id);
  const r = await fetch(`./${fw.file}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`cannot fetch ${fw.file}: HTTP ${r.status}`);
  const image = new Uint8Array(await r.arrayBuffer());
  if (fw.size && image.length !== fw.size) {
    log(`warning: manifest says ${fw.size} B for ${fw.id}, got ${image.length} B`, "err");
  }
  state.images.set(fw.id, image);
  return image;
}

/* ─────────────────────────────────────────────────────────────── connect */

async function connect() {
  let device;
  try {
    device = await navigator.usb.requestDevice({ filters: [BOOTLOADER] });
  } catch {
    log("no device picked — is the board in bootloader mode?", "dim");
    return;
  }

  $("connect").disabled = true;
  try {
    state.isp = new WchIsp(device, { log });
    await serial(() => state.isp.connect());
    renderSpecs();
    goto(2);
    startScan();
  } catch (e) {
    log(`could not talk to the bootloader: ${e.message}`, "err");
    revealLog();
    await disconnect();
  } finally {
    $("connect").disabled = false;
  }
}

async function disconnect() {
  scanToken++;
  if (state.isp) { await state.isp.close(); state.isp = null; }
  state.installed = null;
  renderFirmwares();
  goto(1);
}

function renderSpecs() {
  const { chip, uid, bootloaderVersion } = state.isp;
  const rows = [
    ["Chip", chip.name],
    ["Bootloader", bootloaderVersion],
    ["Unique ID", Array.from(uid, (b) => b.toString(16).padStart(2, "0")).join("-")],
    ["Code flash", fmtSize(chip.codeFlash)],
  ];
  const dl = $("specs");
  dl.textContent = "";
  for (const [k, v] of rows) dl.append(text("dt", "", k), text("dd", "", v));
}

/* ───────────────────────────────────────────────── what is already on it? */

/*
 * The bootloader has no read-flash command, so there is no way to dump what is
 * installed. It does have VERIFY_CODE, which compares without erasing — so we
 * ask "is it this one?" of each known image in turn. A wrong guess is rejected
 * at its first differing chunk, so only a match costs a full pass.
 *
 * Best-effort by design: a board holding something we do not ship reports
 * "not recognised", which is the honest answer, and flashing works either way.
 */
function startScan() {
  const token = ++scanToken;
  $("cancel-scan").hidden = false;

  /* One renderer for all four outcomes: busy, found, unrecognised, skipped. */
  const show = (cls, busy, ...parts) => {
    const box = $("installed");
    box.className = `installed ${cls}`;
    box.textContent = "";
    if (busy) box.append(text("span", "spinner"));
    const line = text("div");
    line.append(...parts);
    box.append(line);
  };

  serial(async () => {
    try {
      for (const [i, fw] of state.flashable.entries()) {
        if (token !== scanToken) throw new Cancelled();

        show("", true,
          `Identifying installed firmware — checking ${fw.name} `,
          text("span", "muted", `(${i + 1} of ${state.flashable.length})`));

        const image = await imageFor(fw);
        const hit = await state.isp.matches(image, () => {
          if (token !== scanToken) throw new Cancelled();
        });

        if (hit) {
          state.installed = fw.id;
          log(`installed firmware identified: ${fw.name}`, "ok");
          show("found", false, text("strong", "", "Installed: "), fw.name);
          renderFirmwares();
          return;
        }
      }
      state.installed = null;
      log("installed firmware matches none of the listed images", "dim");
      show("unknown", false,
        text("strong", "", "Not recognised. "),
        "Flash holds something other than the images listed here — or nothing at all.");
    } catch (e) {
      if (token !== scanToken || e instanceof Cancelled) {
        show("", false, text("span", "muted", "Identification skipped."));
        return;
      }
      log(`could not identify installed firmware: ${e.message}`, "dim");
      show("unknown", false, text("span", "muted",
        "Could not identify the installed firmware. Flashing still works."));
    } finally {
      if (token === scanToken) $("cancel-scan").hidden = true;
    }
  });
}

/* ──────────────────────────────────────────────────────── custom image */

$("custom-file").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const image = new Uint8Array(await file.arrayBuffer());
  const entry = {
    id: "__custom__",
    name: file.name,
    description: "Local file.",
    file: file.name,
    size: image.length,
    source: "custom",
    method: "isp",
    targets: [],
  };
  state.images.set(entry.id, image);
  state.selected = entry;
  for (const input of $$('#firmwares input[type=radio]')) input.checked = false;
  log(`custom image selected: ${file.name} (${image.length} B)`);
});

/* ───────────────────────────────────────────────────────────────── flash */

function renderSummary() {
  const fw = state.selected;
  const host = $("flash-summary");
  host.textContent = "";
  host.append(text("div", "name", fw.name));
  host.append(text("div", "meta", `${fw.file}  ·  ${fmtSize(fw.size)}`));

  if (state.installed === fw.id) {
    host.append(text("div", "hint",
      "This is already what the board is running. Rewriting it is harmless."));
  }
  if (fw.source === "vendor") {
    host.append(text("div", "hint",
      "Stock WCH firmware. It does not support CH32V003 — come back here to " +
      "put the SWIO debugger on again."));
  }
}

async function doFlash() {
  const fw = state.selected;
  $("flash").disabled = true;
  setView("busy");
  setStage(null);
  setProgress(0);

  try {
    const image = await imageFor(fw);
    state.isp.onStage = (s) => {
      setStage(s);
      if (s === "erase") setProgress(0, "erasing");
    };

    await serial(() => state.isp.program(image, (done, total) => {
      setProgress((done / total) * 100, `${done} / ${total} bytes`);
    }));

    setProgress(100, "done");
    setStage("done");
    markStepComplete(4);
    log("DONE — flashed and verified", "ok");
    renderSuccess(fw);
    setView("ok");
  } catch (e) {
    log(`FAILED: ${e.message}`, "err");
    revealLog();
    $("fail-msg").textContent = e.message;
    setView("fail");
  } finally {
    $("flash").disabled = false;
    if (state.isp) { await state.isp.close(); state.isp = null; }
    scanToken++;
  }
}

function renderSuccess(fw) {
  $("ok-title").textContent = `${fw.name} is on the board`;
  // Accuracy: the bootloader has no read-flash command. VERIFY_CODE sends each
  // chunk back and the device compares it against its own flash, so "verified"
  // means the device agreed, not that we read the bytes out.
  $("ok-sub").textContent =
    `${fmtSize(fw.size)} written, then compared chunk by chunk against the ` +
    "device's own flash. The board has rebooted into it.";

  const host = $("next-steps");
  host.textContent = "";
  host.append(text("h3", "", "What now"));

  const list = text("ul");
  list.append(text("li", "",
    "Unplug and replug the board normally — without holding the button — so it " +
    "comes up in the firmware you just wrote."));
  if (fw.id === "swio") {
    list.append(text("li", "",
      "It enumerates as a USB serial port: /dev/ttyACM0 on Linux, /dev/cu.usbmodem* " +
      "on macOS, a COM port on Windows."));
    list.append(text("li", "",
      "Wire SWIO to the target's PD1, share ground, and fit the 1 kΩ pull-up to " +
      "3V3 — it is required, not optional."));
  }
  host.append(list);

  if (fw.usage) {
    host.append(text("h3", "", "Usage"));
    host.append(commandBlock(fw.usage));
  }
}

/* ───────────────────────────────────────────────────────────────── wiring */

setStepLeaveHook((from) => {
  if (from === 2) scanToken++; // never leave a scan running behind the flow
});

$("connect").addEventListener("click", connect);
$("disconnect").addEventListener("click", disconnect);
$("cancel-scan").addEventListener("click", () => { scanToken++; });

$("to-firmware").addEventListener("click", () => goto(3));
$("to-flash").addEventListener("click", () => {
  if (!state.selected) { log("pick a firmware first", "err"); return; }
  renderSummary();
  setView("confirm");
  goto(4);
});
for (const b of $$("[data-goto]")) {
  b.addEventListener("click", () => goto(Number(b.dataset.goto)));
}

$("flash").addEventListener("click", doFlash);
$("again").addEventListener("click", restart);
$("retry").addEventListener("click", restart);
$("clear").addEventListener("click", clearLog);

async function restart() {
  await disconnect();
  setView("confirm");
  setProgress(0);
  setStage(null);
}

/* ─────────────────────────────────────────────────────────────────── boot */

goto(1);
if (checkSupport()) loadManifest();
