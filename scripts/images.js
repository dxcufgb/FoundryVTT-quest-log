import { MODULE_ID, t, randomId, escapeHTML } from "./util.js";

/*
 * Image uploads. Users with Foundry's "Upload new files" permission upload directly into the world's quest-log
 * folder. Everyone else sends the (already shrunk) image over the module socket to the active GM, whose client
 * uploads it and answers with the stored path.
 */

const SOCKET = `module.${MODULE_ID}`;
const MAX_SIDE = 1600;
const pending = new Map();

export function imageFolder() {
  const custom = game.settings.get(MODULE_ID, "imageFolder")?.trim();
  return (custom || `worlds/${game.world.id}/quest-log`).replace(/^\/+|\/+$/g, "");
}

export function canBrowse() {
  return game.user.can("FILES_BROWSE");
}

export function registerImageSocket() {
  game.socket.on(SOCKET, async message => {
    try {
      if (message?.action === "upload" && message.gmId === game.user.id && game.user.isGM) await relayUpload(message);
      else if (message?.action === "uploaded" && message.userId === game.user.id) {
        const entry = pending.get(message.requestId);
        if (!entry) return;
        pending.delete(message.requestId);
        clearTimeout(entry.timer);
        if (message.path) entry.resolve(message.path);
        else entry.reject(new Error(message.error || "Upload failed"));
      }
    } catch (err) {
      console.error(`${MODULE_ID} | socket`, err);
    }
  });
}

async function relayUpload({ requestId, userId, name, data }) {
  let path = null;
  let error = null;
  try {
    const user = game.users.get(userId);
    if (!user) throw new Error("Unknown user");
    if (typeof data !== "string" || !data.startsWith("data:image/")) throw new Error("Not an image");
    const blob = await (await fetch(data)).blob();
    const file = new File([blob], name, { type: blob.type });
    path = await uploadDirect(file);
  } catch (err) {
    error = err.message;
    console.error(`${MODULE_ID} | relayed upload failed`, err);
  }
  game.socket.emit(SOCKET, { action: "uploaded", requestId, userId, path, error });
}

let folderReady = null;
async function ensureFolder() {
  const target = imageFolder();
  if (folderReady === target) return target;
  const FP = foundry.applications.apps.FilePicker.implementation;
  let parent = "";
  for (const part of target.split("/")) {
    parent = parent ? `${parent}/${part}` : part;
    try {
      await FP.browse("data", parent);
    } catch {
      try {
        await FP.createDirectory("data", parent);
      } catch (err) {
        if (!String(err?.message ?? err).includes("EEXIST")) console.warn(`${MODULE_ID} | createDirectory`, err);
      }
    }
  }
  folderReady = target;
  return target;
}

async function uploadDirect(file) {
  const folder = await ensureFolder();
  const FP = foundry.applications.apps.FilePicker.implementation;
  const response = await FP.upload("data", folder, file, {}, { notify: false });
  if (!response?.path) throw new Error(t("UploadFailed"));
  return response.path;
}

function safeName(name, ext) {
  const base = String(name ?? "image").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
  return `${Date.now().toString(36)}-${randomId().slice(0, 4)}-${base}.${ext}`;
}

/** Shrinks big photos to at most MAX_SIDE px as WebP; GIF and SVG are kept as they are. */
async function prepare(file) {
  if (!file?.type?.startsWith("image/")) throw new Error(t("NotAnImage"));
  const ext = file.type.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
  if (["image/gif", "image/svg+xml"].includes(file.type)) return new File([file], safeName(file.name, ext), { type: file.type });
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 700 * 1024) return new File([file], safeName(file.name, ext), { type: file.type });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new Error("toBlob failed");
    return new File([blob], safeName(file.name, "webp"), { type: "image/webp" });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not shrink image, uploading as is`, err);
    return new File([file], safeName(file.name, ext), { type: file.type });
  }
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadViaGM(file) {
  const gm = game.users.activeGM;
  if (!gm) throw new Error(t("NeedGMForUpload"));
  const data = await readAsDataURL(file);
  const requestId = randomId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(t("UploadTimeout")));
    }, 60000);
    pending.set(requestId, { resolve, reject, timer });
    game.socket.emit(SOCKET, { action: "upload", requestId, gmId: gm.id, userId: game.user.id, name: file.name, data });
  });
}

/** Uploads one image file and returns its path. Throws with a readable message. */
export async function uploadImage(file) {
  const prepared = await prepare(file);
  if (game.user.can("FILES_UPLOAD")) return uploadDirect(prepared);
  return uploadViaGM(prepared);
}

/** Uploads several files, reporting failures, and returns the paths that worked. */
export async function uploadImages(files) {
  const paths = [];
  for (const file of files) {
    if (!file?.type?.startsWith("image/")) continue;
    try {
      paths.push(await uploadImage(file));
    } catch (err) {
      ui.notifications.error(t("UploadError", { name: escapeHTML(file.name), error: escapeHTML(err.message) }));
    }
  }
  return paths;
}

/** Opens a native file dialog for images. Resolves to the chosen File objects. */
export function pickFiles({ multiple = true } = {}) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = multiple;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}

/** Opens Foundry's file browser (for users who may browse files). Resolves to a path or null. */
export function browseImage() {
  return new Promise(resolve => {
    const FP = foundry.applications.apps.FilePicker.implementation;
    const picker = new FP({ type: "image", current: imageFolder(), callback: path => resolve(path) });
    picker.addEventListener?.("close", () => setTimeout(() => resolve(null), 50), { once: true });
    picker.render(true);
  });
}

/** Image files from a paste or drop event. */
export function filesFromEvent(event) {
  const list = event.clipboardData?.files ?? event.dataTransfer?.files ?? [];
  return [...list].filter(f => f.type?.startsWith("image/"));
}

/** An image URL dragged in from another page or Foundry (e.g. a tile), if any. */
export function urlFromDrop(event) {
  const uri = event.dataTransfer?.getData("text/uri-list") || "";
  const first = uri.split(/\r?\n/).find(l => l && !l.startsWith("#"));
  if (first && /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(first)) return first;
  return null;
}

export function showImage(src, title) {
  const ImagePopout = foundry.applications.apps.ImagePopout;
  new ImagePopout({ src, window: { title: title || t("Image") } }).render({ force: true });
}
