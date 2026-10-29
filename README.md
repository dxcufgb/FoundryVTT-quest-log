# Dxcufgb's Quest log

[![Foundry v13](https://img.shields.io/github/v/release/dxcufgb/FoundryVTT-quest-log?label=Foundry%20v13&logo=foundryvirtualtabletop&color=ff6400)](https://github.com/dxcufgb/FoundryVTT-quest-log/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/dxcufgb/FoundryVTT-quest-log/module.zip?label=downloads&color=blue)](https://github.com/dxcufgb/FoundryVTT-quest-log/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/dxcufgb)\
[![CI](https://img.shields.io/github/actions/workflow/status/dxcufgb/FoundryVTT-quest-log/ci.yml?branch=main&label=CI)](https://github.com/dxcufgb/FoundryVTT-quest-log/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dxcufgb/FoundryVTT-quest-log)](LICENSE)

<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT project, video and changelog in one place" width="650"></a>

A shared quest log for the whole table, in its own tab in the right sidebar. Players and the GM add quests, write down where they were picked up, who gave them and where they take place, keep notes and clues, add objectives as they come up and tick them off. Everything is searchable, and quests can be grouped by location, quest giver or tag. A second view, **Quest Rewards**, keeps track of what the party got and can use later, with a count of uses left, and a third, **Notes**, holds the party's own notes, about a quest or on their own.

**Foundry VTT:** v13 · **System:** any

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-quest-log/releases/latest/download/module.json
```

The first time a GM opens the world after enabling the module, the quest log is set up. Players can use it from then on, with or without a GM online.

## Features

- **Quest Log tab in the right sidebar** (the scroll icon, next to Game Settings) for every player and the GM. Right-click the tab icon to pop it out into its own window. The switch at the top of the tab shows the **Quests**, the **Quest Rewards** or the **Notes** (see below); each shows how many are active (for Notes: how many there are).
- **Quests** have a title, a **type** (*Main quest* or *Side quest*), a **chapter**, a **quest giver**, where they were **acquired**, the **places** they take place at, an optional **reward**, a **description**, **tags**, **objectives**, **related NPCs**, **items needed**, **images** and a log of **notes and clues**.
  - **Main quest / Side quest** and **Chapter** are categories of their own (one per quest), not tags: pick the type at the top of the edit form and type the chapter (it suggests the chapters already used). Main quests have a crown, side quests a compass, in the list and on the quest.
  - Worlds whose quests use tags for this (*Main quest*, *Side quest*, *Main story*, *Chapter 3* …) get a one-time question for the GM: **Convert** turns those tags into the categories (only for quests that don't have a type or chapter yet; other tags stay), *Ask me later* asks at the next start, *Keep the tags* never asks again. It can also be run from a macro: `game.modules.get("dxcufgbs-quest-log").api.convertCategoryTags()`.
  - **Takes place at** can hold several places: type a place and press **Enter** or type a **comma**, and it becomes a token below the field; **×** removes it again (Backspace in the empty field removes the last one). The pin button adds the scene you're on. Every place can be hidden from players on its own.
  - Drop an actor (or a token) on the quest giver to link it: its portrait is shown and the name opens its sheet.
  - The location fields suggest places already used and the names of your scenes; the pin button fills in (or adds) the scene you're on.
  - Drop actors, items, journal entries or scenes into any text to link them (`@UUID` links work everywhere).
- **Works with [Dxcufgb's Familiar Faces & Places](https://github.com/dxcufgb/FoundryVTT-familiar-faces)**: when that module is active, a quest giver, an *Acquired at* or *Takes place at* place, and the places, NPCs and factions linked to a reward or a note open their page in Familiar Faces & Places if it has an NPC, place or faction with that name (factions need Familiar Faces & Places 1.2.0 or later). Each user gets a link only to what they can see there; without the module, or without a matching entry, the name stays plain text (or opens its linked document, as before).
- **Objectives**: add new ones at any time, tick them off, reorder, edit (double-click) and delete them. A progress bar shows how far along the quest is, in the quest window and in the list.
- **Related NPCs**: the people the quest involves. Type a name under *Related NPCs* in the quest window and press Enter (names from Familiar Faces & Places are suggested), or drop an actor or token on the section. An NPC opens their Familiar Faces & Places page (or the actor). Players and the GM can both add NPCs; the GM can hide single NPCs from players.
- **NPCs in objectives and stages**: with Familiar Faces & Places active, type `@` and the start of a name while writing an objective or a stage, and pick the NPC from the list (arrow keys and Enter, or click). It becomes a link, `@NPC[<npc id>]{Name}`, that opens the NPC's page for everyone who knows them there (others see just the name). When an objective or stage is added or changed, the NPCs it newly links, and the NPCs the whole party knows whose name it mentions, are added to *Related NPCs* (marked with a small wand). NPCs from a hidden objective or stage are added hidden, and so are the GM's links to NPCs the party doesn't know yet (a player's link to an NPC only some players know isn't added, so the rest of the party doesn't learn of them). Revealing the objective or stage reveals the NPCs it brought in that the party knows, unless the GM has hidden an NPC with its own eye button. Removing an NPC from the list doesn't bring them back until a text mentions them anew.
- **Items needed**: the things the quest calls for (a key, three wolf pelts, the signet ring). Type a name under *Items needed* in the quest window and press Enter, or drop an item from the sidebar or a character sheet on the section to link it (its image is shown and the name opens it). Tick an item when the party has it; the count shows how many they have. Players and the GM can both add items; the GM can hide single items from players like objectives.
- **Stages**: a quest can be split into stages, each a heading with a short text (what the party knows now) and its own objectives. *Add Stage* under the objectives adds one; the menu next to *Add* picks which stage a new objective goes into. Stages are a natural thing to prepare hidden: a hidden stage hides its objectives with it, and unhiding it shows the players the new part of the quest in one click (they get a *"New stage in …"* notification).
- **Quest status**: *Active*, *Completed* or *Failed*. Tick the circle in the list to complete (or reopen) a quest; the quest window also has **Complete**, **Fail** and **Reopen** buttons, and the list's right-click menu has all of them.
- **Notes and clues**: a running log per quest showing who wrote each entry and when. Switch an entry between note and clue at any time, edit or delete your own entries, and filter the log by notes or clues.
- **Images** on quests and on notes: upload from your computer, **paste** an image straight into the text box, **drop** image files in, or (if your role may browse files) pick one already on the server. Click an image to view it full size; the GM can show it to everyone from there. Big photos are shrunk to at most 1600 px (WebP) before upload.
  Players without Foundry's *Upload new files* permission can still add images: their upload goes through the GM's client, so a GM must be online for that.
- **Search** everything: titles, quest givers, locations, rewards, tags, descriptions, objectives, related NPCs, items needed, notes, clues and note authors. Every word you type must match somewhere in the quest. Results show where the match was found, and opening a quest from a search highlights the words in it.
- **Grouping**: by *Main / side quest* (main quests first), *Chapter* (in chapter order: Chapter 2 before Chapter 10), *Where acquired*, *Where it takes place*, *Quest giver* or *Tag*. A quest with several places or tags shows up under each of them. Click a group header to collapse it.
- **Tags** keep related quests together. Click a tag in the list to show only quests with that tag; the quest window lists **related quests** that share a tag.
- **Add things from the game**:
  - Right-click a **chat message** → *Add to Quest Log…* or *Start a Quest from This*.
  - Right-click a **journal entry** in the Journal sidebar, or a **page** in a journal's table of contents, the same way.
  - **Select text** anywhere (chat, journal pages, item and actor sheets) and right-click it: add it as a note, clue or objective, start a new quest from it, or copy it. Hold **Shift** while right-clicking to get the normal menu.
  The dialog lets you pick the quest (or a new one), the kind of entry and which of the source's images to keep, and you can edit the text first. Notes remember where they came from: the link under the note opens the original message or journal page.
- **Hidden quests (GM)**: the GM can prepare quests that players can't see and reveal them later (eye button, or the *Hidden from players* box when creating one). Players get a "New quest" notification when it's revealed.
- **Hidden parts of a quest (GM)**: every part of a quest can be hidden from players on its own, while the rest of the quest stays visible:
  - each **objective** (so later stages of a quest stay secret until the party gets there), each **note**, each **clue** and each **image**: the eye button on the entry;
  - each **place** the quest takes place at: the eye button on the place, in the quest window or on its token in the edit form;
  - the **type** (main/side), the **chapter**, the **quest giver**, **where it was acquired**, the **reward**, the **description** and the **tags**: the eye button on the field, in the quest window or in the edit form.
  The eye buttons next to *Add* (objectives and items needed) and in the note box (notes and clues) make new entries start out hidden, and the *Add to Quest Log* dialog has a *Hidden from players* box. Hidden parts are dashed for the GM, and the quest list shows how many parts of a quest are hidden. Players don't see hidden parts anywhere (quest window, list, search, progress bar, grouping, related quests), and when the GM reveals one they get a notification such as *"New clue in The Missing Blacksmith"*. A player editing the quest can't overwrite a hidden field.
- **Quest Rewards**: the second view of the tab, for the things the party got and can use whenever they like (a favour, a scroll, a free night at the inn, a magic item with charges). Players and the GM add them with *New Reward*.
  - A reward has a **name**, an **image**, a **description**, the **quest it came from**, and **links** to any number of places, NPCs, factions and other things. Drop an actor, scene or journal entry on the links field to link the document (it opens from the reward window); click a link's icon to change whether it is a place, NPC, faction or other. Drop an item on the name to use its name, image and a link to it.
  - **Uses**: a reward has *No limit* (available for as long as the party plays) or a number of uses. It is received full (*5/5 uses*); **Use** (in the list, in the reward window or in the right-click menu) counts one down (*4/5*), and when none are left (*0/5*) it moves from the active rewards to the **claimed** ones. *Undo last use* takes back a misclick, *Refill* fills it again, and *Mark claimed* / *Make active again* move a reward by hand. The reward window lists who used it and when. Two players using a reward at the same moment both count.
  - The list has *Active*, *Claimed* and *All* filters, a search (names, descriptions, links and the quest), and can be grouped by *Quest*, *Place*, *NPC*, *Faction* or *Other link* (a reward with several places shows under each).
  - Right-click a reward for *Open*, *Use once*, *Undo last use*, *Refill*, *Mark claimed* / *Make active again*, *Open the quest*, *Copy reward link* (`@Reward[id]{label}` for journals and chat), *Hide from players* / *Reveal to players* (GM) and *Delete*.
  - Right-click a **chat message**, a **journal entry**, a **journal page** or an **item** in the Items sidebar → *Add as a Quest Reward…*, or select text and choose *Add selection as a quest reward…*, to open the reward form filled in from it.
  - The quest window lists the rewards that came from the quest, with an *Add Reward* button that fills in the form from the quest (its reward text, quest giver and places).
  - **When a quest is completed** and has something in its *Reward* field, the GM is asked whether to add it to the Quest Rewards (setting *Offer quest rewards on completion*). The reward text is split into items (*200 gp, 3x Potion of Healing, Wand of Webs (7 charges)*): untick what shouldn't be added, fix the names, and each item opens a reward form filled in from the quest (name, number of uses, the quest, its quest giver and places as links) for the GM to check and save. Only GMs are asked: the GM who completed the quest, or the GM in charge when a player completed it.
  - **Hidden rewards (GM)**: like quests, a reward can be hidden from players and revealed later. A reward from a hidden quest stays hidden until the quest is revealed.
- **Notes**: the third view of the tab, for anything the party wants to remember that isn't a quest: rumours, names, a map someone drew, the plan for tomorrow. Players and the GM add them with *New Note*.
  - A note has a **title**, its **text** (drop actors, items, journal entries or scenes into it to link them), **images** (upload, paste into the text, drop files, or pick one on the server), **tags**, **links** to places, NPCs, factions and other things (the same as a reward's), and optionally the **quest it is about**. A note without a quest is a *general* note.
  - Everyone can **edit** any note; the note window shows who wrote it and who last edited it. Images can also be added and removed straight from the note window without opening the edit form.
  - **Pin** a note to keep it at the top of the list (the pin on the card, or in the note window).
  - **Share** posts the note to the chat for everyone (its title, text, images and a link that opens it).
  - The list has *All*, *Pinned*, *Quests* (notes about a quest) and *General* filters, a search (titles, text, tags, links, the quest and who wrote it), can be grouped by *Quest*, *Tag*, *Written by*, *Place*, *NPC*, *Faction* or *Other link*, and clicking a tag shows only notes with that tag.
  - Right-click a note for *Open*, *Pin* / *Unpin*, *Share in chat*, *Open the quest*, *Copy note link* (`@PartyNote[id]{label}` for journals and chat), *Hide from players* / *Reveal to players* (GM) and *Delete*.
  - Right-click a **chat message**, a **journal entry** or a **journal page** → *Add as a Note…*, or select text and choose *Add selection as a note in Notes…*, to open the note form filled in from it.
  - The quest window lists the party's notes about the quest, with an *Add Note* button.
  - **Hidden notes (GM)**: a note can be hidden from players and revealed later, e.g. a handout prepared before the session. A note about a hidden quest stays hidden until the quest is revealed.
- **Notifications** when someone adds, reveals, completes, fails or reopens a quest, when a quest reward is added, revealed, used, used up, marked claimed or made active again, and when a note is added or revealed (setting).
- **Import / export (GM)**: the two buttons next to *Group by* in the Quest Log tab.
  - **Export** saves the log as a JSON file; choose which statuses to include, whether to include the quest rewards and the notes, and whether to include hidden quests, hidden rewards, hidden notes and hidden parts (left out, the file has only what players can see).
  - **Import** reads such a file and either **adds** its quests, rewards and notes to the log (one that is already in the log is replaced by the version in the file) or **replaces the whole log** (asks again before deleting anything; the rewards and the notes are replaced only when the file has them). Hidden quests, rewards and notes stay hidden.
  Author names are saved in the file, so notes imported into another world still show who wrote them. Images are saved as file paths, not embedded: copy the image folder along when moving to another server.
- **Quests that come with an adventure**: an Adventure compendium can carry a ready-made quest log. When a GM imports the adventure, its quests are added to the log, **hidden from players** (unless the adventure marks a quest as visible), ready for the GM to reveal when the party gets there. Quests that are already in the log are left as they are, so importing the adventure again never resets the party's progress (a quest you deleted comes back, though). Turn it off with *Import quests from adventures*.
  If an adventure was made from a world that used the quest log and brings the module's two data journals along, their quests are merged into this world's quest log and the extra journals are removed.
- **Quest links in journals**: write `@Quest[<quest id>]{label}` in a journal page (or chat) to link a quest; right-click a quest in the list → *Copy quest link* to get one. Clicking it opens the quest. For the GM, a link to a hidden quest is dashed and has a **Reveal** button, so an adventure's text can say *"reveal this quest now"* right where it happens. Players see a link only to quests they can see.
  One stage, objective, note or clue can be linked the same way: `@Quest[<quest id>/stages/<stage id>]{label}` (or `/objectives/`, `/notes/`, `/locations/` for a place, `/items/` for an item needed, `/npcs/` for a related NPC). For the GM a hidden part's link has an **Unhide** button. Players only ever see a part link's label, as plain text.

## Permissions

- Everyone can create quests, edit their details, add and tick objectives and items needed, add notes, clues and images.
- Players can delete only what they added themselves (quests, objectives, notes, images), unless the GM turns on *Players can delete anything*. The GM can always delete everything.
- Only the author (or the GM) can edit a note or clue in a quest's log; deleting one follows the rule above.
- Everyone can add, edit and use quest rewards; deleting one follows the same rule as quests.
- Everyone can add, edit, pin and share notes in the Notes view; deleting one (or an image on it) follows the same rule as quests.
- Hidden quests and hidden parts of quests are kept out of everything players see. Like any GM-only journal entry, a player who digs into the browser console could still read them; don't rely on it for secrets you'd hide from a determined player.

## Settings

| Setting | Scope | Default | What it does |
|---|---|---|---|
| Announce quest changes | World | On | Notification to everyone when a quest is added, revealed, completed, failed or reopened, a quest reward is added, revealed, used, used up, marked claimed or made active again, or a note is added or revealed. |
| Offer quest rewards on completion | World | On | When a quest with a reward is completed, the GM is asked whether to add it to the Quest Rewards. |
| Players can delete anything | World | Off | Off: players delete only their own quests, objectives, notes and images. |
| Import quests from adventures | World | On | Adds the quests stored in an adventure to the quest log (hidden) when a GM imports it. |
| Image folder | World | *(empty)* | Where uploads go, relative to the data folder. Empty: `worlds/<world>/quest-log`. |
| Right-click menu for selected text | Client | On | Turns the selected-text menu on or off for you. |

**Delete all quests** (GM only, a button at the top of the module's settings): deletes every quest in the log, hidden ones included (tick *Also delete all quest rewards* / *Also delete all … notes* to empty the Quest Rewards / the Notes too). You have to type `DELETE` to confirm, and the dialog has a button to export the log first. It can't be undone; uploaded image files stay in the image folder. It's only in the settings, not in the Quest Log tab, so the log can't be wiped by a stray click.

## Where the data lives

Quests, quest rewards and notes are stored in the flags of two journal entries that the module creates the first time a GM joins: *Quest Log (module data, shared)*, owned by everyone, and *Quest Log (module data, GM only)* for hidden quests, rewards and notes. Both are hidden from the Journal sidebar. Don't delete them: that deletes the quest log. They're ordinary world documents, so they're included in world backups and exports. Uploaded images are ordinary files in the image folder.

Every change is saved as a small update of just the part that changed, so several people can edit the log at the same time without overwriting each other. Each use of a reward, and each image on a note, is saved as its own entry for the same reason.

## API

`game.modules.get("dxcufgbs-quest-log").api` (set when the world is ready; see *From another module* below). Functions that change data return a Promise, so `await` them. Players can use everything not marked GM, also with no GM online.

| Function | |
|---|---|
| `open()` | Opens the Quest Log tab. |
| `openQuest(id)` / `newQuest(prefill)` | Opens a quest's window / the new-quest form (`prefill`: `title`, `questType` (`"main"`/`"side"`), `chapter`, `giver`, `acquiredAt`, `location` (one text; commas split it into places) or `locations` (`[{name, hidden}]`), `reward`, `description`, `tags`, `objectivesText` (one objective per line), `images` (paths), `hidden` (GM)). Nothing is saved until the user clicks Create. |
| `addToQuestLog({text, images, source, type, title})` | Opens the *Add to Quest Log* dialog (`type`: `note`, `clue`, `objective` or `quest`). |
| `quests()` / `getQuest(id)` | Quests the current user can see (`getQuest` returns `null` for an unknown quest, and for players for a hidden one). For players, hidden parts are left out and hidden fields come back empty. |
| `createQuest(data, {hidden})` | Creates a quest and returns its id (`null` before the quest log is set up). `data`: `title`, `questType`, `chapter`, `giver`, `acquiredAt`, `locations` (`[{name, hidden}]`; the one-text `location` of `prefill` isn't read here), `reward`, `description`, `tags`, `objectives` (a list of texts) and `images` (paths). `hidden: true` (GM) creates it hidden from players. |
| `updateQuest(id, data)`, `setStatus(id, status)`, `addObjective(id, text, {hidden, stage})`, `addItem(id, {name, uuid, img, hidden})`, `addNpc(id, {name, faceId, uuid, img, hidden})`, `addNote(id, {type, text, images, source, hidden})` | Changes a quest. `status`: `active`, `completed` or `failed`. `stage`: a stage id of the quest. `faceId`: the id of a Familiar Faces & Places NPC. `type`: `note` or `clue`; `source`: `{uuid, label}` of where it came from. `hidden` works for GMs only. The `add…` calls return the new entry's id. |
| `exportQuests()` / `importQuests(file?)` | GM: the export dialog / import from a `File` (asks for one when left out). |
| `deleteAllQuests()` | GM: the *Delete all quests* confirmation; deletes every quest when confirmed. Returns how many were deleted. |
| `convertCategoryTags()` | GM: turns *Main quest* / *Side quest* / *Chapter …* tags into the quest type and chapter (see *Main quest / Side quest* above), without asking. Returns how many quests were changed. |
| `importAdventureQuests(adventure, {notify})` | GM: adds the quests, rewards and notes stored in an Adventure (document or UUID) to the log, skipping ones already there. Returns the quest counts `{added, skipped, hidden}`, or `null` when the adventure has no quest log. `notify: false` shows no notifications. |
| `storeInAdventure(adventure, {includeHidden})` | GM: stores the world's quest log (quests, rewards and notes) in an Adventure (its compendium must be unlocked), so the adventure brings them along. `includeHidden: false` leaves out hidden quests, rewards, notes and hidden parts. Returns how many quests were stored. |
| `openRewards()` / `openReward(id)` / `newReward(prefill)` | Opens the Quest Rewards view / a reward's window / the new-reward form (`prefill`: `name`, `description`, `img`, `maxUses` (0 = no limit), `usesLeft`, `questId`, `links` (`[{type, name, uuid}]`, `type`: `place`, `npc`, `faction`, `other`), `hidden`). |
| `addAsReward({text, images, source, title})` | Opens the new-reward form filled in from a piece of text. |
| `rewards()` / `getReward(id)` | Quest rewards the current user can see (`status` `active` or `claimed`, `maxUses`, `usesLeft`, `unlimited`, `log` of uses, `links`, `questId`). |
| `createReward(data, {hidden})` / `updateReward(id, data)` / `deleteReward(id)` | Creates (returns the id), changes or deletes a reward (`data` as `prefill` above). |
| `useReward(id)`, `undoRewardUse(id)`, `refillReward(id)`, `setRewardClaimed(id, claimed)`, `setRewardHidden(id, hidden)` | Uses a reward once (the last use moves it to claimed; rewards with no limit have no uses to count), takes back the last use, fills it again, claims or restores it, hides or reveals it (GM). |
| `offerQuestRewards(questId)` | GM: asks whether to add a completed quest's reward to the Quest Rewards (what happens when a quest is completed). Does nothing unless the quest is completed and has something in its *Reward* field. |
| `openNotes()` / `openPartyNote(id)` / `newPartyNote(prefill)` | Opens the Notes view / a note's window / the new-note form (`prefill`: `title`, `text`, `tags`, `questId`, `links` (`[{type, name, uuid}]`), `images` (paths), `pinned`, `hidden`). |
| `addAsPartyNote({text, images, source, title})` | Opens the new-note form filled in from a piece of text. |
| `partyNotes()` / `getPartyNote(id)` | Notes the current user can see (`title`, `text`, `tags`, `questId`, `links`, `gallery` (`[{id, src}]`), `pinned`, `hidden`). |
| `createPartyNote(data, {hidden})` / `updatePartyNote(id, data)` / `deletePartyNote(id)` | Creates (returns the id), changes or deletes a note (`data` as `prefill` above; when changing a note, paths in `images` are added to its images). |
| `setPartyNotePinned(id, pinned)`, `setPartyNoteHidden(id, hidden)`, `addPartyNoteImages(id, paths)`, `sharePartyNote(id)` | Pins or unpins a note, hides or reveals it (GM), adds images (paths) to it, posts it to the chat (not while it is hidden). |
| `setPartHidden(id, kind, partId, hidden)` / `setFieldHidden(id, field, hidden)` | GM: hides or reveals one stage, objective, note/clue, image, place, item needed or related NPC (`kind`: `stages`, `objectives`, `notes`, `gallery`, `locations`, `items`, `npcs`) / one field (`questType`, `chapter`, `giver`, `acquiredAt`, `reward`, `description`, `tags`, or `location` for every place at once). |

The module calls no hooks of its own.

### From another module

The API is set at the end of the module's own `ready` hook, after the quest log's journals are checked, so it may not be there yet while another module's `ready` hook runs. Look it up when you need it (a button, a macro, a later hook) and make the integration optional:

```js
const questLog = game.modules.get("dxcufgbs-quest-log");
const api = questLog?.active ? questLog.api : null;
if (api) {
  const id = await api.createQuest({ title: "The Missing Blacksmith", giver: "Mayor Holt", objectives: ["Find the blacksmith"] });
  await api.addNote(id, { type: "clue", text: "Soot on the mayor's boots." });
}
```

Add `{ "id": "dxcufgbs-quest-log", "type": "module" }` to `relationships.recommends` in your `module.json`.

Read and change the log through the API, not the flags: the data journals (`flags.dxcufgbs-quest-log.store` is `"shared"` or `"secret"`) and the shape of their `quests`, `rewards` and `partyNotes` flags are internal and may change. The stable formats are the export file / adventure format below and the links: `@Quest[<id>]{label}`, `@Quest[<id>/<part kind>/<part id>]{label}`, `@Reward[<id>]{label}`, `@PartyNote[<id>]{label}`, and `@NPC[<Familiar Faces & Places NPC id>]{label}`, which links an NPC for every user who knows them in Familiar Faces & Places (plain text for everyone else, and without that module).

### Making an adventure that brings quests

An Adventure document can carry a ready-made quest log: quests, quest rewards and notes (handouts). It is stored in the
Adventure's flags, in the same format as an export file:

```json
"flags": {
  "dxcufgbs-quest-log": {
    "questLog": {
      "module": "dxcufgbs-quest-log",
      "format": 1,
      "quests": [
        { "id": "myAdvQuest000001", "hidden": true, "title": "The Missing Blacksmith",
          "questType": "main", "chapter": "Chapter 1",
          "giver": "Mayor Holt", "acquiredAt": "The Green Dragon", "reward": "200 gp", "description": "…",
          "tags": ["Blacksmith"], "hiddenFields": ["reward"],
          "locations": ["The old mine", { "name": "The smugglers' cave", "hidden": true }],
          "stages": { "s1": { "title": "The mine", "text": "…", "sort": 1 },
                      "s2": { "title": "The truth", "text": "…", "sort": 2, "hidden": true } },
          "objectives": { "o1": { "text": "Find the blacksmith", "stage": "s1", "sort": 1 },
                          "o2": { "text": "Confront the mayor", "stage": "s2", "sort": 2 } },
          "notes": { "c1": { "type": "clue", "text": "Soot on the mayor's boots.", "hidden": true } },
          "gallery": { "g1": { "src": "modules/my-adventure/images/mine.webp" } },
          "items": { "i1": { "name": "Silver key", "have": false, "sort": 1 } },
          "npcs": { "n1": { "name": "Bertha Stone", "faceId": "<Familiar Faces & Places id>", "hidden": true } } }
      ],
      "rewards": [
        { "id": "myAdvReward00001", "name": "Favour of the Harbour Guild", "maxUses": 1,
          "questId": "myAdvQuest000001", "links": [{ "type": "faction", "name": "Harbour Guild" }] }
      ],
      "partyNotes": [
        { "id": "myAdvNote0000001", "title": "The smuggler's map", "text": "…", "tags": ["Chapter 1"],
          "questId": "myAdvQuest000001", "images": ["modules/my-adventure/images/smugglers-map.webp"] }
      ]
    }
  }
}
```

**Putting it on the adventure.** The easiest way is to build the quests, rewards and notes in a world (hidden, with the
GM's quest window) and run `game.modules.get("dxcufgbs-quest-log").api.storeInAdventure(uuid)` with the adventure's
compendium unlocked. It stores the whole log, hidden entries included (they stay hidden); `{includeHidden: false}` leaves
out hidden quests, rewards, notes and hidden parts. Run it again after changing the log: it replaces what the adventure
carried. Or, when building the adventure with the Foundry CLI, paste an export file's contents into `questLog`. Images
are file paths, so keep them inside the adventure module (`modules/<your module>/…`).

**What happens on import.** When a GM imports the adventure (and *Import quests from adventures* is on), its quests,
rewards and notes are added to the log:
- Anything without `"hidden"` is imported **hidden**; set `"hidden": false` for one players should see right away. A
  reward or note whose `questId` is a hidden quest is hidden with it.
- Quests, rewards and notes already in the log (same id) are left as they are, so importing the adventure again never
  resets the party's progress or a reward's uses. Something the GM deleted comes back, though.
- If the adventure also brings the module's two data journals (it was made from a world that used the quest log), their
  contents are merged into this world's log and the extra journals are removed.

With the setting off, or to add the quests later, run `importAdventureQuests(uuid)` from the API.

**Fields.**
- Give every quest, reward and note a fixed `id` (letters and digits, up to 32): the ids are how a re-import recognises
  entries that are already in the log, and what links point to. The keys of stages, objectives, notes, images, items
  and NPCs follow the same rule and are what part links point to (lists instead of keyed objects work too, with
  generated keys).
- Quests: `"questType"` (`"main"` or `"side"`) and `"chapter"` set the categories; `"status"` is `"active"` (default),
  `"completed"` or `"failed"`. Places go in `"locations"`, as a list of names or `{"name": "…", "hidden": true}` (an old
  single `"location"` text still works). Stages are `{title, text, hidden, sort}`, with `"stage": "s1"` on their
  objectives (an objective of a hidden stage is hidden with it). Notes are `{type: "note" | "clue", text, images,
  hidden}`, images `{src, hidden}`. Items needed are `{name, have, hidden, sort}` (optionally `"uuid"` and `"img"` of a
  linked item), related NPCs `{name, faceId, hidden, sort}` (`faceId` of a Familiar Faces & Places NPC, optionally
  `"uuid"` and `"img"`). `"hiddenFields"` lists fields hidden on their own: `questType`, `chapter`, `giver`,
  `acquiredAt`, `location` (every place), `reward`, `description`, `tags`. Hidden parts and fields stay hidden after the
  quest itself is revealed, until the GM unhides them.
- Rewards: `name`, `description`, `img`, `maxUses` (0 = no limit), `questId`, and `links` (`{type: "place" | "npc" |
  "faction" | "other", name, uuid}`).
- Notes: `title`, `text`, `tags`, `questId`, `links` (as rewards), `images` (a list of paths) and `pinned`.

**Linking from the adventure's journals.** `@Quest[<quest id>]{label}` links a quest, and
`@Quest[<quest id>/objectives/<objective id>]{label}` one part of it (`/stages/`, `/notes/`, `/locations/`, `/items/`,
`/npcs/` the same way). `@Reward[<reward id>]{label}` and `@PartyNote[<note id>]{label}` link a reward and a note. For the
GM a link to something hidden is dashed and has a **Reveal** (or **Unhide**) button, so the adventure's text can say
*"reveal this quest now"* right where it happens.

## License

MIT, see [LICENSE](LICENSE).
