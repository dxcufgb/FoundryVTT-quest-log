import { MODULE_ID, FACES_ID, t, escapeHTML, escapeRegExp, cleanLine, facesApi } from "./util.js";

/*
 * NPCs from Dxcufgb's Familiar Faces & Places in quest text.
 *   - @NPC[faceId]{label} links one of its NPCs. It opens the NPC's page for users who know the NPC there; everyone
 *     else sees the label as plain text (the label is what the writer typed, so it never shows more than the text).
 *   - Typing "@" and a few letters in an objective or stage offers the NPCs the user knows (attachNpcPicker).
 *   - mentionedFaces finds the NPCs a text links, and the ones the whole party knows that it names, so the store can
 *     add them to the quest's Related NPCs.
 */

export const NPC_LINK = /@NPC\[([A-Za-z0-9]{1,32})\](?:\{([^}]*)\})?/g;
const MIN_NAME = 3;
const MAX_SUGGESTIONS = 8;

export function facesActive() {
  return typeof facesApi()?.faces === "function";
}

/** The Familiar Faces & Places NPCs this user knows (GMs: all of them). */
export function knownFaces() {
  try {
    const list = facesApi()?.faces?.() ?? [];
    return list.filter(f => f?.id && cleanLine(f.name, 80));
  } catch (err) {
    console.error(`${MODULE_ID} | ${FACES_ID} faces`, err);
    return [];
  }
}

/** One NPC this user knows, or null. */
export function knownFace(id) {
  if (!id) return null;
  try {
    return facesApi()?.getFace?.(id) ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | ${FACES_ID} getFace`, err);
    return null;
  }
}

/** Whether the whole party knows this NPC (Familiar Faces & Places: no knownBy list). */
export function partyKnows(face) {
  return !!face && !(Array.isArray(face.knownBy) && face.knownBy.length);
}

/** Compiled name patterns, by name (names rarely change, and every objective or stage save tests all of them). */
const patterns = new Map();

/** A name as a whole word or phrase, any case, any spacing within one line (texts join their parts with newlines). */
function namePattern(name) {
  let re = patterns.get(name);
  if (!re) {
    const body = String(name).trim().split(/\s+/).map(escapeRegExp).join("[^\\S\\r\\n]+");
    re = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "iu");
    if (patterns.size > 2000) patterns.clear();
    patterns.set(name, re);
  }
  return re;
}

/**
 * The NPCs a text mentions: every @NPC link to an NPC this user knows, and the NPCs the whole party knows whose name
 * appears in the text. Returns [{face, linked}], one per NPC.
 */
export function mentionedFaces(text) {
  text = String(text ?? "");
  if (!text || !facesActive()) return [];
  const found = new Map();
  for (const m of text.matchAll(NPC_LINK)) {
    const face = knownFace(m[1]);
    if (face && !found.has(face.id)) found.set(face.id, { face, linked: true });
  }
  for (const face of knownFaces()) {
    if (found.has(face.id) || !partyKnows(face)) continue;
    const name = cleanLine(face.name, 80);
    if (name.length < MIN_NAME) continue;
    if (namePattern(name).test(text)) found.set(face.id, { face, linked: false });
  }
  return [...found.values()];
}

/** The NPCs a new text mentions that the old text didn't (so editing a text never re-adds a removed NPC). */
export function newMentions(text, oldText = "") {
  const before = new Set(mentionedFaces(oldText).map(m => m.face.id));
  return mentionedFaces(text).filter(m => !before.has(m.face.id));
}

/** The text of a link to an NPC. */
export function npcLinkText(face) {
  return `@NPC[${face.id}]{${String(face.name).replace(/[{}[\]]/g, "")}}`;
}

/* -------------------------------------------- */
/*  @NPC[id]{label}                             */
/* -------------------------------------------- */

function npcLink(match) {
  const [, id, label] = match;
  const face = knownFace(id);
  const text = label || face?.name || t("Npc.Unknown");
  if (!face) {
    const span = document.createElement("span");
    span.classList.add("dxql-npc-link", "dxql-missing");
    span.textContent = text;
    return span;
  }
  const a = document.createElement("a");
  a.classList.add("dxql-npc-link");
  a.dataset.facesId = face.id;
  a.dataset.tooltip = t("OpenInFaces");
  a.innerHTML = `<i class="fa-solid fa-user" inert></i> ${escapeHTML(text)}`;
  return a;
}

function onNpcLinkClick(event) {
  const link = event.target.closest?.("a.dxql-npc-link[data-faces-id]");
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  const open = facesApi()?.openFace;
  if (typeof open === "function") open(link.dataset.facesId);
}

export function registerNpcLinks() {
  CONFIG.TextEditor.enrichers.push({ id: "dxqlNpc", pattern: new RegExp(NPC_LINK.source, "g"), enricher: async match => npcLink(match) });
  document.addEventListener("click", event => {
    try {
      onNpcLinkClick(event);
    } catch (err) {
      console.error(`${MODULE_ID} | npc link`, err);
    }
  });
}

/* -------------------------------------------- */
/*  "@" pick list in text fields                */
/* -------------------------------------------- */

/**
 * Typing "@" and the start of a name in this input or textarea shows the NPCs the user knows; Enter, Tab or a click
 * puts an @NPC link in place of what was typed. Call before other keydown listeners of the field, so Enter picks an
 * NPC instead of saving while the list is open.
 */
export function attachNpcPicker(field) {
  if (!field || field.dataset.npcPicker || !facesActive()) return;
  field.dataset.npcPicker = "1";
  const host = field.parentElement;
  if (!host) return;
  host.classList.add("dxql-npc-picker-host");
  const menu = document.createElement("ul");
  menu.className = "dxql-npc-picker";
  menu.hidden = true;
  host.append(menu);
  let matches = [];
  let active = 0;
  let start = -1;

  const close = () => {
    menu.hidden = true;
    matches = [];
    start = -1;
  };
  /** The "@word" being typed before the cursor: {at, query}, or null. */
  const typed = () => {
    const pos = field.selectionStart ?? field.value.length;
    const before = field.value.slice(0, pos);
    const m = before.match(/(^|[\s(])@([\p{L}\p{N}' -]{0,30})$/u);
    if (!m || /\s{2}/.test(m[2])) return null;
    return { at: pos - m[2].length - 1, query: m[2].trim().toLowerCase() };
  };
  const show = () => {
    const cur = typed();
    if (!cur) return close();
    start = cur.at;
    matches = knownFaces()
      .filter(f => !cur.query || f.name.toLowerCase().split(/\s+/).some(w => w.startsWith(cur.query)) || f.name.toLowerCase().startsWith(cur.query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS);
    if (!matches.length) return close();
    active = Math.min(active, matches.length - 1);
    menu.innerHTML = matches.map((f, i) => `<li class="${i === active ? "is-active" : ""}" data-index="${i}">
      ${f.img ? `<img src="${escapeHTML(f.img)}" alt="">` : `<i class="fa-solid fa-user" inert></i>`}<span>${escapeHTML(f.name)}</span></li>`).join("");
    menu.hidden = false;
  };
  const pick = index => {
    const face = matches[index];
    if (!face || start < 0) return close();
    const pos = field.selectionStart ?? field.value.length;
    const link = npcLinkText(face);
    const after = field.value.slice(pos);
    const pad = /^\s/.test(after) ? "" : " ";
    field.value = field.value.slice(0, start) + link + pad + after;
    const caret = start + link.length + pad.length;
    field.setSelectionRange?.(caret, caret);
    close();
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  };

  field.addEventListener("input", () => {
    active = 0;
    show();
  });
  field.addEventListener("keydown", event => {
    if (menu.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      show();
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopImmediatePropagation();
      pick(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  });
  field.addEventListener("blur", () => setTimeout(close, 150));
  // mousedown, not click: the field keeps its focus (an objective being edited saves when it loses focus).
  menu.addEventListener("mousedown", event => {
    const li = event.target.closest("li[data-index]");
    if (!li) return;
    event.preventDefault();
    pick(Number(li.dataset.index));
  });
}
