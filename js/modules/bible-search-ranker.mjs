const DEFAULT_LIMIT = 120;

export function normalizeBibleSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function boundedEditDistance(left, right, maximum) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost
      );
      rowMinimum = Math.min(rowMinimum, current[rightIndex]);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

function hasEnoughSharedCharacters(text, query, maximumEdits) {
  const available = new Map();
  for (const character of text) available.set(character, (available.get(character) || 0) + 1);
  let shared = 0;
  for (const character of query) {
    const count = available.get(character) || 0;
    if (count > 0) {
      shared += 1;
      available.set(character, count - 1);
    }
  }
  return shared >= query.length - maximumEdits;
}

function findFuzzyDistance(text, query) {
  if (query.length < 3) return null;
  const maximumEdits = query.length <= 5 ? 1 : Math.min(2, Math.floor(query.length * 0.25));
  if (!hasEnoughSharedCharacters(text, query, maximumEdits)) return null;
  const minimumLength = Math.max(1, query.length - maximumEdits);
  const maximumLength = Math.min(text.length, query.length + maximumEdits);
  let best = maximumEdits + 1;
  for (let length = minimumLength; length <= maximumLength; length += 1) {
    for (let start = 0; start + length <= text.length; start += 1) {
      const distance = boundedEditDistance(query, text.slice(start, start + length), maximumEdits);
      if (distance < best) best = distance;
      if (best === 0) return 0;
    }
  }
  return best <= maximumEdits ? best : null;
}

function canonicalOrder(item) {
  const book = Number(item.book ?? item.bookId ?? 999);
  const chapter = Number(item.chapter || 0);
  const verse = Number(item.verse || 0);
  return (book * 1_000_000) + (chapter * 1_000) + verse;
}

export function rankBibleSearchResults(items, query, options = {}) {
  const normalizedQuery = normalizeBibleSearchText(query);
  if (!Array.isArray(items) || !normalizedQuery) return [];
  const includeFuzzy = options.includeFuzzy !== false && normalizedQuery.length >= 3;
  const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);

  return items
    .map((item, sourceIndex) => {
      const normalizedText = normalizeBibleSearchText(item?.text);
      if (!normalizedText) return null;
      const exactIndex = normalizedText.indexOf(normalizedQuery);
      if (exactIndex >= 0) {
        return { item, tier: exactIndex === 0 ? 0 : 1, detail: exactIndex, sourceIndex };
      }
      if (!includeFuzzy) return null;
      const distance = findFuzzyDistance(normalizedText, normalizedQuery);
      return distance === null ? null : { item, tier: 2, detail: distance, sourceIndex };
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.tier - right.tier
      || left.detail - right.detail
      || canonicalOrder(left.item) - canonicalOrder(right.item)
      || left.sourceIndex - right.sourceIndex
    ))
    .slice(0, limit)
    .map(({ item }) => item);
}
