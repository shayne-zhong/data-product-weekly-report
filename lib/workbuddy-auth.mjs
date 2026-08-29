import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function text(value) {
  return String(value || "").trim();
}

function normalizedUsername(value) {
  return text(value).toLowerCase();
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function stateSignature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeReturnPath(value) {
  const path = text(value) || "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Invalid OAuth return path");
  }
  return path;
}

export function workbuddyTokenValid(header, env = process.env) {
  const authorization = text(header);
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const expected = text(env.WORKBUDDY_OPEN_API_TOKEN);
  return Boolean(expected && provided) && safeEqual(provided, expected);
}

export function bindWecomUserId(accounts, username, wecomUserId) {
  const normalizedUser = normalizedUsername(username);
  const normalizedWecomUser = text(wecomUserId);
  if (!normalizedWecomUser) throw new Error("WeCom userid is required");
  const account = (accounts || []).find((row) => normalizedUsername(row.username) === normalizedUser);
  if (!account) throw new Error("Website account not found");
  const conflict = accounts.find((row) => row !== account && text(row.wecomUserId) === normalizedWecomUser);
  if (conflict) throw new Error("WeCom userid already bound");
  account.wecomUserId = normalizedWecomUser;
  return account;
}

export function applyDirectoryMappings(state, mappings, { departmentId, batchId } = {}) {
  const normalizedBatchId = text(batchId);
  if (!normalizedBatchId) throw new Error("Directory mapping batch id is required");
  state.workbuddyDirectoryBatches ||= {};
  if (state.workbuddyDirectoryBatches[normalizedBatchId]) {
    return state.workbuddyDirectoryBatches[normalizedBatchId];
  }

  const accounts = state.settings?.accounts || [];
  const summary = { batchId: normalizedBatchId, bound: 0, skipped: 0, conflicts: 0 };
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const account = accounts.find((row) =>
      row.departmentId === departmentId
      && normalizedUsername(row.username) === normalizedUsername(mapping?.username));
    if (!account) {
      summary.skipped += 1;
      continue;
    }
    const wecomUserId = text(mapping?.wecom_userid);
    if (!wecomUserId || text(account.wecomUserId) === wecomUserId) {
      summary.skipped += 1;
      continue;
    }
    try {
      bindWecomUserId(accounts, account.username, wecomUserId);
      summary.bound += 1;
    } catch {
      summary.conflicts += 1;
    }
  }
  state.workbuddyDirectoryBatches[normalizedBatchId] = summary;
  return summary;
}

export function issueOAuthState(payload = {}, { secret, now = Date.now() } = {}) {
  const normalizedSecret = text(secret);
  if (!normalizedSecret) throw new Error("OAuth state secret is required");
  const body = Buffer.from(JSON.stringify({
    nonce: randomUUID(),
    returnTo: safeReturnPath(payload.returnTo),
    expiresAt: now + 300_000,
  })).toString("base64url");
  return `${body}.${stateSignature(body, normalizedSecret)}`;
}

export function consumeOAuthState(state, token, { secret, now = Date.now() } = {}) {
  const normalizedSecret = text(secret);
  const [payload, signature, extra] = text(token).split(".");
  if (!normalizedSecret || !payload || !signature || extra) throw new Error("Invalid OAuth state");
  const expected = stateSignature(payload, normalizedSecret);
  if (!safeEqual(signature, expected)) throw new Error("Invalid OAuth state");

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid OAuth state");
  }
  if (!decoded.nonce || !Number.isFinite(decoded.expiresAt) || decoded.expiresAt < now) {
    throw new Error("Expired OAuth state");
  }
  const returnTo = safeReturnPath(decoded.returnTo);
  state.oauthStates ||= {};
  if (state.oauthStates[decoded.nonce]?.usedAt) throw new Error("OAuth state already used");
  state.oauthStates[decoded.nonce] = { expiresAt: decoded.expiresAt, usedAt: now };
  return { nonce: decoded.nonce, expiresAt: decoded.expiresAt, returnTo };
}

export async function resolveWorkbuddyIdentity(code, {
  url,
  token,
  fetchImpl = fetch,
} = {}) {
  const resolverUrl = text(url);
  const resolverToken = text(token);
  if (!text(code) || !resolverUrl || !resolverToken) throw new Error("WorkBuddy identity resolver is not configured");

  let response;
  try {
    response = await fetchImpl(resolverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${resolverToken}`,
      },
      body: JSON.stringify({ code: text(code) }),
    });
  } catch {
    throw new Error("WorkBuddy identity resolver failed");
  }
  if (!response?.ok) throw new Error("WorkBuddy identity resolver failed");

  let identity;
  try {
    identity = await response.json();
  } catch {
    throw new Error("WorkBuddy identity resolver returned invalid data");
  }
  if (!text(identity?.wecom_userid) || !normalizedUsername(identity?.username)) {
    throw new Error("WorkBuddy identity resolver returned incomplete data");
  }
  return {
    ...identity,
    wecom_userid: text(identity.wecom_userid),
    username: normalizedUsername(identity.username),
  };
}
