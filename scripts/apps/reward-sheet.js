import {
  MODULE_ID, TEMPLATE_PATH, LINK_TYPES, LINK_ICONS, REWARD_STATUS_ICONS, MAX_USES, t, cleanLine, enrich, formatDate, userInfo,
  locationSuggestions, getDropData, linkForDrop, insertAtCursor, randomId, escapeHTML
} from "../util.js";
import * as store from "../store.js";
import { tokenize, markTerms } from "../search.js";
import { uploadImages, pickFiles, browseImage, canBrowse, filesFromEvent, urlFromDrop, showImage } from "../images.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** At most this many uses are drawn as pips in the reward window. */
const MAX_PIPS = 20;
const WIDTH = 560;
const HEIGHT = 680;

/** The link type a dropped document gets. */
const DROP_TYPES = { Actor: "npc", Token: "npc", Scene: "place", JournalEntry: "other", JournalEntryPage: "other", Item: "other" };

/**
 * Reads the uses out of a reward text: "Potion of Healing (3 uses)", "3x Potion", "Potion x3", "Wand, 7 charges".
 * Returns {name, maxUses} (maxUses 0 when the text doesn't say).
 */
export function parseRewardItem(text) {
  let name = cleanLine(text, 120);
  let maxUses = 0;
  const patterns = [
    /\s*\(?\b(\d{1,3})\s*(?:uses?|charges?)\)?\s*$/i,
    /^\s*(\d{1,3})\s*[x×]\s+/i,
    /\s+[x×]\s*(\d{1,3})\s*$/i
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (!m) continue;
    maxUses = Math.min(Number(m[1]), MAX_USES);
    name = cleanLine(name.replace(re, " ").replace(/[,(]\s*$/, ""), 120);
    break;
  }
  return { name, maxUses };
}

/** Splits a quest's reward text into items: "200 gp, Ring of Warmth; 3x Potion" → three items. */
export function splitRewardText(text) {
  const items = [];
  for (const part of String(text ?? "").split(/[,;\n]+/).map(s => cleanLine(s, 120)).filter(Boolean)) {
    // "Wand of Webs, 7 charges": a piece that only gives the uses belongs to the item before it.
    if (items.length && /^\(?\d{1,3}\s*(?:uses?|charges?)\)?$/i.test(part)) items[items.length - 1] += ` (${part.replace(/[()]/g, "")})`;
    else items.push(part);
  }
  return items;
}

/** One reward's window: uses, links, description and the log of uses. Also used to create a new reward. */
export class RewardSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dxql", "dxql-sheet", "dxql-reward-sheet"],
    window: { icon: "fa-solid fa-gift", resizable: true },
    position: { width: WIDTH, height: HEIGHT },
    actions: {
      edit: RewardSheet.#onEdit,
      cancelEdit: RewardSheet.#onCancelEdit,
      setLimited: RewardSheet.#onSetLimited,
      addLink: RewardSheet.#onAddLink,
      removeLink: RewardSheet.#onRemoveLink,
      cycleLinkType: RewardSheet.#onCycleLinkType,
      uploadImage: RewardSheet.#onUploadImage,
      browseImage: RewardSheet.#onBrowseImage,
      removeImage: RewardSheet.#onRemoveImage,
      viewImage: RewardSheet.#onViewImage,
      use: RewardSheet.#onUse,
      undoUse: RewardSheet.#onUndoUse,
      refill: RewardSheet.#onRefill,
      setClaimed: RewardSheet.#onSetClaimed,
      toggleHidden: RewardSheet.#onToggleHidden,
      deleteReward: RewardSheet.#onDeleteReward,
      openLink: RewardSheet.#onOpenLink,
      openQuest: RewardSheet.#onOpenQuest
    }
  };

  static PARTS = {
    body: { template: `${TEMPLATE_PATH}/reward-sheet.hbs`, scrollable: [""] }
  };

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  static appId(rewardId) {
    return `dxql-reward-${rewardId}`;
  }

  static open(rewardId, { highlight = "", position } = {}) {
    const existing = foundry.applications.instances.get(RewardSheet.appId(rewardId));
    if (existing) {
      existing.highlight = highlight;
      existing.render({ force: true });
      existing.bringToFront();
      return existing;
    }
    const options = { id: RewardSheet.appId(rewardId), rewardId, highlight };
    if (position) options.position = position;
    const app = new RewardSheet(options);
    app.render({ force: true });
    return app;
  }

  /**
   * Opens an empty (or prefilled) reward form; nothing is saved until Add.
   * prefill: name, description, img, maxUses, usesLeft, questId, links ([{type, name, uuid}]), hidden.
   * offset: shifts the window, so several forms opened at once don't cover each other.
   */
  static createNew(prefill = {}, { offset = 0 } = {}) {
    const options = { id: `dxql-reward-new-${randomId()}`, draft: prefill };
    if (offset) {
      options.position = {
        left: Math.max(0, (window.innerWidth - WIDTH) / 2 + offset * 32),
        top: Math.max(0, (window.innerHeight - HEIGHT) / 2 + offset * 32)
      };
    }
    const app = new RewardSheet(options);
    app.render({ force: true });
    return app;
  }

  static refreshAll() {
    for (const app of foundry.applications.instances.values()) {
      if (!(app instanceof RewardSheet) || !app.rendered) continue;
      if (app.rewardId && !store.getReward(app.rewardId)) {
        // A reveal or an import briefly removes a reward before writing it back; only close if it stays gone.
        setTimeout(() => {
          if (app.rendered && !store.getReward(app.rewardId)) app.close();
        }, 1500);
        continue;
      }
      app.render();
    }
  }

  static async confirmDelete(rewardId) {
    const reward = store.getReward(rewardId);
    if (!reward) return false;
    const ok = await DialogV2.confirm({
      window: { title: t("Reward.Delete"), icon: "fa-solid fa-trash" },
      content: `<p>${t("Reward.DeleteConfirm", { name: escapeHTML(reward.name) })}</p>`,
      rejectClose: false
    });
    if (!ok) return false;
    await store.deleteReward(rewardId);
    return true;
  }

  /** The reward form, filled in from a quest: its quest giver (NPC) and places as links, and one item of its reward text. */
  static prefillFromQuest(quest, itemText = "") {
    const { name, maxUses } = parseRewardItem(itemText);
    // A reward from a hidden quest (or from a hidden reward field) starts out hidden, with the quest's hidden links.
    const hidden = !!(game.user.isGM && (quest.hidden || quest.hiddenFields.includes("reward")));
    const links = [];
    if (quest.giver && (hidden || !quest.hiddenFields.includes("giver"))) links.push({ type: "npc", name: quest.giver, uuid: quest.giverUuid ?? "" });
    for (const place of quest.locations ?? []) if (hidden || !place.hidden) links.push({ type: "place", name: place.name, uuid: "" });
    return { name, maxUses, questId: quest.id, links, hidden };
  }

  /**
   * GM, when a quest is completed: asks whether anything from its reward field should go to the Quest Rewards. Each item
   * the GM keeps opens a prefilled reward form; nothing is added until the GM saves it.
   */
  static async offerFromQuest(questId) {
    if (!game.user.isGM) return;
    const quest = store.getQuest(questId);
    if (!quest || quest.status !== "completed" || !quest.reward.trim()) return;
    const items = splitRewardText(quest.reward);
    if (!items.length) return;
    const already = store.rewardsForQuest(questId).length;
    const rows = items.map((item, i) => `
      <li class="dxql-offer-item">
        <input type="checkbox" name="keep${i}" checked aria-label="${escapeHTML(t("Reward.Offer.Keep"))}">
        <input type="text" name="item${i}" value="${escapeHTML(item)}" maxlength="120">
      </li>`).join("");
    const result = await DialogV2.wait({
      window: { title: t("Reward.Offer.Title"), icon: "fa-solid fa-gift" },
      position: { width: 460 },
      classes: ["dxql-dialog"],
      content: `<div class="dxql dxql-reward-offer">
        <p>${t("Reward.Offer.Body", { title: escapeHTML(quest.title) })}</p>
        <p class="dxql-offer-reward"><i class="fa-solid fa-coins" inert></i> ${escapeHTML(quest.reward)}</p>
        <ol class="dxql-offer-items">${rows}</ol>
        <p class="dxql-hint">${escapeHTML(t("Reward.Offer.Hint"))}</p>
        ${already ? `<p class="dxql-hint"><i class="fa-solid fa-circle-info" inert></i> ${escapeHTML(t("Reward.Offer.Already", { count: already }))}</p>` : ""}
      </div>`,
      rejectClose: false,
      buttons: [
        { action: "no", label: t("Reward.Offer.No"), icon: "fa-solid fa-xmark" },
        {
          action: "yes", label: t("Reward.Offer.Yes"), icon: "fa-solid fa-check", default: true,
          callback: (event, button) => {
            const form = button.form;
            return items.map((item, i) => (form.elements[`keep${i}`]?.checked ? cleanLine(form.elements[`item${i}`]?.value, 120) : ""))
              .filter(Boolean);
          }
        }
      ]
    });
    if (!Array.isArray(result) || !result.length) return;
    // The quest may have changed while the dialog was open.
    const current = store.getQuest(questId) ?? quest;
    result.forEach((item, i) => RewardSheet.createNew(RewardSheet.prefillFromQuest(current, item), { offset: i }));
  }

  /** Right-click menu entries for a reward (the Quest Rewards list). getId(li) gives the reward id of the entry. */
  static contextOptions(getId) {
    const reward = li => store.getReward(getId(li));
    return [
      {
        name: "DXQL.Open", icon: '<i class="fa-solid fa-book-open"></i>',
        callback: li => RewardSheet.open(getId(li))
      },
      {
        name: "DXQL.Reward.UseOnce", icon: '<i class="fa-solid fa-hand-sparkles"></i>',
        condition: li => { const r = reward(li); return r?.status === "active" && !r.unlimited; },
        callback: li => store.useReward(getId(li))
      },
      {
        name: "DXQL.Reward.UndoUse", icon: '<i class="fa-solid fa-rotate-left"></i>',
        condition: li => { const r = reward(li); return r && !r.unlimited && r.used > 0; },
        callback: li => store.undoRewardUse(getId(li))
      },
      {
        name: "DXQL.Reward.Refill", icon: '<i class="fa-solid fa-fill-drip"></i>',
        condition: li => { const r = reward(li); return r && !r.unlimited && r.used > 0; },
        callback: li => store.refillReward(getId(li))
      },
      {
        name: "DXQL.Reward.MarkClaimed", icon: '<i class="fa-solid fa-box-archive"></i>',
        condition: li => reward(li)?.status === "active",
        callback: li => store.setRewardClaimed(getId(li), true)
      },
      {
        name: "DXQL.Reward.Restore", icon: '<i class="fa-solid fa-box-open"></i>',
        condition: li => reward(li)?.status === "claimed",
        callback: li => store.setRewardClaimed(getId(li), false)
      },
      {
        name: "DXQL.Reward.OpenQuest", icon: '<i class="fa-solid fa-scroll"></i>',
        condition: li => !!reward(li)?.questId && !!store.getQuest(reward(li).questId),
        callback: li => game.modules.get(MODULE_ID)?.api?.openQuest(reward(li)?.questId)
      },
      {
        name: "DXQL.Reward.CopyLink", icon: '<i class="fa-solid fa-link"></i>',
        condition: li => !!reward(li),
        callback: li => {
          const r = reward(li);
          if (!r) return;
          const link = `@Reward[${r.id}]{${r.name.replace(/[{}[\]]/g, "")}}`;
          navigator.clipboard?.writeText(link)
            .then(() => ui.notifications.info(t("Reward.LinkCopied", { link: escapeHTML(link) })))
            .catch(() => ui.notifications.warn(link));
        }
      },
      {
        name: "DXQL.HideFromPlayers", icon: '<i class="fa-solid fa-eye-slash"></i>',
        condition: li => game.user.isGM && reward(li) && !reward(li).hidden,
        callback: li => store.setRewardHidden(getId(li), true)
      },
      {
        name: "DXQL.RevealToPlayers", icon: '<i class="fa-solid fa-eye"></i>',
        condition: li => game.user.isGM && reward(li)?.hidden,
        callback: li => store.setRewardHidden(getId(li), false)
      },
      {
        name: "DXQL.Reward.Delete", icon: '<i class="fa-solid fa-trash"></i>',
        condition: li => { const r = reward(li); return r && store.canDelete(r.createdBy); },
        callback: li => RewardSheet.confirmDelete(getId(li))
      }
    ];
  }

  /* -------------------------------------------- */

  constructor(options = {}) {
    super(options);
    this.rewardId = options.rewardId ?? null;
    this.highlight = options.highlight ?? "";
    this.editing = !this.rewardId;
    this.draft = this.rewardId ? null : RewardSheet.#makeDraft(options.draft ?? {});
    this.linkInput = "";
    this.linkType = "place";
    this.uploading = 0;
    this._focus = null;
  }

  static #makeDraft(source = {}) {
    const maxUses = store.clampUses(source.maxUses);
    // Empty = all uses left (a new reward is received full).
    const usesLeft = maxUses && source.usesLeft != null ? String(source.usesLeft) : "";
    return {
      name: source.name ?? "",
      description: source.description ?? "",
      img: source.img ?? "",
      limited: maxUses > 0,
      maxUses: maxUses ? String(maxUses) : "1",
      usesLeft,
      // What "uses left" was when the form opened: it is written only when the user changes it.
      usesLeftStart: usesLeft,
      questId: source.questId ?? "",
      links: (source.links ?? []).map(l => ({
        id: l.id ?? null, type: LINK_TYPES.includes(l.type) ? l.type : "other", name: cleanLine(l.name, 120), uuid: l.uuid ?? ""
      })).filter(l => l.name),
      hidden: !!source.hidden
    };
  }

  get reward() {
    return this.rewardId ? store.getReward(this.rewardId) : null;
  }

  get title() {
    if (!this.rewardId) return t("Reward.New");
    return this.reward?.name ?? t("Reward.Tab");
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const reward = this.reward;
    Object.assign(context, {
      appId: this.id,
      isGM: game.user.isGM,
      isNew: !this.rewardId,
      editing: this.editing,
      missing: !!this.rewardId && !reward,
      canBrowse: canBrowse(),
      uploading: this.uploading > 0
    });
    if (context.missing) return context;
    const quests = store.storesReady() ? store.allQuests() : [];

    if (this.editing) {
      if (!this.draft) this.draft = RewardSheet.#makeDraft(reward);
      const draft = this.draft;
      const suggestions = new Set(locationSuggestions(quests));
      for (const q of quests) if (q.giver) suggestions.add(q.giver);
      for (const r of store.allRewards()) for (const l of r.links) suggestions.add(l.name);
      const questOptions = [{ id: "", label: t("Reward.NoQuest"), selected: !draft.questId },
        ...quests.slice().sort((a, b) => a.title.localeCompare(b.title))
          .map(q => ({ id: q.id, label: `${q.title}${q.hidden ? " 👁" : ""}`, selected: q.id === draft.questId }))];
      Object.assign(context, {
        draft: {
          ...draft,
          linkList: draft.links.map(l => ({ ...l, icon: LINK_ICONS[l.type], label: t(`Reward.LinkType.${l.type}`) }))
        },
        questOptions,
        linkInput: this.linkInput,
        linkTypes: LINK_TYPES.map(id => ({ id, label: t(`Reward.LinkType.${id}`), selected: id === this.linkType })),
        linkSuggestions: [...suggestions].filter(n => !draft.links.some(l => l.name.toLowerCase() === n.toLowerCase()))
          .sort((a, b) => a.localeCompare(b)),
        maxUsesLimit: MAX_USES
      });
      return context;
    }

    const quest = reward.questId ? store.getQuest(reward.questId) : null;
    const pips = !reward.unlimited && reward.maxUses <= MAX_PIPS
      ? Array.from({ length: reward.maxUses }, (_, i) => ({ full: i < reward.usesLeft }))
      : null;
    const linkGroups = LINK_TYPES.map(type => ({
      type,
      label: t(`Reward.LinkTypes.${type}`),
      icon: LINK_ICONS[type],
      links: reward.links.filter(l => l.type === type)
    })).filter(g => g.links.length);
    const history = reward.log.slice().reverse().map(u => ({
      name: userInfo(u.by, u.byName).name,
      color: userInfo(u.by, u.byName).color,
      date: formatDate(u.at),
      fullDate: u.at ? new Date(u.at).toLocaleString() : ""
    }));
    Object.assign(context, {
      reward: {
        ...reward,
        statusIcon: REWARD_STATUS_ICONS[reward.status],
        statusLabel: t(reward.usedUp ? "Reward.UsedUp" : `Reward.Status.${reward.status}`)
      },
      pips,
      usesLabel: reward.unlimited ? t("Reward.Unlimited") : t("Reward.UsesLeft", { left: reward.usesLeft, max: reward.maxUses }),
      canUse: reward.status === "active" && !reward.unlimited,
      canUndo: !reward.unlimited && reward.used > 0,
      quest: quest ? { id: quest.id, title: quest.title, hidden: quest.hidden } : null,
      linkGroups,
      descriptionHTML: await enrich(reward.description),
      history,
      canDeleteReward: store.canDelete(reward.createdBy),
      createdBy: userInfo(reward.createdBy, reward.authorName).name,
      createdAt: new Date(reward.createdAt || Date.now()).toLocaleDateString(),
      claimedAt: reward.status === "claimed" && reward.claimedAt ? new Date(reward.claimedAt).toLocaleDateString() : ""
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
        this.#onDrop(event, zone).catch(err => console.error(`${MODULE_ID} | reward drop`, err));
      });
    }

    if (this._focus) {
      const field = root.querySelector(`[data-bind="${this._focus.bind}"]`);
      if (field) {
        field.focus();
        try { field.setSelectionRange(this._focus.start, this._focus.end); } catch { /* number, select */ }
      }
      this._focus = null;
    } else if (options.isFirstRender && this.editing) {
      root.querySelector("[data-bind='draft.name']")?.focus();
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
  /*  Drag & drop                                 */
  /* -------------------------------------------- */

  async #onDrop(event, zone) {
    const kind = zone.dataset.drop;
    const files = filesFromEvent(event);
    const url = urlFromDrop(event);
    const data = getDropData(event);
    event.preventDefault();
    event.stopPropagation();
    if (!this.editing) return;

    if (kind === "image") {
      if (files.length) return this.#upload(files);
      const src = url ?? data?.src ?? data?.texture?.src;
      if (src) {
        this.draft.img = src;
        return this.render();
      }
      if (data?.uuid) {
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (doc?.img) {
          this.draft.img = doc.img;
          this.render();
        }
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
    if (kind === "item") {
      // An item dropped on the name: the reward is that item (name, image and a link in the description).
      if (!data?.uuid) return;
      const doc = await fromUuid(data.uuid).catch(() => null);
      if (!doc) return;
      if (!this.draft.name.trim()) this.draft.name = cleanLine(doc.name, 120);
      if (!this.draft.img && doc.img && !doc.img.includes("icons/svg/")) this.draft.img = doc.img;
      const link = await linkForDrop(data);
      if (link && !this.draft.description.includes(data.uuid)) {
        this.draft.description = [this.draft.description.trim(), link].filter(Boolean).join("\n");
      }
      return this.render();
    }
    if (kind === "link" && data?.uuid) insertAtCursor(zone, await linkForDrop(data));
  }

  async #upload(files) {
    this.uploading++;
    this.render();
    try {
      const [path] = await uploadImages(files.slice(0, 1));
      if (path && this.draft) this.draft.img = path;
    } finally {
      this.uploading--;
      if (this.rendered) this.render();
    }
  }

  /* -------------------------------------------- */
  /*  Actions: edit form                          */
  /* -------------------------------------------- */

  static #onEdit() {
    this._scrollToTop = true;
    this.draft = RewardSheet.#makeDraft(this.reward);
    this.linkInput = "";
    this.editing = true;
    this._focusNext = "[data-bind='draft.name']";
    this.render();
  }

  static #onCancelEdit() {
    if (!this.rewardId) return this.close();
    this._scrollToTop = true;
    this.editing = false;
    this.draft = null;
    this.render();
  }

  static #onSetLimited(event, target) {
    this.draft.limited = target.dataset.limited === "true";
    if (this.draft.limited && !(Number(this.draft.maxUses) > 0)) this.draft.maxUses = "1";
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

  static async #onUploadImage() {
    const files = await pickFiles();
    if (files.length) this.#upload(files);
  }

  static async #onBrowseImage() {
    const path = await browseImage();
    if (path && this.draft) {
      this.draft.img = path;
      this.render();
    }
  }

  static #onRemoveImage() {
    this.draft.img = "";
    this.render();
  }

  static #onViewImage(event, target) {
    showImage(target.dataset.src, this.title);
  }

  /** Saves the edit form. Runs only from the form's submit event, and only once at a time. */
  async #onSave() {
    if (this._saving || this.uploading) return;
    this.#commitLink({ silent: true });
    const draft = this.draft;
    if (!draft.name.trim()) {
      ui.notifications.warn(t("Reward.NameRequired"));
      this.element.querySelector("[data-bind='draft.name']")?.focus();
      return;
    }
    const max = draft.limited ? store.clampUses(draft.maxUses) : 0;
    if (draft.limited && !max) {
      ui.notifications.warn(t("Reward.UsesRequired"));
      this.element.querySelector("[data-bind='draft.maxUses']")?.focus();
      return;
    }
    const data = {
      name: draft.name,
      description: draft.description,
      img: draft.img,
      maxUses: max,
      questId: draft.questId,
      links: draft.links
    };
    // Uses left is written only when changed here, so a use someone makes while this form is open still counts.
    const leftChanged = String(draft.usesLeft).trim() !== String(draft.usesLeftStart).trim();
    if (max && leftChanged && String(draft.usesLeft).trim() !== "") data.usesLeft = draft.usesLeft;
    this._saving = true;
    try {
      if (!this.rewardId) {
        const id = await store.createReward(data, { hidden: draft.hidden });
        if (!id) return;
        const { left, top, width, height } = this.position;
        await this.close({ animate: false });
        RewardSheet.open(id, { position: { left, top, width, height } });
        return;
      }
      await store.updateReward(this.rewardId, data);
      if (game.user.isGM && draft.hidden !== this.reward?.hidden) await store.setRewardHidden(this.rewardId, draft.hidden);
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

  static async #onUse() {
    await store.useReward(this.rewardId);
  }

  static async #onUndoUse() {
    await store.undoRewardUse(this.rewardId);
  }

  static async #onRefill() {
    await store.refillReward(this.rewardId);
  }

  static async #onSetClaimed(event, target) {
    await store.setRewardClaimed(this.rewardId, target.dataset.claimed === "true");
  }

  static async #onToggleHidden() {
    const reward = this.reward;
    if (reward) await store.setRewardHidden(this.rewardId, !reward.hidden);
  }

  static async #onDeleteReward() {
    if (await RewardSheet.confirmDelete(this.rewardId)) this.close();
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
