/**
 * Validates a verse source string to prevent injection and malicious inputs.
 * @param {string} source
 * @returns {string} The trimmed valid verse source.
 */
export function validateVerseSource(source) {
  if (source === null || source === undefined) {
    throw new Error("Verse source cannot be null or undefined");
  }
  if (typeof source !== "string") {
    throw new Error("Verse source must be a string");
  }
  const trimmed = source.trim();
  if (trimmed === "") {
    throw new Error("Verse source cannot be empty or only whitespace");
  }
  if (trimmed.length > 512) {
    throw new Error("Verse source cannot exceed 512 characters");
  }
  return trimmed;
}
