import { MODULE_ID, STATUSES, t, escapeHTML, elementToText, htmlToText, imagesIn, cleanLine } from "./util.js";
import * as store from "./store.js";
import { QuestSheet } from "./apps/quest-sheet.js";
import { RewardSheet } from "./apps/reward-sheet.js";
import { PartyNoteSheet } from "./apps/party-note-sheet.js";

const { DialogV2 } = foundry.applications.api;
const NEW_QUEST = "__new";
const TYPES = ["note", "clue", "objective"];
const MAX_TEXT = 6000;
let lastQuestId = null;

/* -------------------------------------------- */
/*  The "Add to Quest Log" dialog               */
/* -------------------------------------------- */

/**
 * Asks where a piece of text (and images) should go: a note, clue or objective on an existing quest, or a new quest.
 * @param {object} entry
 * @param {string} entry.text
 * @param {string[]} [entry.images]
 * @param {{uuid: string, label: string}|null} [entry.source]
 * @param {string} [entry.type]          note | clue | objective | quest
 * @param {string} [entry.title]         Suggested title for a new quest.
 */
export async function addToQuestLog({ text = "", images = [], source = null, type = "note", title = "" } = {}) {
  if (!store.storesReady()) return ui.notifications.warn(t("NotReady"));
  text = String(text).trim().slice(0, MAX_TEXT);
  if (type === "quest") return startQuestFrom({ text, images, source, title });

  const quests = store.allQuests();
  const byStatus = STATUSES.map(status => ({
    status,
    quests: quests.filter(q => q.status === status).sort((a, b) => b.updatedAt - a.updatedAt)
  })).filter(g => g.quests.length);
  const preferred = quests.find(q => q.id === lastQuestId && q.status === "active")
    ?? byStatus.find(g => g.status === "active")?.quests[0];
  const selected = preferred?.id ?? NEW_QUEST;

  const options = byStatus.map(g => `<optgroup label="${escapeHTML(t(`Status.${g.status}`))}">${g.quests.map(q =>
    `<option value="${q.id}" ${q.id === selected ? "selected" : ""}>${escapeHTML(q.title)}${q.hidden ? " 👁" : ""}</option>`).join("")}</optgroup>`).join("");
  const typeButtons = TYPES.map(id => `
    <label class="dxql-seg-option">
      <input type="radio" name="type" value="${id}" ${id === type ? "checked" : ""}>
      <span><i class="${{ note: "fa-solid fa-note-sticky", clue: "fa-solid fa-magnifying-glass", objective: "fa-solid fa-list-check" }[id]}" inert></i> ${escapeHTML(t(`AddAs.${id}`))}</span>
    </label>`).join("");
  const imageList = images.length ? `
    <div class="form-group stacked">
      <label>${escapeHTML(t("IncludeImages"))}</label>
      <div class="dxql-pick-images">${images.map((src, i) => `
        <label class="dxql-pick-image"><input type="checkbox" name="image${i}" checked><img src="${escapeHTML(src)}" alt=""></label>`).join("")}
      </div>
    </div>` : "";

  const content = `
    <div class="dxql dxql-add-entry">
      ${source ? `<p class="dxql-source-line"><i class="fa-solid fa-link" inert></i> ${escapeHTML(t("From"))}: <b>${escapeHTML(source.label)}</b></p>` : ""}
      <div class="form-group">
        <label>${escapeHTML(t("AddAsLabel"))}</label>
        <div class="dxql-seg">${typeButtons}</div>
      </div>
      <div class="form-group">
        <label for="dxql-add-quest">${escapeHTML(t("Quest"))}</label>
        <select id="dxql-add-quest" name="questId">
          ${options}
          <option value="${NEW_QUEST}" ${selected === NEW_QUEST ? "selected" : ""}>＋ ${escapeHTML(t("NewQuestOption"))}</option>
        </select>
      </div>
      <div class="form-group dxql-new-title" ${selected === NEW_QUEST ? "" : "hidden"}>
        <label for="dxql-add-title">${escapeHTML(t("Field.Title"))}</label>
        <input id="dxql-add-title" type="text" name="title" value="${escapeHTML(title)}" placeholder="${escapeHTML(t("Placeholder.Title"))}">
      </div>
      <div class="form-group stacked">
        <label for="dxql-add-text">${escapeHTML(t("Text"))}</label>
        <textarea id="dxql-add-text" name="text" rows="7">${escapeHTML(text)}</textarea>
      </div>
      ${imageList}
      ${game.user.isGM ? `<label class="dxql-checkbox"><input type="checkbox" name="hidden">
        <i class="fa-solid fa-eye-slash" inert></i> ${escapeHTML(t("HiddenFromPlayers"))}</label>` : ""}
    </div>`;

  const result = await DialogV2.wait({
    window: { title: t("AddToQuestLog"), icon: "fa-solid fa-scroll" },
    position: { width: 480 },
    classes: ["dxql-dialog"],
    content,
    rejectClose: false,
    buttons: [
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
      {
        action: "add", label: t("Add"), icon: "fa-solid fa-check", default: true,
        callback: (event, button) => {
          const form = button.form;
          const data = new foundry.applications.ux.FormDataExtended(form).object;
          data.images = images.filter((src, i) => form.elements[`image${i}`]?.checked);
          return data;
        }
      }
    ],
    render: (event, dialog) => {
      const el = dialog.element;
      const select = el.querySelector("select[name=questId]");
      const titleRow = el.querySelector(".dxql-new-title");
      select.addEventListener("change", () => {
        titleRow.hidden = select.value !== NEW_QUEST;
        if (!titleRow.hidden) el.querySelector("input[name=title]").focus();
      });
    }
  });
  if (!result || result === "cancel") return;

  const entryType = TYPES.includes(result.type) ? result.type : "note";
  const entryText = String(result.text ?? "").trim();
  const entryImages = result.images ?? [];
  const hidden = !!(game.user.isGM && result.hidden);

  if (result.questId === NEW_QUEST) {
    const draft = { title: cleanLine(result.title, 120) };
    if (entryType === "objective") {
      draft.objectivesText = entryText;
      draft.objectivesHidden = hidden;
      draft.images = entryImages;
    } else {
      draft.notes = [{ type: entryType, text: entryText, images: entryImages, source, hidden }];
    }
    QuestSheet.createNew(draft);
    return;
  }

  const quest = store.getQuest(result.questId);
  if (!quest) return ui.notifications.warn(t("QuestGone"));
  lastQuestId = quest.id;
  if (entryType === "objective") {
    const lines = entryText.split(/\r?\n/).map(s => s.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
    for (const line of lines) await store.addObjective(quest.id, line, { hidden });
    if (entryImages.length) await store.addImages(quest.id, entryImages, { hidden });
  } else {
    if (!entryText && !entryImages.length) return;
    await store.addNote(quest.id, { type: entryType, text: entryText, images: entryImages, source, hidden });
  }
  ui.notifications.info(t("AddedTo", { what: t(`AddAs.${entryType}`), title: escapeHTML(quest.title) }));
}

/** Opens the new-quest form with the text as description and a link back to where it came from. */
function startQuestFrom({ text, images, source, title }) {
  const link = source?.uuid ? `\n\n${t("From")}: @UUID[${source.uuid}]{${String(source.label).replace(/[{}[\]]/g, "")}}` : "";
  QuestSheet.createNew({ title: title || firstLine(text), description: text + link, images });
}

/**
 * Opens the new-reward form filled in from a piece of the game: the first line (or title) as the name, the text as the
 * description with a link back to where it came from, and the first image.
 */
export function addAsReward({ text = "", images = [], source = null, title = "" } = {}) {
  if (!store.storesReady()) return ui.notifications.warn(t("NotReady"));
  const link = source?.uuid ? `${t("From")}: @UUID[${source.uuid}]{${String(source.label).replace(/[{}[\]]/g, "")}}` : "";
  const body = String(text ?? "").trim().slice(0, MAX_TEXT);
  return RewardSheet.createNew({
    name: cleanLine(title, 120) || firstLine(body),
    description: [body, link].filter(Boolean).join("\n\n"),
    img: images[0] ?? ""
  });
}

/**
 * Opens the new-note form (Notes view) filled in from a piece of the game: the first line (or title) as the title, the
 * text with a link back to where it came from, and its images.
 */
export function addAsPartyNote({ text = "", images = [], source = null, title = "" } = {}) {
  if (!store.storesReady()) return ui.notifications.warn(t("NotReady"));
  const link = source?.uuid ? `${t("From")}: @UUID[${source.uuid}]{${String(source.label).replace(/[{}[\]]/g, "")}}` : "";
  const body = String(text ?? "").trim().slice(0, MAX_TEXT);
  return PartyNoteSheet.createNew({
    title: cleanLine(title, 120) || firstLine(body),
    text: [body, link].filter(Boolean).join("\n\n"),
    images
  });
}

function firstLine(text) {
  const line = String(text ?? "").split(/\r?\n/).find(l => l.trim()) ?? "";
  return cleanLine(line, 60);
}

/* -------------------------------------------- */
/*  Sources                                     */
/* -------------------------------------------- */

function messageLabel(message) {
  const who = message.alias || message.speaker?.alias || message.author?.name || t("Chat");
  const flavor = cleanLine(htmlToText(message.flavor), 50);
  return cleanLine(flavor ? `${who}: ${flavor}` : `${who} (${t("ChatMessage")})`, 100);
}

function fromChatMessage(message, li) {
  const content = li?.querySelector(".message-content");
  const text = content ? elementToText(content) : htmlToText(message.content);
  const flavor = htmlToText(message.flavor);
  return {
    text: [flavor, text].filter(Boolean).join("\n"),
    images: imagesIn(content ?? (() => { const d = document.createElement("div"); d.innerHTML = message.content; return d; })()),
    source: { uuid: message.uuid, label: messageLabel(message) },
    title: cleanLine(flavor || firstLine(text), 60)
  };
}

function fromJournalPage(page) {
  let text = "";
  const images = [];
  if (page.type === "text") {
    text = htmlToText(page.text?.content);
    const div = document.createElement("div");
    div.innerHTML = page.text?.content ?? "";
    images.push(...imagesIn(div));
  } else if (page.type === "image" && page.src) {
    images.push(page.src);
    text = page.image?.caption ?? "";
  } else {
    text = page.name;
  }
  return {
    text,
    images,
    source: { uuid: page.uuid, label: `${page.parent?.name ?? ""}: ${page.name}` },
    title: page.name
  };
}

function fromJournalEntry(entry) {
  const pages = entry.pages.contents.filter(p => p.testUserPermission(game.user, "OBSERVER")).sort((a, b) => a.sort - b.sort);
  const texts = [];
  const images = new Set();
  for (const page of pages) {
    const part = fromJournalPage(page);
    if (part.text) texts.push(pages.length > 1 ? `${page.name}\n${part.text}` : part.text);
    part.images.forEach(src => images.add(src));
  }
  return {
    text: texts.join("\n\n"),
    images: [...images],
    source: { uuid: entry.uuid, label: entry.name },
    title: entry.name
  };
}

/** Works out where a selection was made: a chat message, a journal page or another document's window. */
function sourceForElement(el) {
  const msgEl = el?.closest?.(".message[data-message-id], .chat-message[data-message-id]");
  if (msgEl) {
    const message = game.messages.get(msgEl.dataset.messageId);
    if (message) return { uuid: message.uuid, label: messageLabel(message) };
  }
  const appEl = el?.closest?.(".application, .app");
  const app = appEl ? foundry.applications.instances.get(appEl.id) ?? ui.windows?.[appEl.dataset.appid] : null;
  const doc = app?.document ?? app?.object;
  const pageEl = el?.closest?.("[data-page-id]");
  if (doc instanceof JournalEntry && pageEl) {
    const page = doc.pages.get(pageEl.dataset.pageId);
    if (page) return { uuid: page.uuid, label: `${doc.name}: ${page.name}` };
  }
  if (doc?.uuid && !store.isStore(doc)) return { uuid: doc.uuid, label: doc.name ?? doc.documentName };
  return null;
}

/* -------------------------------------------- */
/*  Foundry context menus                       */
/* -------------------------------------------- */

const MENU_ICON = '<i class="fa-solid fa-scroll"></i>';
const REWARD_ICON = '<i class="fa-solid fa-gift"></i>';
const PARTY_NOTE_ICON = '<i class="fa-solid fa-note-sticky"></i>';

export function registerContextMenus() {
  Hooks.on("getChatMessageContextOptions", (app, options) => {
    options.push({
      name: "DXQL.Ctx.AddToQuestLog",
      icon: MENU_ICON,
      condition: li => store.storesReady() && !!game.messages.get(li.dataset.messageId),
      callback: li => {
        const message = game.messages.get(li.dataset.messageId);
        if (message) addToQuestLog(fromChatMessage(message, li));
      }
    }, {
      name: "DXQL.Ctx.NewQuestFrom",
      icon: '<i class="fa-solid fa-feather-pointed"></i>',
      condition: li => store.storesReady() && !!game.messages.get(li.dataset.messageId),
      callback: li => {
        const message = game.messages.get(li.dataset.messageId);
        if (message) addToQuestLog({ ...fromChatMessage(message, li), type: "quest" });
      }
    }, {
      name: "DXQL.Ctx.AddReward",
      icon: REWARD_ICON,
      condition: li => store.storesReady() && !!game.messages.get(li.dataset.messageId),
      callback: li => {
        const message = game.messages.get(li.dataset.messageId);
        if (message) addAsReward(fromChatMessage(message, li));
      }
    }, {
      name: "DXQL.Ctx.AddPartyNote",
      icon: PARTY_NOTE_ICON,
      condition: li => store.storesReady() && !!game.messages.get(li.dataset.messageId),
      callback: li => {
        const message = game.messages.get(li.dataset.messageId);
        if (message) addAsPartyNote(fromChatMessage(message, li));
      }
    });
  });

  Hooks.on("getJournalEntryContextOptions", (app, options) => {
    const entry = li => game.journal.get(li.closest("[data-entry-id]")?.dataset.entryId);
    const ok = li => {
      const e = entry(li);
      return store.storesReady() && e && !store.isStore(e) && e.testUserPermission(game.user, "OBSERVER");
    };
    options.push({
      name: "DXQL.Ctx.AddToQuestLog", icon: MENU_ICON, condition: ok,
      callback: li => addToQuestLog(fromJournalEntry(entry(li)))
    }, {
      name: "DXQL.Ctx.NewQuestFrom", icon: '<i class="fa-solid fa-feather-pointed"></i>', condition: ok,
      callback: li => addToQuestLog({ ...fromJournalEntry(entry(li)), type: "quest" })
    }, {
      name: "DXQL.Ctx.AddReward", icon: REWARD_ICON, condition: ok,
      callback: li => addAsReward(fromJournalEntry(entry(li)))
    }, {
      name: "DXQL.Ctx.AddPartyNote", icon: PARTY_NOTE_ICON, condition: ok,
      callback: li => addAsPartyNote(fromJournalEntry(entry(li)))
    });
  });

  Hooks.on("getJournalEntryPageContextOptions", (app, options) => {
    const page = li => app.document?.pages.get(li.dataset.pageId);
    const ok = li => store.storesReady() && page(li)?.testUserPermission(game.user, "OBSERVER");
    options.push({
      name: "DXQL.Ctx.AddToQuestLog", icon: MENU_ICON, condition: ok,
      callback: li => addToQuestLog(fromJournalPage(page(li)))
    }, {
      name: "DXQL.Ctx.NewQuestFrom", icon: '<i class="fa-solid fa-feather-pointed"></i>', condition: ok,
      callback: li => addToQuestLog({ ...fromJournalPage(page(li)), type: "quest" })
    }, {
      name: "DXQL.Ctx.AddReward", icon: REWARD_ICON, condition: ok,
      callback: li => addAsReward(fromJournalPage(page(li)))
    }, {
      name: "DXQL.Ctx.AddPartyNote", icon: PARTY_NOTE_ICON, condition: ok,
      callback: li => addAsPartyNote(fromJournalPage(page(li)))
    });
  });

  // Items directory: an item the party got becomes a reward (its name, image and a link to it).
  Hooks.on("getItemContextOptions", (app, options) => {
    const item = li => game.items.get(li.closest("[data-entry-id]")?.dataset.entryId);
    options.push({
      name: "DXQL.Ctx.AddReward", icon: REWARD_ICON,
      condition: li => store.storesReady() && !!item(li)?.testUserPermission(game.user, "OBSERVER"),
      callback: li => {
        const doc = item(li);
        if (!doc) return;
        const img = doc.img && !doc.img.includes("icons/svg/") ? doc.img : "";
        RewardSheet.createNew({ name: doc.name, img, description: `@UUID[${doc.uuid}]{${doc.name.replace(/[{}[\]]/g, "")}}` });
      }
    });
  });

  // Capture phase on the document: runs before Foundry's own context menus on chat messages and journal pages.
  document.addEventListener("contextmenu", onSelectionContextMenu, true);
}

/* -------------------------------------------- */
/*  Right-click on selected text                */
/* -------------------------------------------- */

let menuEl = null;

function selectionUnderPointer(event) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const target = event.target;
  if (target.closest?.("input, textarea, select, [contenteditable=''], [contenteditable=true], prose-mirror, .editor-content, #board")) return null;
  const range = selection.getRangeAt(0);
  const pad = 6;
  const inside = [...range.getClientRects()].some(r =>
    event.clientX >= r.left - pad && event.clientX <= r.right + pad && event.clientY >= r.top - pad && event.clientY <= r.bottom + pad);
  if (!inside) return null;
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return { text, images: imagesIn(range.cloneContents()), source: sourceForElement(el) };
}

function onSelectionContextMenu(event) {
  if (!game.ready || !store.storesReady() || event.shiftKey) return;
  if (!game.settings.get(MODULE_ID, "selectionMenu")) return;
  const found = selectionUnderPointer(event);
  if (!found) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  showSelectionMenu(event.clientX, event.clientY, found);
}

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("blur", closeMenu);
  window.removeEventListener("wheel", closeMenu, true);
}

function onOutside(event) {
  if (!menuEl?.contains(event.target)) closeMenu();
}

function onKey(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeMenu();
  }
}

function showSelectionMenu(x, y, found) {
  closeMenu();
  const items = [
    { act: "note", icon: "fa-solid fa-note-sticky", label: t("Ctx.SelectionNote") },
    { act: "clue", icon: "fa-solid fa-magnifying-glass", label: t("Ctx.SelectionClue") },
    { act: "objective", icon: "fa-solid fa-list-check", label: t("Ctx.SelectionObjective") },
    { act: "quest", icon: "fa-solid fa-feather-pointed", label: t("Ctx.SelectionQuest") },
    { act: "reward", icon: "fa-solid fa-gift", label: t("Ctx.SelectionReward") },
    { act: "partyNote", icon: "fa-solid fa-note-sticky", label: t("Ctx.SelectionPartyNote") },
    { sep: true },
    { act: "copy", icon: "fa-solid fa-copy", label: t("Ctx.Copy") }
  ];
  menuEl = document.createElement("nav");
  menuEl.id = "dxql-context-menu";
  menuEl.className = "dxql dxql-ctx";
  menuEl.setAttribute("role", "menu");
  menuEl.innerHTML = `<header><i class="fa-solid fa-scroll" inert></i> ${escapeHTML(t("Title"))}</header><ol>${items.map(i => i.sep
    ? '<li class="dxql-ctx-sep" role="separator"></li>'
    : `<li role="menuitem" tabindex="-1" data-act="${i.act}"><i class="${i.icon}" inert></i><span>${escapeHTML(i.label)}</span></li>`).join("")}</ol>`;
  document.body.append(menuEl);
  const { width, height } = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
  menuEl.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
  menuEl.addEventListener("click", event => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    closeMenu();
    if (act === "copy") {
      navigator.clipboard?.writeText(found.text).then(() => ui.notifications.info(t("Copied"))).catch(() => {});
      return;
    }
    if (act === "reward") return addAsReward({ ...found, title: firstLine(found.text) });
    if (act === "partyNote") return addAsPartyNote({ ...found, title: firstLine(found.text) });
    addToQuestLog({ ...found, type: act, title: firstLine(found.text) });
  });
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("wheel", closeMenu, true);
  }, 0);
}
