export const AUTH_POLICY_VERSION = 1;
export const AUTH_CONTINUATION_MAX_LENGTH = 1024;

const VALID_INTENTS = new Set([
  "login",
  "register",
  "account_center",
  "step_up",
  "reconnect_identity",
  "satellite_sso"
]);

const VALID_ACCOUNT_CENTER_TARGETS = new Set([
  "profile",
  "username",
  "email",
  "phone",
  "password",
  "passkeys",
  "security"
]);

const FLOW_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE_URL = "https://example.com";

function getSecureRandomBytes(byteLength) {
  const cryptoApi = globalThis.crypto || globalThis.msCrypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Secure random values are not available in this environment.");
  }
  const bytes = new Uint8Array(byteLength);
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function toBase32(value, length) {
  let remaining = value;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out = FLOW_ID_ALPHABET[(remaining >>> 0) % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out.replace(/[^0-9A-Z]/g, "0");
}

function encodeUlidSuffix() {
  const randomValues = getSecureRandomBytes(16);
  let carry = 0;
  let bits = 0;
  let out = "";

  for (let i = 0; i < randomValues.length; i += 1) {
    carry = (carry << 8) | randomValues[i];
    bits += 8;
    while (bits >= 5) {
      out += FLOW_ID_ALPHABET[(carry >>> (bits - 5)) & 31];
      bits -= 5;
      carry &= (1 << bits) - 1;
    }
  }

  if (bits > 0) {
    out += FLOW_ID_ALPHABET[(carry << (5 - bits)) & 31];
  }

  return out.slice(0, 16).padEnd(16, "0");
}

function encodeTimestampUlid() {
  const time = BigInt(Date.now());
  let value = time;
  let out = "";

  for (let i = 0; i < 10; i += 1) {
    const mod = Number(value % 32n);
    out = FLOW_ID_ALPHABET[mod] + out;
    value = value / 32n;
  }

  while (out.length < 10) {
    out = `0${out}`;
  }

  return out;
}

function generateFlowId() {
  return `${encodeTimestampUlid()}${encodeUlidSuffix()}`;
}

function isBlank(value) {
  return typeof value !== "string" || !value.trim();
}

function cleanBrowserContextReturnTo(raw = "") {
  if (isBlank(raw)) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";

  const normalized = raw.trim();
  if (normalized.length > 512) return "/";
  if (/(^|\/)\.\.(\/|$)/.test(normalized)) return "/";

  let parsed;
  try {
    parsed = new URL(normalized, BASE_URL);
  } catch {
    return "/";
  }

  if (parsed.origin !== "https://example.com") return "/";

  const path = parsed.pathname;
  const normalizedPath = path
    .split("/")
    .filter(Boolean)
    .reduce((acc, segment) => {
      if (segment === ".") return acc;
      if (segment === "..") return null;
      acc.push(segment);
      return acc;
    }, []);

  if (normalizedPath === null) return "/";

  const outputPath = `/${normalizedPath.join("/")}${parsed.pathname.endsWith("/") && parsed.pathname !== "/" ? "/" : ""}`;
  return `${outputPath}${parsed.search}${parsed.hash}`;
}

export function stripAuthTransportParams(rawUrl = "") {
  const url = new URL(rawUrl, BASE_URL);
  url.searchParams.delete("openExternalBrowser");
  url.searchParams.delete("auth_bridge_attempted");
  url.searchParams.delete("auth_continuation");
  return `${url.pathname}${url.search ? `?${url.searchParams}` : ""}${url.hash}`;
}

export function createAuthContinuation({
  intent,
  returnTo = "/",
  target = null
}) {
  const safeIntent = String(intent || "");
  if (!VALID_INTENTS.has(safeIntent)) {
    throw new Error(`Invalid auth intent: ${safeIntent}`);
  }

  let safeTarget;
  if (target !== null && target !== undefined) {
    const normalizedTarget = String(target);
    if (!VALID_ACCOUNT_CENTER_TARGETS.has(normalizedTarget)) {
      throw new Error(`Invalid account center target: ${normalizedTarget}`);
    }
    safeTarget = normalizedTarget;
  }

  const continuation = {
    version: AUTH_POLICY_VERSION,
    flowId: generateFlowId(),
    intent: safeIntent,
    returnTo: cleanBrowserContextReturnTo(returnTo)
  };

  if (safeTarget) {
    continuation.target = safeTarget;
  }

  return continuation;
}

export function parseAuthContinuation(value) {
  if (isBlank(value)) return null;

  let parsed;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;

  const version = Number(parsed.version);
  if (Number.isNaN(version) || version !== AUTH_POLICY_VERSION) return null;

  if (!VALID_INTENTS.has(String(parsed.intent))) return null;
  if (typeof parsed.flowId !== "string" || parsed.flowId.length !== 26) return null;
  if (!/^[0-9A-Z]{26}$/.test(parsed.flowId)) return null;
  if (typeof parsed.returnTo !== "string") return null;

  const continuation = {
    version,
    flowId: parsed.flowId,
    intent: String(parsed.intent),
    returnTo: cleanBrowserContextReturnTo(parsed.returnTo)
  };

  if (parsed.target !== undefined) {
    if (!VALID_ACCOUNT_CENTER_TARGETS.has(String(parsed.target))) return null;
    continuation.target = String(parsed.target);
  }

  return continuation;
}

export function parseContinuationFromSearchParams(search) {
  const params = new URLSearchParams(search);
  return parseAuthContinuation(params.get("auth_continuation"));
}

export function serializeAuthContinuation(continuation) {
  if (!continuation || continuation.version !== AUTH_POLICY_VERSION) return "";

  const clean = {
    version: continuation.version,
    intent: continuation.intent,
    returnTo: cleanBrowserContextReturnTo(continuation.returnTo),
    flowId: continuation.flowId,
    target: continuation.target
  };

  return encodeURIComponent(JSON.stringify(clean));
}

export function validateContinuation(value) {
  if (!value || typeof value !== "object") return false;

  return typeof value.flowId === "string"
    && value.flowId.length === 26
    && /^[0-9A-Z]{26}$/.test(value.flowId)
    && typeof value.intent === "string"
    && VALID_INTENTS.has(value.intent)
    && typeof value.returnTo === "string";
}

export function cleanReturnTo(raw) {
  return cleanBrowserContextReturnTo(raw);
}
