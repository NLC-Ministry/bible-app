// 小測驗／大測驗共用的「題型一～五」定義：資料形狀、渲染、DOM 綁定、正確性比對。
// 純函式模組，不依賴 window/state，方便兩邊呼叫也方便單元測試。
//
// 題目正規化後的形狀（跟 exam_questions.payload / answer_key 同一套慣例）：
//   { id, type, payload: {...}, answerKey, explanation, verseRef }
// 作答回應（response）依題型：
//   truefalse  boolean
//   single     number（選項索引）
//   multiple   number[]（選項索引，順序無關）
//   matching   { [leftId]: rightId }
//   ordering   string[]（item id 依作答排列順序）

export const QUESTION_TYPES = ["truefalse", "single", "multiple", "matching", "ordering"];

export const QUESTION_TYPE_LABELS = {
  truefalse: "是非",
  single: "單選",
  multiple: "多選",
  matching: "配對",
  ordering: "排序"
};

export function isSupportedQuestionType(type) {
  return QUESTION_TYPES.includes(type);
}

/** 把一個作答結果轉成人看得懂的文字，給完成後的檢討畫面用。response 為 null/undefined 時顯示「未作答」。 */
export function formatResponseForDisplay(type, payload, response) {
  if (response == null) return "未作答";
  switch (type) {
    case "truefalse":
      return response ? "對" : "錯";
    case "single":
      return (payload.options || [])[response] ?? "未作答";
    case "multiple": {
      const labels = (Array.isArray(response) ? response : []).map(index => (payload.options || [])[index]).filter(Boolean);
      return labels.length ? labels.join("、") : "未作答";
    }
    case "matching": {
      const leftText = id => (payload.left || []).find(item => item.id === id)?.text ?? id;
      const rightText = id => (payload.right || []).find(item => item.id === id)?.text ?? id;
      const pairs = Object.entries(response || {}).map(([leftId, rightId]) => `${leftText(leftId)}→${rightText(rightId)}`);
      return pairs.length ? pairs.join("、") : "未作答";
    }
    case "ordering": {
      const text = id => (payload.items || []).find(item => item.id === id)?.text ?? id;
      const order = Array.isArray(response) ? response.map(text) : [];
      return order.length ? order.join(" → ") : "未作答";
    }
    default:
      return "未作答";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
    return aKeys.every(key => deepEqual(a[key], b[key]));
  }
  return false;
}

export function shuffleItems(items, random = Math.random) {
  const shuffled = Array.isArray(items) ? [...items] : [];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

/**
 * 同一個 seed 永遠產生同一串亂數（FNV-1a 雜湊 + mulberry32），讓同一位會友
 * 重新整理／續答時選項順序不會跳動；不同會友 seed 不同，順序也就不同。
 * seed 為空時退回 Math.random（後台預覽每次看不同排列）。
 */
export function createSeededRandom(seed) {
  if (seed == null || seed === "") return Math.random;
  let state = 0x811c9dc5;
  for (const character of String(seed)) {
    state ^= character.codePointAt(0);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 洗幾次、留「送分程度」最低的那一種；score 為 0 就提早收工。
function pickLeastGivenAway(length, random, score, attempts = 50) {
  const indices = Array.from({ length }, (_, index) => index);
  let best = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < attempts && bestScore > 0; attempt += 1) {
    const candidate = shuffleItems(indices, random);
    const candidateScore = score(candidate);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best || indices;
}

// 排序題：payload.items 是照正解順序存的（三個出題來源都是 answerKey = items.map(id)）。
// 一開始的排列不能有任何項目已經在正確位置，其次盡量少出現「前後兩項已經接對」。
export function arrangeOrderingItems(items, random = Math.random) {
  const list = Array.isArray(items) ? items : [];
  const order = pickLeastGivenAway(list.length, random, permutation => {
    let fixed = 0;
    let adjacent = 0;
    permutation.forEach((original, position) => {
      if (original === position) fixed += 1;
      if (position > 0 && permutation[position - 1] + 1 === original) adjacent += 1;
    });
    return fixed * list.length + adjacent;
  });
  return order.map(index => list[index]);
}

// 配對題：payload 慣例是 left[i] 配 right[i]。左欄照常打亂，右欄再排成
// 盡量沒有任何一列「左右兩格剛好是一對」。
export function arrangeMatchingColumns(left, right, random = Math.random) {
  const leftList = Array.isArray(left) ? left : [];
  const rightList = Array.isArray(right) ? right : [];
  const leftOrder = shuffleItems(leftList.map((_, index) => index), random);
  const rightOrder = pickLeastGivenAway(rightList.length, random, permutation =>
    permutation.filter((original, row) => original === leftOrder[row]).length);
  return {
    left: leftOrder.map(index => leftList[index]),
    right: rightOrder.map(index => rightList[index])
  };
}

/**
 * 把題目轉成統一的型別化格式。已經是新格式的原樣通過（驗證 type 合法）；
 * 舊版 AI 產生的純單選格式 {id, question, options, correctIndex, explanation, verseRef}
 * 自動轉換成 { type:'single', payload:{stem, options}, answerKey:correctIndex }，
 * 讓舊資料在新的渲染/判分邏輯下照樣能用。
 */
export function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") throw new Error("invalid_question");

  if (raw.type) {
    if (!isSupportedQuestionType(raw.type)) throw new Error(`unsupported_question_type:${raw.type}`);
    if (!raw.payload || typeof raw.payload !== "object") throw new Error("invalid_question_payload");
    return {
      id: String(raw.id ?? ""),
      type: raw.type,
      payload: raw.payload,
      answerKey: raw.answerKey !== undefined ? raw.answerKey : (raw.answer_key ?? null),
      explanation: raw.explanation || "",
      verseRef: raw.verseRef || ""
    };
  }

  // 注意：伺服器（quiz_questions_for_member）在作答前會把 correctIndex 拿掉
  // 才回傳給會友，所以不能拿 correctIndex 存不存在當作「是不是舊格式」的判斷
  // 依據——只能靠 options/question 這兩個一定會在的欄位辨認。
  if (Array.isArray(raw.options) && typeof raw.question === "string") {
    return {
      id: String(raw.id ?? ""),
      type: "single",
      payload: { stem: raw.question, options: raw.options.map(String) },
      answerKey: Number.isInteger(raw.correctIndex) ? raw.correctIndex : null,
      explanation: raw.explanation || "",
      verseRef: raw.verseRef || ""
    };
  }

  throw new Error("unrecognized_question_shape");
}

/** 這次作答是否已經填完（可以進下一題/送出），不判斷對錯。 */
export function isResponseComplete(type, response, payload = {}) {
  switch (type) {
    case "truefalse":
      return response === true || response === false;
    case "single":
      return Number.isInteger(response) && response >= 0;
    case "multiple":
      return Array.isArray(response) && response.length > 0;
    case "matching": {
      const expected = Array.isArray(payload.left) ? payload.left.length : 0;
      return response && typeof response === "object" && !Array.isArray(response)
        && Object.keys(response).length === expected
        && Object.values(response).every(value => value != null && value !== "");
    }
    case "ordering": {
      const expected = Array.isArray(payload.items) ? payload.items.length : 0;
      return Array.isArray(response) && response.length === expected;
    }
    default:
      return false;
  }
}

/**
 * 跟 SQL 端 public._quiz_answer_is_correct 邏輯一致的客戶端鏡射版本，
 * 只用來做即時 UI 回饋；正式分數一律以伺服器判定為準。
 */
export function isAnswerCorrect(type, answerKey, response) {
  if (answerKey == null || response == null) return false;
  if (type === "truefalse" || type === "single" || type === "matching" || type === "ordering") {
    return deepEqual(answerKey, response);
  }
  if (type === "multiple") {
    const a = Array.isArray(answerKey) ? [...answerKey].sort() : [];
    const b = Array.isArray(response) ? [...response].sort() : [];
    return a.length === b.length && a.every((value, index) => String(value) === String(b[index]));
  }
  return false;
}

// 顯示順序打亂，但 value 仍是原本的選項索引——作答格式、判分、檢討畫面都不受影響。
function renderOptionsList(id, options, multiple, random) {
  const inputType = multiple ? "checkbox" : "radio";
  const name = multiple ? `q-${id}[]` : `q-${id}`;
  const indexed = (options || []).map((option, optionIndex) => ({ option, optionIndex }));
  return `<div class="daily-quiz-options">
    ${shuffleItems(indexed, random).map(({ option, optionIndex }) => `
      <label><input type="${inputType}" name="${escapeHtml(name)}" value="${optionIndex}"><span>${escapeHtml(option)}</span></label>
    `).join("")}
  </div>`;
}

// 排序題沿用大測驗「事件排序」的積木（index.css 的 .exam-order-*）：待排序區打亂、
// 作答區一開始是空的；點一下加入作答區，也可以拖進作答區指定位置、在作答區內
// 拖動換位、拖回待排序區或按 ✕ 移回。
const ORDER_EMPTY_ANSWER = "拖曳項目到這裡排序";
const ORDER_EMPTY_POOL = "已全部放入作答區";

function orderChipHtml(item, answerIndex) {
  const inAnswer = answerIndex != null;
  return `<div class="exam-order-chip" data-item-id="${escapeHtml(item.id)}" data-pool-index="${item.poolIndex}">
    ${inAnswer ? `<span class="exam-order-num">${answerIndex + 1}</span>` : '<span class="exam-order-chip__grip">⠿</span>'}
    <span class="exam-order-chip__text">${escapeHtml(item.text)}</span>
    ${inAnswer ? '<button type="button" class="exam-chip-remove" aria-label="移回待排序">✕</button>' : ""}
  </div>`;
}

function orderZoneHtml(chipsHtml, emptyText) {
  return chipsHtml.length ? chipsHtml.join("") : `<span class="exam-order-empty">${emptyText}</span>`;
}

/**
 * 渲染一題的 <fieldset> HTML；不含送出按鈕（由呼叫端的表單負責）。
 * options.shuffleSeed：同一個 seed（通常是會友 id + 當天測驗）重畫時選項順序不變；
 * 不給則每次隨機。
 */
export function renderQuestionFieldsetHtml(question, index, { shuffleSeed } = {}) {
  const { id, type, payload } = question;
  const random = createSeededRandom(shuffleSeed ? `${shuffleSeed}:${id}` : null);
  const legend = `${index + 1}. ${escapeHtml(payload.stem)}`;
  const body = (() => {
    switch (type) {
      case "truefalse":
        return `<div class="daily-quiz-options daily-quiz-options--truefalse">
          <label><input type="radio" name="q-${escapeHtml(id)}" value="true"><span>對</span></label>
          <label><input type="radio" name="q-${escapeHtml(id)}" value="false"><span>錯</span></label>
        </div>`;
      case "single":
        return renderOptionsList(id, payload.options, false, random);
      case "multiple":
        return renderOptionsList(id, payload.options, true, random);
      case "matching": {
        // 連線用的 SVG 不寫死在樣板裡，改由 bindQuestionFieldset 用
        // document.createElementNS 動態插入（跟 exam.js 連連看同一招）——
        // 設計系統的 icon-audit 測試會擋下 Lucide 註冊表以外的行內 SVG。
        // 左欄用 CSS flex-direction: row-reverse 把連線點翻到右側（貼著中間
        // 欄間），跟大測驗連連看（.exam-match-col--left .exam-match-node）同一
        // 招——這樣連線點永遠在兩欄的內側，線不會畫過自己這顆按鈕的文字上面。
        const columns = arrangeMatchingColumns(payload.left, payload.right, random);
        return `<div class="daily-quiz-matching" data-matching-root>
          <div class="daily-quiz-matching-col" data-side="left">
            ${columns.left.map(item => `<button type="button" class="daily-quiz-match-item" data-left-id="${escapeHtml(item.id)}"><span class="daily-quiz-match-dot" aria-hidden="true"></span><span class="daily-quiz-match-item__label">${escapeHtml(item.text)}</span></button>`).join("")}
          </div>
          <div class="daily-quiz-matching-col" data-side="right">
            ${columns.right.map(item => `<button type="button" class="daily-quiz-match-item" data-right-id="${escapeHtml(item.id)}"><span class="daily-quiz-match-dot" aria-hidden="true"></span><span class="daily-quiz-match-item__label">${escapeHtml(item.text)}</span></button>`).join("")}
          </div>
        </div>`;
      }
      case "ordering": {
        const pool = arrangeOrderingItems(payload.items, random)
          .map((item, poolIndex) => ({ id: item.id, text: item.text, poolIndex }));
        return `<div class="daily-quiz-ordering" data-ordering-root>
          <p class="exam-order-hint">把下方項目拖進「作答區」，並在作答區內拖動調整順序（點一下也可加入）。</p>
          <div class="exam-order-answer" data-order-answer>${orderZoneHtml([], ORDER_EMPTY_ANSWER)}</div>
          <p class="exam-order-sub">待排序項目</p>
          <div class="exam-order-pool" data-order-pool>${orderZoneHtml(pool.map(item => orderChipHtml(item)), ORDER_EMPTY_POOL)}</div>
        </div>`;
      }
      default:
        return "";
    }
  })();

  return `<fieldset class="daily-quiz-question" data-question-id="${escapeHtml(id)}" data-question-type="${escapeHtml(type)}">
    <legend>${legend}</legend>
    ${body}
  </fieldset>`;
}

/** 從已經渲染好的 fieldset 讀出目前的作答狀態（不觸發事件，單純讀 DOM）。 */
export function readResponseFromFieldset(fieldsetEl, type) {
  if (!fieldsetEl) return null;
  switch (type) {
    case "truefalse": {
      const checked = fieldsetEl.querySelector("input[type=radio]:checked");
      return checked ? checked.value === "true" : null;
    }
    case "single": {
      const checked = fieldsetEl.querySelector("input[type=radio]:checked");
      return checked ? Number(checked.value) : null;
    }
    case "multiple": {
      const checked = Array.from(fieldsetEl.querySelectorAll("input[type=checkbox]:checked"));
      return checked.map(input => Number(input.value));
    }
    case "matching": {
      const pairs = {};
      fieldsetEl.querySelectorAll("[data-left-id]").forEach(button => {
        const rightId = button.getAttribute("data-paired-with");
        if (rightId) pairs[button.getAttribute("data-left-id")] = rightId;
      });
      return pairs;
    }
    case "ordering": {
      return Array.from(fieldsetEl.querySelectorAll("[data-order-answer] [data-item-id]")).map(chip => chip.getAttribute("data-item-id"));
    }
    default:
      return null;
  }
}

/**
 * 綁定一題的互動事件；每次作答狀態變動都呼叫 onChange(response)。
 * 回傳一個 unbind 函式（目前元素會整份重繪，通常不需要主動呼叫，保留給呼叫端需要時用）。
 */
export function bindQuestionFieldset(fieldsetEl, type, onChange) {
  if (!fieldsetEl || typeof onChange !== "function") return () => {};

  const emit = () => onChange(readResponseFromFieldset(fieldsetEl, type));

  if (type === "truefalse" || type === "single" || type === "multiple") {
    fieldsetEl.addEventListener("change", emit);
    return () => fieldsetEl.removeEventListener("change", emit);
  }

  if (type === "matching") {
    let selectedLeft = null;
    const matchingRoot = fieldsetEl.querySelector("[data-matching-root]");
    const SVG_NS = "http://www.w3.org/2000/svg";
    const drawLines = () => {
      if (!matchingRoot) return;
      let svg = matchingRoot.querySelector(".daily-quiz-match-lines");
      if (!svg) {
        svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "daily-quiz-match-lines");
        svg.setAttribute("aria-hidden", "true");
        matchingRoot.insertBefore(svg, matchingRoot.firstChild);
      }
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const rootRect = matchingRoot.getBoundingClientRect();
      fieldsetEl.querySelectorAll("[data-left-id][data-paired-with]").forEach(leftButton => {
        const rightId = leftButton.getAttribute("data-paired-with");
        const rightButton = Array.from(fieldsetEl.querySelectorAll("[data-right-id]"))
          .find(button => button.getAttribute("data-right-id") === rightId);
        if (!rightButton) return;
        const leftRect = leftButton.querySelector(".daily-quiz-match-dot")?.getBoundingClientRect() || leftButton.getBoundingClientRect();
        const rightRect = rightButton.querySelector(".daily-quiz-match-dot")?.getBoundingClientRect() || rightButton.getBoundingClientRect();
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(leftRect.left + leftRect.width / 2 - rootRect.left));
        line.setAttribute("y1", String(leftRect.top + leftRect.height / 2 - rootRect.top));
        line.setAttribute("x2", String(rightRect.left + rightRect.width / 2 - rootRect.left));
        line.setAttribute("y2", String(rightRect.top + rightRect.height / 2 - rootRect.top));
        line.setAttribute("class", "daily-quiz-match-line");
        svg.appendChild(line);
      });
    };
    const onClick = event => {
      const leftButton = event.target.closest("[data-left-id]");
      const rightButton = event.target.closest("[data-right-id]");
      if (leftButton) {
        if (leftButton.hasAttribute("data-paired-with")) {
          const rightId = leftButton.getAttribute("data-paired-with");
          leftButton.removeAttribute("data-paired-with");
          leftButton.classList.remove("is-paired");
          Array.from(fieldsetEl.querySelectorAll("[data-right-id]"))
            .find(button => button.getAttribute("data-right-id") === rightId)
            ?.classList.remove("is-paired");
          selectedLeft = null;
          emit();
          drawLines();
          return;
        }
        fieldsetEl.querySelectorAll("[data-left-id]").forEach(button => button.classList.remove("is-selected"));
        selectedLeft = leftButton;
        leftButton.classList.add("is-selected");
        return;
      }
      if (rightButton && selectedLeft) {
        const rightId = rightButton.getAttribute("data-right-id");
        Array.from(fieldsetEl.querySelectorAll("[data-paired-with]"))
          .filter(button => button.getAttribute("data-paired-with") === rightId)
          .forEach(button => {
            button.removeAttribute("data-paired-with");
            button.classList.remove("is-paired");
          });
        selectedLeft.setAttribute("data-paired-with", rightId);
        selectedLeft.classList.remove("is-selected");
        selectedLeft.classList.add("is-paired");
        rightButton.classList.add("is-paired");
        selectedLeft = null;
        emit();
        drawLines();
      }
    };
    fieldsetEl.addEventListener("click", onClick);
    window.addEventListener("resize", drawLines);
    drawLines();
    return () => {
      fieldsetEl.removeEventListener("click", onClick);
      window.removeEventListener("resize", drawLines);
    };
  }

  if (type === "ordering") {
    const root = fieldsetEl.querySelector("[data-ordering-root]");
    const answerZone = root?.querySelector("[data-order-answer]");
    const poolZone = root?.querySelector("[data-order-pool]");
    if (!root || !answerZone || !poolZone) return () => {};

    const items = new Map(Array.from(poolZone.querySelectorAll("[data-item-id]")).map(chip => {
      const id = chip.getAttribute("data-item-id");
      return [id, {
        id,
        text: chip.querySelector(".exam-order-chip__text")?.textContent ?? "",
        poolIndex: Number(chip.getAttribute("data-pool-index"))
      }];
    }));
    const placed = [];
    const repaint = () => {
      answerZone.innerHTML = orderZoneHtml(placed.map((id, k) => orderChipHtml(items.get(id), k)), ORDER_EMPTY_ANSWER);
      const pool = [...items.values()].filter(item => !placed.includes(item.id)).sort((a, b) => a.poolIndex - b.poolIndex);
      poolZone.innerHTML = orderZoneHtml(pool.map(item => orderChipHtml(item)), ORDER_EMPTY_POOL);
      emit();
    };

    let drag = null;
    const zoneAt = (x, y) => document.elementFromPoint?.(x, y)?.closest("[data-order-answer], [data-order-pool]") || null;
    const indexAt = (zone, y, skipId) => {
      const chips = Array.from(zone.querySelectorAll("[data-item-id]")).filter(chip => chip.getAttribute("data-item-id") !== skipId);
      const index = chips.findIndex(chip => {
        const rect = chip.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      });
      return index === -1 ? chips.length : index;
    };
    const onPointerDown = event => {
      const chip = event.target.closest("[data-item-id]");
      if (!chip || event.target.closest(".exam-chip-remove")) return;
      event.preventDefault();
      const rect = chip.getBoundingClientRect();
      drag = {
        chip, id: chip.getAttribute("data-item-id"), fromPool: !!chip.closest("[data-order-pool]"),
        startX: event.clientX, startY: event.clientY, dx: event.clientX - rect.left, dy: event.clientY - rect.top,
        width: rect.width, moved: false, ghost: null
      };
      try { chip.setPointerCapture(event.pointerId); } catch (_) {}
    };
    const onPointerMove = event => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        const ghost = drag.chip.cloneNode(true);
        ghost.removeAttribute("data-item-id");
        ghost.classList.add("is-ghost");
        ghost.style.width = `${drag.width}px`;
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        drag.chip.classList.add("is-placeholder");
      }
      drag.ghost.style.left = `${event.clientX - drag.dx}px`;
      drag.ghost.style.top = `${event.clientY - drag.dy}px`;
    };
    const onPointerEnd = event => {
      if (!drag) return;
      const { id, fromPool, moved, ghost } = drag;
      drag = null;
      ghost?.remove();
      const current = placed.indexOf(id);
      if (!moved) {
        if (!fromPool) return;
        placed.push(id);
      } else {
        const zone = zoneAt(event.clientX, event.clientY);
        if (zone === answerZone) {
          const index = indexAt(zone, event.clientY, id);
          if (current !== -1) placed.splice(current, 1);
          placed.splice(index, 0, id);
        } else if (zone === poolZone && current !== -1) {
          placed.splice(current, 1);
        }
      }
      repaint();
    };
    const onClick = event => {
      const removeButton = event.target.closest(".exam-chip-remove");
      if (!removeButton) return;
      const index = placed.indexOf(removeButton.closest("[data-item-id]")?.getAttribute("data-item-id"));
      if (index === -1) return;
      placed.splice(index, 1);
      repaint();
    };
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerEnd);
    root.addEventListener("pointercancel", onPointerEnd);
    root.addEventListener("click", onClick);
    return () => {
      drag?.ghost?.remove();
      drag = null;
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerEnd);
      root.removeEventListener("pointercancel", onPointerEnd);
      root.removeEventListener("click", onClick);
    };
  }

  return () => {};
}
