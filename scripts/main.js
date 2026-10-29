import { MODULE_ID, t, escapeHTML, isResponsibleGM } from "./util.js";
import * as store from "./store.js";
import { QuestLogTab, GROUP_MODES, REWARD_GROUP_MODES, VIEWS } from "./apps/quest-log-tab.js";
import { QuestSheet } from "./apps/quest-sheet.js";
import { RewardSheet } from "./apps/reward-sheet.js";
import { registerImageSocket } from "./images.js";
import { registerContextMenus, addToQuestLog, addAsReward } from "./capture.js";
import { exportQuests, importQuests } from "./transfer.js";
import { DeleteAllQuestsMenu, confirmDeleteAll } from "./delete-all.js";
import { registerQuestLinks, registerAdventureHooks, tidyStoresOnReady, importAdventureQuests, storeInAdventure } from "./adventure.js";

/* -------------------------------------------- */
/*  Settings and the sidebar tab                */
/* -------------------------------------------- */

function registerSettings() {
  game.settings.register(MODULE_ID, "notify", {
    name: "DXQL.Settings.Notify.Name",
    hint: "DXQL.Settings.Notify.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "playersCanDelete", {
    name: "DXQL.Settings.PlayersCanDelete.Name",
    hint: "DXQL.Settings.PlayersCanDelete.Hint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: refreshAll
  });
  game.settings.register(MODULE_ID, "offerRewards", {
    name: "DXQL.Settings.OfferRewards.Name",
    hint: "DXQL.Settings.OfferRewards.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "adventureImport", {
    name: "DXQL.Settings.AdventureImport.Name",
    hint: "DXQL.Settings.AdventureImport.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "imageFolder", {
    name: "DXQL.Settings.ImageFolder.Name",
    hint: "DXQL.Settings.ImageFolder.Hint",
    scope: "world", config: true, type: String, default: ""
  });
  // GM only, and only here in the settings (not in the Quest Log tab), so the log isn't wiped by accident.
  game.settings.registerMenu(MODULE_ID, "deleteAll", {
    name: "DXQL.Settings.DeleteAll.Name",
    label: "DXQL.Settings.DeleteAll.Label",
    hint: "DXQL.Settings.DeleteAll.Hint",
    icon: "fa-solid fa-trash",
    type: DeleteAllQuestsMenu,
    restricted: true
  });
  game.settings.register(MODULE_ID, "categoryTagsPrompt", {
    scope: "world", config: false, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "selectionMenu", {
    name: "DXQL.Settings.SelectionMenu.Name",
    hint: "DXQL.Settings.SelectionMenu.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "statusFilter", {
    scope: "client", config: false, type: String, default: "active"
  });
  game.settings.register(MODULE_ID, "groupBy", {
    scope: "client", config: false, type: String, default: "none",
    choices: Object.fromEntries(GROUP_MODES.map(g => [g, g]))
  });
  game.settings.register(MODULE_ID, "view", {
    scope: "client", config: false, type: String, default: "quests",
    choices: Object.fromEntries(VIEWS.map(v => [v, v]))
  });
  game.settings.register(MODULE_ID, "rewardStatusFilter", {
    scope: "client", config: false, type: String, default: "active"
  });
  game.settings.register(MODULE_ID, "rewardGroupBy", {
    scope: "client", config: false, type: String, default: "none",
    choices: Object.fromEntries(REWARD_GROUP_MODES.map(g => [g, g]))
  });
}

/** Adds the Quest Log tab to the right sidebar, just before Game Settings. */
function registerSidebarTab() {
  const Sidebar = foundry.applications.sidebar.Sidebar;
  const tabs = {};
  for (const [id, config] of Object.entries(Sidebar.TABS)) {
    if (id === "settings") tabs.questlog = { tooltip: "DXQL.Title", icon: "fa-solid fa-scroll" };
    tabs[id] = config;
  }
  tabs.questlog ??= { tooltip: "DXQL.Title", icon: "fa-solid fa-scroll" };
  Sidebar.TABS = tabs;
  CONFIG.ui.questlog = QuestLogTab;
}

function refreshAll() {
  ui.questlog?.refresh();
  ui.questlog?.popout?.refresh();
  QuestSheet.refreshAll();
  RewardSheet.refreshAll();
}

/* -------------------------------------------- */
/*  Change notifications                        */
/* -------------------------------------------- */

const NOTIFY = {
  created: ["NotifyCreated", "info"],
  revealed: ["NotifyRevealed", "info"],
  "status-completed": ["NotifyCompleted", "success"],
  "status-failed": ["NotifyFailed", "warning"],
  "status-active": ["NotifyReopened", "info"],
  "revealed-objectives": ["NotifyNewObjective", "info"],
  "revealed-stages": ["NotifyNewStage", "info"],
  "revealed-gallery": ["NotifyNewImage", "info"],
  "revealed-field": ["NotifyNewInfo", "info"],
  "revealed-locations": ["NotifyNewInfo", "info"]
};

const NOTIFY_REWARD = {
  "reward-created": ["Reward.NotifyCreated", "info"],
  "reward-revealed": ["Reward.NotifyRevealed", "info"],
  "reward-used": ["Reward.NotifyUsed", "info"],
  "reward-usedup": ["Reward.NotifyUsedUp", "info"],
  "reward-claimed": ["Reward.NotifyClaimed", "info"],
  "reward-restored": ["Reward.NotifyRestored", "info"]
};

function notifyRewardChange(event, userId) {
  const entry = NOTIFY_REWARD[event.type];
  if (!entry) return;
  const title = store.getReward(event.rewardId)?.name ?? event.title ?? "";
  if (!title) return;
  const [key, level] = entry;
  const message = t(key, {
    title: escapeHTML(title), name: escapeHTML(game.users.get(userId)?.name ?? ""),
    left: Number(event.left) || 0, max: Number(event.max) || 0
  });
  (ui.notifications[level] ?? ui.notifications.info).call(ui.notifications, message);
}

function notifyChange(event, userId) {
  if (!event?.type || userId === game.user.id || !game.settings.get(MODULE_ID, "notify")) return;
  if (event.rewardId) return notifyRewardChange(event, userId);
  const entry = event.type === "revealed-notes"
    ? [event.noteType === "clue" ? "NotifyNewClue" : "NotifyNewNote", "info"]
    : NOTIFY[event.type];
  if (!entry) return;
  const quest = store.getQuest(event.questId);
  const title = quest?.title ?? event.title ?? "";
  if (!title) return;
  const [key, level] = entry;
  const message = t(key, { title: escapeHTML(title), name: escapeHTML(game.users.get(userId)?.name ?? "") });
  const fn = ui.notifications[level] ?? ui.notifications.info;
  fn.call(ui.notifications, message);
}

/** Opens the Quest Log tab on its Quest Rewards view. */
async function openRewards() {
  await game.settings.set(MODULE_ID, "view", "rewards");
  for (const app of [ui.questlog, ui.questlog?.popout]) {
    if (app?.rendered) app.render({ parts: ["nav", "header", "filters", "list"] });
  }
  ui.questlog?.activate();
}

/* -------------------------------------------- */
/*  Quest completed → add its reward?            */
/* -------------------------------------------- */

/**
 * A quest was completed: a GM is asked whether anything from its reward field should go to the Quest Rewards. The GM
 * who completed it is asked; when a player completed it, the responsible GM is. Players are never asked.
 */
function offerRewardsOnCompletion(event, userId) {
  if (event?.type !== "status-completed" || !game.user.isGM || !game.settings.get(MODULE_ID, "offerRewards")) return;
  const byGM = !!game.users.get(userId)?.isGM;
  if (byGM ? userId !== game.user.id : !isResponsibleGM()) return;
  RewardSheet.offerFromQuest(event.questId).catch(err => console.error(`${MODULE_ID} | offer rewards`, err));
}

/* -------------------------------------------- */
/*  Category tags → categories (once per world)  */
/* -------------------------------------------- */

/**
 * Quests made before Main/Side quest and Chapter were categories may carry them as tags ("Side quest", "Chapter 3").
 * The responsible GM is asked once whether to turn those tags into the categories.
 */
async function offerCategoryConversion() {
  if (!isResponsibleGM()) return;
  if (!game.settings.get(MODULE_ID, "categoryTagsPrompt")) return;
  const count = store.countCategoryTags();
  if (!count) return;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: t("Convert.Title"), icon: "fa-solid fa-wand-magic-sparkles" },
    position: { width: 440 },
    content: `<p>${t("Convert.Body", { count })}</p><p class="hint">${escapeHTML(t("Convert.Hint"))}</p>`,
    rejectClose: false,
    buttons: [
      { action: "never", label: t("Convert.Never"), icon: "fa-solid fa-ban" },
      { action: "later", label: t("Convert.Later"), icon: "fa-solid fa-clock" },
      { action: "convert", label: t("Convert.Convert"), icon: "fa-solid fa-check", default: true }
    ]
  });
  if (choice === "never") return game.settings.set(MODULE_ID, "categoryTagsPrompt", false);
  if (choice !== "convert") return;
  const changed = await store.convertCategoryTags();
  await game.settings.set(MODULE_ID, "categoryTagsPrompt", false);
  ui.notifications.info(t("Convert.Done", { count: changed }));
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  registerSidebarTab();
  registerContextMenus();
  registerQuestLinks();
  registerAdventureHooks();
});

Hooks.once("ready", async () => {
  try {
    registerImageSocket();
    await store.ensureStores();
    await tidyStoresOnReady();
    offerCategoryConversion();
    refreshAll();
    game.modules.get(MODULE_ID).api = {
      open: () => ui.questlog?.activate(),
      openQuest: id => QuestSheet.open(id),
      newQuest: prefill => QuestSheet.createNew(prefill),
      addToQuestLog,
      quests: () => store.allQuests(),
      getQuest: store.getQuest,
      createQuest: store.createQuest,
      updateQuest: store.updateQuest,
      setStatus: store.setStatus,
      addObjective: store.addObjective,
      addNote: store.addNote,
      exportQuests,
      importQuests,
      importAdventureQuests,
      storeInAdventure,
      setPartHidden: store.setPartHidden,
      setFieldHidden: store.setFieldHidden,
      convertCategoryTags: store.convertCategoryTags,
      deleteAllQuests: confirmDeleteAll,
      openRewards,
      openReward: id => RewardSheet.open(id),
      newReward: prefill => RewardSheet.createNew(prefill),
      addAsReward,
      rewards: () => store.allRewards(),
      getReward: store.getReward,
      createReward: store.createReward,
      updateReward: store.updateReward,
      useReward: store.useReward,
      undoRewardUse: store.undoRewardUse,
      refillReward: store.refillReward,
      setRewardClaimed: store.setRewardClaimed,
      setRewardHidden: store.setRewardHidden,
      deleteReward: store.deleteReward,
      offerQuestRewards: id => RewardSheet.offerFromQuest(id)
    };
  } catch (err) {
    console.error(`${MODULE_ID} | ready`, err);
  }
});

for (const hook of ["createJournalEntry", "deleteJournalEntry"]) {
  Hooks.on(hook, doc => {
    if (store.isStore(doc)) refreshAll();
  });
}

Hooks.on("updateJournalEntry", (doc, changes, options, userId) => {
  try {
    if (!store.isStore(doc)) return;
    refreshAll();
    notifyChange(options?.[MODULE_ID], userId);
    offerRewardsOnCompletion(options?.[MODULE_ID], userId);
  } catch (err) {
    console.error(`${MODULE_ID} | updateJournalEntry`, err);
  }
});

// Keep the two storage journals out of the Journal directory; they're managed from the Quest Log tab.
Hooks.on("renderJournalDirectory", (app, html) => {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0];
    for (const id of store.storeIds()) root?.querySelector(`[data-entry-id="${id}"]`)?.remove();
  } catch (err) {
    console.error(`${MODULE_ID} | renderJournalDirectory`, err);
  }
});

// User names and colours show in notes and in the log of reward uses.
Hooks.on("updateUser", (user, changes) => {
  if ("name" in changes || "color" in changes) {
    QuestSheet.refreshAll();
    RewardSheet.refreshAll();
  }
});
