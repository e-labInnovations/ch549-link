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
  images: new Map(),  // id -> Uint8Array, fetched once
  isp: null,
  selected: null,     // a manifest entry, or a synthetic one for a custom file
};

/* Every USB sequence runs through here, so two of them can never interleave on
 * the same endpoint. */
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

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
  } catch (e) {
    log(`could not talk to the bootloader: ${e.message}`, "err");
    revealLog();
    await disconnect();
  } finally {
    $("connect").disabled = false;
  }
}

async function disconnect() {
  if (state.isp) { await state.isp.close(); state.isp = null; }
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

$("connect").addEventListener("click", connect);
$("disconnect").addEventListener("click", disconnect);

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
