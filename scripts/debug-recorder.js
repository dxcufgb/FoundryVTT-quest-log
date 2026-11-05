import { MODULE_ID } from "./util.js";

/*
 * Optional integration with Dxcufgb's Debug Recorder (dxcufgbs-debug-recorder).
 *
 * The recorder is NOT a dependency: when it is missing, inactive or broken, everything here does nothing and the
 * quest log works exactly as without it. When it is there, this module registers a snapshot of its runtime state
 * (see `debugSnapshot` in main.js) and leaves breadcrumbs at its main actions while the GM is recording.
 *
 * Privacy: snapshots and breadcrumbs hold only counts, booleans, numbers and this module's own enum values (statuses,
 * views, entry types, event types). Never quest titles, objectives, notes, clues, rewards, NPC or user names, search
 * text, tags, image paths or URLs.
 */

const RECORDER_ID = "dxcufgbs-debug-recorder";

/** The recorder's API once this module is registered with it. */
let recorder = null;
let snapshotFn = () => ({});
/** Error codes this module caught since the page loaded: {code: count}, and the latest one. */
const errors = { counts: {}, last: null, lastAt: 0 };

/**
 * Leaves a breadcrumb (only while the recorder is recording). `data` is a small, flat object without names or text.
 * @param {string} key     dot-namespaced, e.g. "capture.open"
 * @param {object} [data]
 */
export function crumb(key, data) {
  try {
    if (recorder?.isRecording?.()) recorder.breadcrumb(MODULE_ID, key, data);
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder breadcrumb failed`, err);
  }
}

/**
 * Notes an error the module caught, by a fixed code of this module (e.g. "socket", "upload.relay"), never its message.
 * Counted for the snapshot even when nothing is recording.
 */
export function noteError(code) {
  try {
    errors.counts[code] = (errors.counts[code] ?? 0) + 1;
    errors.last = code;
    errors.lastAt = Date.now();
    crumb("error.caught", { code });
  } catch {
    // Never let the bookkeeping itself break anything.
  }
}

/** The error codes counted so far, for the snapshot. */
export function errorSummary() {
  return { counts: { ...errors.counts }, last: errors.last, lastAt: errors.lastAt };
}

function snapshot() {
  try {
    return snapshotFn() ?? {};
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder snapshot failed`, err);
    return { snapshotError: true };
  }
}

/** Registers with the recorder once (whichever of its ready hook or the fallback comes first). */
function connect(rec) {
  if (recorder || !rec || typeof rec.register !== "function") return;
  recorder = rec;
  try {
    rec.register(MODULE_ID, { snapshot });
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder registration failed`, err);
  }
}

// Listen from import time, so the recorder's ready hook is never missed whatever the load order.
Hooks.once(`${RECORDER_ID}.ready`, rec => connect(rec));

/**
 * Sets the snapshot function and registers with the recorder if its API is already there (it became ready before
 * this module's code ran). Called from "ready".
 * @param {{snapshot: () => object}} options
 */
export function registerDebugRecorder({ snapshot: fn } = {}) {
  if (typeof fn === "function") snapshotFn = fn;
  try {
    const mod = game.modules.get(RECORDER_ID);
    if (mod?.active && mod.api) connect(mod.api);
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder lookup failed`, err);
  }
}
