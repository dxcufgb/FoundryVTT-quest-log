import { MODULE_ID, t, escapeHTML } from "./util.js";
import { countQuests, deleteAllQuests, countRewards, deleteAllRewards, countPartyNotes, deleteAllPartyNotes, storesReady } from "./store.js";
import { exportQuests } from "./transfer.js";

/*
 * "Delete all quests": a GM-only button in the module's settings (not in the Quest Log tab), so the log can't be
 * wiped by a stray click. The GM has to type a confirmation word, and can export the log first from the same dialog.
 */

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/** Opens the confirmation and deletes every quest when the GM confirms. Returns how many were deleted. */
export async function confirmDeleteAll() {
  if (!game.user.isGM) return 0;
  if (!storesReady()) {
    ui.notifications.warn(t("NotReady"));
    return 0;
  }
  const counts = countQuests();
  const rewardCount = countRewards().total;
  const noteCount = countPartyNotes().total;
  if (!counts.total && !rewardCount && !noteCount) {
    ui.notifications.info(t("DeleteAll.Empty"));
    return 0;
  }

  const word = t("DeleteAll.Word");
  const typedWord = form => form?.elements.confirmWord?.value.trim().toLocaleUpperCase() === word.toLocaleUpperCase();
  const action = await DialogV2.wait({
    window: { title: t("DeleteAll.Title"), icon: "fa-solid fa-triangle-exclamation" },
    position: { width: 460 },
    content: `<div class="dxql dxql-transfer dxql-delete-all">
      <p>${t("DeleteAll.Body", { count: counts.total })}</p>
      ${rewardCount ? `<label class="checkbox"><input type="checkbox" name="rewards">
        <i class="fa-solid fa-gift" inert></i> ${escapeHTML(t("DeleteAll.AlsoRewards", { count: rewardCount }))}</label>` : ""}
      ${noteCount ? `<label class="checkbox"><input type="checkbox" name="partyNotes">
        <i class="fa-solid fa-note-sticky" inert></i> ${escapeHTML(t("DeleteAll.AlsoPartyNotes", { count: noteCount }))}</label>` : ""}
      ${counts.secret ? `<p class="dxql-hint"><i class="fa-solid fa-eye-slash" inert></i> ${escapeHTML(t("DeleteAll.HiddenNote", { count: counts.secret }))}</p>` : ""}
      <p class="dxql-hint">${escapeHTML(t("DeleteAll.ExportHint"))}</p>
      <button type="button" class="dxql-delete-all-export"><i class="fa-solid fa-file-export" inert></i> ${escapeHTML(t("DeleteAll.ExportFirst"))}</button>
      <label class="dxql-delete-all-word">${t("DeleteAll.TypeWord", { word: `<b>${escapeHTML(word)}</b>` })}
        <input type="text" name="confirmWord" autocomplete="off" spellcheck="false"></label>
    </div>`,
    rejectClose: false,
    buttons: [
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark", default: true },
      {
        action: "delete", label: t("DeleteAll.Delete"), icon: "fa-solid fa-trash",
        callback: (event, button) => {
          if (!typedWord(button.form)) return "cancel";
          return { rewards: !!button.form?.elements.rewards?.checked, partyNotes: !!button.form?.elements.partyNotes?.checked };
        }
      }
    ],
    render: (event, dialog) => {
      const root = dialog instanceof HTMLElement ? dialog : dialog?.element;
      const form = root?.querySelector("form") ?? root;
      const input = root?.querySelector('input[name="confirmWord"]');
      const deleteButton = root?.querySelector('button[data-action="delete"]');
      if (!input || !deleteButton) return;
      deleteButton.classList.add("dxql-danger");
      const sync = () => { deleteButton.disabled = !typedWord(form); };
      sync();
      input.addEventListener("input", sync);
      // Enter in the box must never delete: it would skip the button the GM has to click on purpose.
      input.addEventListener("keydown", ev => { if (ev.key === "Enter") ev.preventDefault(); });
      root.querySelector(".dxql-delete-all-export")?.addEventListener("click", () => exportQuests());
      input.focus();
    }
  });
  if (!action || typeof action !== "object") return 0;

  const deleted = await deleteAllQuests();
  ui.notifications.info(t("DeleteAll.Done", { count: deleted }));
  console.log(`${MODULE_ID} | ${game.user.name} deleted all ${deleted} quests`);
  if (action.rewards) {
    const rewards = await deleteAllRewards();
    ui.notifications.info(t("DeleteAll.RewardsDone", { count: rewards }));
    console.log(`${MODULE_ID} | ${game.user.name} deleted all ${rewards} quest rewards`);
  }
  if (action.partyNotes) {
    const notes = await deleteAllPartyNotes();
    ui.notifications.info(t("DeleteAll.PartyNotesDone", { count: notes }));
    console.log(`${MODULE_ID} | ${game.user.name} deleted all ${notes} party notes`);
  }
  return deleted;
}

/** The settings menu entry: opening it shows the confirmation dialog instead of a window of its own. */
export class DeleteAllQuestsMenu extends ApplicationV2 {
  async render() {
    try {
      await confirmDeleteAll();
    } catch (err) {
      console.error(`${MODULE_ID} | delete all quests`, err);
    }
    return this;
  }
}
