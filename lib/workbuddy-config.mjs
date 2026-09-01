function text(value) {
  return String(value || "").trim();
}

function envValue(env, name) {
  return text(env?.[name]);
}

function tokenProjection(stored, environmentValue) {
  if (stored?.encrypted) {
    return {
      configured: true,
      source: "admin",
      mask: stored.last4 ? `•••• ${stored.last4}` : "••••",
    };
  }
  const fallback = text(environmentValue);
  return {
    configured: Boolean(fallback),
    source: fallback ? "environment" : "none",
    mask: fallback ? `•••• ${fallback.slice(-4)}` : "",
  };
}

export async function effectiveWorkbuddyConfig(
  state,
  { env = process.env, decrypt } = {},
) {
  const stored = state?.workbuddy || {};
  const decryptStored = async (entry) => {
    if (!entry?.encrypted) return "";
    if (typeof decrypt !== "function") {
      throw new Error("WorkBuddy secret decryptor is required");
    }
    return text(await decrypt(entry.encrypted));
  };

  return {
    enabled: Object.hasOwn(stored, "enabled") ? stored.enabled === true : true,
    departmentId: text(stored.departmentId)
      || envValue(env, "WORKBUDDY_DEPARTMENT_ID"),
    openApiToken: stored.openApiToken?.encrypted
      ? await decryptStored(stored.openApiToken)
      : envValue(env, "WORKBUDDY_OPEN_API_TOKEN"),
    oauthResolverUrl: text(stored.oauthResolverUrl)
      || envValue(env, "WORKBUDDY_OAUTH_RESOLVER_URL"),
    oauthResolverToken: stored.oauthResolverToken?.encrypted
      ? await decryptStored(stored.oauthResolverToken)
      : envValue(env, "WORKBUDDY_OAUTH_RESOLVER_TOKEN"),
    corpId: text(stored.corpId) || envValue(env, "WECOM_OAUTH_CORP_ID"),
  };
}

export function publicWorkbuddyConfig(state, { env = process.env } = {}) {
  const stored = state?.workbuddy || {};
  return {
    enabled: Object.hasOwn(stored, "enabled") ? stored.enabled === true : true,
    departmentId: text(stored.departmentId)
      || envValue(env, "WORKBUDDY_DEPARTMENT_ID"),
    oauthResolverUrl: text(stored.oauthResolverUrl)
      || envValue(env, "WORKBUDDY_OAUTH_RESOLVER_URL"),
    corpId: text(stored.corpId) || envValue(env, "WECOM_OAUTH_CORP_ID"),
    openApiToken: tokenProjection(
      stored.openApiToken,
      envValue(env, "WORKBUDDY_OPEN_API_TOKEN"),
    ),
    oauthResolverToken: tokenProjection(
      stored.oauthResolverToken,
      envValue(env, "WORKBUDDY_OAUTH_RESOLVER_TOKEN"),
    ),
  };
}

export function validateWorkbuddyConfigPatch(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("WorkBuddy configuration must be an object");
  }
  if (Object.hasOwn(body, "enabled") && typeof body.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  for (const key of ["open_api_token", "oauth_resolver_token"]) {
    if (Object.hasOwn(body, key) && text(body[key]).length < 24) {
      throw new Error(`${key} must contain at least 24 characters`);
    }
  }
  if (
    body.open_api_token
    && body.oauth_resolver_token
    && text(body.open_api_token) === text(body.oauth_resolver_token)
  ) {
    throw new Error("WorkBuddy tokens must be different");
  }
  if (body.clear_open_api_token === true && Object.hasOwn(body, "open_api_token")) {
    throw new Error("Cannot replace and clear open_api_token together");
  }
  if (
    body.clear_oauth_resolver_token === true
    && Object.hasOwn(body, "oauth_resolver_token")
  ) {
    throw new Error("Cannot replace and clear oauth_resolver_token together");
  }
  if (Object.hasOwn(body, "oauth_resolver_url") && text(body.oauth_resolver_url)) {
    let url;
    try {
      url = new URL(text(body.oauth_resolver_url));
    } catch {
      throw new Error("OAuth resolver URL must be a valid http or https URL");
    }
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      throw new Error("OAuth resolver URL must use http or https");
    }
  }
  return body;
}
