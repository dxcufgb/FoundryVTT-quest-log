import {
  MODULE_ID, STATUSES, NOTE_TYPES, HIDEABLE_FIELDS, PART_KINDS, QUEST_TYPES, LINK_TYPES, MAX_USES, t, escapeHTML, randomId, cleanLine, cleanTag
} from "./util.js";
import { STORE_KINDS, getStore } from "./store.js";

/*
 * GM export / import of the whole quest log (quests, quest rewards and the party's notes) as a JSON file.
 * Images are exported as paths (not embedded); they show up after an import when the files exist on that server.
 */

const FORMAT = 1;
const FLAG_PATH = `flags.${MODULE_ID}.quests`;
const REWARD_PATH = `flags.${MODULE_ID}.rewards`;
const PARTY_NOTE_PATH = `flags.${MODULE_ID}.partyNotes`;
const { DialogV2 } = foundry.applications.api;

/* -------------------------------------------- */
/*  Export                                      */
/* -------------------------------------------- */

function userName(id) {
  return id ? game.users.get(id)?.name ?? null : null;
}

/** A copy of a stored quest with author names next to user ids, so another world can still show them. */
function withNames(raw) {
  const quest = foundry.utils.deepClone(raw);
  quest.authorName ??= userName(quest.createdBy);
  for (const key of ["stages", "objectives", "notes", "gallery", "items", "npcs"]) {
    for (const entry of Object.values(quest[key] ?? {})) {
      if (!entry || typeof entry !== "object") continue;
      entry.authorName ??= userName(entry.createdBy);
      if (entry.doneBy) entry.doneByName ??= userName(entry.doneBy);
    }
  }
  return quest;
}

/** A copy of a stored reward with the names of its author and of who used it. */
function rewardWithNames(raw) {
  const reward = foundry.utils.deepClone(raw);
  reward.authorName ??= userName(reward.createdBy);
  for (const use of Object.values(reward.uses ?? {})) {
    if (use && typeof use === "object") use.byName ??= userName(use.by);
  }
  return reward;
}

/** A copy of a stored party note with the names of its author, its last editor and who added each image. */
function partyNoteWithNames(raw) {
  const note = foundry.utils.deepClone(raw);
  note.authorName ??= userName(note.createdBy);
  if (note.editedBy) note.editedByName ??= userName(note.editedBy);
  for (const img of Object.values(note.gallery ?? {})) {
    if (img && typeof img === "object") img.authorName ??= userName(img.createdBy);
  }
  return note;
}

/** The stored party notes of both stores: [{id, hidden, note}]. */
function storedPartyNotes() {
  const out = [];
  for (const kind of STORE_KINDS) {
    for (const [id, note] of Object.entries(getStore(kind)?.getFlag(MODULE_ID, "partyNotes") ?? {})) {
      if (note && typeof note === "object") out.push({ id, hidden: kind === "secret", note });
    }
  }
  return out;
}

/** A copy of an exported quest without the parts and fields hidden from players. */
export function withoutHiddenParts(quest) {
  const copy = foundry.utils.deepClone(quest);
  // Objectives of a hidden stage are hidden with it.
  for (const [sid, stage] of Object.entries(copy.stages ?? {})) {
    if (!stage?.hidden) continue;
    for (const [oid, o] of Object.entries(copy.objectives ?? {})) if (o?.stage === sid) delete copy.objectives[oid];
  }
  for (const kind of PART_KINDS) {
    for (const [id, part] of Object.entries(copy[kind] ?? {})) if (part?.hidden) delete copy[kind][id];
  }
  for (const field of copy.hiddenFields ?? []) {
    if (field === "tags") copy.tags = [];
    else copy[field] = "";
    if (field === "giver") { copy.giverImg = ""; copy.giverUuid = ""; }
  }
  copy.hiddenFields = [];
  return copy;
}

export async function exportQuests() {
  if (!game.user.isGM) return;
  const stored = [];
  for (const kind of STORE_KINDS) {
    const raw = getStore(kind)?.getFlag(MODULE_ID, "quests") ?? {};
    for (const [id, quest] of Object.entries(raw)) {
      if (quest && typeof quest === "object") stored.push({ id, hidden: kind === "secret", quest });
    }
  }
  const storedRewards = [];
  for (const kind of STORE_KINDS) {
    for (const [id, reward] of Object.entries(getStore(kind)?.getFlag(MODULE_ID, "rewards") ?? {})) {
      if (reward && typeof reward === "object") storedRewards.push({ id, hidden: kind === "secret", reward });
    }
  }
  const storedNotes = storedPartyNotes();
  if (!stored.length && !storedRewards.length && !storedNotes.length) return ui.notifications.warn(t("Transfer.NothingToExport"));

  const hasHiddenParts = q => (q.hiddenFields?.length > 0)
    || PART_KINDS.some(kind => Object.values(q[kind] ?? {}).some(part => part?.hidden));
  const hiddenCount = stored.filter(s => s.hidden || hasHiddenParts(s.quest)).length + storedRewards.filter(r => r.hidden).length
    + storedNotes.filter(n => n.hidden).length;
  const statusRows = STATUSES.map(status => {
    const count = stored.filter(s => (s.quest.status ?? "active") === status).length;
    return `<label class="checkbox"><input type="checkbox" name="status-${status}" checked ${count ? "" : "disabled"}>
      ${escapeHTML(t(`Status.${status}`))} <span class="dxql-count">${count}</span></label>`;
  }).join("");
  const options = await DialogV2.wait({
    window: { title: t("Transfer.ExportTitle"), icon: "fa-solid fa-file-export" },
    position: { width: 420 },
    content: `<div class="dxql dxql-transfer">
      <p>${escapeHTML(t("Transfer.ExportIntro"))}</p>
      <fieldset><legend>${escapeHTML(t("Transfer.Include"))}</legend>
        <div class="dxql-transfer-checks">${statusRows}</div>
        ${storedRewards.length ? `<label class="checkbox"><input type="checkbox" name="rewards" checked>
          <i class="fa-solid fa-gift" inert></i> ${escapeHTML(t("Transfer.IncludeRewards"))} <span class="dxql-count">${storedRewards.length}</span></label>` : ""}
        ${storedNotes.length ? `<label class="checkbox"><input type="checkbox" name="partyNotes" checked>
          <i class="fa-solid fa-note-sticky" inert></i> ${escapeHTML(t("Transfer.IncludePartyNotes"))} <span class="dxql-count">${storedNotes.length}</span></label>` : ""}
        ${hiddenCount ? `<label class="checkbox"><input type="checkbox" name="hidden" checked>
          <i class="fa-solid fa-eye-slash" inert></i> ${escapeHTML(t("Transfer.IncludeHidden"))} <span class="dxql-count">${hiddenCount}</span></label>` : ""}
      </fieldset>
      <p class="dxql-hint">${escapeHTML(t("Transfer.ImagesNote"))}</p>
    </div>`,
    rejectClose: false,
    buttons: [
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
      {
        action: "export", label: t("Transfer.Export"), icon: "fa-solid fa-file-export", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
      }
    ]
  });
  if (!options || options === "cancel") return;

  const quests = stored
    .filter(s => options[`status-${s.quest.status ?? "active"}`] !== false)
    .filter(s => !s.hidden || options.hidden !== false)
    .map(s => ({ id: s.id, hidden: s.hidden, ...withNames(s.quest) }))
    .map(q => (options.hidden === false ? withoutHiddenParts(q) : q));
  const rewards = options.rewards === false ? [] : storedRewards
    .filter(r => !r.hidden || options.hidden !== false)
    .map(r => ({ id: r.id, hidden: r.hidden, ...rewardWithNames(r.reward) }));
  const partyNotes = options.partyNotes === false ? [] : storedNotes
    .filter(n => !n.hidden || options.hidden !== false)
    .map(n => ({ id: n.id, hidden: n.hidden, ...partyNoteWithNames(n.note) }));
  if (!quests.length && !rewards.length && !partyNotes.length) return ui.notifications.warn(t("Transfer.NothingToExport"));

  const data = {
    module: MODULE_ID,
    format: FORMAT,
    version: game.modules.get(MODULE_ID)?.version ?? null,
    world: game.world.id,
    worldTitle: game.world.title,
    exportedAt: new Date().toISOString(),
    quests,
    rewards,
    partyNotes
  };
  const date = new Date().toISOString().slice(0, 10);
  foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", `quest-log-${game.world.id}-${date}.json`);
  ui.notifications.info(t(partyNotes.length ? "Transfer.ExportedAll" : rewards.length ? "Transfer.ExportedWithRewards" : "Transfer.Exported",
    { count: quests.length, rewards: rewards.length, notes: partyNotes.length }));
}

/* -------------------------------------------- */
/*  Import                                      */
/* -------------------------------------------- */

const ID = /^[A-Za-z0-9]{1,32}$/;
const str = (v, max = 20000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const userId = v => (typeof v === "string" && ID.test(v) ? v : null);
const name = v => (typeof v === "string" && v.trim() ? cleanLine(v, 80) : null);

/** Accepts a keyed object or an array; returns [id, entry] pairs with safe ids. */
function entries(value) {
  const list = Array.isArray(value) ? value.map(v => [v?.id, v]) : Object.entries(value ?? {});
  const seen = new Set();
  return list.filter(([, v]) => v && typeof v === "object").map(([id, v]) => {
    let key = typeof id === "string" && ID.test(id) && !seen.has(id) ? id : randomId();
    seen.add(key);
    return [key, v];
  });
}

/** Turns one quest from a file into stored data, dropping anything unexpected. Returns null if unusable. */
export function sanitizeQuest(q) {
  if (!q || typeof q !== "object") return null;
  const title = cleanLine(q.title, 120);
  if (!title) return null;
  const now = Date.now();
  const quest = {
    title,
    status: STATUSES.includes(q.status) ? q.status : "active",
    description: str(q.description).trim(),
    giver: cleanLine(q.giver),
    giverImg: str(q.giverImg, 500),
    giverUuid: str(q.giverUuid, 200),
    acquiredAt: cleanLine(q.acquiredAt),
    location: cleanLine(q.location),
    chapter: cleanLine(q.chapter, 80),
    questType: QUEST_TYPES.includes(q.questType) ? q.questType : "",
    locations: {},
    reward: cleanLine(q.reward),
    tags: [...new Set((Array.isArray(q.tags) ? q.tags : []).map(cleanTag).filter(Boolean))],
    hiddenFields: [...new Set(Array.isArray(q.hiddenFields) ? q.hiddenFields : [])].filter(f => HIDEABLE_FIELDS.includes(f)),
    stages: {},
    objectives: {},
    notes: {},
    gallery: {},
    items: {},
    npcs: {},
    createdBy: userId(q.createdBy),
    authorName: name(q.authorName),
    createdAt: num(q.createdAt) || now,
    updatedAt: num(q.updatedAt) || now,
    closedAt: num(q.closedAt)
  };
  // Places: a keyed object or an array of {name, hidden} / plain strings.
  const placeList = Array.isArray(q.locations) ? q.locations.map(l => (typeof l === "string" ? { name: l } : l)) : q.locations;
  entries(placeList).forEach(([id, l], i) => {
    const placeName = cleanLine(l.name, 120);
    if (!placeName) return;
    quest.locations[id] = { name: placeName, hidden: !!l.hidden, sort: Number.isFinite(Number(l.sort)) ? Number(l.sort) : i };
  });
  if (Object.keys(quest.locations).length) quest.location = "";
  for (const [id, s] of entries(q.stages)) {
    const title = cleanLine(s.title, 120);
    if (!title) continue;
    quest.stages[id] = {
      title, text: str(s.text).trim(), hidden: !!s.hidden, sort: num(s.sort), createdAt: num(s.createdAt),
      createdBy: userId(s.createdBy), authorName: name(s.authorName)
    };
  }
  for (const [id, o] of entries(q.objectives)) {
    const text = cleanLine(o.text, 300);
    if (!text) continue;
    quest.objectives[id] = {
      text, done: !!o.done, hidden: !!o.hidden, sort: num(o.sort), createdAt: num(o.createdAt),
      stage: typeof o.stage === "string" && quest.stages[o.stage] ? o.stage : null,
      createdBy: userId(o.createdBy), authorName: name(o.authorName),
      doneBy: userId(o.doneBy), doneByName: name(o.doneByName)
    };
  }
  for (const [id, n] of entries(q.notes)) {
    const text = str(n.text).trim();
    const images = (Array.isArray(n.images) ? n.images : []).map(v => str(v, 500)).filter(Boolean);
    if (!text && !images.length) continue;
    const source = n.source && typeof n.source === "object" && str(n.source.uuid, 200)
      ? { uuid: str(n.source.uuid, 200), label: cleanLine(n.source.label, 120) } : null;
    quest.notes[id] = {
      type: NOTE_TYPES.includes(n.type) ? n.type : "note", text, images, source, hidden: !!n.hidden,
      createdBy: userId(n.createdBy), authorName: name(n.authorName),
      createdAt: num(n.createdAt), editedAt: num(n.editedAt), sort: num(n.sort) || num(n.createdAt)
    };
  }
  for (const [id, g] of entries(q.gallery)) {
    const src = str(g.src, 500);
    if (!src) continue;
    quest.gallery[id] = { src, hidden: !!g.hidden, createdBy: userId(g.createdBy), authorName: name(g.authorName), createdAt: num(g.createdAt), sort: num(g.sort) };
  }
  for (const [id, it] of entries(q.items)) {
    const itemName = cleanLine(it.name, 120);
    if (!itemName) continue;
    quest.items[id] = {
      name: itemName, uuid: str(it.uuid, 200), img: str(it.img, 500), have: !!it.have, hidden: !!it.hidden,
      createdBy: userId(it.createdBy), authorName: name(it.authorName), createdAt: num(it.createdAt), sort: num(it.sort)
    };
  }
  for (const [id, n] of entries(q.npcs)) {
    const npcName = cleanLine(n.name, 80);
    if (!npcName) continue;
    quest.npcs[id] = {
      name: npcName, faceId: userId(n.faceId) ?? "", uuid: str(n.uuid, 200), img: str(n.img, 500), auto: !!n.auto, hidden: !!n.hidden, autoHidden: !!(n.autoHidden && n.hidden),
      createdBy: userId(n.createdBy), authorName: name(n.authorName), createdAt: num(n.createdAt), sort: num(n.sort)
    };
  }
  return quest;
}

/** Turns one reward from a file into stored data, dropping anything unexpected. Returns null if unusable. */
export function sanitizeReward(r) {
  if (!r || typeof r !== "object") return null;
  const title = cleanLine(r.name, 120);
  if (!title) return null;
  const now = Date.now();
  const maxUses = Math.min(Math.max(Math.floor(num(r.maxUses)), 0), MAX_USES);
  const reward = {
    name: title,
    description: str(r.description).trim(),
    img: str(r.img, 500),
    maxUses,
    spent: Math.min(Math.max(Math.trunc(num(r.spent)), -MAX_USES), MAX_USES),
    uses: {},
    claimed: !!r.claimed,
    claimedAt: num(r.claimedAt),
    questId: typeof r.questId === "string" && ID.test(r.questId) ? r.questId : "",
    links: {},
    createdBy: userId(r.createdBy),
    authorName: name(r.authorName),
    createdAt: num(r.createdAt) || now,
    updatedAt: num(r.updatedAt) || now
  };
  for (const [id, u] of entries(r.uses)) {
    reward.uses[id] = { by: userId(u.by), byName: name(u.byName), at: num(u.at), sort: num(u.sort) || num(u.at) };
  }
  const linkList = Array.isArray(r.links) ? r.links.map(l => (typeof l === "string" ? { name: l } : l)) : r.links;
  entries(linkList).forEach(([id, l], i) => {
    const linkName = cleanLine(l.name, 120);
    if (!linkName) return;
    reward.links[id] = {
      type: LINK_TYPES.includes(l.type) ? l.type : "other",
      name: linkName,
      uuid: str(l.uuid, 200),
      sort: Number.isFinite(Number(l.sort)) ? Number(l.sort) : i
    };
  });
  return reward;
}

/** Turns one party note from a file into stored data, dropping anything unexpected. Returns null if unusable. */
export function sanitizePartyNote(n) {
  if (!n || typeof n !== "object") return null;
  const title = cleanLine(n.title, 120);
  if (!title) return null;
  const now = Date.now();
  const note = {
    title,
    text: str(n.text).trim(),
    tags: [...new Set((Array.isArray(n.tags) ? n.tags : []).map(cleanTag).filter(Boolean))],
    questId: typeof n.questId === "string" && ID.test(n.questId) ? n.questId : "",
    links: {},
    gallery: {},
    pinned: !!n.pinned,
    createdBy: userId(n.createdBy),
    authorName: name(n.authorName),
    editedBy: userId(n.editedBy),
    editedByName: name(n.editedByName),
    createdAt: num(n.createdAt) || now,
    editedAt: num(n.editedAt),
    updatedAt: num(n.updatedAt) || now
  };
  const linkList = Array.isArray(n.links) ? n.links.map(l => (typeof l === "string" ? { name: l } : l)) : n.links;
  entries(linkList).forEach(([id, l], i) => {
    const linkName = cleanLine(l.name, 120);
    if (!linkName) return;
    note.links[id] = {
      type: LINK_TYPES.includes(l.type) ? l.type : "other",
      name: linkName,
      uuid: str(l.uuid, 200),
      sort: Number.isFinite(Number(l.sort)) ? Number(l.sort) : i
    };
  });
  // Images: a keyed object of {src}, or a list of sources.
  const imageList = Array.isArray(n.gallery ?? n.images)
    ? (n.gallery ?? n.images).map(g => (typeof g === "string" ? { src: g } : g)) : n.gallery;
  entries(imageList).forEach(([id, g], i) => {
    const src = str(g.src, 500);
    if (!src) return;
    note.gallery[id] = { src, createdBy: userId(g.createdBy), authorName: name(g.authorName), createdAt: num(g.createdAt), sort: num(g.sort) || i };
  });
  return note;
}

function pickJsonFile() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/**
 * Reads and checks an export file. Returns {quests: [{id, hidden, quest}], rewards: [{id, hidden, reward}],
 * partyNotes: [{id, hidden, note}], hasRewards, hasPartyNotes, meta} or throws a readable error.
 */
export function parseExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t("Transfer.NotJson"));
  }
  return parseExportData(data);
}

/**
 * Checks already-parsed export data (a file's contents, or the quest log stored on an Adventure).
 * hiddenByDefault: a quest without a "hidden" field is treated as hidden (used for adventures).
 */
export function parseExportData(data, { hiddenByDefault = false } = {}) {
  const list = Array.isArray(data) ? data
    : data?.quests ?? (Array.isArray(data?.rewards) || Array.isArray(data?.partyNotes) ? [] : null);
  if (!Array.isArray(list) || (!Array.isArray(data) && data.module && data.module !== MODULE_ID)) {
    throw new Error(t("Transfer.NotAnExport"));
  }
  const quests = [];
  const seen = new Set();
  for (const raw of list) {
    const quest = sanitizeQuest(raw);
    if (!quest) continue;
    let id = typeof raw.id === "string" && ID.test(raw.id) && !seen.has(raw.id) ? raw.id : randomId();
    seen.add(id);
    const hidden = typeof raw.hidden === "boolean" ? raw.hidden : hiddenByDefault;
    quests.push({ id, hidden, quest });
  }
  const rewards = [];
  const rewardList = !Array.isArray(data) && Array.isArray(data?.rewards) ? data.rewards : [];
  const seenRewards = new Set();
  for (const raw of rewardList) {
    const reward = sanitizeReward(raw);
    if (!reward) continue;
    const id = typeof raw.id === "string" && ID.test(raw.id) && !seenRewards.has(raw.id) ? raw.id : randomId();
    seenRewards.add(id);
    rewards.push({ id, hidden: typeof raw.hidden === "boolean" ? raw.hidden : hiddenByDefault, reward });
  }
  const partyNotes = [];
  const noteList = !Array.isArray(data) && Array.isArray(data?.partyNotes) ? data.partyNotes : [];
  const seenNotes = new Set();
  for (const raw of noteList) {
    const note = sanitizePartyNote(raw);
    if (!note) continue;
    const id = typeof raw.id === "string" && ID.test(raw.id) && !seenNotes.has(raw.id) ? raw.id : randomId();
    seenNotes.add(id);
    partyNotes.push({ id, hidden: typeof raw.hidden === "boolean" ? raw.hidden : hiddenByDefault, note });
  }
  if (!quests.length && !rewards.length && !partyNotes.length) throw new Error(t("Transfer.NoQuestsInFile"));
  const meta = Array.isArray(data) ? {} : data;
  return {
    quests,
    rewards,
    // Only a file that has a rewards list replaces the rewards (older exports have none).
    hasRewards: !Array.isArray(data) && Array.isArray(data?.rewards),
    // The same for the party notes.
    partyNotes,
    hasPartyNotes: !Array.isArray(data) && Array.isArray(data?.partyNotes),
    meta: { worldTitle: meta.worldTitle ?? meta.world ?? null, exportedAt: meta.exportedAt ?? null }
  };
}

/** Imports quests from a JSON export. Asks for a file when none is given (a File or Blob with a name). */
export async function importQuests(file = null) {
  if (!game.user.isGM) return;
  const shared = getStore("shared");
  const secret = getStore("secret");
  if (!shared || !secret) return ui.notifications.warn(t("NotReady"));
  file ??= await pickJsonFile();
  if (!file) return;

  let parsed;
  try {
    parsed = parseExport(await foundry.utils.readTextFromFile(file));
  } catch (err) {
    return ui.notifications.error(t("Transfer.ReadError", { name: escapeHTML(file.name), error: escapeHTML(err.message) }));
  }

  const current = new Map();
  for (const kind of STORE_KINDS) {
    for (const id of Object.keys(getStore(kind)?.getFlag(MODULE_ID, "quests") ?? {})) current.set(id, kind);
  }
  const currentRewards = new Map();
  for (const kind of STORE_KINDS) {
    for (const id of Object.keys(getStore(kind)?.getFlag(MODULE_ID, "rewards") ?? {})) currentRewards.set(id, kind);
  }
  const currentNotes = new Map();
  for (const kind of STORE_KINDS) {
    for (const id of Object.keys(getStore(kind)?.getFlag(MODULE_ID, "partyNotes") ?? {})) currentNotes.set(id, kind);
  }
  const overlap = parsed.quests.filter(q => current.has(q.id)).length + parsed.rewards.filter(r => currentRewards.has(r.id)).length
    + parsed.partyNotes.filter(n => currentNotes.has(n.id)).length;
  const hidden = parsed.quests.filter(q => q.hidden || q.quest.hiddenFields.length
    || PART_KINDS.some(kind => Object.values(q.quest[kind]).some(part => part.hidden))).length;
  const from = [parsed.meta.worldTitle, parsed.meta.exportedAt ? new Date(parsed.meta.exportedAt).toLocaleString() : null]
    .filter(Boolean).map(escapeHTML).join(" · ");

  const mode = await DialogV2.wait({
    window: { title: t("Transfer.ImportTitle"), icon: "fa-solid fa-file-import" },
    position: { width: 460 },
    content: `<div class="dxql dxql-transfer">
      <p>${t(parsed.partyNotes.length ? "Transfer.ImportSummaryAll" : parsed.rewards.length ? "Transfer.ImportSummaryRewards" : "Transfer.ImportSummary",
        { count: parsed.quests.length, rewards: parsed.rewards.length, notes: parsed.partyNotes.length, file: escapeHTML(file.name) })}${from ? `<br><span class="dxql-hint">${from}</span>` : ""}</p>
      ${hidden ? `<p class="dxql-hint"><i class="fa-solid fa-eye-slash" inert></i> ${escapeHTML(t("Transfer.HiddenNote", { count: hidden }))}</p>` : ""}
      <label class="dxql-transfer-mode"><input type="radio" name="mode" value="merge" checked>
        <span><b>${escapeHTML(t("Transfer.Merge"))}</b><br><span class="dxql-hint">${escapeHTML(overlap
          ? t("Transfer.MergeHintOverlap", { count: overlap }) : t("Transfer.MergeHint"))}</span></span></label>
      <label class="dxql-transfer-mode danger"><input type="radio" name="mode" value="replace">
        <span><b>${escapeHTML(t("Transfer.Replace"))}</b><br><span class="dxql-hint">${escapeHTML(t("Transfer.ReplaceHint", { count: current.size }))}</span></span></label>
      <p class="dxql-hint">${escapeHTML(t("Transfer.ImagesNote"))}</p>
    </div>`,
    rejectClose: false,
    buttons: [
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
      {
        action: "import", label: t("Transfer.Import"), icon: "fa-solid fa-file-import", default: true,
        callback: (event, button) => button.form.elements.mode.value
      }
    ]
  });
  if (!mode || mode === "cancel") return;
  if (mode === "replace" && current.size) {
    const ok = await DialogV2.confirm({
      window: { title: t("Transfer.Replace"), icon: "fa-solid fa-triangle-exclamation" },
      content: `<p>${t("Transfer.ReplaceConfirm", { count: current.size })}</p>`,
      rejectClose: false
    });
    if (!ok) return;
  }

  const options = { [MODULE_ID]: { type: "imported" } };
  const stores = { shared, secret };

  // Clear what's being replaced: the whole log, or (merge) the quests and rewards the file brings a new version of.
  for (const kind of STORE_KINDS) {
    const store = stores[kind];
    if (mode === "replace") {
      const clear = {};
      if (Object.keys(store.getFlag(MODULE_ID, "quests") ?? {}).length) clear[`flags.${MODULE_ID}.-=quests`] = null;
      if (parsed.hasRewards && Object.keys(store.getFlag(MODULE_ID, "rewards") ?? {}).length) clear[`flags.${MODULE_ID}.-=rewards`] = null;
      if (parsed.hasPartyNotes && Object.keys(store.getFlag(MODULE_ID, "partyNotes") ?? {}).length) clear[`flags.${MODULE_ID}.-=partyNotes`] = null;
      if (Object.keys(clear).length) await store.update(clear, options);
      continue;
    }
    const removals = {};
    for (const q of parsed.quests) if (current.get(q.id) === kind) removals[`${FLAG_PATH}.-=${q.id}`] = null;
    for (const r of parsed.rewards) if (currentRewards.get(r.id) === kind) removals[`${REWARD_PATH}.-=${r.id}`] = null;
    for (const n of parsed.partyNotes) if (currentNotes.get(n.id) === kind) removals[`${PARTY_NOTE_PATH}.-=${n.id}`] = null;
    if (Object.keys(removals).length) await store.update(removals, options);
  }
  // A reward from (or a note about) a hidden quest goes to the GM-only store with it.
  const hiddenQuests = new Set(parsed.quests.filter(q => q.hidden).map(q => q.id));
  if (mode !== "replace") for (const [id, kind] of current) if (kind === "secret" && !parsed.quests.some(q => q.id === id)) hiddenQuests.add(id);
  for (const kind of STORE_KINDS) {
    const update = {};
    const map = {};
    for (const q of parsed.quests) if ((q.hidden ? "secret" : "shared") === kind) map[q.id] = q.quest;
    if (Object.keys(map).length) update[FLAG_PATH] = map;
    const rewardMap = {};
    for (const r of parsed.rewards) {
      if (((r.hidden || hiddenQuests.has(r.reward.questId)) ? "secret" : "shared") === kind) rewardMap[r.id] = r.reward;
    }
    if (Object.keys(rewardMap).length) update[REWARD_PATH] = rewardMap;
    const noteMap = {};
    for (const n of parsed.partyNotes) {
      if (((n.hidden || hiddenQuests.has(n.note.questId)) ? "secret" : "shared") === kind) noteMap[n.id] = n.note;
    }
    if (Object.keys(noteMap).length) update[PARTY_NOTE_PATH] = noteMap;
    if (Object.keys(update).length) await stores[kind].update(update, options);
  }
  ui.notifications.info(t(parsed.partyNotes.length ? "Transfer.ImportedAll" : parsed.rewards.length ? "Transfer.ImportedWithRewards" : "Transfer.Imported",
    { count: parsed.quests.length, rewards: parsed.rewards.length, notes: parsed.partyNotes.length }));
}
