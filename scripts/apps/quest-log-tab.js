import { MODULE_ID, TEMPLATE_PATH, STATUSES, STATUS_ICONS, t, tagHue, formatDate, escapeHTML } from "../util.js";
import * as store from "../store.js";
import { matchQuest, tokenize } from "../search.js";
import { QuestSheet } from "./quest-sheet.js";
import { exportQuests, importQuests } from "../transfer.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { AbstractSidebarTab } = foundry.applications.sidebar;

const TYPE_ICONS = { main: "fa-solid fa-crown", side: "fa-solid fa-compass", "": "fa-solid fa-circle-question" };

export const GROUP_MODES = ["none", "questType", "chapter", "acquiredAt", "location", "giver", "tag"];

/** The Quest Log tab in the right sidebar (and its pop-out). */
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
      exportQuests: () => exportQuests(),
      importQuests: () => importQuests(null)
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATE_PATH}/tab-header.hbs` },
    filters: { template: `${TEMPLATE_PATH}/tab-filters.hbs` },
    list: { template: `${TEMPLATE_PATH}/tab-list.hbs`, scrollable: [""] }
  };

  /** Free-text search, shared by the sidebar tab and its pop-out. */
  static search = "";
  static tagFilter = null;
  static collapsed = new Set();

  get statusFilter() {
    return game.settings.get(MODULE_ID, "statusFilter");
  }

  get groupBy() {
    return game.settings.get(MODULE_ID, "groupBy");
  }

  /** Re-renders the parts that depend on quest data (both the tab and its pop-out). */
  refresh() {
    if (!this.rendered) return;
    this.render({ parts: ["filters", "list"] });
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const ready = store.storesReady();
    const terms = tokenize(QuestLogTab.search);
    const tag = QuestLogTab.tagFilter;
    const all = ready ? store.allQuests() : [];

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
      ready,
      isGM: game.user.isGM,
      search: QuestLogTab.search,
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
        + ["stages", "objectives", "notes", "gallery", "locations"].reduce((n, k) => n + (quest[k] ?? []).filter(p => p.hidden).length, 0),
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
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _onRender(context, options) {
    await super._onRender(context, options);
    const input = this.element.querySelector("input[name=search]");
    if (input && options.parts?.includes("header")) {
      input.addEventListener("input", foundry.utils.debounce(event => {
        QuestLogTab.search = event.target.value;
        this.#renderAllLists();
      }, 150));
      input.addEventListener("keydown", event => {
        if (event.key === "Escape" && input.value) {
          event.preventDefault();
          event.stopPropagation();
          input.value = "";
          QuestLogTab.search = "";
          this.#renderAllLists();
        }
      });
    }
    const select = this.element.querySelector("select[name=groupBy]");
    if (select && options.parts?.includes("filters")) {
      select.addEventListener("change", async event => {
        await game.settings.set(MODULE_ID, "groupBy", event.target.value);
        this.#renderAllLists();
      });
    }
    if (!this._dxqlMenu) {
      this._dxqlMenu = true;
      new foundry.applications.ux.ContextMenu.implementation(this.element, ".dxql-quest[data-quest-id]", this.#questMenu(), {
        jQuery: false, fixed: true
      });
    }
  }

  /** The tab and its pop-out keep the same search; re-render both lists. */
  #renderAllLists() {
    for (const app of [ui.questlog, ui.questlog?.popout]) {
      if (!app?.rendered) continue;
      const input = app.element.querySelector("input[name=search]");
      if (app !== this && input && input.value !== QuestLogTab.search) input.value = QuestLogTab.search;
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
    await game.settings.set(MODULE_ID, "statusFilter", target.dataset.status);
    this.#renderAllLists();
  }

  static #onToggleGroup(event, target) {
    const key = `${this.groupBy}:${target.closest("[data-group]").dataset.group}`;
    if (QuestLogTab.collapsed.has(key)) QuestLogTab.collapsed.delete(key);
    else QuestLogTab.collapsed.add(key);
    this.#renderAllLists();
  }

  static #onFilterTag(event, target) {
    event.stopPropagation();
    const tag = target.dataset.tag;
    QuestLogTab.tagFilter = QuestLogTab.tagFilter?.toLowerCase() === tag.toLowerCase() ? null : tag;
    this.#renderAllLists();
  }

  static #onClearTag() {
    QuestLogTab.tagFilter = null;
    this.#renderAllLists();
  }

  static #onClearSearch() {
    QuestLogTab.search = "";
    QuestLogTab.tagFilter = null;
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
}
