import {
  MODULE_ID, TEMPLATE_PATH, STATUSES, STATUS_ICONS, REWARD_STATUSES, REWARD_STATUS_ICONS, LINK_ICONS, LINK_TYPES, t, tagHue, formatDate,
  escapeHTML, plainText, userInfo
} from "../util.js";
import * as store from "../store.js";
import { matchQuest, matchReward, matchPartyNote, tokenize } from "../search.js";
import { QuestSheet } from "./quest-sheet.js";
import { RewardSheet } from "./reward-sheet.js";
import { PartyNoteSheet, PARTY_NOTE_ICON } from "./party-note-sheet.js";
import { exportQuests, importQuests } from "../transfer.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { AbstractSidebarTab } = foundry.applications.sidebar;

const TYPE_ICONS = { main: "fa-solid fa-crown", side: "fa-solid fa-compass", "": "fa-solid fa-circle-question" };

export const GROUP_MODES = ["none", "questType", "chapter", "acquiredAt", "location", "giver", "tag"];
export const REWARD_GROUP_MODES = ["none", "quest", "place", "npc", "faction", "other"];
export const NOTE_GROUP_MODES = ["none", "quest", "tag", "author", ...LINK_TYPES];
/** The Notes view's filter: all notes, pinned ones, notes about a quest, general notes (about no quest). */
export const NOTE_FILTERS = ["all", "pinned", "quest", "general"];
/** The three views of the tab. */
export const VIEWS = ["quests", "rewards", "notes"];
const VIEW_ICONS = { quests: "fa-solid fa-scroll", rewards: "fa-solid fa-gift", notes: PARTY_NOTE_ICON };
const VIEW_LABELS = { quests: "QuestsTab", rewards: "Reward.Tab", notes: "PartyNote.Tab" };
/** The client settings that hold each view's status filter and grouping. */
const FILTER_SETTINGS = { quests: "statusFilter", rewards: "rewardStatusFilter", notes: "noteFilter" };
const GROUP_SETTINGS = { quests: "groupBy", rewards: "rewardGroupBy", notes: "noteGroupBy" };
/** At most this many uses are drawn as pips; more show as a number only. */
const MAX_PIPS = 10;

/** The Quest Log tab in the right sidebar (and its pop-out): the quests, the party's quest rewards and the party's notes. */
export class QuestLogTab extends HandlebarsApplicationMixin(AbstractSidebarTab) {
  static tabName = "questlog";

  static DEFAULT_OPTIONS = {
    classes: ["dxql", "dxql-tab", "flexcol"],
    window: { title: "DXQL.Title", icon: "fa-solid fa-scroll" },
    actions: {
      createQuest: QuestLogTab.#onCreateQuest,
      openQuest: QuestLogTab.#onOpenQuest,
      setStatusFilter: QuestLogTab.#onSetStatusFilter,
      toggleGroup: QuestLogTab.#onToggleGroup,
      filterTag: QuestLogTab.#onFilterTag,
      clearTag: QuestLogTab.#onClearTag,
      clearSearch: QuestLogTab.#onClearSearch,
      toggleQuestStatus: QuestLogTab.#onToggleQuestStatus,
      setView: QuestLogTab.#onSetView,
      createReward: QuestLogTab.#onCreateReward,
      openReward: QuestLogTab.#onOpenReward,
      useReward: QuestLogTab.#onUseReward,
      createPartyNote: QuestLogTab.#onCreatePartyNote,
      openPartyNote: QuestLogTab.#onOpenPartyNote,
      toggleNotePin: QuestLogTab.#onToggleNotePin,
      exportQuests: () => exportQuests(),
      importQuests: () => importQuests(null)
    }
  };

  static PARTS = {
    nav: { template: `${TEMPLATE_PATH}/tab-nav.hbs` },
    header: { template: `${TEMPLATE_PATH}/tab-header.hbs` },
    filters: { template: `${TEMPLATE_PATH}/tab-filters.hbs` },
    list: { template: `${TEMPLATE_PATH}/tab-list.hbs`, scrollable: [""] }
  };

  /** The Quest Rewards view uses its own filters and list. */
  static REWARD_PARTS = {
    filters: `${TEMPLATE_PATH}/tab-reward-filters.hbs`,
    list: `${TEMPLATE_PATH}/tab-reward-list.hbs`
  };

  /** The Notes view uses its own filters and list. */
  static NOTE_PARTS = {
    filters: `${TEMPLATE_PATH}/tab-note-filters.hbs`,
    list: `${TEMPLATE_PATH}/tab-note-list.hbs`
  };

  /** Free-text search, shared by the sidebar tab and its pop-out (one for each view). */
  static search = "";
  static rewardSearch = "";
  static noteSearch = "";
  static tagFilter = null;
  static noteTagFilter = null;
  static collapsed = new Set();

  /** The view shown: "quests", "rewards" or "notes" (shared by the tab and its pop-out). */
  static get currentView() {
    const view = game.settings.get(MODULE_ID, "view");
    return VIEWS.includes(view) ? view : "quests";
  }

  get view() {
    return QuestLogTab.currentView;
  }

  get rewardsView() {
    return this.view === "rewards";
  }

  get notesView() {
    return this.view === "notes";
  }

  get statusFilter() {
    return game.settings.get(MODULE_ID, FILTER_SETTINGS[this.view]);
  }

  get groupBy() {
    return game.settings.get(MODULE_ID, GROUP_SETTINGS[this.view]);
  }

  static get currentSearch() {
    return { quests: QuestLogTab.search, rewards: QuestLogTab.rewardSearch, notes: QuestLogTab.noteSearch }[QuestLogTab.currentView];
  }

  static set currentSearch(value) {
    const key = { quests: "search", rewards: "rewardSearch", notes: "noteSearch" }[QuestLogTab.currentView];
    QuestLogTab[key] = value;
  }

  /** Re-renders the parts that depend on quest data (both the tab and its pop-out). */
  refresh() {
    if (!this.rendered) return;
    this.render({ parts: ["nav", "filters", "list"] });
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const swap = this.rewardsView ? QuestLogTab.REWARD_PARTS : this.notesView ? QuestLogTab.NOTE_PARTS : null;
    if (swap) {
      for (const [id, template] of Object.entries(swap)) if (parts[id]) parts[id] = { ...parts[id], template };
    }
    return parts;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const ready = store.storesReady();
    const quests = ready ? store.allQuests() : [];
    const rewards = ready ? store.allRewards() : [];
    const notes = ready ? store.allPartyNotes() : [];
    const rewardsView = this.rewardsView;
    const notesView = this.notesView;
    const viewCounts = {
      quests: quests.filter(q => q.status === "active").length,
      rewards: rewards.filter(r => r.status === "active").length,
      notes: notes.length
    };
    const prefix = { quests: "", rewards: "Reward.", notes: "PartyNote." }[this.view];
    Object.assign(context, {
      ready,
      isGM: game.user.isGM,
      rewardsView,
      notesView,
      views: VIEWS.map(id => ({ id, label: t(VIEW_LABELS[id]), icon: VIEW_ICONS[id], count: viewCounts[id], active: id === this.view })),
      search: QuestLogTab.currentSearch,
      searchPlaceholder: t(`${prefix}SearchPlaceholder`),
      searchLabel: t(`${prefix}Search`)
    });
    if (rewardsView) return this.#prepareRewards(context, quests, rewards);
    if (notesView) return this.#prepareNotes(context, quests, notes);

    const terms = tokenize(QuestLogTab.search);
    const tag = QuestLogTab.tagFilter;
    const all = quests;

    // Search and tag filter first, so the status counts show what the search found.
    const found = [];
    for (const quest of all) {
      if (tag && !quest.tags.some(x => x.toLowerCase() === tag.toLowerCase())) continue;
      const match = matchQuest(quest, terms);
      if (match) found.push({ quest, snippet: match.snippet });
    }
    const counts = { all: found.length };
    for (const s of STATUSES) counts[s] = found.filter(f => f.quest.status === s).length;
    const status = this.statusFilter;
    const shown = found.filter(f => status === "all" || f.quest.status === status);

    Object.assign(context, {
      searching: terms.length > 0 || !!tag,
      tagFilter: tag,
      tagHue: tag ? tagHue(tag) : 0,
      statusTabs: ["active", "completed", "failed", "all"].map(s => ({
        id: s, label: t(`Status.${s}`), count: counts[s], active: s === status
      })),
      groupBy: this.groupBy,
      groupOptions: Object.fromEntries(GROUP_MODES.map(g => [g, t(`GroupBy.${g}`)])),
      groups: this.#group(shown),
      total: all.length,
      emptyMessage: !all.length ? t("EmptyLog") : terms.length || tag ? t("NoMatches") : t(`EmptyStatus.${status}`)
    });
    return context;
  }

  #card(quest, snippet) {
    const total = quest.objectives.length;
    const done = quest.objectives.filter(o => o.done).length;
    const next = quest.status === "active" ? "completed" : "active";
    return {
      id: quest.id,
      title: quest.title,
      status: quest.status,
      statusIcon: STATUS_ICONS[quest.status],
      statusLabel: t(`Status.${quest.status}`),
      toggleTooltip: t(next === "completed" ? "MarkCompleted" : "Reopen"),
      hidden: quest.hidden,
      giver: quest.giver,
      location: quest.location,
      acquiredAt: quest.acquiredAt,
      chapter: quest.chapter,
      questType: quest.questType,
      questTypeLabel: quest.questType ? t(`QuestType.${quest.questType}`) : "",
      questTypeIcon: TYPE_ICONS[quest.questType] ?? "",
      tags: quest.tags.map(name => ({ name, hue: tagHue(name), active: name.toLowerCase() === QuestLogTab.tagFilter?.toLowerCase() })),
      progress: total ? { done, total, pct: Math.round(done / total * 100) } : null,
      noteCount: quest.notes.length,
      hiddenParts: quest.hidden ? 0 : quest.hiddenFields.length
        + ["stages", "objectives", "notes", "gallery", "locations", "items"].reduce((n, k) => n + (quest[k] ?? []).filter(p => p.hidden).length, 0),
      updated: formatDate(quest.updatedAt),
      snippet
    };
  }

  #group(entries) {
    const sort = (a, b) => {
      const order = STATUSES.indexOf(a.quest.status) - STATUSES.indexOf(b.quest.status);
      return order || (b.quest.updatedAt - a.quest.updatedAt);
    };
    entries.sort(sort);
    const mode = this.groupBy;
    if (mode === "none") {
      return entries.length ? [{ key: "all", label: null, quests: entries.map(e => this.#card(e.quest, e.snippet)) }] : [];
    }
    const groups = new Map();
    const unknownKey = "\u0000unknown";
    const add = (rawLabel, entry, { key: fixedKey, label: fixedLabel, rank = 0 } = {}) => {
      const label = String(fixedLabel ?? rawLabel ?? "").trim();
      const key = fixedKey ?? (label ? label.toLowerCase() : unknownKey);
      if (!groups.has(key)) groups.set(key, { key, label: label || t(`GroupUnknown.${mode}`), unknown: !label, rank, quests: [] });
      groups.get(key).quests.push(this.#card(entry.quest, entry.snippet));
    };
    // Quests with several tags or places show up under each of them.
    const multi = { tag: q => q.tags, location: q => q.locations.map(l => l.name) }[mode];
    for (const entry of entries) {
      if (multi) {
        const values = multi(entry.quest);
        if (values.length) values.forEach(v => add(v, entry));
        else add("", entry);
      } else if (mode === "questType") {
        const type = entry.quest.questType;
        add(null, entry, type ? { key: type, label: t(`QuestType.${type}`), rank: type === "main" ? -2 : -1 } : {});
      } else add(entry.quest[mode], entry);
    }
    const icon = {
      questType: "fa-solid fa-crown", chapter: "fa-solid fa-book-bookmark", acquiredAt: "fa-solid fa-flag",
      location: "fa-solid fa-location-dot", giver: "fa-solid fa-user", tag: "fa-solid fa-tag"
    }[mode];
    // Main quests before side quests; "Chapter 2" before "Chapter 10".
    return [...groups.values()]
      .sort((a, b) => (a.unknown - b.unknown) || (a.rank - b.rank)
        || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }))
      .map(g => ({
        ...g,
        icon: mode === "questType" ? TYPE_ICONS[g.unknown ? "" : g.key] : icon,
        hue: mode === "tag" && !g.unknown ? tagHue(g.label) : null,
        count: g.quests.length,
        collapsed: QuestLogTab.collapsed.has(`${mode}:${g.key}`)
      }));
  }

  /* -------------------------------------------- */
  /*  Rewards                                     */
  /* -------------------------------------------- */

  #prepareRewards(context, quests, rewards) {
    const terms = tokenize(QuestLogTab.rewardSearch);
    const questTitles = new Map(quests.map(q => [q.id, q.title]));
    const found = [];
    for (const reward of rewards) {
      const match = matchReward(reward, terms, questTitles.get(reward.questId));
      if (match) found.push({ reward, snippet: match.snippet });
    }
    const counts = { all: found.length };
    for (const s of REWARD_STATUSES) counts[s] = found.filter(f => f.reward.status === s).length;
    const status = REWARD_STATUSES.includes(this.statusFilter) || this.statusFilter === "all" ? this.statusFilter : "active";
    const shown = found.filter(f => status === "all" || f.reward.status === status);
    return Object.assign(context, {
      searching: terms.length > 0,
      statusTabs: ["active", "claimed", "all"].map(s => ({
        id: s, label: t(`Reward.Status.${s}`), count: counts[s], active: s === status
      })),
      groupBy: this.groupBy,
      groupOptions: Object.fromEntries(REWARD_GROUP_MODES.map(g => [g, t(`Reward.GroupBy.${g}`)])),
      groups: this.#groupRewards(shown, questTitles),
      total: rewards.length,
      emptyMessage: !rewards.length ? t("Reward.Empty") : terms.length ? t("Reward.NoMatches") : t(`Reward.EmptyStatus.${status}`)
    });
  }

  #rewardCard(reward, snippet, questTitles) {
    const pips = !reward.unlimited && reward.maxUses <= MAX_PIPS
      ? Array.from({ length: reward.maxUses }, (_, i) => ({ full: i < reward.usesLeft }))
      : null;
    return {
      id: reward.id,
      name: reward.name,
      img: reward.img,
      status: reward.status,
      statusIcon: REWARD_STATUS_ICONS[reward.status],
      hidden: reward.hidden,
      unlimited: reward.unlimited,
      usesLeft: reward.usesLeft,
      maxUses: reward.maxUses,
      pips,
      usesLabel: reward.unlimited ? t("Reward.Unlimited") : t("Reward.UsesLeft", { left: reward.usesLeft, max: reward.maxUses }),
      claimedLabel: reward.usedUp ? t("Reward.UsedUp") : t("Reward.Claimed"),
      canUse: reward.status === "active" && !reward.unlimited,
      questTitle: questTitles.get(reward.questId) ?? "",
      links: reward.links.map(l => ({ name: l.name, icon: LINK_ICONS[l.type], type: l.type, label: t(`Reward.LinkType.${l.type}`) })),
      updated: formatDate(reward.updatedAt),
      snippet
    };
  }

  #groupRewards(entries, questTitles) {
    entries.sort((a, b) => (REWARD_STATUSES.indexOf(a.reward.status) - REWARD_STATUSES.indexOf(b.reward.status))
      || ((b.reward.claimedAt || b.reward.createdAt) - (a.reward.claimedAt || a.reward.createdAt)));
    const mode = this.groupBy;
    const card = e => this.#rewardCard(e.reward, e.snippet, questTitles);
    if (mode === "none" || !REWARD_GROUP_MODES.includes(mode)) {
      return entries.length ? [{ key: "all", label: null, rewards: entries.map(card) }] : [];
    }
    const groups = new Map();
    const unknownKey = "\u0000unknown";
    const add = (label, entry, key = null) => {
      label = String(label ?? "").trim();
      key ??= label ? label.toLowerCase() : unknownKey;
      if (!groups.has(key)) groups.set(key, { key, label: label || t(`Reward.GroupUnknown.${mode}`), unknown: !label, rewards: [] });
      groups.get(key).rewards.push(card(entry));
    };
    for (const entry of entries) {
      if (mode === "quest") {
        const title = questTitles.get(entry.reward.questId);
        add(title, entry, title ? entry.reward.questId : null);
        continue;
      }
      // A reward linked to several places (NPCs, factions …) shows up under each of them.
      const names = entry.reward.links.filter(l => l.type === mode).map(l => l.name);
      if (names.length) [...new Set(names)].forEach(n => add(n, entry));
      else add("", entry);
    }
    const icon = mode === "quest" ? "fa-solid fa-scroll" : LINK_ICONS[mode];
    return [...groups.values()]
      .sort((a, b) => (a.unknown - b.unknown) || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }))
      .map(g => ({ ...g, icon, count: g.rewards.length, collapsed: QuestLogTab.collapsed.has(`rewards:${mode}:${g.key}`) }));
  }

  /* -------------------------------------------- */
  /*  Party notes                                 */
  /* -------------------------------------------- */

  #prepareNotes(context, quests, notes) {
    const terms = tokenize(QuestLogTab.noteSearch);
    const tag = QuestLogTab.noteTagFilter;
    const questTitles = new Map(quests.map(q => [q.id, q.title]));
    const found = [];
    for (const note of notes) {
      if (tag && !note.tags.some(x => x.toLowerCase() === tag.toLowerCase())) continue;
      const match = matchPartyNote(note, terms, questTitles.get(note.questId));
      if (match) found.push({ note, snippet: match.snippet });
    }
    const test = { all: () => true, pinned: n => n.pinned, quest: n => !!n.questId, general: n => !n.questId };
    const counts = Object.fromEntries(NOTE_FILTERS.map(f => [f, found.filter(e => test[f](e.note)).length]));
    const filter = NOTE_FILTERS.includes(this.statusFilter) ? this.statusFilter : "all";
    const shown = found.filter(e => test[filter](e.note));
    return Object.assign(context, {
      searching: terms.length > 0 || !!tag,
      tagFilter: tag,
      tagHue: tag ? tagHue(tag) : 0,
      statusTabs: NOTE_FILTERS.map(f => ({ id: f, label: t(`PartyNote.Filter.${f}`), count: counts[f], active: f === filter })),
      groupBy: this.groupBy,
      groupOptions: Object.fromEntries(NOTE_GROUP_MODES.map(g => [g, t(`PartyNote.GroupBy.${g}`)])),
      groups: this.#groupNotes(shown, questTitles),
      total: notes.length,
      emptyMessage: !notes.length ? t("PartyNote.Empty") : terms.length || tag ? t("PartyNote.NoMatches") : t(`PartyNote.EmptyFilter.${filter}`)
    });
  }

  #noteCard(note, snippet, questTitles) {
    const author = userInfo(note.createdBy, note.authorName);
    const text = plainText(note.text).replace(/\s+/g, " ").trim();
    return {
      id: note.id,
      title: note.title,
      img: note.gallery[0]?.src ?? "",
      imageCount: note.gallery.length,
      pinned: note.pinned,
      hidden: note.hidden,
      questTitle: questTitles.get(note.questId) ?? "",
      links: note.links.map(l => ({ name: l.name, icon: LINK_ICONS[l.type], label: t(`Reward.LinkType.${l.type}`) })),
      tags: note.tags.map(name => ({ name, hue: tagHue(name), active: name.toLowerCase() === QuestLogTab.noteTagFilter?.toLowerCase() })),
      excerpt: snippet ? "" : text.length > 140 ? `${text.slice(0, 140)}…` : text,
      author: author.name,
      color: author.color,
      updated: formatDate(note.editedAt || note.createdAt),
      pinTooltip: t(note.pinned ? "PartyNote.Unpin" : "PartyNote.Pin"),
      snippet
    };
  }

  #groupNotes(entries, questTitles) {
    // Pinned notes first, then the most recently changed.
    entries.sort((a, b) => (b.note.pinned - a.note.pinned) || ((b.note.editedAt || b.note.createdAt) - (a.note.editedAt || a.note.createdAt)));
    const mode = NOTE_GROUP_MODES.includes(this.groupBy) ? this.groupBy : "none";
    const card = e => this.#noteCard(e.note, e.snippet, questTitles);
    if (mode === "none") return entries.length ? [{ key: "all", label: null, notes: entries.map(card) }] : [];
    const groups = new Map();
    const unknownKey = "\u0000unknown";
    const add = (label, entry, key = null) => {
      label = String(label ?? "").trim();
      key ??= label ? label.toLowerCase() : unknownKey;
      if (!groups.has(key)) groups.set(key, { key, label: label || t(`PartyNote.GroupUnknown.${mode}`), unknown: !label, notes: [] });
      groups.get(key).notes.push(card(entry));
    };
    for (const entry of entries) {
      const note = entry.note;
      if (mode === "quest") {
        const title = questTitles.get(note.questId);
        add(title, entry, title ? note.questId : null);
      } else if (mode === "author") {
        add(userInfo(note.createdBy, note.authorName).name, entry, note.createdBy || null);
      } else {
        // A note with several tags (places, NPCs …) shows up under each of them.
        const names = mode === "tag" ? note.tags : note.links.filter(l => l.type === mode).map(l => l.name);
        if (names.length) [...new Set(names)].forEach(n => add(n, entry));
        else add("", entry);
      }
    }
    const icon = { quest: "fa-solid fa-scroll", tag: "fa-solid fa-tag", author: "fa-solid fa-user-pen" }[mode] ?? LINK_ICONS[mode];
    return [...groups.values()]
      .sort((a, b) => (a.unknown - b.unknown) || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }))
      .map(g => ({
        ...g,
        icon,
        hue: mode === "tag" && !g.unknown ? tagHue(g.label) : null,
        count: g.notes.length,
        collapsed: QuestLogTab.collapsed.has(`notes:${mode}:${g.key}`)
      }));
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _onRender(context, options) {
    await super._onRender(context, options);
    const input = this.element.querySelector("input[name=search]");
    if (input && options.parts?.includes("header")) {
      input.addEventListener("input", foundry.utils.debounce(event => {
        QuestLogTab.currentSearch = event.target.value;
        this.#renderAllLists();
      }, 150));
      input.addEventListener("keydown", event => {
        if (event.key === "Escape" && input.value) {
          event.preventDefault();
          event.stopPropagation();
          input.value = "";
          QuestLogTab.currentSearch = "";
          this.#renderAllLists();
        }
      });
    }
    const select = this.element.querySelector("select[name=groupBy]");
    if (select && options.parts?.includes("filters")) {
      select.addEventListener("change", async event => {
        await game.settings.set(MODULE_ID, GROUP_SETTINGS[this.view], event.target.value);
        this.#renderAllLists();
      });
    }
    if (!this._dxqlMenu) {
      this._dxqlMenu = true;
      const ContextMenu = foundry.applications.ux.ContextMenu.implementation;
      new ContextMenu(this.element, ".dxql-quest[data-quest-id]", this.#questMenu(), { jQuery: false, fixed: true });
      new ContextMenu(this.element, ".dxql-reward[data-reward-id]", RewardSheet.contextOptions(li => li.dataset.rewardId), {
        jQuery: false, fixed: true
      });
      new ContextMenu(this.element, ".dxql-party-note[data-note-id]", PartyNoteSheet.contextOptions(li => li.dataset.noteId), {
        jQuery: false, fixed: true
      });
    }
  }

  /** The tab and its pop-out keep the same search; re-render both lists. */
  #renderAllLists() {
    const search = QuestLogTab.currentSearch;
    for (const app of [ui.questlog, ui.questlog?.popout]) {
      if (!app?.rendered) continue;
      const input = app.element.querySelector("input[name=search]");
      if (app !== this && input && input.value !== search) input.value = search;
      app.render({ parts: ["filters", "list"] });
    }
  }

  #questMenu() {
    const quest = li => store.getQuest(li.dataset.questId);
    return [
      {
        name: "DXQL.Open", icon: '<i class="fa-solid fa-book-open"></i>',
        callback: li => QuestSheet.open(li.dataset.questId)
      },
      {
        name: "DXQL.CopyLink", icon: '<i class="fa-solid fa-link"></i>',
        callback: li => {
          const q = quest(li);
          if (!q) return;
          const link = `@Quest[${q.id}]{${q.title.replace(/[{}[\]]/g, "")}}`;
          navigator.clipboard?.writeText(link)
            .then(() => ui.notifications.info(t("LinkCopied", { link: escapeHTML(link) })))
            .catch(() => ui.notifications.warn(link));
        }
      },
      {
        name: "DXQL.MarkCompleted", icon: '<i class="fa-solid fa-circle-check"></i>',
        condition: li => quest(li)?.status !== "completed",
        callback: li => store.setStatus(li.dataset.questId, "completed")
      },
      {
        name: "DXQL.MarkFailed", icon: '<i class="fa-solid fa-circle-xmark"></i>',
        condition: li => quest(li)?.status !== "failed",
        callback: li => store.setStatus(li.dataset.questId, "failed")
      },
      {
        name: "DXQL.Reopen", icon: '<i class="fa-solid fa-rotate-left"></i>',
        condition: li => quest(li)?.status !== "active",
        callback: li => store.setStatus(li.dataset.questId, "active")
      },
      {
        name: "DXQL.HideFromPlayers", icon: '<i class="fa-solid fa-eye-slash"></i>',
        condition: li => game.user.isGM && quest(li) && !quest(li).hidden,
        callback: li => store.setHidden(li.dataset.questId, true)
      },
      {
        name: "DXQL.RevealToPlayers", icon: '<i class="fa-solid fa-eye"></i>',
        condition: li => game.user.isGM && quest(li)?.hidden,
        callback: li => store.setHidden(li.dataset.questId, false)
      },
      {
        name: "DXQL.DeleteQuest", icon: '<i class="fa-solid fa-trash"></i>',
        condition: li => { const q = quest(li); return q && store.canDelete(q.createdBy); },
        callback: li => QuestSheet.confirmDelete(li.dataset.questId)
      }
    ];
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onCreateQuest() {
    if (!store.storesReady()) return ui.notifications.warn(t("NotReady"));
    QuestSheet.createNew();
  }

  static #onOpenQuest(event, target) {
    const id = target.closest("[data-quest-id]")?.dataset.questId;
    if (id) QuestSheet.open(id, { highlight: QuestLogTab.search });
  }

  static async #onSetStatusFilter(event, target) {
    await game.settings.set(MODULE_ID, FILTER_SETTINGS[this.view], target.dataset.status);
    this.#renderAllLists();
  }

  static #onToggleGroup(event, target) {
    const group = target.closest("[data-group]").dataset.group;
    const key = this.view === "quests" ? `${this.groupBy}:${group}` : `${this.view}:${this.groupBy}:${group}`;
    if (QuestLogTab.collapsed.has(key)) QuestLogTab.collapsed.delete(key);
    else QuestLogTab.collapsed.add(key);
    this.#renderAllLists();
  }

  static #onFilterTag(event, target) {
    event.stopPropagation();
    const tag = target.dataset.tag;
    const key = this.notesView ? "noteTagFilter" : "tagFilter";
    QuestLogTab[key] = QuestLogTab[key]?.toLowerCase() === tag.toLowerCase() ? null : tag;
    this.#renderAllLists();
  }

  static #onClearTag() {
    QuestLogTab[this.notesView ? "noteTagFilter" : "tagFilter"] = null;
    this.#renderAllLists();
  }

  static #onClearSearch() {
    QuestLogTab.currentSearch = "";
    if (this.notesView) QuestLogTab.noteTagFilter = null;
    else if (!this.rewardsView) QuestLogTab.tagFilter = null;
    for (const app of [ui.questlog, ui.questlog?.popout]) {
      const input = app?.element?.querySelector("input[name=search]");
      if (input) input.value = "";
    }
    this.#renderAllLists();
  }

  static async #onToggleQuestStatus(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-quest-id]")?.dataset.questId;
    const quest = id && store.getQuest(id);
    if (!quest) return;
    await store.setStatus(id, quest.status === "active" ? "completed" : "active");
  }

  /* Rewards */

  /** Switches between the quests, the quest rewards and the notes (in the tab and its pop-out). */
  static async #onSetView(event, target) {
    const view = target.dataset.view;
    if (!VIEWS.includes(view) || view === this.view) return;
    await game.settings.set(MODULE_ID, "view", view);
    for (const app of [ui.questlog, ui.questlog?.popout]) {
      if (app?.rendered) app.render({ parts: ["nav", "header", "filters", "list"] });
    }
  }

  static #onCreateReward() {
    if (!store.storesReady()) return ui.notifications.warn(t("NotReady"));
    RewardSheet.createNew();
  }

  static #onOpenReward(event, target) {
    const id = target.closest("[data-reward-id]")?.dataset.rewardId;
    if (id) RewardSheet.open(id, { highlight: QuestLogTab.rewardSearch });
  }

  static async #onUseReward(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-reward-id]")?.dataset.rewardId;
    if (id) await store.useReward(id);
  }

  /* Party notes */

  static #onCreatePartyNote() {
    if (!store.storesReady()) return ui.notifications.warn(t("NotReady"));
    PartyNoteSheet.createNew();
  }

  static #onOpenPartyNote(event, target) {
    const id = target.closest("[data-note-id]")?.dataset.noteId;
    if (id) PartyNoteSheet.open(id, { highlight: QuestLogTab.noteSearch });
  }

  static async #onToggleNotePin(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-note-id]")?.dataset.noteId;
    const note = id && store.getPartyNote(id);
    if (note) await store.setPartyNotePinned(id, !note.pinned);
  }
}
