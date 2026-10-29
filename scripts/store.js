import {
  MODULE_ID, STATUSES, NOTE_TYPES, HIDEABLE_FIELDS, PART_KINDS, QUEST_TYPES, LINK_TYPES, MAX_USES, t, isResponsibleGM, randomId, cleanLine, cleanTag
} from "./util.js";

/*
 * Quests live in the flags of two journal entries that the module creates and hides from the Journal directory:
 *   - "shared": default ownership OWNER, so every player can read and write quests without a GM online.
 *   - "secret": default ownership NONE, the GM's hidden quests (players' clients never receive it).
 * Every quest, objective, note and gallery image is keyed by id, and every write is a dot-path update of just that
 * key, so two people editing different parts of the log at the same time never overwrite each other.
 * Quest rewards live next to the quests, in flags.<module>.rewards.<id> of the same two journals (hidden rewards in
 * the "secret" one), and so do the party's own notes, in flags.<module>.partyNotes.<id>.
 */

export const STORE_KINDS = ["shared", "secret"];
const FLAG_PATH = `flags.${MODULE_ID}.quests`;

export function getStore(kind) {
  return game.journal?.find(j => j.getFlag(MODULE_ID, "store") === kind) ?? null;
}

export function isStore(doc) {
  return !!doc?.getFlag?.(MODULE_ID, "store");
}

export function storeIds() {
  return STORE_KINDS.map(getStore).filter(Boolean).map(j => j.id);
}

export function storesReady() {
  return !!getStore("shared");
}

/** First GM start: create the two store journals. */
export async function ensureStores() {
  if (!isResponsibleGM()) return;
  const O = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const specs = [
    { kind: "shared", name: t("StoreShared"), ownership: { default: O.OWNER } },
    { kind: "secret", name: t("StoreSecret"), ownership: { default: O.NONE } }
  ];
  for (const spec of specs) {
    if (getStore(spec.kind)) continue;
    await JournalEntry.implementation.create({
      name: spec.name,
      ownership: spec.ownership,
      flags: { [MODULE_ID]: { store: spec.kind, quests: {} } }
    });
  }
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

function sortedEntries(obj) {
  return Object.entries(obj ?? {})
    .filter(([, v]) => v && typeof v === "object")
    .map(([id, v]) => ({ ...v, id }))
    .sort((a, b) => (a.sort ?? a.createdAt ?? 0) - (b.sort ?? b.createdAt ?? 0));
}

/**
 * The places a quest takes place at, as stored: [{id, name, hidden, sort}]. Quests from before places were a list
 * keep one text in `location`; it is read as a single place with the id "legacy" (and written as a list on the next
 * save). A hidden "location" field (the old whole-field toggle) hides every place.
 */
export function locationsOf(raw) {
  const fieldHidden = hiddenFieldsOf(raw).includes("location");
  const keyed = sortedEntries(raw?.locations)
    .map(l => ({ id: l.id, name: cleanLine(l.name, 120), hidden: !!l.hidden || fieldHidden, sort: l.sort ?? 0 }))
    .filter(l => l.name);
  if (keyed.length) return keyed;
  const legacy = cleanLine(raw?.location, 120);
  return legacy ? [{ id: "legacy", name: legacy, hidden: fieldHidden, sort: 0 }] : [];
}

/** The detail fields of a stored quest that the GM has hidden from players. */
export function hiddenFieldsOf(raw) {
  return Array.isArray(raw?.hiddenFields) ? raw.hiddenFields.filter(f => HIDEABLE_FIELDS.includes(f)) : [];
}

/**
 * Turns stored quest data into the view model. For players (forGM false) every part the GM has hidden is left out:
 * hidden objectives, notes and images are dropped and hidden detail fields come back empty, so nothing downstream
 * (list, search, progress, grouping, related quests) can show them.
 */
export function normalizeQuest(id, raw, hidden, { forGM = game.user.isGM } = {}) {
  const visible = entry => forGM || !entry.hidden;
  const hiddenFields = hiddenFieldsOf(raw);
  const isFieldHidden = field => !forGM && hiddenFields.includes(field);
  // Stages group objectives. A hidden stage hides its objectives from players too.
  const rawStages = sortedEntries(raw.stages);
  const stageIds = new Set(rawStages.map(s => s.id));
  const hiddenStages = new Set(rawStages.filter(s => s.hidden).map(s => s.id));
  const stages = rawStages.filter(visible).map(s => ({
    id: s.id, title: String(s.title ?? "").trim() || t("UntitledStage"), text: String(s.text ?? ""), hidden: !!s.hidden,
    sort: s.sort ?? 0, createdBy: s.createdBy ?? null, createdAt: s.createdAt ?? 0, authorName: s.authorName ?? null
  }));
  const objectives = sortedEntries(raw.objectives).filter(visible)
    .filter(o => forGM || !hiddenStages.has(o.stage)).map(o => ({
    id: o.id, text: String(o.text ?? ""), done: !!o.done, sort: o.sort ?? 0, hidden: !!o.hidden,
    stage: stageIds.has(o.stage) ? o.stage : null,
    createdBy: o.createdBy ?? null, createdAt: o.createdAt ?? 0, doneBy: o.doneBy ?? null,
    authorName: o.authorName ?? null, doneByName: o.doneByName ?? null
  }));
  const notes = sortedEntries(raw.notes).filter(visible).map(n => ({
    id: n.id,
    hidden: !!n.hidden,
    type: NOTE_TYPES.includes(n.type) ? n.type : "note",
    text: String(n.text ?? ""),
    images: Array.isArray(n.images) ? n.images.filter(Boolean) : [],
    source: n.source?.uuid ? { uuid: n.source.uuid, label: String(n.source.label ?? "") } : null,
    createdBy: n.createdBy ?? null, createdAt: n.createdAt ?? 0, editedAt: n.editedAt ?? 0,
    authorName: n.authorName ?? null
  }));
  const gallery = sortedEntries(raw.gallery).filter(g => g.src).filter(visible).map(g => ({
    id: g.id, src: g.src, hidden: !!g.hidden, createdBy: g.createdBy ?? null, createdAt: g.createdAt ?? 0
  }));
  const field = (key, value) => (isFieldHidden(key) ? "" : String(value ?? ""));
  const locations = locationsOf(raw).filter(visible);
  return {
    id,
    hidden,
    title: String(raw.title ?? "").trim() || t("Untitled"),
    status: STATUSES.includes(raw.status) ? raw.status : "active",
    description: field("description", raw.description),
    giver: field("giver", raw.giver),
    giverImg: isFieldHidden("giver") ? "" : raw.giverImg ?? "",
    giverUuid: isFieldHidden("giver") ? "" : raw.giverUuid ?? "",
    acquiredAt: field("acquiredAt", raw.acquiredAt),
    /** The places the quest takes place at ([{id, name, hidden}]), and their names as one text. */
    locations,
    location: locations.map(l => l.name).join(", "),
    chapter: field("chapter", raw.chapter),
    questType: isFieldHidden("questType") || !QUEST_TYPES.includes(raw.questType) ? "" : raw.questType,
    reward: field("reward", raw.reward),
    tags: isFieldHidden("tags") ? [] : Array.isArray(raw.tags) ? raw.tags.map(cleanTag).filter(Boolean) : [],
    /** Detail fields hidden from players (GMs only; always empty for players). */
    hiddenFields: forGM ? hiddenFields : [],
    stages,
    objectives,
    notes,
    gallery,
    createdBy: raw.createdBy ?? null,
    authorName: raw.authorName ?? null,
    createdAt: raw.createdAt ?? 0,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? 0,
    closedAt: raw.closedAt ?? 0
  };
}

/** Every quest this user can see. */
export function allQuests() {
  const quests = [];
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    if (!store || !store.testUserPermission(game.user, "OBSERVER")) continue;
    const raw = store.getFlag(MODULE_ID, "quests") ?? {};
    for (const [id, q] of Object.entries(raw)) {
      if (q && typeof q === "object") quests.push(normalizeQuest(id, q, kind === "secret"));
    }
  }
  return quests;
}

function rawQuest(id) {
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    const raw = store?.getFlag(MODULE_ID, "quests")?.[id];
    if (raw) return { store, kind, raw };
  }
  return null;
}

/** Names of the detail fields hidden from players on a quest (so a player's edit form can leave them out). */
export function hiddenFieldsFor(id) {
  return hiddenFieldsOf(rawQuest(id)?.raw);
}

export function getQuest(id) {
  const found = rawQuest(id);
  if (!found) return null;
  // A hidden quest lives in the GM-only store: players must never get it, even by id (e.g. from a @Quest link).
  if (!found.store.testUserPermission(game.user, "OBSERVER")) return null;
  return normalizeQuest(id, found.raw, found.kind === "secret");
}

/* -------------------------------------------- */
/*  Permissions                                 */
/* -------------------------------------------- */

export function canDelete(createdBy) {
  if (game.user.isGM) return true;
  if (game.settings.get(MODULE_ID, "playersCanDelete")) return true;
  return !!createdBy && createdBy === game.user.id;
}

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

async function patch(id, data, event) {
  const found = rawQuest(id);
  if (!found) throw new Error(`Quest ${id} not found`);
  const update = { [`${FLAG_PATH}.${id}`]: { ...data, updatedAt: Date.now() } };
  return found.store.update(update, { [MODULE_ID]: event ? { ...event, questId: id } : { questId: id } });
}

function questFields(data, raw = null) {
  const out = {};
  if ("title" in data) out.title = cleanLine(data.title, 120);
  for (const key of ["giver", "acquiredAt", "reward"]) if (key in data) out[key] = cleanLine(data[key]);
  if ("chapter" in data) out.chapter = cleanLine(data.chapter, 80);
  if ("questType" in data) out.questType = QUEST_TYPES.includes(data.questType) ? data.questType : "";
  if ("locations" in data) Object.assign(out, locationFields(data.locations, raw));
  if ("giverImg" in data) out.giverImg = data.giverImg || "";
  if ("giverUuid" in data) out.giverUuid = data.giverUuid || "";
  if ("description" in data) out.description = String(data.description ?? "").trim();
  if ("tags" in data) out.tags = [...new Set((data.tags ?? []).map(cleanTag).filter(Boolean))];
  if (game.user.isGM && "hiddenFields" in data) {
    out.hiddenFields = [...new Set(data.hiddenFields ?? [])].filter(f => HIDEABLE_FIELDS.includes(f));
  }
  // Once places are a list, each place carries its own flag: the old whole-field "location" toggle goes.
  if (out.locations && out.hiddenFields) out.hiddenFields = out.hiddenFields.filter(f => f !== "location");
  // Players never see hidden fields, so they must never overwrite them either.
  if (!game.user.isGM && raw) {
    for (const f of hiddenFieldsOf(raw)) {
      delete out[f];
      if (f === "giver") { delete out.giverImg; delete out.giverUuid; }
      if (f === "location") delete out.locations;
    }
  }
  return out;
}

/**
 * The update for a new list of places [{id, name, hidden}] (from the edit form). Places keep their ids; removed ones
 * are deleted with "-=id". A player's list lacks the places hidden from them, so those are never removed or changed
 * by a player. The old one-text `location` is cleared once places are a list.
 */
function locationFields(list, raw) {
  const current = raw ? locationsOf(raw) : [];
  const currentIds = new Set(current.map(l => l.id));
  const maxSort = current.reduce((m, l) => Math.max(m, Number(l.sort) || 0), -1);
  const map = {};
  const kept = new Set();
  (list ?? []).forEach((l, i) => {
    const name = cleanLine(l?.name, 120);
    if (!name) return;
    const known = l.id && l.id !== "legacy" && currentIds.has(l.id);
    const lid = known ? l.id : randomId();
    if (known) kept.add(l.id);
    map[lid] = { name };
    if (game.user.isGM) {
      // The GM sees every place, so the list order is the order.
      map[lid].sort = i;
      map[lid].hidden = !!l.hidden;
    } else if (!known) {
      // A player's list lacks hidden places: new places go after all of them, known ones keep their position.
      map[lid].sort = maxSort + 1 + i;
      map[lid].hidden = false;
    }
  });
  for (const c of current) {
    if (c.id === "legacy" || kept.has(c.id)) continue;
    if (!game.user.isGM && c.hidden) continue;
    map[`-=${c.id}`] = null;
  }
  const out = { locations: map, location: "" };
  // The old whole-field toggle is replaced by each place's own flag (set above from the GM's list).
  if (game.user.isGM && raw && hiddenFieldsOf(raw).includes("location")) {
    out.hiddenFields = hiddenFieldsOf(raw).filter(f => f !== "location");
  }
  return out;
}

export async function createQuest(data = {}, { hidden = false } = {}) {
  const kind = hidden && game.user.isGM ? "secret" : "shared";
  const store = getStore(kind);
  if (!store) {
    ui.notifications.warn(t("NotReady"));
    return null;
  }
  const id = randomId();
  const now = Date.now();
  const quest = {
    title: "", description: "", giver: "", giverImg: "", giverUuid: "", acquiredAt: "", location: "", reward: "",
    chapter: "", questType: "", tags: [], locations: {}, stages: {}, objectives: {}, notes: {}, gallery: {},
    ...questFields(data),
    status: "active",
    createdBy: game.user.id,
    createdAt: now,
    updatedAt: now
  };
  if (!quest.title) quest.title = t("Untitled");
  const gmHidden = !!(game.user.isGM && data.objectivesHidden);
  for (const text of data.objectives ?? []) {
    const oid = randomId();
    quest.objectives[oid] = { text: cleanLine(text, 300), done: false, hidden: gmHidden, sort: now + Object.keys(quest.objectives).length, createdBy: game.user.id, createdAt: now };
  }
  for (const src of data.images ?? []) {
    const gid = randomId();
    quest.gallery[gid] = { src, createdBy: game.user.id, createdAt: now, sort: now + Object.keys(quest.gallery).length };
  }
  await store.update({ [`${FLAG_PATH}.${id}`]: quest }, { [MODULE_ID]: { type: "created", questId: id, title: quest.title } });
  return id;
}

export async function updateQuest(id, data) {
  return patch(id, questFields(data, rawQuest(id)?.raw));
}

/* Hiding parts of a quest from players (GM only) */

/** Hides or reveals one stage, objective, note/clue or gallery image. */
export async function setPartHidden(id, kind, partId, hidden) {
  if (!game.user.isGM || !PART_KINDS.includes(kind)) return;
  const raw = rawQuest(id)?.raw;
  if (kind === "locations") return setLocationHidden(id, raw, partId, hidden);
  const part = raw?.[kind]?.[partId];
  if (!part || !!part.hidden === !!hidden) return;
  const event = hidden ? null : { type: `revealed-${kind}`, noteType: part.type ?? null, title: raw.title };
  return patch(id, { [kind]: { [partId]: { hidden: !!hidden } } }, event);
}

/**
 * Hides or reveals one place. Old quests (one-text location, or the whole-field toggle) are first written as a list
 * of places, each with its own flag.
 */
async function setLocationHidden(id, raw, partId, hidden) {
  const list = locationsOf(raw);
  const place = list.find(l => l.id === partId);
  if (!place || place.hidden === !!hidden) return;
  const migrate = list.some(l => l.id === "legacy") || hiddenFieldsOf(raw).includes("location");
  const event = hidden ? null : { type: "revealed-locations", name: place.name, title: raw.title };
  if (!migrate) return patch(id, { locations: { [partId]: { hidden: !!hidden } } }, event);
  const update = locationFields(list.map(l => (l.id === partId ? { ...l, hidden: !!hidden } : l)), raw);
  // A migrated legacy place gets a new id; keep the toggle on it.
  return patch(id, update, event);
}

/** Hides or reveals one detail field (giver, acquiredAt, reward, description, tags, chapter, questType). */
export async function setFieldHidden(id, field, hidden) {
  if (!game.user.isGM || !HIDEABLE_FIELDS.includes(field)) return;
  const raw = rawQuest(id)?.raw;
  if (!raw) return;
  const fields = new Set(hiddenFieldsOf(raw));
  if (fields.has(field) === !!hidden) return;
  if (hidden) fields.add(field);
  else fields.delete(field);
  const event = hidden ? null : { type: "revealed-field", field, title: raw.title };
  return patch(id, { hiddenFields: [...fields] }, event);
}

export async function setStatus(id, status) {
  if (!STATUSES.includes(status)) return;
  const quest = getQuest(id);
  if (!quest || quest.status === status) return;
  return patch(id, { status, closedAt: status === "active" ? 0 : Date.now() }, { type: `status-${status}`, title: quest.title });
}

export async function deleteQuest(id) {
  const found = rawQuest(id);
  if (!found) return;
  return found.store.update({ [`${FLAG_PATH}.-=${id}`]: null }, { [MODULE_ID]: { type: "deleted", questId: id } });
}

/** How many quests are in each store: {shared, secret, total}. */
export function countQuests() {
  const counts = { total: 0 };
  for (const kind of STORE_KINDS) {
    const raw = getStore(kind)?.getFlag(MODULE_ID, "quests") ?? {};
    counts[kind] = Object.values(raw).filter(q => q && typeof q === "object").length;
    counts.total += counts[kind];
  }
  return counts;
}

/** GM only: deletes every quest in both stores (the store journals stay). Returns how many were deleted. */
export async function deleteAllQuests() {
  if (!game.user.isGM) return 0;
  let deleted = 0;
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    const raw = store?.getFlag(MODULE_ID, "quests") ?? {};
    if (!Object.keys(raw).length) continue;
    await store.update({ [`flags.${MODULE_ID}.-=quests`]: null }, { [MODULE_ID]: { type: "deleted-all" } });
    deleted += Object.values(raw).filter(q => q && typeof q === "object").length;
  }
  return deleted;
}

/** GM only: move a quest between the shared and the secret store. */
export async function setHidden(id, hidden) {
  if (!game.user.isGM) return;
  const found = rawQuest(id);
  const targetKind = hidden ? "secret" : "shared";
  if (!found || found.kind === targetKind) return;
  const target = getStore(targetKind);
  if (!target) return;
  const raw = foundry.utils.deepClone(found.raw);
  raw.updatedAt = Date.now();
  await target.update({ [`${FLAG_PATH}.${id}`]: raw },
    { [MODULE_ID]: { type: hidden ? "hidden" : "revealed", questId: id, title: raw.title } });
  await found.store.update({ [`${FLAG_PATH}.-=${id}`]: null }, { [MODULE_ID]: { type: "moved", questId: id } });
}

/* Objectives */

export async function addObjective(id, text, { hidden = false, stage = null } = {}) {
  const clean = cleanLine(text, 300);
  if (!clean) return null;
  const oid = randomId();
  const now = Date.now();
  const secret = !!(hidden && game.user.isGM);
  const stages = rawQuest(id)?.raw?.stages ?? {};
  const stageId = stage && stages[stage] ? stage : null;
  await patch(id, { objectives: { [oid]: { text: clean, done: false, hidden: secret, stage: stageId, sort: now, createdBy: game.user.id, createdAt: now } } },
    { type: "objective-added" });
  return oid;
}

export async function updateObjective(id, oid, data) {
  const change = {};
  if ("text" in data) change.text = cleanLine(data.text, 300);
  if ("done" in data) {
    change.done = !!data.done;
    change.doneBy = data.done ? game.user.id : null;
  }
  return patch(id, { objectives: { [oid]: change } });
}

export async function deleteObjective(id, oid) {
  return patch(id, { objectives: { [`-=${oid}`]: null } });
}

export async function moveObjective(id, oid, direction) {
  const quest = getQuest(id);
  if (!quest) return;
  // Objectives move within their own stage.
  const current = quest.objectives.find(o => o.id === oid);
  const list = quest.objectives.filter(o => o.stage === (current?.stage ?? null));
  const index = list.findIndex(o => o.id === oid);
  const other = list[index + direction];
  if (index < 0 || !other) return;
  const a = list[index].sort || index;
  const b = other.sort || index + direction;
  return patch(id, { objectives: { [oid]: { sort: b === a ? a + direction : b }, [other.id]: { sort: a } } });
}

/* Stages: a stage is a heading with a short text that groups objectives (a new phase of the quest). */

export async function addStage(id, { title = "", text = "", hidden = false } = {}) {
  const clean = cleanLine(title, 120);
  if (!clean) return null;
  const sid = randomId();
  const now = Date.now();
  await patch(id, {
    stages: { [sid]: { title: clean, text: String(text ?? "").trim(), hidden: !!(hidden && game.user.isGM), sort: now, createdBy: game.user.id, createdAt: now } }
  }, { type: "stage-added" });
  return sid;
}

export async function updateStage(id, sid, data) {
  const change = {};
  if ("title" in data) change.title = cleanLine(data.title, 120);
  if ("text" in data) change.text = String(data.text ?? "").trim();
  if (!Object.keys(change).length) return;
  return patch(id, { stages: { [sid]: change } });
}

/** Deletes a stage. Its objectives stay, without a stage; those of a hidden stage stay hidden. */
export async function deleteStage(id, sid) {
  const raw = rawQuest(id)?.raw;
  const stage = raw?.stages?.[sid];
  if (!stage) return;
  const objectives = {};
  for (const [oid, o] of Object.entries(raw.objectives ?? {})) {
    if (o?.stage === sid) objectives[oid] = stage.hidden ? { stage: null, hidden: true } : { stage: null };
  }
  return patch(id, { stages: { [`-=${sid}`]: null }, objectives });
}

/* Notes and clues */

export async function addNote(id, { type = "note", text = "", images = [], source = null, hidden = false } = {}) {
  const clean = String(text ?? "").trim();
  if (!clean && !images.length) return null;
  const nid = randomId();
  const now = Date.now();
  await patch(id, {
    notes: {
      [nid]: {
        type: NOTE_TYPES.includes(type) ? type : "note",
        text: clean,
        images: [...images],
        source: source?.uuid ? { uuid: source.uuid, label: cleanLine(source.label, 120) } : null,
        hidden: !!(hidden && game.user.isGM),
        createdBy: game.user.id,
        createdAt: now,
        sort: now
      }
    }
  }, { type: `${type}-added` });
  return nid;
}

export async function updateNote(id, nid, data) {
  const change = {};
  if ("text" in data) change.text = String(data.text ?? "").trim();
  if ("type" in data && NOTE_TYPES.includes(data.type)) change.type = data.type;
  if ("images" in data) change.images = [...data.images];
  if ("text" in data || "images" in data) change.editedAt = Date.now();
  return patch(id, { notes: { [nid]: change } });
}

export async function deleteNote(id, nid) {
  return patch(id, { notes: { [`-=${nid}`]: null } });
}

/* Gallery */

export async function addImages(id, sources, { hidden = false } = {}) {
  if (!sources?.length) return;
  const now = Date.now();
  const gallery = {};
  const secret = !!(hidden && game.user.isGM);
  sources.forEach((src, i) => {
    gallery[randomId()] = { src, hidden: secret, createdBy: game.user.id, createdAt: now, sort: now + i };
  });
  return patch(id, { gallery });
}

export async function removeImage(id, gid) {
  return patch(id, { gallery: { [`-=${gid}`]: null } });
}

/* -------------------------------------------- */
/*  Category tags → categories                  */
/* -------------------------------------------- */

const TYPE_TAGS = { main: /^main\s*(quest|story|storyline)$/i, side: /^side\s*(quest|story)?$/i };
const CHAPTER_TAG = /^(chapter|ch\.?|part|act)\s*\d+\b/i;

/**
 * What a quest's tags say about its categories: tags like "Main quest" / "Side quest" become the quest type and
 * "Chapter 3" the chapter. Only categories the quest doesn't have yet are taken; the tags used are removed.
 * Returns null when there is nothing to convert.
 */
export function categoriesFromTags(raw) {
  const tags = Array.isArray(raw?.tags) ? raw.tags : [];
  const change = {};
  const used = new Set();
  if (!QUEST_TYPES.includes(raw.questType)) {
    for (const tag of tags) {
      const type = Object.keys(TYPE_TAGS).find(k => TYPE_TAGS[k].test(String(tag).trim()));
      if (type) { change.questType = type; used.add(tag); break; }
    }
  }
  if (!cleanLine(raw.chapter)) {
    const tag = tags.find(x => CHAPTER_TAG.test(String(x).trim()));
    if (tag) { change.chapter = cleanLine(tag, 80); used.add(tag); }
  }
  if (!used.size) return null;
  // A second type tag (e.g. both "Main story" and "Main quest") is dropped too.
  change.tags = tags.filter(x => !used.has(x) && !(change.questType && Object.values(TYPE_TAGS).some(re => re.test(String(x).trim()))));
  return change;
}

/** GM: how many quests (in both stores) have category tags to convert. */
export function countCategoryTags() {
  let count = 0;
  for (const kind of STORE_KINDS) {
    for (const raw of Object.values(getStore(kind)?.getFlag(MODULE_ID, "quests") ?? {})) if (raw && categoriesFromTags(raw)) count++;
  }
  return count;
}

/** GM: converts category tags to categories in every quest, one update per store. Returns the number of quests changed. */
export async function convertCategoryTags() {
  if (!game.user.isGM) return 0;
  let changed = 0;
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    const update = {};
    for (const [id, raw] of Object.entries(store?.getFlag(MODULE_ID, "quests") ?? {})) {
      const change = raw && categoriesFromTags(raw);
      if (!change) continue;
      for (const [key, value] of Object.entries(change)) update[`${FLAG_PATH}.${id}.${key}`] = value;
      changed++;
    }
    if (Object.keys(update).length) await store.update(update, { [MODULE_ID]: { type: "converted" } });
  }
  return changed;
}

/* ==================================================================== */
/*  Quest rewards                                                        */
/* ==================================================================== */

/*
 * A reward the party got: {name, description, img, maxUses, spent, uses, claimed, claimedAt, questId, links}.
 *   - maxUses 0 = no limit: the reward is available for as long as the party plays.
 *   - Each use is its own keyed entry in `uses` ({by, at}), so two players using a reward at the same time both
 *     count. `spent` is an offset set from the edit form ("3 of 5 uses left" when received half used).
 *   - A reward whose uses are all spent is claimed; `claimed: true` also puts one away by hand.
 *   - `links` are keyed {type, name, uuid, sort}: the places, NPCs, factions … the reward is tied to.
 *   - `questId`: the quest it came from.
 */

const REWARD_PATH = `flags.${MODULE_ID}.rewards`;

export function clampUses(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_USES) : 0;
}

/** The links of a stored reward: [{id, type, name, uuid, sort}]. */
export function linksOf(raw) {
  return sortedEntries(raw?.links).map(l => ({
    id: l.id,
    type: LINK_TYPES.includes(l.type) ? l.type : "other",
    name: cleanLine(l.name, 120),
    uuid: typeof l.uuid === "string" ? l.uuid.slice(0, 200) : "",
    sort: l.sort ?? 0
  })).filter(l => l.name);
}

/** Is the quest with this id in a store this user can see? */
function questVisible(questId) {
  return !!questId && !!getQuest(questId);
}

/** Turns stored reward data into the view model. For players a link to a quest they can't see is left out. */
export function normalizeReward(id, raw, hidden, { forGM = game.user.isGM } = {}) {
  const maxUses = clampUses(raw.maxUses);
  const log = sortedEntries(raw.uses).map(u => ({ id: u.id, by: u.by ?? null, byName: u.byName ?? null, at: u.at ?? 0 }));
  const spent = Math.trunc(Number(raw.spent)) || 0;
  const used = Math.max(0, spent + log.length);
  const usesLeft = maxUses ? Math.max(0, maxUses - used) : null;
  const usedUp = maxUses > 0 && usesLeft === 0;
  const questId = typeof raw.questId === "string" && (forGM ? raw.questId : questVisible(raw.questId) ? raw.questId : "");
  return {
    id,
    hidden,
    name: String(raw.name ?? "").trim() || t("Reward.Untitled"),
    description: String(raw.description ?? ""),
    img: typeof raw.img === "string" ? raw.img : "",
    maxUses,
    unlimited: !maxUses,
    usesLeft,
    used: maxUses ? Math.min(used, maxUses) : used,
    usedUp,
    status: raw.claimed || usedUp ? "claimed" : "active",
    /** Each use, oldest first: [{id, by, byName, at}]. */
    log,
    links: linksOf(raw),
    questId: questId || "",
    createdBy: raw.createdBy ?? null,
    authorName: raw.authorName ?? null,
    createdAt: raw.createdAt ?? 0,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? 0,
    claimedAt: raw.claimedAt ?? 0
  };
}

/** Every reward this user can see. */
export function allRewards() {
  const rewards = [];
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    if (!store || !store.testUserPermission(game.user, "OBSERVER")) continue;
    for (const [id, r] of Object.entries(store.getFlag(MODULE_ID, "rewards") ?? {})) {
      if (r && typeof r === "object") rewards.push(normalizeReward(id, r, kind === "secret"));
    }
  }
  return rewards;
}

function rawReward(id) {
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    const raw = store?.getFlag(MODULE_ID, "rewards")?.[id];
    if (raw) return { store, kind, raw };
  }
  return null;
}

export function getReward(id) {
  const found = rawReward(id);
  if (!found) return null;
  // Hidden rewards are in the GM-only store: players never get them, not even by id.
  if (!found.store.testUserPermission(game.user, "OBSERVER")) return null;
  return normalizeReward(id, found.raw, found.kind === "secret");
}

/** The rewards (this user can see) that came from a quest. */
export function rewardsForQuest(questId) {
  return questId ? allRewards().filter(r => r.questId === questId) : [];
}

/** Is a quest in the GM-only store? Rewards from it must stay there too until the quest is revealed. */
function questIsHidden(questId) {
  return !!questId && rawQuest(questId)?.kind === "secret";
}

async function patchReward(id, data, event) {
  const found = rawReward(id);
  if (!found) throw new Error(`Reward ${id} not found`);
  const update = { [`${REWARD_PATH}.${id}`]: { ...data, updatedAt: Date.now() } };
  return found.store.update(update, { [MODULE_ID]: { ...(event ?? {}), rewardId: id } });
}

/**
 * The update for a new list of links [{id, type, name, uuid}] (from the edit form): links keep their ids, removed
 * ones are deleted with "-=id".
 */
function linkFields(list, raw) {
  const current = raw ? linksOf(raw) : [];
  const currentIds = new Set(current.map(l => l.id));
  const map = {};
  const kept = new Set();
  (list ?? []).forEach((l, i) => {
    const name = cleanLine(l?.name, 120);
    if (!name) return;
    const known = l.id && currentIds.has(l.id);
    const lid = known ? l.id : randomId();
    if (known) kept.add(l.id);
    map[lid] = {
      type: LINK_TYPES.includes(l.type) ? l.type : "other",
      name,
      uuid: typeof l.uuid === "string" ? l.uuid.slice(0, 200) : "",
      sort: i
    };
  });
  for (const c of current) if (!kept.has(c.id)) map[`-=${c.id}`] = null;
  return map;
}

function rewardFields(data, raw = null) {
  const out = {};
  if ("name" in data) out.name = cleanLine(data.name, 120);
  if ("description" in data) out.description = String(data.description ?? "").trim();
  if ("img" in data) out.img = typeof data.img === "string" ? data.img.slice(0, 500) : "";
  if ("maxUses" in data) out.maxUses = clampUses(data.maxUses);
  if ("questId" in data) out.questId = typeof data.questId === "string" && /^[A-Za-z0-9]{0,32}$/.test(data.questId) ? data.questId : "";
  if ("links" in data) out.links = linkFields(data.links, raw);
  // "N uses left" from the form: the uses already logged stay, `spent` makes up the difference.
  const max = out.maxUses ?? clampUses(raw?.maxUses);
  if ("usesLeft" in data && max) {
    const logged = Object.values(raw?.uses ?? {}).filter(u => u && typeof u === "object").length;
    const left = Math.min(clampUses(data.usesLeft), max);
    out.spent = max - left - logged;
  }
  // A player can't see a hidden quest, so their form must never clear or change the link to it.
  if (!game.user.isGM && raw?.questId && !questVisible(raw.questId)) delete out.questId;
  return out;
}

export async function createReward(data = {}, { hidden = false } = {}) {
  let secret = !!(hidden && game.user.isGM);
  // Nothing from a hidden quest goes to the shared store before the quest is revealed.
  if (!secret && questIsHidden(data.questId)) {
    secret = true;
    ui.notifications.info(t("Reward.KeptHidden"));
  }
  const store = getStore(secret ? "secret" : "shared");
  if (!store) {
    ui.notifications.warn(t("NotReady"));
    return null;
  }
  const id = randomId();
  const now = Date.now();
  const reward = {
    name: "", description: "", img: "", maxUses: 0, spent: 0, uses: {}, claimed: false, claimedAt: 0, questId: "", links: {},
    ...rewardFields(data),
    createdBy: game.user.id,
    createdAt: now,
    updatedAt: now
  };
  if (!reward.name) reward.name = t("Reward.Untitled");
  await store.update({ [`${REWARD_PATH}.${id}`]: reward },
    { [MODULE_ID]: { type: "reward-created", rewardId: id, title: reward.name } });
  return id;
}

export async function updateReward(id, data) {
  const found = rawReward(id);
  if (!found) return;
  const change = rewardFields(data, found.raw);
  if (found.kind === "shared" && change.questId && questIsHidden(change.questId)) {
    ui.notifications.warn(t("Reward.QuestHidden"));
    delete change.questId;
  }
  return patchReward(id, change);
}

/** Uses a reward once. The use that spends the last one moves it to the claimed rewards. */
export async function useReward(id) {
  const reward = getReward(id);
  if (!reward || reward.status !== "active" || reward.unlimited) return;
  const uid = randomId();
  const now = Date.now();
  const last = reward.usesLeft <= 1;
  const left = Math.max(0, reward.usesLeft - 1);
  return patchReward(id, { uses: { [uid]: { by: game.user.id, at: now, sort: now } }, ...(last ? { claimedAt: now } : {}) },
    { type: last ? "reward-usedup" : "reward-used", title: reward.name, left, max: reward.maxUses });
}

/** Takes back the latest use (a misclick). A reward that was used up becomes active again. */
export async function undoRewardUse(id) {
  const found = rawReward(id);
  const reward = getReward(id);
  if (!found || !reward || reward.unlimited || !reward.used) return;
  const latest = reward.log.at(-1);
  const change = latest ? { uses: { [`-=${latest.id}`]: null } } : { spent: (Math.trunc(Number(found.raw.spent)) || 0) - 1 };
  return patchReward(id, change, reward.usedUp && !found.raw.claimed ? { type: "reward-restored", title: reward.name } : null);
}

/** Fills a reward's uses again (and makes it active). */
export async function refillReward(id) {
  const reward = getReward(id);
  if (!reward || reward.unlimited) return;
  return patchReward(id, { "-=uses": null, spent: 0, claimed: false, claimedAt: 0 },
    reward.status === "claimed" ? { type: "reward-restored", title: reward.name } : null);
}

/** Puts a reward away as claimed, or brings it back (a used-up reward comes back with its uses filled again). */
export async function setRewardClaimed(id, claimed) {
  const reward = getReward(id);
  if (!reward || (reward.status === "claimed") === !!claimed) return;
  if (claimed) return patchReward(id, { claimed: true, claimedAt: Date.now() }, { type: "reward-claimed", title: reward.name });
  const change = { claimed: false, claimedAt: 0 };
  if (reward.usedUp) Object.assign(change, { "-=uses": null, spent: 0 });
  return patchReward(id, change, { type: "reward-restored", title: reward.name });
}

export async function deleteReward(id) {
  const found = rawReward(id);
  if (!found) return;
  return found.store.update({ [`${REWARD_PATH}.-=${id}`]: null }, { [MODULE_ID]: { type: "reward-deleted", rewardId: id } });
}

/** GM only: moves a reward between the shared and the secret store. A reward from a hidden quest stays hidden. */
export async function setRewardHidden(id, hidden) {
  if (!game.user.isGM) return;
  const found = rawReward(id);
  const targetKind = hidden ? "secret" : "shared";
  if (!found || found.kind === targetKind) return;
  if (!hidden && questIsHidden(found.raw.questId)) return ui.notifications.warn(t("Reward.QuestHidden"));
  const target = getStore(targetKind);
  if (!target) return;
  const raw = foundry.utils.deepClone(found.raw);
  raw.updatedAt = Date.now();
  await target.update({ [`${REWARD_PATH}.${id}`]: raw },
    { [MODULE_ID]: { type: hidden ? "reward-hidden" : "reward-revealed", rewardId: id, title: raw.name } });
  await found.store.update({ [`${REWARD_PATH}.-=${id}`]: null }, { [MODULE_ID]: { type: "reward-moved", rewardId: id } });
}

/** How many rewards are in each store: {shared, secret, total}. */
export function countRewards() {
  const counts = { total: 0 };
  for (const kind of STORE_KINDS) {
    const raw = getStore(kind)?.getFlag(MODULE_ID, "rewards") ?? {};
    counts[kind] = Object.values(raw).filter(r => r && typeof r === "object").length;
    counts.total += counts[kind];
  }
  return counts;
}

/** GM only: deletes every reward in both stores. Returns how many were deleted. */
export async function deleteAllRewards() {
  if (!game.user.isGM) return 0;
  let deleted = 0;
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    const raw = store?.getFlag(MODULE_ID, "rewards") ?? {};
    if (!Object.keys(raw).length) continue;
    await store.update({ [`flags.${MODULE_ID}.-=rewards`]: null }, { [MODULE_ID]: { type: "reward-deleted-all" } });
    deleted += Object.values(raw).filter(r => r && typeof r === "object").length;
  }
  return deleted;
}

/* ==================================================================== */
/*  Party notes                                                          */
/* ==================================================================== */

/*
 * A note the party keeps, on its own or about a quest: {title, text, tags, questId, links, gallery, pinned}.
 *   - `links` are keyed {type, name, uuid, sort} like a reward's (places, NPCs, factions, other things).
 *   - `gallery` is keyed {src, createdBy, createdAt, sort}, so two people adding images at the same time both keep theirs.
 *   - `questId`: the quest the note is about ("" for a general note).
 * Hidden notes (GM) live in the "secret" store, like hidden quests. A note about a hidden quest stays there with it.
 */

const PARTY_NOTE_PATH = `flags.${MODULE_ID}.partyNotes`;
const QUEST_ID = /^[A-Za-z0-9]{0,32}$/;

/** Turns stored note data into the view model. For players a link to a quest they can't see is left out. */
export function normalizePartyNote(id, raw, hidden, { forGM = game.user.isGM } = {}) {
  const questId = typeof raw.questId === "string" && raw.questId && (forGM || questVisible(raw.questId)) ? raw.questId : "";
  return {
    id,
    hidden,
    title: String(raw.title ?? "").trim() || t("PartyNote.Untitled"),
    text: String(raw.text ?? ""),
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map(cleanTag).filter(Boolean))] : [],
    questId,
    links: linksOf(raw),
    gallery: sortedEntries(raw.gallery).filter(g => typeof g.src === "string" && g.src)
      .map(g => ({ id: g.id, src: g.src, createdBy: g.createdBy ?? null, createdAt: g.createdAt ?? 0 })),
    pinned: !!raw.pinned,
    createdBy: raw.createdBy ?? null,
    authorName: raw.authorName ?? null,
    editedBy: raw.editedBy ?? null,
    editedByName: raw.editedByName ?? null,
    createdAt: raw.createdAt ?? 0,
    editedAt: raw.editedAt ?? 0,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? 0
  };
}

/** Every party note this user can see. */
export function allPartyNotes() {
  const notes = [];
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    if (!store || !store.testUserPermission(game.user, "OBSERVER")) continue;
    for (const [id, n] of Object.entries(store.getFlag(MODULE_ID, "partyNotes") ?? {})) {
      if (n && typeof n === "object") notes.push(normalizePartyNote(id, n, kind === "secret"));
    }
  }
  return notes;
}

function rawPartyNote(id) {
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    const raw = store?.getFlag(MODULE_ID, "partyNotes")?.[id];
    if (raw) return { store, kind, raw };
  }
  return null;
}

export function getPartyNote(id) {
  const found = rawPartyNote(id);
  if (!found) return null;
  // Hidden notes are in the GM-only store: players never get them, not even by id.
  if (!found.store.testUserPermission(game.user, "OBSERVER")) return null;
  return normalizePartyNote(id, found.raw, found.kind === "secret");
}

/** The party notes (this user can see) about a quest. */
export function partyNotesForQuest(questId) {
  return questId ? allPartyNotes().filter(n => n.questId === questId) : [];
}

async function patchPartyNote(id, data, event) {
  const found = rawPartyNote(id);
  if (!found) throw new Error(`Note ${id} not found`);
  const update = { [`${PARTY_NOTE_PATH}.${id}`]: { ...data, updatedAt: Date.now() } };
  return found.store.update(update, { [MODULE_ID]: { ...(event ?? {}), partyNoteId: id } });
}

/**
 * The update for the edit form's list of images ([{id, src}] or plain sources). New images get new keys; images that
 * were in the form when it opened (startIds) and are gone from it are deleted. Images someone else added while the
 * form was open are not in startIds, so they stay.
 */
function galleryFields(list, raw, startIds = []) {
  const current = new Set(Object.keys(raw?.gallery ?? {}));
  const kept = new Set();
  const map = {};
  const now = Date.now();
  (list ?? []).forEach((img, i) => {
    const src = typeof img === "string" ? img : img?.src;
    if (typeof src !== "string" || !src) return;
    if (img?.id && current.has(img.id)) return void kept.add(img.id);
    map[randomId()] = { src: src.slice(0, 500), createdBy: game.user.id, createdAt: now, sort: now + i };
  });
  for (const id of startIds) if (current.has(id) && !kept.has(id)) map[`-=${id}`] = null;
  return map;
}

function partyNoteFields(data, raw = null) {
  const out = {};
  if ("title" in data) out.title = cleanLine(data.title, 120);
  if ("text" in data) out.text = String(data.text ?? "").trim();
  if ("tags" in data) out.tags = [...new Set((data.tags ?? []).map(cleanTag).filter(Boolean))];
  if ("questId" in data) out.questId = typeof data.questId === "string" && QUEST_ID.test(data.questId) ? data.questId : "";
  if ("links" in data) out.links = linkFields(data.links, raw);
  if ("pinned" in data) out.pinned = !!data.pinned;
  if ("images" in data && raw) out.gallery = galleryFields(data.images, raw, data.imagesStart ?? []);
  // A player can't see a hidden quest, so their form must never clear or change the link to it.
  if (!game.user.isGM && raw?.questId && !questVisible(raw.questId)) delete out.questId;
  return out;
}

/** Creates a note. data: title, text, tags, questId, links ([{type, name, uuid}]), images (sources), pinned. */
export async function createPartyNote(data = {}, { hidden = false } = {}) {
  let secret = !!(hidden && game.user.isGM);
  // Nothing about a hidden quest goes to the shared store before the quest is revealed.
  if (!secret && questIsHidden(data.questId)) {
    secret = true;
    ui.notifications.info(t("PartyNote.KeptHidden"));
  }
  const store = getStore(secret ? "secret" : "shared");
  if (!store) {
    ui.notifications.warn(t("NotReady"));
    return null;
  }
  const id = randomId();
  const now = Date.now();
  const { images, ...rest } = data;
  const note = {
    title: "", text: "", tags: [], questId: "", links: {}, gallery: {}, pinned: false,
    ...partyNoteFields(rest),
    createdBy: game.user.id,
    createdAt: now,
    updatedAt: now
  };
  if (!note.title) note.title = t("PartyNote.Untitled");
  (images ?? []).map(img => (typeof img === "string" ? img : img?.src)).filter(src => typeof src === "string" && src)
    .forEach((src, i) => { note.gallery[randomId()] = { src: src.slice(0, 500), createdBy: game.user.id, createdAt: now, sort: now + i }; });
  await store.update({ [`${PARTY_NOTE_PATH}.${id}`]: note },
    { [MODULE_ID]: { type: "note-created", partyNoteId: id, title: note.title } });
  return id;
}

/** Changes a note (data as for createPartyNote; images as [{id, src}] with imagesStart, the ids the form started with). */
export async function updatePartyNote(id, data) {
  const found = rawPartyNote(id);
  if (!found) return;
  const change = partyNoteFields(data, found.raw);
  if (found.kind === "shared" && change.questId && questIsHidden(change.questId)) {
    ui.notifications.warn(t("PartyNote.QuestHidden"));
    delete change.questId;
  }
  if (["title", "text", "tags", "links", "images"].some(k => k in data)) Object.assign(change, { editedBy: game.user.id, editedAt: Date.now() });
  return patchPartyNote(id, change);
}

export async function setPartyNotePinned(id, pinned) {
  const note = getPartyNote(id);
  if (!note || note.pinned === !!pinned) return;
  return patchPartyNote(id, { pinned: !!pinned });
}

export async function addPartyNoteImages(id, sources) {
  if (!sources?.length || !getPartyNote(id)) return;
  const now = Date.now();
  const gallery = {};
  sources.forEach((src, i) => {
    if (typeof src === "string" && src) gallery[randomId()] = { src: src.slice(0, 500), createdBy: game.user.id, createdAt: now, sort: now + i };
  });
  return patchPartyNote(id, { gallery });
}

export async function removePartyNoteImage(id, gid) {
  return patchPartyNote(id, { gallery: { [`-=${gid}`]: null } });
}

export async function deletePartyNote(id) {
  const found = rawPartyNote(id);
  if (!found) return;
  return found.store.update({ [`${PARTY_NOTE_PATH}.-=${id}`]: null }, { [MODULE_ID]: { type: "note-deleted", partyNoteId: id } });
}

/** GM only: moves a note between the shared and the secret store. A note about a hidden quest stays hidden. */
export async function setPartyNoteHidden(id, hidden) {
  if (!game.user.isGM) return;
  const found = rawPartyNote(id);
  const targetKind = hidden ? "secret" : "shared";
  if (!found || found.kind === targetKind) return;
  if (!hidden && questIsHidden(found.raw.questId)) return ui.notifications.warn(t("PartyNote.QuestHidden"));
  const target = getStore(targetKind);
  if (!target) return;
  const raw = foundry.utils.deepClone(found.raw);
  raw.updatedAt = Date.now();
  await target.update({ [`${PARTY_NOTE_PATH}.${id}`]: raw },
    { [MODULE_ID]: { type: hidden ? "note-hidden" : "note-revealed", partyNoteId: id, title: raw.title } });
  await found.store.update({ [`${PARTY_NOTE_PATH}.-=${id}`]: null }, { [MODULE_ID]: { type: "note-moved", partyNoteId: id } });
}

/** How many party notes are in each store: {shared, secret, total}. */
export function countPartyNotes() {
  const counts = { total: 0 };
  for (const kind of STORE_KINDS) {
    const raw = getStore(kind)?.getFlag(MODULE_ID, "partyNotes") ?? {};
    counts[kind] = Object.values(raw).filter(n => n && typeof n === "object").length;
    counts.total += counts[kind];
  }
  return counts;
}

/** GM only: deletes every party note in both stores. Returns how many were deleted. */
export async function deleteAllPartyNotes() {
  if (!game.user.isGM) return 0;
  let deleted = 0;
  for (const kind of STORE_KINDS) {
    const store = getStore(kind);
    const raw = store?.getFlag(MODULE_ID, "partyNotes") ?? {};
    if (!Object.keys(raw).length) continue;
    await store.update({ [`flags.${MODULE_ID}.-=partyNotes`]: null }, { [MODULE_ID]: { type: "note-deleted-all" } });
    deleted += Object.values(raw).filter(n => n && typeof n === "object").length;
  }
  return deleted;
}
