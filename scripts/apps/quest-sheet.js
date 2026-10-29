import {
  MODULE_ID, TEMPLATE_PATH, STATUS_ICONS, NOTE_ICONS, REWARD_STATUS_ICONS, HIDEABLE_FIELDS, QUEST_TYPES, t, cleanLine, tagHue, cleanTag, enrich, formatDate, userInfo,
  locationSuggestions, currentSceneName, getDropData, linkForDrop, insertAtCursor, randomId, escapeHTML, facesEntry, openFacesEntry
} from "../util.js";
import * as store from "../store.js";
import { tokenize, markTerms } from "../search.js";
import { uploadImages, pickFiles, browseImage, canBrowse, filesFromEvent, urlFromDrop, showImage } from "../images.js";
import { RewardSheet, splitRewardText } from "./reward-sheet.js";
import { PartyNoteSheet } from "./party-note-sheet.js";
import { attachNpcPicker, knownFaces, knownFace, facesActive } from "../npcs.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const SOURCE_ICONS = {
  ChatMessage: "fa-solid fa-comment",
  JournalEntry: "fa-solid fa-book",
  JournalEntryPage: "fa-solid fa-book-open",
  Actor: "fa-solid fa-user",
  Item: "fa-solid fa-suitcase",
  Scene: "fa-solid fa-map"
};

const TYPE_ICONS = { main: "fa-solid fa-crown", side: "fa-solid fa-compass", "": "fa-solid fa-circle-question" };

function sourceIcon(uuid) {
  let type = null;
  try {
    type = foundry.utils.parseUuid(uuid)?.type;
  } catch { /* ignore */ }
  return SOURCE_ICONS[type] ?? "fa-solid fa-link";
}

/** One quest's window: details, objectives, images, notes and clues. Also used to create a new quest. */
export class QuestSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dxql", "dxql-sheet"],
    window: { icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 620, height: 780 },
    actions: {
      edit: QuestSheet.#onEdit,
      toggleDraftField: QuestSheet.#onToggleDraftField,
      setQuestType: QuestSheet.#onSetQuestType,
      removeLocation: QuestSheet.#onRemoveLocation,
      toggleDraftLocation: QuestSheet.#onToggleDraftLocation,
      toggleField: QuestSheet.#onToggleField,
      togglePart: QuestSheet.#onTogglePart,
      toggleComposerHidden: QuestSheet.#onToggleComposerHidden,
      toggleNewObjectiveHidden: QuestSheet.#onToggleNewObjectiveHidden,
      cancelEdit: QuestSheet.#onCancelEdit,
      removeTag: QuestSheet.#onRemoveTag,
      removeDraftImage: QuestSheet.#onRemoveDraftImage,
      useScene: QuestSheet.#onUseScene,
      unlinkGiver: QuestSheet.#onUnlinkGiver,
      setStatus: QuestSheet.#onSetStatus,
      toggleHidden: QuestSheet.#onToggleHidden,
      deleteQuest: QuestSheet.#onDeleteQuest,
      openGiver: QuestSheet.#onOpenGiver,
      openFacesEntry: QuestSheet.#onOpenFacesEntry,
      addObjective: QuestSheet.#onAddObjective,
      addStage: QuestSheet.#onAddStage,
      editStage: QuestSheet.#onEditStage,
      deleteStage: QuestSheet.#onDeleteStage,
      editObjective: QuestSheet.#onEditObjective,
      saveObjective: QuestSheet.#onSaveObjective,
      deleteObjective: QuestSheet.#onDeleteObjective,
      moveObjective: QuestSheet.#onMoveObjective,
      addItem: QuestSheet.#onAddItem,
      deleteItem: QuestSheet.#onDeleteItem,
      openItem: QuestSheet.#onOpenItem,
      toggleNewItemHidden: QuestSheet.#onToggleNewItemHidden,
      addNpc: QuestSheet.#onAddNpc,
      deleteNpc: QuestSheet.#onDeleteNpc,
      openNpc: QuestSheet.#onOpenNpc,
      addGalleryImage: QuestSheet.#onAddGalleryImage,
      browseGalleryImage: QuestSheet.#onBrowseGalleryImage,
      removeImage: QuestSheet.#onRemoveImage,
      viewImage: QuestSheet.#onViewImage,
      setNoteFilter: QuestSheet.#onSetNoteFilter,
      setComposerType: QuestSheet.#onSetComposerType,
      attachComposerImage: QuestSheet.#onAttachComposerImage,
      browseComposerImage: QuestSheet.#onBrowseComposerImage,
      removeComposerImage: QuestSheet.#onRemoveComposerImage,
      postNote: QuestSheet.#onPostNote,
      toggleNoteType: QuestSheet.#onToggleNoteType,
      editNote: QuestSheet.#onEditNote,
      saveNote: QuestSheet.#onSaveNote,
      cancelNote: QuestSheet.#onCancelNote,
      deleteNote: QuestSheet.#onDeleteNote,
      attachEditImage: QuestSheet.#onAttachEditImage,
      removeEditImage: QuestSheet.#onRemoveEditImage,
      openSource: QuestSheet.#onOpenSource,
      openRelated: QuestSheet.#onOpenRelated,
      openReward: QuestSheet.#onOpenReward,
      addReward: QuestSheet.#onAddReward,
      openPartyNote: QuestSheet.#onOpenPartyNote,
      addPartyNote: QuestSheet.#onAddPartyNote
    }
  };

  static PARTS = {
    // "" = the part's own root element (.dxql-sheet-scroll), so re-renders keep the scroll position.
    body: { template: `${TEMPLATE_PATH}/quest-sheet.hbs`, scrollable: [""] }
  };

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  static appId(questId) {
    return `dxql-quest-${questId}`;
  }

  /** Opens (or brings forward) the window of a quest. */
  static open(questId, { highlight = "", position } = {}) {
    const existing = foundry.applications.instances.get(QuestSheet.appId(questId));
    if (existing) {
      existing.highlight = highlight;
      existing.render({ force: true });
      existing.bringToFront();
      return existing;
    }
    const options = { id: QuestSheet.appId(questId), questId, highlight };
    if (position) options.position = position;
    const app = new QuestSheet(options);
    app.render({ force: true });
    return app;
  }

  /** Opens an empty quest form; nothing is saved until Create. */
  static createNew(prefill = {}) {
    const app = new QuestSheet({ id: `dxql-quest-new-${randomId()}`, draft: prefill });
    app.render({ force: true });
    return app;
  }

  /** Re-renders every open quest window (after the log changed); closes windows of deleted quests. */
  static refreshAll() {
    for (const app of foundry.applications.instances.values()) {
      if (!(app instanceof QuestSheet) || !app.rendered) continue;
      if (app.questId && !store.getQuest(app.questId)) {
        // An import or a reveal briefly removes a quest before writing it back; only close if it stays gone.
        setTimeout(() => {
          if (app.rendered && !store.getQuest(app.questId)) app.close();
        }, 1500);
        continue;
      }
      app.render();
    }
  }

  static async confirmDelete(questId) {
    const quest = store.getQuest(questId);
    if (!quest) return false;
    const ok = await DialogV2.confirm({
      window: { title: t("DeleteQuest"), icon: "fa-solid fa-trash" },
      content: `<p>${t("DeleteQuestConfirm", { title: escapeHTML(quest.title) })}</p>`,
      rejectClose: false
    });
    if (!ok) return false;
    await store.deleteQuest(questId);
    return true;
  }

  /* -------------------------------------------- */

  constructor(options = {}) {
    super(options);
    this.questId = options.questId ?? null;
    this.highlight = options.highlight ?? "";
    this.editing = !this.questId;
    this.draft = this.questId ? null : QuestSheet.#makeDraft(options.draft ?? {});
    this.tagInput = "";
    this.locationInput = "";
    this.composer = { text: "", type: "note", images: [], uploading: 0, hidden: false };
    this.newObjectiveHidden = false;
    this.newItem = "";
    this.newItemHidden = false;
    this.newNpc = "";
    this.noteFilter = "all";
    this.newObjective = "";
    this.newObjectiveStage = "";
    this.editObjective = null;
    this.editNote = null;
    this.galleryUploading = 0;
    this._focus = null;
  }

  static #makeDraft(source = {}) {
    return {
      title: source.title ?? "",
      giver: source.giver ?? "",
      giverImg: source.giverImg ?? "",
      giverUuid: source.giverUuid ?? "",
      acquiredAt: source.acquiredAt ?? "",
      // Places as a list of {id, name, hidden}; a prefill may give one text ("A, B" becomes two places).
      locations: Array.isArray(source.locations)
        ? source.locations.map(l => ({ id: l.id ?? null, name: l.name, hidden: !!l.hidden }))
        : String(source.location ?? "").split(",").map(n => cleanLine(n, 120)).filter(Boolean).map(name => ({ id: null, name, hidden: false })),
      chapter: source.chapter ?? "",
      questType: QUEST_TYPES.includes(source.questType) ? source.questType : "",
      reward: source.reward ?? "",
      description: source.description ?? "",
      tags: [...(source.tags ?? [])],
      hidden: !!source.hidden,
      hiddenFields: [...(source.hiddenFields ?? [])],
      objectivesText: source.objectivesText ?? "",
      objectivesHidden: !!source.objectivesHidden,
      images: [...(source.images ?? [])],
      notes: [...(source.notes ?? [])]
    };
  }

  get quest() {
    return this.questId ? store.getQuest(this.questId) : null;
  }

  get title() {
    if (!this.questId) return t("NewQuest");
    return this.quest?.title ?? t("Title");
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const all = store.storesReady() ? store.allQuests() : [];
    const quest = this.quest;
    Object.assign(context, {
      appId: this.id,
      isGM: game.user.isGM,
      isNew: !this.questId,
      editing: this.editing,
      missing: !!this.questId && !quest,
      canBrowse: canBrowse()
    });
    if (context.missing) return context;

    if (this.editing) {
      if (!this.draft) this.draft = QuestSheet.#makeDraft(quest);
      const tagSet = new Map();
      for (const q of all) for (const tag of q.tags) tagSet.set(tag.toLowerCase(), tag);
      // GM: which fields are hidden (eye toggles). Player: which fields to leave out of the form entirely.
      const hiddenNow = game.user.isGM ? this.draft.hiddenFields : this.questId ? store.hiddenFieldsFor(this.questId) : [];
      const fieldMap = Object.fromEntries(HIDEABLE_FIELDS.map(f => [f, hiddenNow.includes(f)]));
      Object.assign(context, {
        secret: game.user.isGM ? fieldMap : {},
        locked: game.user.isGM ? {} : fieldMap,
        draft: {
          ...this.draft,
          tagList: this.draft.tags.map(name => ({ name, hue: tagHue(name) })),
          locationList: this.draft.locations,
          notePreview: this.draft.notes.map(n => ({
            type: n.type,
            icon: NOTE_ICONS[n.type] ?? NOTE_ICONS.note,
            label: t(n.type === "clue" ? "Clue" : "Note"),
            text: n.text.length > 160 ? `${n.text.slice(0, 160)}…` : n.text,
            hidden: !!n.hidden,
            images: n.images ?? []
          }))
        },
        tagInput: this.tagInput,
        locationInput: this.locationInput,
        questTypes: ["main", "side", ""].map(id => ({
          id, label: t(`QuestType.${id || "none"}`), icon: TYPE_ICONS[id], active: this.draft.questType === id
        })),
        chapters: [...new Set(all.map(q => q.chapter).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })),
        sceneName: currentSceneName(),
        locations: locationSuggestions(all)
          .filter(n => !this.draft.locations.some(l => l.name.toLowerCase() === n.toLowerCase())),
        givers: [...new Set(all.map(q => q.giver).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        tagSuggestions: [...tagSet.values()].sort((a, b) => a.localeCompare(b))
      });
      return context;
    }

    const secret = Object.fromEntries(HIDEABLE_FIELDS.map(f => [f, quest.hiddenFields.includes(f)]));
    const hiddenParts = quest.hiddenFields.length
      + ["stages", "objectives", "notes", "gallery", "locations", "items", "npcs"].reduce((n, k) => n + quest[k].filter(p => p.hidden).length, 0);
    const total = quest.objectives.length;
    const done = quest.objectives.filter(o => o.done).length;
    const objectives = [];
    for (const o of quest.objectives) {
      const editing = this.editObjective?.id === o.id;
      objectives.push({
        ...o,
        html: await enrich(o.text),
        editing,
        editText: editing ? this.editObjective.text : "",
        canDelete: store.canDelete(o.createdBy),
        doneTooltip: o.doneBy || o.doneByName ? t("DoneBy", { name: userInfo(o.doneBy, o.doneByName).name }) : t("MarkObjectiveOpen")
      });
    }

    // Objectives without a stage come first, then each stage (a heading and its text) with its own objectives.
    const objectiveGroups = [{ stage: null, objectives: objectives.filter(o => !o.stage) }];
    for (const s of quest.stages) {
      objectiveGroups.push({
        stage: { ...s, html: await enrich(s.text), canDelete: store.canDelete(s.createdBy) },
        objectives: objectives.filter(o => o.stage === s.id)
      });
    }
    if (this.newObjectiveStage && !quest.stages.some(s => s.id === this.newObjectiveStage)) this.newObjectiveStage = "";
    const stageOptions = quest.stages.length ? [{ id: "", label: t("NoStage"), selected: !this.newObjectiveStage },
      ...quest.stages.map(s => ({ id: s.id, label: s.title, selected: s.id === this.newObjectiveStage }))] : [];

    const notes = [];
    const shownNotes = quest.notes.filter(n => this.noteFilter === "all" || n.type === this.noteFilter).reverse();
    for (const n of shownNotes) {
      const author = userInfo(n.createdBy, n.authorName);
      const mine = n.createdBy === game.user.id;
      const editing = this.editNote?.id === n.id;
      notes.push({
        ...n,
        html: await enrich(n.text),
        typeLabel: t(n.type === "clue" ? "Clue" : "Note"),
        icon: NOTE_ICONS[n.type],
        author: author.name,
        color: author.color,
        date: formatDate(n.createdAt),
        fullDate: new Date(n.createdAt).toLocaleString(),
        edited: !!n.editedAt,
        canEdit: game.user.isGM || mine,
        canDelete: store.canDelete(n.createdBy),
        source: n.source ? { ...n.source, icon: sourceIcon(n.source.uuid), label: n.source.label || t("Source") } : null,
        editing,
        editText: editing ? this.editNote.text : "",
        editImages: editing ? this.editNote.images : []
      });
    }

    const counts = { all: quest.notes.length, note: 0, clue: 0 };
    for (const n of quest.notes) counts[n.type]++;

    const myTags = new Set(quest.tags.map(x => x.toLowerCase()));
    const related = myTags.size ? all
      .filter(q => q.id !== quest.id && q.tags.some(x => myTags.has(x.toLowerCase())))
      .map(q => ({
        id: q.id, title: q.title, status: q.status, statusIcon: STATUS_ICONS[q.status],
        shared: q.tags.filter(x => myTags.has(x.toLowerCase())).map(name => ({ name, hue: tagHue(name) }))
      }))
      .sort((a, b) => a.title.localeCompare(b.title)) : [];

    Object.assign(context, {
      quest: {
        ...quest,
        statusIcon: STATUS_ICONS[quest.status],
        statusLabel: t(`Status.${quest.status}`),
        tagList: quest.tags.map(name => ({ name, hue: tagHue(name) })),
        locations: quest.locations.map(l => ({ ...l, faces: facesEntry("place", l.name) }))
      },
      giverFaces: facesEntry("npc", quest.giver),
      acquiredAtFaces: facesEntry("place", quest.acquiredAt),
      canDeleteQuest: store.canDelete(quest.createdBy),
      secret,
      hiddenParts,
      questTypeLabel: quest.questType ? t(`QuestType.${quest.questType}`) : "",
      questTypeIcon: TYPE_ICONS[quest.questType] ?? "",
      newObjectiveHidden: this.newObjectiveHidden,
      descriptionHTML: await enrich(quest.description),
      objectives,
      objectiveGroups,
      stageOptions,
      progress: total ? { done, total, pct: Math.round(done / total * 100) } : null,
      newObjective: this.newObjective,
      items: quest.items.map(i => ({ ...i, canDelete: store.canDelete(i.createdBy) })),
      itemsHave: quest.items.filter(i => i.have).length,
      newItem: this.newItem,
      newItemHidden: this.newItemHidden,
      npcs: quest.npcs.map(n => {
        // Familiar Faces & Places: the NPC itself if the user knows it there, else one with the same name.
        const face = knownFace(n.faceId);
        const faces = face ? { kind: "faces", id: face.id } : facesEntry("npc", n.name);
        return { ...n, img: n.img || face?.img || "", faces, canDelete: store.canDelete(n.createdBy) };
      }),
      newNpc: this.newNpc,
      npcSuggestions: knownFaces().map(f => f.name)
        .filter(name => !quest.npcs.some(n => n.name.toLowerCase() === name.toLowerCase()))
        .sort((a, b) => a.localeCompare(b)),
      facesActive: facesActive(),
      gallery: quest.gallery.map(g => ({ ...g, canDelete: store.canDelete(g.createdBy) })),
      galleryUploading: this.galleryUploading > 0,
      composer: this.composer,
      noteTabs: ["all", "note", "clue"].map(id => ({
        id, label: t(id === "all" ? "All" : id === "clue" ? "Clues" : "Notes"), count: counts[id], active: this.noteFilter === id
      })),
      notes,
      noteEmpty: t(this.noteFilter === "clue" ? "NoClues" : "NoNotes"),
      related,
      rewards: store.rewardsForQuest(quest.id).sort((a, b) => a.createdAt - b.createdAt).map(r => ({
        id: r.id, name: r.name, status: r.status, hidden: r.hidden, statusIcon: REWARD_STATUS_ICONS[r.status],
        usesLabel: r.unlimited ? t("Reward.Unlimited") : t("Reward.UsesLeft", { left: r.usesLeft, max: r.maxUses })
      })),
      partyNotes: store.partyNotesForQuest(quest.id)
        .sort((a, b) => (b.pinned - a.pinned) || ((b.editedAt || b.createdAt) - (a.editedAt || a.createdAt)))
        .map(n => ({ id: n.id, title: n.title, pinned: n.pinned, hidden: n.hidden, date: formatDate(n.editedAt || n.createdAt) })),
      createdBy: userInfo(quest.createdBy, quest.authorName).name,
      createdAt: new Date(quest.createdAt || Date.now()).toLocaleDateString()
    });
    return context;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _preRender(context, options) {
    await super._preRender(context, options);
    const active = document.activeElement;
    this._focus = null;
    if (this.element?.contains(active) && active.dataset?.bind) {
      this._focus = { bind: active.dataset.bind, start: active.selectionStart, end: active.selectionEnd };
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    const titleEl = root.querySelector(".window-title");
    if (titleEl) titleEl.textContent = this.title;
    root.classList.toggle("is-editing", this.editing);
    // Re-renders keep the scroll position (PARTS scrollable); switching between view and edit mode starts at the top.
    if (this._scrollToTop) {
      this._scrollToTop = false;
      const scroller = root.querySelector(".dxql-sheet-scroll");
      if (scroller) scroller.scrollTop = 0;
    }

    // Two-way binding of inputs to this sheet's state (survives re-renders caused by other people's edits).
    for (const field of root.querySelectorAll("[data-bind]")) {
      const evt = field.type === "checkbox" ? "change" : "input";
      field.addEventListener(evt, () => this.#bind(field));
    }
    // "@" + a name in objectives offers Familiar Faces & Places NPCs (before the Enter-to-save listeners below).
    for (const field of root.querySelectorAll("[data-npc-picker-field]")) attachNpcPicker(field);
    for (const field of root.querySelectorAll("[data-keys]")) {
      field.addEventListener("keydown", event => this.#onKeyDown(event, field.dataset.keys));
    }
    root.querySelector("[data-bind=tagInput]")?.addEventListener("keydown", event => this.#onTagKey(event));
    const placeInput = root.querySelector("[data-bind=locationInput]");
    placeInput?.addEventListener("keydown", event => this.#onPlaceKey(event));
    // Typing or pasting a comma turns everything before it into places.
    placeInput?.addEventListener("input", event => {
      if (event.target.value.includes(",")) this.#commitPlaces({ keepLast: true });
    });
    root.querySelector("form.dxql-edit")?.addEventListener("submit", event => {
      event.preventDefault();
      QuestSheet.#onSaveQuest.call(this, event);
    });
    for (const box of root.querySelectorAll("[data-change=toggleObjective]")) {
      box.addEventListener("change", event => {
        const oid = event.target.closest("[data-objective-id]").dataset.objectiveId;
        store.updateObjective(this.questId, oid, { done: event.target.checked });
      });
    }
    for (const box of root.querySelectorAll("[data-change=toggleItem]")) {
      box.addEventListener("change", event => {
        const iid = event.target.closest("[data-item-id]").dataset.itemId;
        store.updateItem(this.questId, iid, { have: event.target.checked });
      });
    }
    for (const text of root.querySelectorAll(".dxql-objective-text")) {
      text.addEventListener("dblclick", event => {
        const oid = event.currentTarget.closest("[data-objective-id]").dataset.objectiveId;
        this.#startObjectiveEdit(oid);
      });
    }
    const editObjectiveInput = root.querySelector(".dxql-objective-edit");
    editObjectiveInput?.addEventListener("blur", () => {
      setTimeout(() => { if (this.editObjective && !this.element.contains(document.activeElement)) this.#saveObjective(); }, 150);
    });

    // Paste images into the note composer or note editor.
    for (const area of root.querySelectorAll("[data-keys=composer], [data-keys=noteEdit]")) {
      area.addEventListener("paste", event => {
        const files = filesFromEvent(event);
        if (!files.length) return;
        event.preventDefault();
        this.#attachFiles(files, area.dataset.keys === "composer" ? "composer" : "noteEdit");
      });
    }

    // Drag & drop targets.
    for (const zone of root.querySelectorAll("[data-drop]")) {
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("dxql-drop-hover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("dxql-drop-hover"));
      zone.addEventListener("drop", event => {
        zone.classList.remove("dxql-drop-hover");
        this.#onDrop(event, zone);
      });
    }

    if (this._focus) {
      const field = root.querySelector(`[data-bind="${this._focus.bind}"]`);
      if (field) {
        field.focus();
        try { field.setSelectionRange(this._focus.start, this._focus.end); } catch { /* checkbox */ }
      }
      this._focus = null;
    } else if (options.isFirstRender && this.editing) {
      root.querySelector("[data-bind='draft.title']")?.focus();
    } else if (this._focusNext) {
      root.querySelector(this._focusNext)?.focus();
    }
    this._focusNext = null;

    // Opened from a search: mark the words that were searched for.
    if (this.highlight && !this.editing) markTerms(root.querySelector(".dxql-sheet-scroll"), tokenize(this.highlight));
  }

  _onClose(options) {
    super._onClose(options);
    this.highlight = "";
  }

  #bind(field) {
    const value = field.type === "checkbox" ? field.checked : field.value;
    foundry.utils.setProperty(this, field.dataset.bind, value);
  }

  #onKeyDown(event, kind) {
    const enter = event.key === "Enter";
    if (kind === "newObjective" && enter) {
      event.preventDefault();
      QuestSheet.#onAddObjective.call(this);
    } else if (kind === "newItem" && enter) {
      event.preventDefault();
      QuestSheet.#onAddItem.call(this);
    } else if (kind === "newNpc" && enter) {
      event.preventDefault();
      QuestSheet.#onAddNpc.call(this);
    } else if (kind === "objectiveEdit") {
      if (enter) { event.preventDefault(); this.#saveObjective(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.editObjective = null; this.render(); }
    } else if (kind === "composer" && enter && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      QuestSheet.#onPostNote.call(this);
    } else if (kind === "noteEdit") {
      if (enter && (event.ctrlKey || event.metaKey)) { event.preventDefault(); QuestSheet.#onSaveNote.call(this); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.editNote = null; this.render(); }
    }
  }

  #onTagKey(event) {
    if (["Enter", ","].includes(event.key) && event.target.value.trim()) {
      event.preventDefault();
      this.#commitTag();
    } else if (event.key === "Backspace" && !event.target.value && this.draft.tags.length) {
      this.draft.tags.pop();
      this._focusNext = "[data-bind=tagInput]";
      this.render();
    }
  }

  #onPlaceKey(event) {
    if (event.key === "Enter" && event.target.value.trim()) {
      event.preventDefault();
      this.#commitPlaces();
    } else if (event.key === "Enter") {
      event.preventDefault();
    } else if (event.key === "Backspace" && !event.target.value && this.draft.locations.length) {
      this.draft.locations.pop();
      this._focusNext = "[data-bind=locationInput]";
      this.render();
    }
  }

  /** Turns the text in the places input into place tokens. keepLast: the text after the last comma stays typed. */
  #commitPlaces({ keepLast = false, silent = false } = {}) {
    const parts = this.locationInput.split(",");
    const rest = keepLast ? parts.pop() : "";
    for (const part of parts) {
      const name = cleanLine(part, 120);
      if (name && !this.draft.locations.some(l => l.name.toLowerCase() === name.toLowerCase())) {
        this.draft.locations.push({ id: null, name, hidden: false });
      }
    }
    this.locationInput = rest.trimStart();
    if (silent) return;
    this._focusNext = "[data-bind=locationInput]";
    this.render();
  }

  #commitTag() {
    this.#commitTagSilently();
    this._focusNext = "[data-bind=tagInput]";
    this.render();
  }

  /* -------------------------------------------- */
  /*  Drag & drop                                 */
  /* -------------------------------------------- */

  async #onDrop(event, zone) {
    const kind = zone.dataset.drop;
    const files = filesFromEvent(event);
    const url = urlFromDrop(event);
    const data = getDropData(event);
    event.preventDefault();
    event.stopPropagation();

    if (kind === "giver") {
      if (!["Actor", "Token"].includes(data?.type)) return;
      const doc = await fromUuid(data.uuid);
      const actor = doc?.actor ?? doc;
      if (!actor) return;
      const giver = { giver: doc.name ?? actor.name, giverImg: actor.img ?? "", giverUuid: actor.uuid };
      if (this.editing) {
        Object.assign(this.draft, giver);
        this.render();
      } else await store.updateQuest(this.questId, giver);
      return;
    }
    if (kind === "npcs") {
      if (!["Actor", "Token"].includes(data?.type)) return;
      const doc = await fromUuid(data.uuid).catch(() => null);
      const actor = doc?.actor ?? doc;
      if (!actor) return;
      const name = doc.name ?? actor.name;
      const face = knownFaces().find(f => f.actor === actor.uuid) ?? knownFaces().find(f => f.name.toLowerCase() === String(name).toLowerCase());
      await store.addNpc(this.questId, { name, faceId: face?.id ?? "", uuid: actor.uuid, img: actor.img ?? "" });
      return;
    }
    if (kind === "items") {
      if (!data?.uuid) return;
      const doc = await fromUuid(data.uuid).catch(() => null);
      const name = doc?.name ?? data.name;
      if (!name) return;
      const isItem = (doc?.documentName ?? data.type) === "Item";
      await store.addItem(this.questId, {
        name, uuid: data.uuid, img: isItem ? doc?.img ?? "" : "", hidden: this.newItemHidden
      });
      return;
    }
    if (kind === "gallery") {
      if (files.length) return this.#attachFiles(files, "gallery");
      const src = url ?? data?.src ?? data?.texture?.src;
      if (src) return store.addImages(this.questId, [src]);
      return;
    }
    if (kind === "composer" || kind === "noteEdit") {
      if (files.length) return this.#attachFiles(files, kind);
      if (url) return this.#pushImages(kind, [url]);
      if (data?.uuid) {
        const field = zone.querySelector("textarea");
        if (field) insertAtCursor(field, await linkForDrop(data));
      }
      return;
    }
    if (kind === "link" && data?.uuid) {
      insertAtCursor(zone, await linkForDrop(data));
    }
  }

  async #attachFiles(files, target) {
    const counter = target === "gallery" ? "galleryUploading" : null;
    if (counter) this[counter]++;
    else this.composer.uploading++;
    this.render();
    try {
      const paths = await uploadImages(files);
      if (target === "gallery") await store.addImages(this.questId, paths);
      else this.#pushImages(target, paths);
    } finally {
      if (counter) this[counter]--;
      else this.composer.uploading--;
      if (this.rendered) this.render();
    }
  }

  #pushImages(target, paths) {
    if (!paths.length) return;
    if (target === "composer") this.composer.images.push(...paths);
    else if (target === "noteEdit" && this.editNote) this.editNote.images.push(...paths);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: details                            */
  /* -------------------------------------------- */

  /* Hiding parts from players (GM) */

  static #onSetQuestType(event, target) {
    this.draft.questType = target.dataset.type ?? "";
    this.render();
  }

  static #onRemoveLocation(event, target) {
    this.draft.locations.splice(Number(target.dataset.index), 1);
    this._focusNext = "[data-bind=locationInput]";
    this.render();
  }

  static #onToggleDraftLocation(event, target) {
    const place = this.draft.locations[Number(target.dataset.index)];
    if (place) place.hidden = !place.hidden;
    this.render();
  }

  static #onToggleDraftField(event, target) {
    const field = target.dataset.field;
    const set = new Set(this.draft.hiddenFields);
    if (set.has(field)) set.delete(field);
    else set.add(field);
    this.draft.hiddenFields = [...set];
    this.render();
  }

  static async #onToggleField(event, target) {
    const field = target.dataset.field;
    const quest = this.quest;
    if (quest) await store.setFieldHidden(this.questId, field, !quest.hiddenFields.includes(field));
  }

  static async #onTogglePart(event, target) {
    event.stopPropagation();
    const { kind, partId } = target.dataset;
    const list = { stages: "stages", objectives: "objectives", notes: "notes", gallery: "gallery", locations: "locations", items: "items", npcs: "npcs" }[kind];
    const part = list && this.quest?.[list].find(p => p.id === partId);
    if (part) await store.setPartHidden(this.questId, kind, partId, !part.hidden);
  }

  static #onToggleComposerHidden() {
    this.composer.hidden = !this.composer.hidden;
    this._focusNext = "[data-bind='composer.text']";
    this.render();
  }

  static #onToggleNewObjectiveHidden() {
    this.newObjectiveHidden = !this.newObjectiveHidden;
    this._focusNext = "[data-bind=newObjective]";
    this.render();
  }

  static #onEdit() {
    this._scrollToTop = true;
    this.draft = QuestSheet.#makeDraft(this.quest);
    this.tagInput = "";
    this.locationInput = "";
    this.editing = true;
    this._focusNext = "[data-bind='draft.title']";
    this.render();
  }

  static #onCancelEdit() {
    if (!this.questId) return this.close();
    this._scrollToTop = true;
    this.editing = false;
    this.draft = null;
    this.render();
  }

  /** Saves the edit form. Runs only from the form's submit event, and only once at a time. */
  static async #onSaveQuest() {
    if (this._saving) return;
    this.#commitTagSilently();
    this.#commitPlaces({ silent: true });
    const draft = this.draft;
    if (!draft.title.trim()) {
      ui.notifications.warn(t("TitleRequired"));
      this.element.querySelector("[data-bind='draft.title']")?.focus();
      return;
    }
    this._saving = true;
    try {
      await this.#save(draft);
    } finally {
      this._saving = false;
    }
  }

  async #save(draft) {
    if (!this.questId) {
      const objectives = draft.objectivesText.split(/\r?\n/).map(s => s.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
      const id = await store.createQuest({ ...draft, objectives, images: draft.images }, { hidden: draft.hidden });
      if (!id) return;
      for (const note of draft.notes) await store.addNote(id, note);
      const { left, top, width, height } = this.position;
      await this.close({ animate: false });
      QuestSheet.open(id, { position: { left, top, width, height } });
      return;
    }
    await store.updateQuest(this.questId, draft);
    if (game.user.isGM && draft.hidden !== this.quest?.hidden) await store.setHidden(this.questId, draft.hidden);
    this._scrollToTop = true;
    this.editing = false;
    this.draft = null;
    this.render();
  }

  #commitTagSilently() {
    const tag = cleanTag(this.tagInput);
    this.tagInput = "";
    if (tag && !this.draft.tags.some(x => x.toLowerCase() === tag.toLowerCase())) this.draft.tags.push(tag);
  }

  static #onRemoveTag(event, target) {
    this.draft.tags = this.draft.tags.filter(x => x !== target.dataset.tag);
    this.render();
  }

  static #onRemoveDraftImage(event, target) {
    this.draft.images.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static #onUseScene(event, target) {
    const scene = currentSceneName();
    if (target.dataset.field === "location") {
      if (scene && !this.draft.locations.some(l => l.name.toLowerCase() === scene.toLowerCase())) {
        this.draft.locations.push({ id: null, name: scene, hidden: false });
      }
    } else this.draft[target.dataset.field] = scene;
    this.render();
  }

  static #onUnlinkGiver() {
    Object.assign(this.draft, { giverImg: "", giverUuid: "" });
    this.render();
  }

  static async #onSetStatus(event, target) {
    await store.setStatus(this.questId, target.dataset.status);
  }

  static async #onToggleHidden() {
    const quest = this.quest;
    if (quest) await store.setHidden(this.questId, !quest.hidden);
  }

  static async #onDeleteQuest() {
    if (await QuestSheet.confirmDelete(this.questId)) this.close();
  }

  static async #onOpenGiver() {
    const doc = await fromUuid(this.quest?.giverUuid ?? "").catch(() => null);
    if (doc?.testUserPermission(game.user, "LIMITED")) doc.sheet.render({ force: true });
    else ui.notifications.info(t("NoAccess"));
  }

  static #onOpenFacesEntry(event, target) {
    openFacesEntry(target.dataset.facesKind, target.dataset.facesId);
  }

  /* -------------------------------------------- */
  /*  Actions: objectives                         */
  /* -------------------------------------------- */

  static async #onAddObjective() {
    const text = this.newObjective.trim();
    if (!text) return;
    this.newObjective = "";
    this._focusNext = "[data-bind=newObjective]";
    await store.addObjective(this.questId, text, { hidden: this.newObjectiveHidden, stage: this.newObjectiveStage || null });
  }

  /* Stages */

  /** A small form for a stage's title and text; returns {title, text, hidden} or null. */
  async #stageDialog(stage = null) {
    const isNew = !stage;
    const result = await DialogV2.wait({
      window: { title: t(isNew ? "AddStage" : "EditStage"), icon: "fa-solid fa-signs-post" },
      position: { width: 440 },
      content: `<div class="dxql dxql-stage-form">
        <div class="dxql-field wide"><label>${escapeHTML(t("Field.StageTitle"))}</label>
          <input type="text" name="title" maxlength="120" value="${escapeHTML(stage?.title ?? "")}" placeholder="${escapeHTML(t("Placeholder.StageTitle"))}" autofocus></div>
        <div class="dxql-field wide"><label>${escapeHTML(t("Field.StageText"))}</label>
          <textarea name="text" rows="4" placeholder="${escapeHTML(t("Placeholder.StageText"))}">${escapeHTML(stage?.text ?? "")}</textarea></div>
        ${isNew && game.user.isGM ? `<label class="dxql-checkbox"><input type="checkbox" name="hidden" checked>
          <i class="fa-solid fa-eye-slash" inert></i> ${escapeHTML(t("HiddenFromPlayers"))}</label>` : ""}
      </div>`,
      rejectClose: false,
      // "@" + a name offers Familiar Faces & Places NPCs.
      render: (event, dialog) => {
        for (const field of dialog.element.querySelectorAll("input[name=title], textarea[name=text]")) attachNpcPicker(field);
      },
      buttons: [
        { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
        {
          action: "save", label: t(isNew ? "AddStage" : "SaveChanges"), icon: "fa-solid fa-check", default: true,
          callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
        }
      ]
    });
    if (!result || result === "cancel" || !String(result.title ?? "").trim()) return null;
    return result;
  }

  static async #onAddStage() {
    const data = await this.#stageDialog();
    if (!data) return;
    const sid = await store.addStage(this.questId, { title: data.title, text: data.text, hidden: !!data.hidden });
    if (sid) this.newObjectiveStage = sid;
  }

  static async #onEditStage(event, target) {
    const sid = target.closest("[data-stage-id]").dataset.stageId;
    const stage = this.quest?.stages.find(s => s.id === sid);
    if (!stage) return;
    const data = await this.#stageDialog(stage);
    if (data) await store.updateStage(this.questId, sid, { title: data.title, text: data.text });
  }

  static async #onDeleteStage(event, target) {
    const sid = target.closest("[data-stage-id]").dataset.stageId;
    const stage = this.quest?.stages.find(s => s.id === sid);
    if (!stage) return;
    const ok = await DialogV2.confirm({
      window: { title: t("DeleteStage"), icon: "fa-solid fa-trash" },
      content: `<p>${t("DeleteStageConfirm", { title: escapeHTML(stage.title) })}</p>`,
      rejectClose: false
    });
    if (ok) await store.deleteStage(this.questId, sid);
  }

  static #onEditObjective(event, target) {
    this.#startObjectiveEdit(target.closest("[data-objective-id]").dataset.objectiveId);
  }

  #startObjectiveEdit(oid) {
    const objective = this.quest?.objectives.find(o => o.id === oid);
    if (!objective) return;
    this.editObjective = { id: oid, text: objective.text };
    this._focusNext = ".dxql-objective-edit";
    this.render();
  }

  static #onSaveObjective() {
    this.#saveObjective();
  }

  async #saveObjective() {
    const edit = this.editObjective;
    if (!edit) return;
    this.editObjective = null;
    if (edit.text.trim()) await store.updateObjective(this.questId, edit.id, { text: edit.text });
    else this.render();
  }

  static async #onDeleteObjective(event, target) {
    await store.deleteObjective(this.questId, target.closest("[data-objective-id]").dataset.objectiveId);
  }

  static async #onMoveObjective(event, target) {
    await store.moveObjective(this.questId, target.closest("[data-objective-id]").dataset.objectiveId, Number(target.dataset.dir));
  }

  /* -------------------------------------------- */
  /*  Actions: items needed                       */
  /* -------------------------------------------- */

  static async #onAddItem() {
    const name = this.newItem.trim();
    if (!name) return;
    this.newItem = "";
    this._focusNext = "[data-bind=newItem]";
    await store.addItem(this.questId, { name, hidden: this.newItemHidden });
  }

  static async #onDeleteItem(event, target) {
    await store.deleteItem(this.questId, target.closest("[data-item-id]").dataset.itemId);
  }

  static async #onOpenItem(event, target) {
    const item = this.quest?.items.find(i => i.id === target.closest("[data-item-id]")?.dataset.itemId);
    const doc = await fromUuid(item?.uuid ?? "").catch(() => null);
    if (doc?.testUserPermission(game.user, "LIMITED")) doc.sheet.render({ force: true });
    else ui.notifications.info(t("NoAccess"));
  }

  static #onToggleNewItemHidden() {
    this.newItemHidden = !this.newItemHidden;
    this._focusNext = "[data-bind=newItem]";
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: related NPCs                       */
  /* -------------------------------------------- */

  static async #onAddNpc() {
    const name = this.newNpc.trim();
    if (!name) return;
    this.newNpc = "";
    this._focusNext = "[data-bind=newNpc]";
    const face = knownFaces().find(f => f.name.toLowerCase() === name.toLowerCase());
    const added = await store.addNpc(this.questId, { name: face?.name ?? name, faceId: face?.id ?? "", uuid: face?.actor ?? "", img: face?.img ?? "" });
    if (!added) this.render();
  }

  static async #onDeleteNpc(event, target) {
    await store.deleteNpc(this.questId, target.closest("[data-npc-id]").dataset.npcId);
  }

  /** Opens a related NPC: its Familiar Faces & Places page, or else its actor. */
  static async #onOpenNpc(event, target) {
    const { facesKind, facesId } = target.dataset;
    if (facesId) return openFacesEntry(facesKind, facesId);
    const npc = this.quest?.npcs.find(n => n.id === target.closest("[data-npc-id]")?.dataset.npcId);
    const doc = await fromUuid(npc?.uuid ?? "").catch(() => null);
    if (doc?.testUserPermission(game.user, "LIMITED")) doc.sheet.render({ force: true });
    else ui.notifications.info(t("NoAccess"));
  }

  /* -------------------------------------------- */
  /*  Actions: images                             */
  /* -------------------------------------------- */

  static async #onAddGalleryImage() {
    const files = await pickFiles();
    if (files.length) this.#attachFiles(files, "gallery");
  }

  static async #onBrowseGalleryImage() {
    const path = await browseImage();
    if (path) await store.addImages(this.questId, [path]);
  }

  static async #onRemoveImage(event, target) {
    await store.removeImage(this.questId, target.closest("[data-image-id]").dataset.imageId);
  }

  static #onViewImage(event, target) {
    showImage(target.dataset.src, this.title);
  }

  /* -------------------------------------------- */
  /*  Actions: notes & clues                      */
  /* -------------------------------------------- */

  static #onSetNoteFilter(event, target) {
    this.noteFilter = target.dataset.filter;
    this.render();
  }

  static #onSetComposerType(event, target) {
    this.composer.type = target.dataset.type;
    this._focusNext = "[data-bind='composer.text']";
    this.render();
  }

  static async #onAttachComposerImage() {
    const files = await pickFiles();
    if (files.length) this.#attachFiles(files, "composer");
  }

  static async #onBrowseComposerImage() {
    const path = await browseImage();
    if (path) this.#pushImages("composer", [path]);
  }

  static #onRemoveComposerImage(event, target) {
    this.composer.images.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onPostNote() {
    const { text, type, images, uploading, hidden } = this.composer;
    if (uploading) return;
    if (!text.trim() && !images.length) {
      this.element.querySelector("[data-bind='composer.text']")?.focus();
      return;
    }
    // The type and the GM's "hidden" choice stay for the next entry.
    this.composer = { text: "", type, images: [], uploading: 0, hidden };
    if (this.noteFilter !== "all" && this.noteFilter !== type) this.noteFilter = "all";
    this._focusNext = "[data-bind='composer.text']";
    await store.addNote(this.questId, { type, text, images, hidden });
  }

  static async #onToggleNoteType(event, target) {
    const nid = target.closest("[data-note-id]").dataset.noteId;
    const note = this.quest?.notes.find(n => n.id === nid);
    if (note) await store.updateNote(this.questId, nid, { type: note.type === "clue" ? "note" : "clue" });
  }

  static #onEditNote(event, target) {
    const nid = target.closest("[data-note-id]").dataset.noteId;
    const note = this.quest?.notes.find(n => n.id === nid);
    if (!note) return;
    this.editNote = { id: nid, text: note.text, images: [...note.images] };
    this._focusNext = "[data-bind='editNote.text']";
    this.render();
  }

  static async #onSaveNote() {
    const edit = this.editNote;
    if (!edit) return;
    this.editNote = null;
    await store.updateNote(this.questId, edit.id, { text: edit.text, images: edit.images });
  }

  static #onCancelNote() {
    this.editNote = null;
    this.render();
  }

  static async #onDeleteNote(event, target) {
    const nid = target.closest("[data-note-id]").dataset.noteId;
    const ok = await DialogV2.confirm({
      window: { title: t("DeleteNote"), icon: "fa-solid fa-trash" },
      content: `<p>${t("DeleteNoteConfirm")}</p>`,
      rejectClose: false
    });
    if (ok) await store.deleteNote(this.questId, nid);
  }

  static async #onAttachEditImage() {
    const files = await pickFiles();
    if (files.length) this.#attachFiles(files, "noteEdit");
  }

  static #onRemoveEditImage(event, target) {
    this.editNote?.images.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onOpenSource(event, target) {
    await openSource(target.dataset.uuid);
  }

  static #onOpenRelated(event, target) {
    QuestSheet.open(target.dataset.questId);
  }

  static #onOpenReward(event, target) {
    RewardSheet.open(target.dataset.rewardId);
  }

  /** A new reward form filled in from this quest (its first reward item, giver and places). */
  static #onAddReward() {
    const quest = this.quest;
    if (!quest) return;
    const items = splitRewardText(quest.reward);
    const taken = new Set(store.rewardsForQuest(quest.id).map(r => r.name.toLowerCase()));
    const item = items.find(i => !taken.has(i.toLowerCase())) ?? "";
    RewardSheet.createNew(RewardSheet.prefillFromQuest(quest, item));
  }

  static #onOpenPartyNote(event, target) {
    PartyNoteSheet.open(target.dataset.noteId);
  }

  /** A new party note about this quest. */
  static #onAddPartyNote() {
    const quest = this.quest;
    if (quest) PartyNoteSheet.createNew(PartyNoteSheet.prefillFromQuest(quest));
  }
}

/** Opens the chat message, journal page or document a note was taken from. */
export async function openSource(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if (!doc) return ui.notifications.warn(t("SourceGone"));
  if (!doc.testUserPermission(game.user, "LIMITED") && !(doc instanceof ChatMessage)) return ui.notifications.info(t("NoAccess"));
  if (doc instanceof ChatMessage) {
    if (!doc.visible) return ui.notifications.info(t("NoAccess"));
    const Popout = foundry.applications.sidebar.apps.ChatPopout;
    if (Popout) return new Popout({ message: doc }).render({ force: true });
    const li = ui.chat.element?.querySelector(`[data-message-id="${doc.id}"]`);
    ui.chat.activate();
    return li?.scrollIntoView({ block: "center" });
  }
  if (doc instanceof JournalEntryPage) return doc.parent.sheet.render({ force: true, pageId: doc.id, anchor: undefined });
  return doc.sheet?.render({ force: true });
}

// Keep a reference for macros/devs.
QuestSheet.MODULE_ID = MODULE_ID;
