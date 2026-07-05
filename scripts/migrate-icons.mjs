#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const biToKey = {
  "bi-fire": "fire",
  "bi-book-half": "bookOpen",
  "bi-graph-up-arrow": "trendTwo",
  "bi-calendar-check": "calendarCheck",
  "bi-calendar3": "calendarThirty",
  "bi-calendar-event": "calendarEvent",
  "bi-arrow-repeat": "refresh",
  "bi-hourglass-split": "hourglass",
  "bi-people-fill": "peoples",
  "bi-people": "people",
  "bi-lightning-charge": "lightning",
  "bi-check-circle": "checkOne",
  "bi-check2-circle": "checkOne",
  "bi-trophy": "trophy",
  "bi-bar-chart": "barChart",
  "bi-person-bounding-box": "personBox",
  "bi-search": "search",
  "bi-pencil": "edit",
  "bi-stars": "star",
  "bi-plus-lg": "plus",
  "bi-plus": "plus",
  "bi-gear": "setting",
  "bi-box-arrow-right": "logout",
  "bi-heart": "heart",
  "bi-heart-fill": "heartFill",
  "bi-share": "share",
  "bi-megaphone": "megaphone",
  "bi-lock-fill": "lockFill",
  "bi-lock": "lock",
  "bi-chevron-left": "chevronLeft",
  "bi-chevron-right": "chevronRight",
  "bi-chevron-up": "chevronUp",
  "bi-list": "list",
  "bi-volume-up": "volumeNotice",
  "bi-three-dots": "more",
  "bi-x-lg": "closeLg",
  "bi-x-circle-fill": "closeOne",
  "bi-eraser": "eraser",
  "bi-grid-3x3-gap-fill": "gridFour",
  "bi-list-ul": "unorderedList",
  "bi-trash": "trash",
  "bi-journal-text": "journalText",
  "bi-exclamation-circle": "exclamationCircle",
  "bi-book": "bookOpen",
  "bi-calendar-plus": "calendarPlus",
  "bi-award": "award",
  "bi-skip-forward": "skipForward",
  "bi-shield-check": "shieldCheck",
  "bi-signpost-split": "signpost",
};

function migrateContent(content) {
  return content.replace(/<i class="bi (bi-[a-z0-9-]+)([^"]*)"([^>]*)><\/i>/g, (match, cls, extraClasses, tailAttrs) => {
    const key = biToKey[cls];
    if (!key) return match;
    let className = "nlc-icon";
    if (extraClasses) className += extraClasses;
    return `<span class="${className}" data-icon="${key}"${tailAttrs}></span>`;
  });
}

function migrateFile(relPath) {
  const abs = join(root, relPath);
  const next = migrateContent(readFileSync(abs, "utf8"));
  writeFileSync(abs, next, "utf8");
}

const files = [
  "index.html",
  "js/views/dashboard.js",
  "js/views/plan.js",
  "js/gamification.js",
  "js/utils.js",
];

for (const file of files) migrateFile(file);
console.log("migrated", files.length, "files");
