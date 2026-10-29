import {
  MODULE_ID, TEMPLATE_PATH, LINK_TYPES, LINK_ICONS, STATUS_ICONS, t, cleanLine, cleanTag, tagHue, enrich, formatDate, userInfo,
  locationSuggestions, getDropData, linkForDrop, insertAtCursor, randomId, escapeHTML
} from "../util.js";
import * as store from "../store.js";
import { tokenize, markTerms } from "../search.js";
import { uploadImages, pickFiles, browseImage, canBrowse, filesFromEvent, urlFromDrop, showImage } from "../images.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const WIDTH = 580;
const HEIGHT = 700;

/** The link type a dropped document gets. */
const DROP_TYPES = { Actor: "npc", Token: "npc", Scene: "place", JournalEntry: "other", JournalEntryPage: "other", Item: "other" };

/** The icon of a party note (list, sheet, links). */
export const PARTY_NOTE_ICON = "fa-solid fa-note-sticky";

/**
 * One party note's window: its text, images, tags, links and the quest it is about. Also used to create a new note.
 * Notes are the party's own: everyone can add and edit them; deleting follows the same rule as quests.
 */
export class PartyNoteSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dxql", "dxql-sheet", "dxql-party-note-sheet"],
    window: { icon: PARTY_NOTE_ICON, resizable: true },
    position: { width: WIDTH, height: HEIGHT },
    actions: {
      edit: PartyNoteSheet.#onEdit,
      cancelEdit: PartyNoteSheet.#onCancelEdit,
      removeTag: PartyNoteSheet.#onRemoveTag,
      addLink: PartyNoteSheet.#onAddLink,
      removeLink: PartyNoteSheet.#onRemoveLink,
      cycleLinkType: PartyNoteSheet.#onCycleLinkType,
      attachImage: PartyNoteSheet.#onAttachImage,
      browseImage: PartyNoteSheet.#onBrowseImage,
      removeDraftImage: PartyNoteSheet.#onRemoveDraftImage,
      addGalleryImage: PartyNoteSheet.#onAddGalleryImage,
      browseGalleryImage: PartyNoteSheet.#onBrowseGalleryImage,
      removeImage: PartyNoteSheet.#onRemoveImage,
      viewImage: PartyNoteSheet.#onViewImage,
      togglePinned: PartyNoteSheet.#onTogglePinned,
      share: PartyNoteSheet.#onShare,
      toggleHidden: PartyNoteSheet.#onToggleHidden,
      deleteNote: PartyNoteSheet.#onDeleteNote,
      openLink: PartyNoteSheet.#onOpenLink,
      openQuest: PartyNoteSheet.#onOpenQuest
    }
  };

  static PARTS = {
    body: { template: `${TEMPLATE_PATH}/party-note-sheet.hbs`, scrollable: [""] }
  };

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  static appId(noteId) {
    return `dxql-party-note-${noteId}`;
  }

  static open(noteId, { highlight = "", position } = {}) {
    const existing = foundry.applications.instances.get(PartyNoteSheet.appId(noteId));
    if (existing) {
      existing.highlight = highlight;
      existing.render({ force: true });
      existing.bringToFront();
      return existing;
    }
    const options = { id: PartyNoteSheet.appId(noteId), noteId, highlight };
    if (position) options.position = position;
    const app = new PartyNoteSheet(options);
    app.render({ force: true });
    return app;
  }

  /**
   * Opens an empty (or prefilled) note form; nothing is saved until Add.
   * prefill: title, text, tags, questId, links ([{type, name, uuid}]), images (sources), pinned, hidden.
   */
  static createNew(prefill = {}) {
    const app = new PartyNoteSheet({ id: `dxql-party-note-new-${randomId()}`, draft: prefill });
    app.render({ force: true });
    return app;
  }

  static refreshAll() {
    for (const app of foundry.applications.instances.values()) {
      if (!(app instanceof PartyNoteSheet) || !app.rendered) continue;
      if (app.noteId && !store.getPartyNote(app.noteId)) {
        // A reveal or an import briefly removes a note before writing it back; only close if it stays gone.
        setTimeout(() => {
          if (app.rendered && !store.getPartyNote(app.noteId)) app.close();
        }, 1500);
        continue;
      }
      app.render();
    }
  }

  static async confirmDelete(noteId) {
    const note = store.getPartyNote(noteId);
    if (!note) return false;
    const ok = await DialogV2.confirm({
      window: { title: t("PartyNote.Delete"), icon: "fa-solid fa-trash" },
      content: `<p>${t("PartyNote.DeleteConfirm", { title: escapeHTML(note.title) })}</p>`,
      rejectClose: false
    });
    if (!ok) return false;
    await store.deletePartyNote(noteId);
    return true;
  }

  /** The note form, filled in from a quest: the note is about that quest (and hidden with it, for the GM). */
  static prefillFromQuest(quest) {
    return { questId: quest.id, hidden: !!(game.user.isGM && quest.hidden) };
  }

  /**
   * Posts a note to the chat for everyone: its title, text, images and a link that opens it. A hidden note can't be
   * shared until the GM reveals it.
   */
  static async share(noteId) {
    const note = store.getPartyNote(noteId);
    if (!note) return;
    if (note.hidden) return ui.notifications.warn(t("PartyNote.ShareHidden"));
    const text = escapeHTML(note.text.trim()).replace(/\r?\n/g, "<br>");
    const images = note.gallery.map(g => `<img src="${escapeHTML(g.src)}" alt="">`).join("");
    const link = `@PartyNote[${note.id}]{${note.title.replace(/[{}[\]]/g, "")}}`;
    const content = `<div class="dxql-chat-note">
      <h3><i class="${PARTY_NOTE_ICON}" inert></i> ${escapeHTML(note.title)}</h3>
      ${text ? `<p>${text}</p>` : ""}
      ${images ? `<div class="dxql-chat-images">${images}</div>` : ""}
      <p class="dxql-chat-open">${link}</p>
    </div>`;
    await ChatMessage.implementation.create({ content, speaker: ChatMessage.implementation.getSpeaker({ user: game.user }) });
  }

  static copyLink(note) {
    const link = `@PartyNote[${note.id}]{${note.title.replace(/[{}[\]]/g, "")}}`;
    navigator.clipboard?.writeText(link)
      .then(() => ui.notifications.info(t("PartyNote.LinkCopied", { link: escapeHTML(link) })))
      .catch(() => ui.notifications.warn(link));
  }

  /** Right-click menu entries for a note (the Notes list). getId(li) gives the note id of the entry. */
  static contextOptions(getId) {
    const note = li => store.getPartyNote(getId(li));
    return [
      {
        name: "DXQL.Open", icon: '<i class="fa-solid fa-book-open"></i>',
        callback: li => PartyNoteSheet.open(getId(li))
      },
      {
        name: "DXQL.PartyNote.Pin", icon: '<i class="fa-solid fa-thumbtack"></i>',
        condition: li => note(li) && !note(li).pinned,
        callback: li => store.setPartyNotePinned(getId(li), true)
      },
      {
        name: "DXQL.PartyNote.Unpin", icon: '<i class="fa-solid fa-thumbtack-slash"></i>',
        condition: li => !!note(li)?.pinned,
        callback: li => store.setPartyNotePinned(getId(li), false)
      },
      {
        name: "DXQL.PartyNote.Share", icon: '<i class="fa-solid fa-comment"></i>',
        condition: li => note(li) && !note(li).hidden,
        callback: li => PartyNoteSheet.share(getId(li))
      },
      {
        name: "DXQL.PartyNote.OpenQuest", icon: '<i class="fa-solid fa-scroll"></i>',
        condition: li => !!note(li)?.questId && !!store.getQuest(note(li).questId),
        callback: li => game.modules.get(MODULE_ID)?.api?.openQuest(note(li)?.questId)
      },
      {
        name: "DXQL.PartyNote.CopyLink", icon: '<i class="fa-solid fa-link"></i>',
        condition: li => !!note(li),
        callback: li => { const n = note(li); if (n) PartyNoteSheet.copyLink(n); }
      },
      {
        name: "DXQL.HideFromPlayers", icon: '<i class="fa-solid fa-eye-slash"></i>',
        condition: li => game.user.isGM && note(li) && !note(li).hidden,
        callback: li => store.setPartyNoteHidden(getId(li), true)
      },
      {
        name: "DXQL.RevealToPlayers", icon: '<i class="fa-solid fa-eye"></i>',
        condition: li => game.user.isGM && note(li)?.hidden,
        callback: li => store.setPartyNoteHidden(getId(li), false)
      },
      {
        name: "DXQL.PartyNote.Delete", icon: '<i class="fa-solid fa-trash"></i>',
        condition: li => { const n = note(li); return n && store.canDelete(n.createdBy); },
        callback: li => PartyNoteSheet.confirmDelete(getId(li))
      }
    ];
  }

  /* -------------------------------------------- */

  constructor(options = {}) {
    super(options);
    this.noteId = options.noteId ?? null;
    this.highlight = options.highlight ?? "";
    this.editing = !this.noteId;
    this.draft = this.noteId ? null : PartyNoteSheet.#makeDraft(options.draft ?? {});
    this.tagInput = "";
    this.linkInput = "";
    this.linkType = "place";
    this.uploading = 0;
    this.galleryUploading = 0;
    this._focus = null;
  }

  static #makeDraft(source = {}) {
    const images = (source.gallery ?? source.images ?? [])
      .map(img => (typeof img === "string" ? { id: null, src: img } : { id: img.id ?? null, src: img.src }))
      .filter(img => img.src);
    return {
      title: source.title ?? "",
      text: source.text ?? "",
      tags: [...(source.tags ?? [])],
      questId: source.questId ?? "",
      links: (source.links ?? []).map(l => ({
        id: l.id ?? null, type: LINK_TYPES.includes(l.type) ? l.type : "other", name: cleanLine(l.name, 120), uuid: l.uuid ?? ""
      })).filter(l => l.name),
      images,
      // The images the form started with: only these can be removed by saving it.
      imagesStart: images.map(img => img.id).filter(Boolean),
      pinned: !!source.pinned,
      hidden: !!source.hidden
    };
  }

  get note() {
    return this.noteId ? store.getPartyNote(this.noteId) : null;
  }

  get title() {
    if (!this.noteId) return t("PartyNote.New");
    return this.note?.title ?? t("PartyNote.Tab");
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const note = this.note;
    Object.assign(context, {
      appId: this.id,
      isGM: game.user.isGM,
      isNew: !this.noteId,
      editing: this.editing,
      missing: !!this.noteId && !note,
      canBrowse: canBrowse(),
      uploading: this.uploading > 0
    });
    if (context.missing) return context;
    const ready = store.storesReady();
    const quests = ready ? store.allQuests() : [];
    const notes = ready ? store.allPartyNotes() : [];

    if (this.editing) {
      if (!this.draft) this.draft = PartyNoteSheet.#makeDraft(note);
      const draft = this.draft;
      const suggestions = new Set(locationSuggestions(quests));
      for (const q of quests) if (q.giver) suggestions.add(q.giver);
      for (const n of notes) for (const l of n.links) suggestions.add(l.name);
      const tagSet = new Map();
      for (const item of [...quests, ...notes]) for (const tag of item.tags) tagSet.set(tag.toLowerCase(), tag);
      const questOptions = [{ id: "", label: t("PartyNote.NoQuest"), selected: !draft.questId },
        ...quests.slice().sort((a, b) => a.title.localeCompare(b.title))
          .map(q => ({ id: q.id, label: `${q.title}${q.hidden ? " 👁" : ""}`, selected: q.id === draft.questId }))];
      Object.assign(context, {
        draft: {
          ...draft,
          tagList: draft.tags.map(name => ({ name, hue: tagHue(name) })),
          linkList: draft.links.map(l => ({ ...l, icon: LINK_ICONS[l.type], label: t(`Reward.LinkType.${l.type}`) }))
        },
        questOptions,
        tagInput: this.tagInput,
        tagSuggestions: [...tagSet.values()].filter(x => !draft.tags.some(d => d.toLowerCase() === x.toLowerCase()))
          .sort((a, b) => a.localeCompare(b)),
        linkInput: this.linkInput,
        linkTypes: LINK_TYPES.map(id => ({ id, label: t(`Reward.LinkType.${id}`), selected: id === this.linkType })),
        linkSuggestions: [...suggestions].filter(n => !draft.links.some(l => l.name.toLowerCase() === n.toLowerCase()))
          .sort((a, b) => a.localeCompare(b))
      });
      return context;
    }

    const quest = note.questId ? store.getQuest(note.questId) : null;
    const linkGroups = LINK_TYPES.map(type => ({
      type,
      label: t(`Reward.LinkTypes.${type}`),
      icon: LINK_ICONS[type],
      links: note.links.filter(l => l.type === type)
    })).filter(g => g.links.length);
    const author = userInfo(note.createdBy, note.authorName);
    const editor = note.editedBy || note.editedByName ? userInfo(note.editedBy, note.editedByName) : null;
    Object.assign(context, {
      note: { ...note, tagList: note.tags.map(name => ({ name, hue: tagHue(name) })) },
      quest: quest ? { id: quest.id, title: quest.title, hidden: quest.hidden, status: quest.status, statusIcon: STATUS_ICONS[quest.status] } : null,
      linkGroups,
      textHTML: await enrich(note.text),
      gallery: note.gallery.map(g => ({ ...g, canDelete: store.canDelete(g.createdBy) })),
      galleryUploading: this.galleryUploading > 0,
      canDeleteNote: store.canDelete(note.createdBy),
      createdBy: author.name,
      createdAt: new Date(note.createdAt || Date.now()).toLocaleDateString(),
      editedLine: editor && note.editedAt ? t("PartyNote.EditedBy", { name: editor.name, date: formatDate(note.editedAt) }) : ""
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
    if (this._scrollToTop) {
      this._scrollToTop = false;
      const scroller = root.querySelector(".dxql-sheet-scroll");
      if (scroller) scroller.scrollTop = 0;
    }

    // Two-way binding of inputs to this sheet's state (survives re-renders caused by other people's edits).
    for (const field of root.querySelectorAll("[data-bind]")) {
      const evt = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input";
      field.addEventListener(evt, () => this.#bind(field));
    }
    root.querySelector("[data-bind=tagInput]")?.addEventListener("keydown", event => {
      if (["Enter", ","].includes(event.key) && event.target.value.trim()) {
        event.preventDefault();
        this.#commitTag();
        this._focusNext = "[data-bind=tagInput]";
        this.render();
      } else if (event.key === "Enter") {
        event.preventDefault();
      } else if (event.key === "Backspace" && !event.target.value && this.draft.tags.length) {
        this.draft.tags.pop();
        this._focusNext = "[data-bind=tagInput]";
        this.render();
      }
    });
    root.querySelector("[data-bind=linkInput]")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.target.value.trim()) this.#commitLink();
      } else if (event.key === "Backspace" && !event.target.value && this.draft.links.length) {
        this.draft.links.pop();
        this._focusNext = "[data-bind=linkInput]";
        this.render();
      }
    });
    // Paste images straight into the text.
    root.querySelector("[data-bind='draft.text']")?.addEventListener("paste", event => {
      const files = filesFromEvent(event);
      if (!files.length) return;
      event.preventDefault();
      this.#upload(files);
    });
    root.querySelector("form.dxql-edit")?.addEventListener("submit", event => {
      event.preventDefault();
      this.#onSave();
    });

    for (const zone of root.querySelectorAll("[data-drop]")) {
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("dxql-drop-hover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("dxql-drop-hover"));
      zone.addEventListener("drop", event => {
        zone.classList.remove("dxql-drop-hover");
        this.#onDrop(event, zone).catch(err => console.error(`${MODULE_ID} | note drop`, err));
      });
    }

    if (this._focus) {
      const field = root.querySelector(`[data-bind="${this._focus.bind}"]`);
      if (field) {
        field.focus();
        try { field.setSelectionRange(this._focus.start, this._focus.end); } catch { /* select */ }
      }
      this._focus = null;
    } else if (options.isFirstRender && this.editing) {
      root.querySelector("[data-bind='draft.title']")?.focus();
    } else if (this._focusNext) {
      root.querySelector(this._focusNext)?.focus();
    }
    this._focusNext = null;

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

  #commitTag() {
    const tag = cleanTag(this.tagInput);
    this.tagInput = "";
    if (tag && !this.draft.tags.some(x => x.toLowerCase() === tag.toLowerCase())) this.draft.tags.push(tag);
  }

  #commitLink({ silent = false } = {}) {
    const name = cleanLine(this.linkInput, 120);
    this.linkInput = "";
    if (name && !this.draft.links.some(l => l.name.toLowerCase() === name.toLowerCase() && l.type === this.linkType)) {
      this.draft.links.push({ id: null, type: this.linkType, name, uuid: "" });
    }
    if (silent) return;
    this._focusNext = "[data-bind=linkInput]";
    this.render();
  }

  /* -------------------------------------------- */
  /*  Drag & drop, images                         */
  /* -------------------------------------------- */

  async #onDrop(event, zone) {
    const kind = zone.dataset.drop;
    const files = filesFromEvent(event);
    const url = urlFromDrop(event);
    const data = getDropData(event);
    event.preventDefault();
    event.stopPropagation();

    if (kind === "gallery") {
      // View mode: images go straight onto the note.
      if (files.length) return this.#uploadToGallery(files);
      const src = url ?? data?.src ?? data?.texture?.src;
      if (src) return store.addPartyNoteImages(this.noteId, [src]);
      return;
    }
    if (!this.editing) return;
    if (kind === "images") {
      if (files.length) return this.#upload(files);
      const src = url ?? data?.src ?? data?.texture?.src;
      if (src) {
        this.draft.images.push({ id: null, src });
        return this.render();
      }
      return;
    }
    if (kind === "links") {
      if (!data?.uuid) return;
      const doc = await fromUuid(data.uuid).catch(() => null);
      const name = cleanLine(doc?.name ?? data.name, 120);
      if (!name) return;
      const uuid = doc?.actor && data.type === "Token" ? doc.actor.uuid : data.uuid;
      if (!this.draft.links.some(l => l.uuid === uuid)) {
        this.draft.links.push({ id: null, type: DROP_TYPES[data.type] ?? "other", name, uuid });
      }
      return this.render();
    }
    if (kind === "text") {
      if (files.length) return this.#upload(files);
      if (url) {
        this.draft.images.push({ id: null, src: url });
        return this.render();
      }
      if (data?.uuid) insertAtCursor(zone, await linkForDrop(data));
    }
  }

  /** Edit form: uploads images into the draft. */
  async #upload(files) {
    this.uploading++;
    this.render();
    try {
      const paths = await uploadImages(files);
      if (this.draft) this.draft.images.push(...paths.map(src => ({ id: null, src })));
    } finally {
      this.uploading--;
      if (this.rendered) this.render();
    }
  }

  /** View mode: uploads images straight onto the note. */
  async #uploadToGallery(files) {
    this.galleryUploading++;
    this.render();
    try {
      const paths = await uploadImages(files);
      await store.addPartyNoteImages(this.noteId, paths);
    } finally {
      this.galleryUploading--;
      if (this.rendered) this.render();
    }
  }

  /* -------------------------------------------- */
  /*  Actions: edit form                          */
  /* -------------------------------------------- */

  static #onEdit() {
    this._scrollToTop = true;
    this.draft = PartyNoteSheet.#makeDraft(this.note);
    this.tagInput = "";
    this.linkInput = "";
    this.editing = true;
    this._focusNext = "[data-bind='draft.title']";
    this.render();
  }

  static #onCancelEdit() {
    if (!this.noteId) return this.close();
    this._scrollToTop = true;
    this.editing = false;
    this.draft = null;
    this.render();
  }

  static #onRemoveTag(event, target) {
    this.draft.tags = this.draft.tags.filter(x => x !== target.dataset.tag);
    this._focusNext = "[data-bind=tagInput]";
    this.render();
  }

  static #onAddLink() {
    if (this.linkInput.trim()) this.#commitLink();
  }

  static #onRemoveLink(event, target) {
    this.draft.links.splice(Number(target.dataset.index), 1);
    this._focusNext = "[data-bind=linkInput]";
    this.render();
  }

  static #onCycleLinkType(event, target) {
    const link = this.draft.links[Number(target.dataset.index)];
    if (!link) return;
    link.type = LINK_TYPES[(LINK_TYPES.indexOf(link.type) + 1) % LINK_TYPES.length];
    this.render();
  }

  static async #onAttachImage() {
    const files = await pickFiles();
    if (files.length) this.#upload(files);
  }

  static async #onBrowseImage() {
    const path = await browseImage();
    if (path && this.draft) {
      this.draft.images.push({ id: null, src: path });
      this.render();
    }
  }

  static #onRemoveDraftImage(event, target) {
    this.draft.images.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static #onViewImage(event, target) {
    showImage(target.dataset.src, this.title);
  }

  /** Saves the edit form. Runs only from the form's submit event, and only once at a time. */
  async #onSave() {
    if (this._saving || this.uploading) return;
    this.#commitTag();
    this.#commitLink({ silent: true });
    const draft = this.draft;
    if (!draft.title.trim()) {
      ui.notifications.warn(t("PartyNote.TitleRequired"));
      this.element.querySelector("[data-bind='draft.title']")?.focus();
      return;
    }
    const data = {
      title: draft.title,
      text: draft.text,
      tags: draft.tags,
      questId: draft.questId,
      links: draft.links
    };
    this._saving = true;
    try {
      if (!this.noteId) {
        const id = await store.createPartyNote({ ...data, pinned: draft.pinned, images: draft.images.map(i => i.src) }, { hidden: draft.hidden });
        if (!id) return;
        const { left, top, width, height } = this.position;
        await this.close({ animate: false });
        PartyNoteSheet.open(id, { position: { left, top, width, height } });
        return;
      }
      await store.updatePartyNote(this.noteId, { ...data, images: draft.images, imagesStart: draft.imagesStart });
      if (game.user.isGM && draft.hidden !== this.note?.hidden) await store.setPartyNoteHidden(this.noteId, draft.hidden);
      this._scrollToTop = true;
      this.editing = false;
      this.draft = null;
      this.render();
    } finally {
      this._saving = false;
    }
  }

  /* -------------------------------------------- */
  /*  Actions: view                               */
  /* -------------------------------------------- */

  static async #onAddGalleryImage() {
    const files = await pickFiles();
    if (files.length) this.#uploadToGallery(files);
  }

  static async #onBrowseGalleryImage() {
    const path = await browseImage();
    if (path) await store.addPartyNoteImages(this.noteId, [path]);
  }

  static async #onRemoveImage(event, target) {
    await store.removePartyNoteImage(this.noteId, target.closest("[data-image-id]").dataset.imageId);
  }

  static async #onTogglePinned() {
    const note = this.note;
    if (note) await store.setPartyNotePinned(this.noteId, !note.pinned);
  }

  static async #onShare() {
    await PartyNoteSheet.share(this.noteId);
  }

  static async #onToggleHidden() {
    const note = this.note;
    if (note) await store.setPartyNoteHidden(this.noteId, !note.hidden);
  }

  static async #onDeleteNote() {
    if (await PartyNoteSheet.confirmDelete(this.noteId)) this.close();
  }

  static async #onOpenLink(event, target) {
    const doc = await fromUuid(target.dataset.uuid ?? "").catch(() => null);
    if (!doc) return ui.notifications.warn(t("SourceGone"));
    if (!doc.testUserPermission?.(game.user, "LIMITED")) return ui.notifications.info(t("NoAccess"));
    if (doc instanceof Scene) return doc.view();
    if (doc instanceof JournalEntryPage) return doc.parent.sheet.render({ force: true, pageId: doc.id });
    return doc.sheet?.render({ force: true });
  }

  static #onOpenQuest(event, target) {
    game.modules.get(MODULE_ID)?.api?.openQuest(target.dataset.questId);
  }
}
