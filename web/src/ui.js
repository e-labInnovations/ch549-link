/*
 * ch549-link flasher - DOM plumbing.
 *
 * Everything here is presentation: which step is on screen, what the log says,
 * how far the progress bar has moved. No USB, no protocol. app.js owns the
 * flow and calls into this; isp.js owns the wire.
 */

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const STEPS = 4;

/* ------------------------------------------------------------------ steps */

let currentStep = 0;

/* Called just before the visible step changes, so the flow can tear down
 * whatever the step it is leaving had running. */
let onLeave = null;
export const setStepLeaveHook = (fn) => { onLeave = fn; };

export function goto(step) {
  if (step === currentStep) return;
  if (onLeave) onLeave(currentStep, step);
  currentStep = step;

  for (const section of $$("section.step")) {
    section.classList.toggle("active", Number(section.dataset.step) === step);
  }
  for (const li of $$("#stepper li")) {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", n === step);
    li.classList.toggle("done", n < step);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export const step = () => currentStep;

/* Tick a step that is still the visible one - used when the last step finishes
 * and there is nowhere further to advance to. */
export function markStepComplete(n) {
  const li = document.querySelector(`#stepper li[data-step="${n}"]`);
  if (li) li.classList.add("done");
}

/* Sub-views inside step 4: confirm | busy | ok | fail */
export function setView(name) {
  const host = document.querySelector('section.step[data-step="4"]');
  for (const view of $$("[data-view]", host)) {
    view.hidden = view.dataset.view !== name;
  }
}

/* --------------------------------------------------------------- progress */

const STAGES = ["erase", "write", "verify", "reboot"];

/* name is one of STAGES, "done" (all complete) or null (all idle). */
export function setStage(name) {
  const at = name === "done" ? STAGES.length : STAGES.indexOf(name);
  for (const li of $$("#stages li")) {
    const i = STAGES.indexOf(li.dataset.stage);
    li.classList.toggle("active", i === at);
    li.classList.toggle("done", at >= 0 && i < at);
  }
}

export function setProgress(pct, note = "") {
  const clamped = Math.max(0, Math.min(100, pct));
  $("bar").style.width = `${clamped}%`;
  $("bar-pct").textContent = `${Math.round(clamped)}%`;
  $("bar-note").textContent = note;
}

/* -------------------------------------------------------------------- log */

let logLines = 0;

export function log(msg, cls = "") {
  if (logLines === 0) {
    $("log").textContent = "";
    $("log").classList.remove("muted");
  }
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  $("log").appendChild(line);
  $("log").scrollTop = $("log").scrollHeight;
  logLines++;
  $("log-count").textContent = `(${logLines})`;
}

export function clearLog() {
  $("log").textContent = "ready.";
  $("log").classList.add("muted");
  $("log-count").textContent = "";
  logLines = 0;
}

/* Open the log drawer on the first thing that goes wrong, so the detail is
 * in front of the user instead of one click away. */
export function revealLog() {
  $("log-drawer").open = true;
}

/* ----------------------------------------------------------------- format */

export const fmtSize = (n) =>
  n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KiB`;

export function text(tag, cls, content) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (content !== undefined) el.textContent = content;
  return el;
}

/* A one-line shell command with a copy button. */
export function commandBlock(cmd) {
  const wrap = text("div", "cmd");
  const code = text("code", "", cmd);
  const copy = text("button", "btn ghost small", "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1400);
    } catch {
      copy.textContent = "Copy failed";
    }
  });
  wrap.append(code, copy);
  return wrap;
}
