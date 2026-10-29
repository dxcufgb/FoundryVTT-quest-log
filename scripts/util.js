export const MODULE_ID = "dxcufgbs-quest-log";
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;
export const STATUSES = ["active", "completed", "failed"];
export const NOTE_TYPES = ["note", "clue"];
/** Quest detail fields the GM can hide from players one by one. */
export const HIDEABLE_FIELDS = ["giver", "acquiredAt", "location", "reward", "description", "tags", "chapter", "questType"];
/** Quest categories: a quest is a main quest, a side quest or not set (""). */
export const QUEST_TYPES = ["main", "side"];
/** Keyed parts of a quest that can each be hidden from players. */
export const PART_KINDS = ["objectives", "notes", "gallery", "stages", "locations", "items", "npcs"];

export const STATUS_ICONS = {
  active: "fa-regular fa-circle",
  completed: "fa-solid fa-circle-check",
  failed: "fa-solid fa-circle-xmark"
};

/** Quest rewards: active (can be used) or claimed (used up, or put away by hand). */
export const REWARD_STATUSES = ["active", "claimed"];
/** What a reward can be linked to. */
export const LINK_TYPES = ["place", "npc", "faction", "other"];
export const LINK_ICONS = {
  place: "fa-solid fa-location-dot",
  npc: "fa-solid fa-user",
  faction: "fa-solid fa-flag",
  other: "fa-solid fa-link"
};
/**
 * Dxcufgb's Familiar Faces & Places: when it is active, an NPC, place or faction named in a quest, reward or note links to
 * its page there. Looked up by name each time a sheet is shown (nothing is stored), with that module's own visibility.
 */
export const FACES_ID = "dxcufgbs-familiar-faces";
/** The Familiar Faces & Places list a link type is looked up in, and that module's API functions to find / open one. */
const FACES_KINDS = { npc: "faces", place: "places", faction: "factions" };
const FACES_FIND = { faces: "findByName", places: "findPlaceByName", factions: "findFactionByName" };
const FACES_OPEN = { faces: "openFace", places: "openPlace", factions: "openFaction" };

function facesApi() {
  const mod = game.modules.get(FACES_ID);
  return mod?.active ? mod.api ?? null : null;
}

/**
 * The Familiar Faces & Places NPC, place or faction with this name that the user can see, as {kind, id}, or null.
 * Factions came in its 1.2.0; with an older version (no findFactionByName) factions aren't linked.
 */
export function facesEntry(type, name) {
  const api = facesApi();
  const kind = FACES_KINDS[type];
  const find = api?.[FACES_FIND[kind]];
  if (typeof find !== "function" || !name) return null;
  try {
    const entry = find(name);
    return entry?.id ? { kind, id: entry.id } : null;
  } catch (err) {
    console.error(`${MODULE_ID} | ${FACES_ID} lookup`, err);
    return null;
  }
}

/** Opens a Familiar Faces & Places page ({kind, id} from facesEntry, or a link's data-faces-kind / data-faces-id). */
export function openFacesEntry(kind, id) {
  const open = facesApi()?.[FACES_OPEN[kind]];
  if (typeof open === "function" && id) return open(id);
}

export const REWARD_STATUS_ICONS = {
  active: "fa-solid fa-gift",
  claimed: "fa-solid fa-box-archive"
};
/** Most uses a reward can have (0 = unlimited). */
export const MAX_USES = 999;

export const NOTE_ICONS = {
  note: "fa-solid fa-note-sticky",
  clue: "fa-solid fa-magnifying-glass"
};

/** Localize a DXQL.* key, formatting when data is given. */
export function t(key, data) {
  const full = `DXQL.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The one GM client that does world setup and relayed work. */
export function isResponsibleGM() {
  return game.user.isGM && !!game.users.activeGM?.isSelf;
}

export function randomId() {
  return foundry.utils.randomID();
}

/** A stable hue for a tag, so a tag keeps its colour everywhere. */
export function tagHue(tag) {
  let hash = 0;
  for (const ch of String(tag).toLowerCase()) hash = ((hash << 5) - hash + ch.codePointAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export function cleanTag(value) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/^#/, "").trim().slice(0, 40);
}

export function cleanLine(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Turns stored text (with @UUID links) into plain searchable text. */
export function plainText(text) {
  return String(text ?? "")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]]*)\]/g, "$1")
    .replace(/\[\[\/?\w*\s*([^\]]*)\]\]/g, "$1");
}

/** Renders stored plain text (with Foundry enrichers such as @UUID) as safe HTML. */
export async function enrich(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const html = escapeHTML(raw).replace(/\r?\n/g, "<br>");
  const TextEditor = foundry.applications.ux.TextEditor.implementation;
  try {
    return await TextEditor.enrichHTML(html, { secrets: game.user.isGM });
  } catch (err) {
    console.error(`${MODULE_ID} | enrich failed`, err);
    return html;
  }
}

/** Converts an HTML element into readable plain text, one line per block. */
export function elementToText(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll("button, menu, script, style, input, select, textarea, .dice-tooltip, .card-buttons, .dxql-ignore, [hidden]")
    .forEach(el => el.remove());
  clone.querySelectorAll("br").forEach(el => el.replaceWith("\n"));
  clone.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, tr, header, footer, section, blockquote, dt, dd")
    .forEach(el => el.append("\n"));
  return clone.textContent.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function htmlToText(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html ?? "");
  return elementToText(div);
}

/** Collects image sources from an element (skipping icons and SVG dice). */
export function imagesIn(element) {
  if (!element) return [];
  const out = new Set();
  for (const img of element.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src || src.startsWith("data:") || /\.svg($|\?)/i.test(src) || src.includes("icons/svg/")) continue;
    out.add(src);
  }
  return [...out];
}

export function formatDate(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** Name and colour of a user; falls back to the name saved with imported entries. */
export function userInfo(userId, fallbackName) {
  const user = userId ? game.users.get(userId) : null;
  return { name: user?.name ?? fallbackName ?? t("UnknownUser"), color: user?.color?.css ?? "#999999" };
}

/** Suggestions for location fields: used locations plus scenes this user can see. */
export function locationSuggestions(quests) {
  const set = new Map();
  const add = v => {
    const s = cleanLine(v);
    if (s && !set.has(s.toLowerCase())) set.set(s.toLowerCase(), s);
  };
  for (const q of quests) {
    add(q.acquiredAt);
    for (const place of q.locations ?? []) add(place.name);
  }
  for (const scene of game.scenes ?? []) {
    if (scene.testUserPermission(game.user, "LIMITED") || game.user.isGM) add(scene.navName || scene.name);
  }
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}

export function currentSceneName() {
  const scene = canvas?.scene ?? game.scenes?.viewed;
  return scene ? (scene.navName || scene.name) : "";
}

/** Reads dropped Foundry data from a drag event, or null. */
export function getDropData(event) {
  try {
    return foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  } catch {
    return null;
  }
}

/** A short "@UUID[...]{Name}" link for a dropped document. */
export async function linkForDrop(data) {
  if (!data?.uuid) return "";
  const doc = await fromUuid(data.uuid).catch(() => null);
  const name = doc?.name ?? data.name ?? data.type ?? "Link";
  return `@UUID[${data.uuid}]{${String(name).replace(/[{}]/g, "")}}`;
}

/** Inserts text at the cursor of a textarea/input and fires an input event. */
export function insertAtCursor(field, text) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  const before = field.value.slice(0, start);
  const pad = before && !/\s$/.test(before) ? " " : "";
  field.value = before + pad + text + field.value.slice(end);
  const pos = start + pad.length + text.length;
  field.setSelectionRange?.(pos, pos);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
}
