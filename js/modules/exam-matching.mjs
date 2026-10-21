// 大測驗連連看的規則（#611）：作答點擊和出題驗證抽成純函式，ExamRunner 與出題卡共用。
// 右欄比左欄少＝多對一（判斷沿用雲柱的 isManyToOneMatching，#588）。

// 點一個節點後更新作答 cur（{ 左id: 右id }，原地修改），回傳新的待連左邊 id。
// 一對一：右邊點被別的左邊連上時拆掉舊線；單獨點右邊點拆掉它的線。
// 多對一：右邊點可以接多條線；單獨點右邊點不做任何事（有多條線，不知道要拆哪條）。
// 兩種模式都可以「點左邊、再點它已連的右邊點」取消那一條。
export function applyExamMatchClick(cur, pending, side, id, manyToOne) {
  if (side === "L") return pending === id ? null : id;
  const usedBy = manyToOne ? null : Object.keys(cur).find((l) => cur[l] === id);
  if (pending) {
    if (cur[pending] === id) delete cur[pending];
    else { if (usedBy) delete cur[usedBy]; cur[pending] = id; }
  } else if (usedBy) delete cur[usedBy];
  return null;
}

// 出題卡存檔前的檢查，回傳錯誤訊息或 null
export function examMatchingCardError(left, right, answerKey) {
  const leftIds = new Set(left.map((x) => x.id));
  const rightIds = new Set(right.map((x) => x.id));
  const pairs = Object.entries(answerKey || {});
  if (right.length > left.length) return "連連看：右欄不能比左欄多";
  if (pairs.length !== left.length) return "連連看：正解組數要等於左欄項數";
  const badLeft = pairs.find(([l]) => !leftIds.has(l));
  if (badLeft) return `連連看：正解的左欄 id「${badLeft[0]}」不存在`;
  const badRight = pairs.find(([, r]) => !rightIds.has(r));
  if (badRight) return `連連看：正解的右欄 id「${badRight[1]}」不存在`;
  return null;
}
