import { t, plainText, escapeHTML, escapeRegExp, userInfo } from "./util.js";

/** The searchable parts of a quest, each with a label for the result snippet. */
function fields(quest) {
  const out = [
    { label: t("Field.Title"), text: quest.title },
    { label: t("Field.Giver"), text: quest.giver },
    { label: t("Field.AcquiredAt"), text: quest.acquiredAt },
    { label: t("Field.Location"), text: quest.location },
    { label: t("Field.Chapter"), text: quest.chapter },
    { label: t("Field.QuestType"), text: quest.questType ? t(`QuestType.${quest.questType}`) : "" },
    { label: t("Field.Reward"), text: quest.reward },
    { label: t("Field.Tags"), text: quest.tags.join(", ") },
    { label: t("Field.Description"), text: plainText(quest.description) }
  ];
  for (const s of quest.stages ?? []) out.push({ label: t("Stage"), text: [s.title, plainText(s.text)].filter(Boolean).join(" — ") });
  for (const o of quest.objectives) out.push({ label: t("Field.Objective"), text: o.text });
  for (const n of quest.notes) {
    out.push({
      label: n.type === "clue" ? t("Clue") : t("Note"),
      text: [plainText(n.text), n.source?.label].filter(Boolean).join(" — "),
      author: userInfo(n.createdBy, n.authorName).name
    });
  }
  return out;
}

/** The searchable parts of a reward. questTitle: the title of the quest it came from (if the user can see it). */
function rewardFields(reward, questTitle) {
  return [
    { label: t("Reward.Field.Name"), text: reward.name },
    { label: t("Reward.Field.Quest"), text: questTitle ?? "" },
    { label: t("Reward.Field.Links"), text: reward.links.map(l => l.name).join(", ") },
    { label: t("Field.Description"), text: plainText(reward.description) }
  ];
}

/** Like matchQuest, for a reward. */
export function matchReward(reward, terms, questTitle = "") {
  return matchParts(rewardFields(reward, questTitle), reward.name, terms);
}

/** The searchable parts of a party note. questTitle: the title of the quest it is about (if the user can see it). */
function partyNoteFields(note, questTitle) {
  return [
    { label: t("PartyNote.Field.Title"), text: note.title },
    { label: t("PartyNote.Field.Quest"), text: questTitle ?? "" },
    { label: t("PartyNote.Field.Links"), text: note.links.map(l => l.name).join(", ") },
    { label: t("Field.Tags"), text: note.tags.join(", ") },
    { label: t("PartyNote.Field.Text"), text: plainText(note.text), author: userInfo(note.createdBy, note.authorName).name }
  ];
}

/** Like matchQuest, for a party note. */
export function matchPartyNote(note, terms, questTitle = "") {
  return matchParts(partyNoteFields(note, questTitle), note.title, terms);
}

export function tokenize(query) {
  return String(query ?? "").toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Matches a quest against a query: every word must appear somewhere in the quest (title, details, tags,
 * description, objectives, notes, clues or note authors). Returns null, or {snippet} where snippet is HTML.
 */
export function matchQuest(quest, terms) {
  return matchParts(fields(quest), quest.title, terms);
}

/** Every term must appear in one of the parts (the first part is the title). */
function matchParts(parts, title, terms) {
  if (!terms.length) return { snippet: "" };
  const haystack = parts.map(p => `${p.text} ${p.author ?? ""}`).join("\n").toLowerCase();
  if (!terms.every(term => haystack.includes(term))) return null;

  // The title already shows; show where else the first matching word was found.
  if (terms.every(term => title.toLowerCase().includes(term))) return { snippet: "" };
  let best = null;
  let bestCount = 0;
  for (const part of parts.slice(1)) {
    const lower = part.text.toLowerCase();
    const count = terms.filter(term => lower.includes(term)).length;
    if (count > bestCount) {
      best = part;
      bestCount = count;
    }
  }
  if (!best) return { snippet: "" };
  return { snippet: `<b>${escapeHTML(best.label)}:</b> ${highlight(excerpt(best.text, terms), terms)}` };
}

function excerpt(text, terms, radius = 60) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let index = -1;
  for (const term of terms) {
    index = lower.indexOf(term);
    if (index >= 0) break;
  }
  if (index < 0 || flat.length <= radius * 2) return flat;
  const start = Math.max(0, index - radius);
  const end = Math.min(flat.length, index + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** Escapes text and wraps every search term in <mark>. */
export function highlight(text, terms) {
  const safe = escapeHTML(text);
  if (!terms.length) return safe;
  const pattern = new RegExp(`(${terms.map(term => escapeRegExp(escapeHTML(term))).join("|")})`, "gi");
  return safe.replace(pattern, "<mark>$1</mark>");
}

/** Marks search terms inside rendered HTML (text nodes only), used when a quest is opened from a search. */
export function markTerms(root, terms) {
  if (!root || !terms.length) return;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const parent = node.parentElement;
      if (!parent || parent.closest("input, textarea, mark, button, script, style, .dxql-no-mark")) return NodeFilter.FILTER_REJECT;
      pattern.lastIndex = 0;
      return pattern.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    pattern.lastIndex = 0;
    const span = document.createElement("span");
    span.innerHTML = escapeHTML(node.nodeValue).replace(pattern, "<mark class=\"dxql-hit\">$1</mark>");
    node.replaceWith(...span.childNodes);
  }
}
