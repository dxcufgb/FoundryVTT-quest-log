# Dxcufgb's Quest log

FoundryVTT v13 module (id `dxcufgbs-quest-log`, the install folder must have the same name). A shared quest log in
its own right-sidebar tab: quests with giver, where acquired, where they take place, reward, description, tags,
objectives, images and a log of notes/clues; search, grouping, and "add to quest log" from chat, journals and
selected text; a second view of the tab, *Quest Rewards*, for what the party got (uses counted down, then claimed); and a
third, *Notes*, for the party's own notes (general, or about a quest).
System-agnostic. No build step and no npm dependencies.

## Layout
- `scripts/main.js` – entry: settings, the sidebar tab registration (`Sidebar.TABS.questlog` inserted before
  `settings`, `CONFIG.ui.questlog`), refresh hooks, change notifications, hiding the store journals from the
  Journal directory, the module API.
- `scripts/store.js` – the data layer. Quests live in `flags.dxcufgbs-quest-log.quests.<id>` of two journal
  entries made by `ensureStores` (responsible GM only): `store: "shared"` (default OWNER) and `store: "secret"`
  (default NONE, hidden quests). `normalizeQuest` turns raw data into the view model; every write goes through
  `patch` / dot-path updates of one key. `setHidden` moves a quest between the stores. Parts of a quest can be hidden
  on their own: `hidden: true` on a stage / objective / note / gallery image (`setPartHidden`; kinds in `PART_KINDS`) and the `hiddenFields` array
  (`setFieldHidden`, names in `HIDEABLE_FIELDS`). For players `normalizeQuest` drops hidden parts and empties hidden
  fields, so the list, search, progress, grouping and related quests never see them.
  Places ("Takes place at") are a keyed `locations` object ({name, hidden, sort}); `locationsOf` also reads the old
  one-text `location` (as id "legacy") and the old whole-field `location` toggle (hides every place). `locationFields`
  writes the edit form's list (ids kept, removed ones `-=id`, legacy migrated, `location` cleared); a player's list lacks
  hidden places, so it never removes or changes them. `chapter` (text) and `questType` ("main" | "side" | "") are
  single-value categories with their own group-by modes.
  Items needed are keyed `items.<id>` ({name, uuid, img, have, hidden, sort, createdBy}; part kind `items`), added and
  ticked in the quest window (`addItem` / `updateItem` / `deleteItem`), like objectives.
  Related NPCs are keyed `npcs.<id>` ({name, faceId, uuid, img, auto, hidden, sort, createdBy}; part kind `npcs`).
- `scripts/npcs.js` – Familiar Faces & Places NPCs in quest text: the `@NPC[faceId]{label}` enricher (a link only for
  users who know the NPC there), the "@" pick list (`attachNpcPicker`, on objective inputs and the stage dialog) and
  `mentionedFaces` / `newMentions`. `addObjective` / `updateObjective` / `addStage` / `updateStage` / `createQuest`
  add the NPCs a text newly mentions to `npcs` in the same patch (`auto: true`; hidden when the text is hidden, or a
  GM's link to an NPC the party doesn't know, with `autoHidden`; a player's link to such an NPC adds nothing). Revealing an
  objective (not of a hidden stage) or stage reveals the `autoHidden` ones (`npcsRevealedWith`); the GM's eye button on an
  NPC clears `autoHidden`. A player's duplicate check ignores hidden NPCs, so they never learn of one.
- `scripts/apps/quest-log-tab.js` – `QuestLogTab` (HandlebarsApplicationMixin(AbstractSidebarTab)): parts `nav`
  (Quests / Quest Rewards / Notes switch, client setting `view`), `header` (search box, never re-rendered by data changes so
  typing isn't interrupted; re-rendered when the view switches), `filters`, `list`. In the rewards view
  `_configureRenderParts` swaps `filters` / `list` for `tab-reward-filters.hbs` / `tab-reward-list.hbs` (in the notes
  view `tab-note-filters.hbs` / `tab-note-list.hbs`); each view has its own search, status filter and group-by setting
  (`FILTER_SETTINGS` / `GROUP_SETTINGS`).
- **Rewards** (`store.js`, bottom): `flags.dxcufgbs-quest-log.rewards.<id>` in the same two stores ({name, description,
  img, maxUses (0 = no limit), spent, uses, claimed, claimedAt, questId, links}). Each use is a keyed `uses.<id>` entry
  ({by, at}) so simultaneous uses both count; `spent` is the offset the edit form sets ("uses left"). Status is derived
  in `normalizeReward`: claimed when `claimed` or all uses spent. `links` are keyed {type (`LINK_TYPES`), name, uuid,
  sort} written by `linkFields` like places. A reward whose quest is in the secret store stays in the secret store
  (`createReward` forces it, `setRewardHidden` refuses); a player's form never changes `questId` of a quest they can't see.
- **Party notes** (`store.js`, bottom): `flags.dxcufgbs-quest-log.partyNotes.<id>` in the same two stores ({title, text,
  tags, questId, links, gallery, pinned, editedBy, editedAt}). `gallery` is keyed like a quest's; the edit form's image
  list is written by `galleryFields` (new images get new keys; only images the form started with, `imagesStart`, can be
  removed). `links` reuse `linkFields`. A note about a hidden quest stays in the secret store (`createPartyNote`,
  `setPartyNoteHidden`), same rules as rewards.
- `scripts/apps/party-note-sheet.js` – `PartyNoteSheet`: view / edit / create of one note (same `data-bind` draft
  pattern), the Notes list's right-click menu (`contextOptions`), `share` (posts the note to chat; hidden notes can't be
  shared), `copyLink`.
- `scripts/apps/reward-sheet.js` – `RewardSheet`: view / edit / create of one reward (same `data-bind` draft pattern
  as `QuestSheet`), the list's right-click menu (`contextOptions`), `prefillFromQuest`, and `offerFromQuest` – the
  GM-only "quest completed, add its reward?" dialog (fired from the `updateJournalEntry` hook in `main.js` on the GM
  who completed it, or the responsible GM when a player did; setting `offerRewards`).
- `scripts/apps/quest-sheet.js` – `QuestSheet`: view mode and edit/create mode of one quest. Sheet-local state
  (`draft`, `composer`, `newObjective`, `editObjective`, `editNote`) is bound with `data-bind` so other people's
  edits re-render the window without losing what this user is typing; focus is restored in `_onRender`.
- `scripts/capture.js` – the *Add to Quest Log* dialog, the chat / journal entry / journal page context menu
  hooks and the selected-text right-click menu (capture-phase `contextmenu` listener, only when the click is on
  the selection; Shift bypasses it).
- `scripts/images.js` – image shrinking and upload; players without `FILES_UPLOAD` relay over the module socket
  to the active GM.
- `scripts/transfer.js` – GM export (JSON with author names added; `rewards` and `partyNotes` next to `quests`) and import
  (`sanitizeQuest` / `sanitizeReward` / `sanitizePartyNote` rebuild every entry from the file field by field; merge replaces entries with the
  same id, replace clears both stores first – rewards / notes only when the file has a `rewards` / `partyNotes` list).
- `scripts/delete-all.js` – *Delete all quests*: a GM-only settings menu (`registerMenu`, `restricted`) whose
  `DeleteAllQuestsMenu.render()` opens a confirmation (type the word, optional export first) and calls
  `store.deleteAllQuests` (`-=quests` on both stores; the store journals stay). Deliberately not in the Quest Log tab.
- `scripts/adventure.js` – quests stored on an Adventure (`flags.dxcufgbs-quest-log.questLog`, export format) are
  imported on the `importAdventure` hook (hidden by default, existing ids skipped); `consolidateStores` merges
  duplicate store journals an adventure brings in; the `@Quest[id]{label}` enricher (and `@Quest[id/<part kind>/<partId>]` for one stage, objective, note or place) with a GM Reveal / Unhide button
  (a delegated document click listener), `@Reward[id]{label}` / `@PartyNote[id]{label}` the same way for rewards / notes; `storeInAdventure` writes the
  log (quests, rewards and notes) into an Adventure.
- `scripts/search.js` – word-AND search over all quest text, snippets and highlighting.
- `scripts/util.js` – constants, `t()`, `escapeHTML`, `enrich` (escape → `<br>` → enrichHTML), helpers.
- `templates/*.hbs`, `styles/quest-log.css` (theme tokens on `.dxql`, light/dark), `lang/en.json` (`DXQL.*`).
- `.github/workflows/ci.yml` / `release.yml` – thin callers of `dxcufgb/foundry-module-ci`; identical in every
  module, do not edit them here. `claude.yml` – the Claude review.

## Conventions
- `MODULE_ID` must equal `id` in `module.json`; CI checks it.
- Every visible setting (`config: true`) needs a Name and Hint in `lang/en.json`; CI checks it.
- Strings go through `t()` (`DXQL.` prefix). Hook handlers catch and `console.error` their errors.
- Update `README.md` when behaviour, settings or the API change.

## Review focus
- **Concurrent edits**: never write the whole `quests` map or a whole quest from a stale copy; write only the
  keys that changed (`patch`). Objectives, notes and gallery images are keyed objects for that reason; only
  `tags` and a note's `images` are arrays (replaced as a whole by their single editor).
- **Hidden quests**: only GMs create in or move to the `secret` store; nothing from a hidden quest may be written
  to the `shared` store until it is revealed. `getQuest` returns null for a quest in a store the user can't observe.
- **Stages**: `stages.<id>` = {title, text, hidden, sort}; an objective's `stage` points at one (or null). A hidden
  stage hides its objectives from players (`normalizeQuest`, `withoutHiddenParts`); deleting a hidden stage keeps its
  objectives hidden. Objectives move only within their stage.
- **Hidden parts**: anything shown to players must come from `normalizeQuest(..., {forGM: false})` output, never
  from raw flags. Only GMs set `hidden` / `hiddenFields` (`setPartHidden`, `setFieldHidden`, `questFields`);
  `questFields` drops a player's writes to hidden fields so a player's edit form can't blank them.
- **Rewards**: write uses as new keyed `uses` entries, never a counter computed from a stale copy; the edit form writes
  `usesLeft` only when the user changed it. Nothing from a hidden quest (its id included) goes into a shared reward.
- **Party notes**: the same hidden-quest rules as rewards (a note about a hidden quest stays in the secret store; a
  player's form never changes a `questId` they can't see). Images are written as keyed `gallery` entries, never the
  whole gallery from a stale copy.
- **Escaping**: user text is stored plain and rendered through `enrich()` (escapes first) or `highlight()`; any
  other interpolation into HTML (dialogs, notifications, context menu) must use `escapeHTML`.
- **One client acts**: `ensureStores` runs only where `isResponsibleGM()`; relayed uploads only on the GM the
  request names (`gmId`).
- **Imports**: never write file data into a store without `sanitizeQuest`; hidden quests from a file go to the
  `secret` store only. Adventure imports never overwrite a quest that is already in the log (players' progress).
- **Saving the edit form**: only the form's `submit` event saves (the submit button has no `data-action`, or a
  click would save twice); `_saving` guards against double submits.
- **Permissions**: deleting checks `store.canDelete(createdBy)` (GM, own entry, or the `playersCanDelete`
  setting); editing a note is limited to its author and GMs.
