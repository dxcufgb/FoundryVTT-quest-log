import { MODULE_ID, STATUSES, NOTE_TYPES, HIDEABLE_FIELDS, PART_KINDS, QUEST_TYPES, t, isResponsibleGM, randomId, cleanLine, cleanTag } from "./util.js";

/*
 * Quests live in the flags of two journal entries that the module creates and hides from the Journal directory:
 *   - "shared": default ownership OWNER, so every player can read and write quests without a GM online.
 *   - "secret": default ownership NONE, the GM's hidden quests (players' clients never receive it).
 * Every quest, objective, note and gallery image is keyed by id, and every write is a dot-path update of just that
 * key, so two people editing different parts of the log at the same time never overwrite each other.
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
