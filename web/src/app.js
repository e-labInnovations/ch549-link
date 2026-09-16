import { WchIsp, BOOTLOADER } from "./isp.js";

const $ = (id) => document.getElementById(id);
const logEl = $("log"), barEl = $("bar"), listEl = $("firmwares");
let manifest = null, selected = null, firstLog = true;

function log(msg, cls = "") {
  if (firstLog) { logEl.textContent = ""; logEl.classList.remove("dim"); firstLog = false; }
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

if (!("usb" in navigator)) {
  $("support").innerHTML =
    '<span class="err">WebUSB is not available in this browser.</span> Chrome or Edge is required — Firefox and Safari do not implement it.';
  $("connect").disabled = true;
} else if (!isSecureContext) {
  $("support").innerHTML = '<span class="err">WebUSB requires HTTPS.</span>';
  $("connect").disabled = true;
}

/* ------------------------------------------------------------- manifest */

const fmtSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KiB`);

async function loadManifest() {
  try {
    const r = await fetch("./manifest.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    manifest = await r.json();
  } catch (e) {
    listEl.innerHTML = `<span class="err">Could not load manifest.json: ${e.message}</span>`;
    return;
  }

  // Only images written from address 0 can go through the ISP bootloader.
  // The app-only FIRMWARE_*.bin images are for WCH's IAP path and would
  // install an app with no loader in front of it.
  const flashable = manifest.firmwares.filter((f) => f.method === "isp");
  if (!flashable.length) { listEl.innerHTML = '<span class="err">manifest has no ISP-flashable images</span>'; return; }

  listEl.innerHTML = "";
  listEl.classList.remove("dim");
  for (const fw of flashable) {
    const id = `fw-${fw.id}`;
    const label = document.createElement("label");
    label.className = "fw";
    label.innerHTML = `
      <input type="radio" name="fw" id="${id}" value="${fw.id}">
      <span>
        <span class="name">${fw.name}</span>
        <span class="tag ${fw.source}">${fw.source}</span>
        <div class="meta">${fw.description}</div>
        <div class="meta">${fw.file} · ${fmtSize(fw.size)}${fw.targets?.length ? " · targets: " + fw.targets.join(", ") : ""}</div>
      </span>`;
    label.querySelector("input").addEventListener("change", () => { selected = fw; });
    listEl.appendChild(label);
  }
  const first = listEl.querySelector("input");
  if (first) { first.checked = true; selected = flashable[0]; }
}

/* ---------------------------------------------------------------- flash */

$("clear").addEventListener("click", () => {
  logEl.textContent = "ready."; logEl.classList.add("dim"); firstLog = true; barEl.style.width = "0";
});

$("connect").addEventListener("click", async () => {
  if (!selected) { log("pick a firmware first", "err"); return; }
  $("connect").disabled = true;
  barEl.style.width = "0";

  let isp = null;
  try {
    log(`fetching ${selected.file}`);
    const resp = await fetch(`./${selected.file}`, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`cannot fetch image: HTTP ${resp.status}`);
    const image = new Uint8Array(await resp.arrayBuffer());
    if (selected.size && image.length !== selected.size) {
      log(`warning: manifest says ${selected.size} B, got ${image.length} B`, "err");
    }
    log(`image ${image.length} bytes`);

    const device = await navigator.usb.requestDevice({ filters: [BOOTLOADER] });
    isp = new WchIsp(device, log);
    await isp.open();
    log("connected to bootloader");

    await isp.flash(image, (done, total) => {
      barEl.style.width = `${Math.round((done / total) * 100)}%`;
    });

    barEl.style.width = "100%";
    log("DONE — firmware flashed and verified", "ok");
    if (selected.usage) log(`usage: ${selected.usage}`);
  } catch (e) {
    if (e?.name === "NotFoundError") log("no device selected", "dim");
    else log(`FAILED: ${e.message}`, "err");
    log("the bootloader is in ROM and cannot be damaged — redo step 1 and retry", "dim");
  } finally {
    if (isp) await isp.close();
    $("connect").disabled = false;
  }
});

loadManifest();
