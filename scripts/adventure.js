import { MODULE_ID, t, escapeHTML, isResponsibleGM } from "./util.js";
import { STORE_KINDS, getStore, getQuest, setHidden, setPartHidden } from "./store.js";
import { parseExportData, sanitizeQuest, withoutHiddenParts } from "./transfer.js";

/*
 * Adventures and the quest log.
 *   - An Adventure document can carry a quest log in flags.dxcufgbs-quest-log.questLog (the same format as an export
 *     file). When the adventure is imported, its quests are added to the log, hidden from players unless a quest says
 *     otherwise. Quests already in the log (same id) are left alone, so re-importing never resets the party's progress.
 *   - If an adventure brings its own copies of the two store journals (it was made from a world that used the quest log),
 *     their quests are merged into this world's stores and the copies are deleted, so there is only ever one of each.
 *   - Journal text can link a quest with @Quest[id]{label}, or one stage, objective, note or clue of it with
 *     @Quest[id/stages/partId]{label} (objectives, notes the same way). For the GM a hidden quest's or part's link has a
 *     Reveal / Unhide button, so an adventure's text can say "unhide this now" right where it happens.
 */

export const ADVENTURE_FLAG = "questLog";
const FLAG_PATH = `flags.${MODULE_ID}.quests`;
const FORMAT = 1;

/* -------------------------------------------- */
/*  One store of each kind                      */
/* -------------------------------------------- */

const questCount = j => Object.keys(j.getFlag(MODULE_ID, "quests") ?? {}).length;

/**
 * Merges duplicate store journals into one per kind and deletes the duplicates. The store kept is one that was not
 * just imported (newIds), then the one with the most quests, then the oldest. Quests whose id is already in a kept
 * store are not copied. Returns the number of quests moved.
 */
export async function consolidateStores({ newIds = new Set() } = {}) {
  if (!game.user.isGM) return 0;
  const keep = {};
  const extras = [];
  for (const kind of STORE_KINDS) {
    const all = game.journal.filter(j => j.getFlag(MODULE_ID, "store") === kind);
    if (!all.length) continue;
    all.sort((a, b) => (newIds.has(a.id) - newIds.has(b.id))
      || (questCount(b) - questCount(a))
      || ((a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0)));
    keep[kind] = all[0];
    for (const extra of all.slice(1)) extras.push({ kind, doc: extra });
  }
  if (!extras.length) return 0;

  const known = new Set(Object.values(keep).flatMap(j => Object.keys(j.getFlag(MODULE_ID, "quests") ?? {})));
  const maps = { shared: {}, secret: {} };
  let moved = 0;
  for (const { kind, doc } of extras) {
    for (const [id, quest] of Object.entries(doc.getFlag(MODULE_ID, "quests") ?? {})) {
      if (known.has(id)) continue;
      const clean = sanitizeQuest(quest);
      if (!clean) continue;
      known.add(id);
      maps[kind][id] = clean;
      moved++;
    }
  }
  for (const kind of STORE_KINDS) {
    if (Object.keys(maps[kind]).length) await keep[kind].update({ [FLAG_PATH]: maps[kind] }, { [MODULE_ID]: { type: "imported" } });
  }
  await JournalEntry.implementation.deleteDocuments(extras.map(e => e.doc.id));
  console.log(`${MODULE_ID} | merged ${extras.length} duplicate quest log journal(s), ${moved} quest(s) moved`);
  return moved;
}

/* -------------------------------------------- */
/*  Quests stored on an Adventure               */
/* -------------------------------------------- */

export function adventureQuestData(adventure) {
  return adventure?.flags?.[MODULE_ID]?.[ADVENTURE_FLAG] ?? null;
}

async function resolveAdventure(adventure) {
  if (typeof adventure === "string") adventure = await fromUuid(adventure).catch(() => null);
  return adventure?.documentName === "Adventure" ? adventure : null;
}

/**
 * GM: adds the quests stored on an Adventure to the quest log. Quests without a "hidden" field are hidden.
 * Quests already in the log are skipped. Returns {added, skipped, hidden} or null.
 */
export async function importAdventureQuests(adventure, { notify = true } = {}) {
  if (!game.user.isGM) return null;
  adventure = await resolveAdventure(adventure);
  const data = adventureQuestData(adventure);
  if (!data) {
    if (notify && adventure) ui.notifications.warn(t("Adventure.NoQuests", { title: escapeHTML(adventure.name) }));
    return null;
  }
  const stores = { shared: getStore("shared"), secret: getStore("secret") };
  if (!stores.shared || !stores.secret) {
    ui.notifications.warn(t("NotReady"));
    return null;
  }
  let parsed;
  try {
    parsed = parseExportData(data, { hiddenByDefault: true });
  } catch (err) {
    ui.notifications.error(t("Adventure.ReadError", { title: escapeHTML(adventure.name), error: escapeHTML(err.message) }));
    return null;
  }

  const known = new Set(STORE_KINDS.flatMap(kind => Object.keys(stores[kind].getFlag(MODULE_ID, "quests") ?? {})));
  const maps = { shared: {}, secret: {} };
  const now = Date.now();
  const result = { added: 0, skipped: 0, hidden: 0 };
  parsed.quests.forEach(({ id, hidden, quest }, i) => {
    if (known.has(id)) return void result.skipped++;
    // The adventure's order is kept: the newest-first list shows the first quest at the top.
    quest.createdAt = now;
    quest.updatedAt = now - i;
    // Prepared stages, objectives and notes get the import time, so they don't show as dated 1970.
    for (const kind of ["stages", "objectives", "notes"]) {
      for (const part of Object.values(quest[kind] ?? {})) part.createdAt ||= now;
    }
    maps[hidden ? "secret" : "shared"][id] = quest;
    result.added++;
    if (hidden) result.hidden++;
  });
  const options = { [MODULE_ID]: { type: "imported" } };
  for (const kind of STORE_KINDS) {
    if (Object.keys(maps[kind]).length) await stores[kind].update({ [FLAG_PATH]: maps[kind] }, options);
  }
  if (notify) {
    const title = escapeHTML(adventure.name);
    if (result.added) ui.notifications.info(t("Adventure.Imported", { count: result.added, hidden: result.hidden, title }));
    if (result.skipped) ui.notifications.info(t("Adventure.Skipped", { count: result.skipped, title }));
  }
  return result;
}

/**
 * GM: stores the world's current quest log on an Adventure (its compendium must be unlocked), so importing the
 * adventure brings the quests along. Hidden quests stay hidden; set includeHidden false to leave them out.
 */
export async function storeInAdventure(adventure, { includeHidden = true } = {}) {
  if (!game.user.isGM) return null;
  adventure = await resolveAdventure(adventure);
  if (!adventure) return ui.notifications.warn(t("Adventure.NotAnAdventure"));
  const quests = [];
  for (const kind of STORE_KINDS) {
    const hidden = kind === "secret";
    if (hidden && !includeHidden) continue;
    for (const [id, quest] of Object.entries(getStore(kind)?.getFlag(MODULE_ID, "quests") ?? {})) {
      if (!quest || typeof quest !== "object") continue;
      const copy = { id, hidden, ...foundry.utils.deepClone(quest) };
      quests.push(includeHidden ? copy : withoutHiddenParts(copy));
    }
  }
  if (!quests.length) return ui.notifications.warn(t("Transfer.NothingToExport"));
  const data = { module: MODULE_ID, format: FORMAT, version: game.modules.get(MODULE_ID)?.version ?? null, quests };
  try {
    await adventure.update({ [`flags.${MODULE_ID}.${ADVENTURE_FLAG}`]: data });
  } catch (err) {
    return ui.notifications.error(t("Adventure.StoreError", { title: escapeHTML(adventure.name), error: escapeHTML(err.message) }));
  }
  ui.notifications.info(t("Adventure.Stored", { count: quests.length, title: escapeHTML(adventure.name) }));
  return quests.length;
}

/* -------------------------------------------- */
/*  @Quest[id]{label} links                     */
/* -------------------------------------------- */

// @Quest[id]{label} links a quest; @Quest[id/stages|objectives|notes|locations/partId]{label} links one part of it.
const LINK_PATTERN = /@Quest\[([A-Za-z0-9]{1,32})(?:\/(stages|objectives|notes|locations)\/([A-Za-z0-9]{1,32}))?\](?:\{([^}]*)\})?/g;

function questLink(match) {
  const [, id, kind, partId, label] = match;
  const quest = getQuest(id);
  const part = kind ? quest?.[kind]?.find(p => p.id === partId) ?? null : null;
  const partName = part ? (part.title ?? part.name ?? part.text ?? "").slice(0, 60) : "";
  const text = label || (kind ? partName : quest?.title) || t("QuestLink.Unknown");
  // Players only ever get plain text: they can't open what they can't see, and part links are GM cues.
  if (!game.user.isGM && (!quest || kind)) {
    const span = document.createElement("span");
    span.classList.add("dxql-quest-link", "dxql-missing");
    span.textContent = text;
    return span;
  }
  const a = document.createElement("a");
  a.classList.add("dxql-quest-link");
  if (kind) a.classList.add("dxql-part-link", `dxql-part-${kind}`);
  a.dataset.questId = id;
  if (kind) {
    a.dataset.kind = kind;
    a.dataset.partId = partId;
  }
  const icon = { stages: "fa-signs-post", objectives: "fa-list-check", locations: "fa-location-dot", notes: part?.type === "clue" ? "fa-magnifying-glass" : "fa-note-sticky" }[kind] ?? "fa-scroll";
  a.innerHTML = `<i class="fa-solid ${icon}" inert></i> ${escapeHTML(text)}`;
  const hidden = kind ? part?.hidden : quest?.hidden;
  if (!quest || (kind && !part)) {
    a.classList.add("dxql-missing");
    a.dataset.tooltip = t(quest ? "QuestLink.PartMissing" : "QuestLink.NotInLog");
  } else if (hidden) {
    a.classList.add("dxql-hidden");
    a.dataset.tooltip = t(kind && quest.hidden ? "QuestLink.HiddenPartOfHidden" : "QuestLink.Hidden");
    a.insertAdjacentHTML("beforeend",
      `<span class="dxql-reveal" data-dxql-reveal><i class="fa-solid fa-eye" inert></i> ${escapeHTML(t(kind ? "QuestLink.Unhide" : "QuestLink.Reveal"))}</span>`);
  }
  return a;
}

function markRevealed(id, partId = null) {
  const selector = partId ? `.dxql-quest-link[data-quest-id="${id}"][data-part-id="${partId}"]`
    : `.dxql-quest-link[data-quest-id="${id}"]:not([data-part-id])`;
  for (const link of document.querySelectorAll(selector)) {
    link.classList.remove("dxql-hidden");
    delete link.dataset.tooltip;
    link.querySelector("[data-dxql-reveal]")?.remove();
  }
}

async function onLinkClick(event) {
  const link = event.target.closest?.("a.dxql-quest-link[data-quest-id]");
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  const { questId: id, kind, partId } = link.dataset;
  const quest = getQuest(id);
  if (!quest) return ui.notifications.warn(t(game.user.isGM ? "QuestLink.NotInLog" : "QuestLink.Unavailable"));
  if (event.target.closest("[data-dxql-reveal]")) {
    if (kind) {
      const part = quest[kind]?.find(p => p.id === partId);
      if (!part) return ui.notifications.warn(t("QuestLink.PartMissing"));
      if (part.hidden) await setPartHidden(id, kind, partId, false);
      if (quest.hidden) ui.notifications.info(t("QuestLink.QuestStillHidden", { title: escapeHTML(quest.title) }));
      return markRevealed(id, partId);
    }
    if (quest.hidden) await setHidden(id, false);
    return markRevealed(id);
  }
  game.modules.get(MODULE_ID)?.api?.openQuest(id);
}

export function registerQuestLinks() {
  CONFIG.TextEditor.enrichers.push({ id: "dxqlQuest", pattern: LINK_PATTERN, enricher: async match => questLink(match) });
  document.addEventListener("click", event => onLinkClick(event).catch(err => console.error(`${MODULE_ID} | quest link`, err)));
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

export function registerAdventureHooks() {
  // Runs only on the client that imported the adventure.
  Hooks.on("importAdventure", async (adventure, options, created) => {
    try {
      if (!game.user.isGM) return;
      const newIds = new Set((created?.JournalEntry ?? []).map(d => d.id));
      await consolidateStores({ newIds });
      if (adventureQuestData(adventure) && game.settings.get(MODULE_ID, "adventureImport")) await importAdventureQuests(adventure);
    } catch (err) {
      console.error(`${MODULE_ID} | importAdventure`, err);
    }
  });
}

/** Responsible GM at startup: tidy up duplicate store journals left by an earlier import. */
export async function tidyStoresOnReady() {
  if (isResponsibleGM()) await consolidateStores();
}
