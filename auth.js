/**
 * Nectar AI – Supabase auth & subscription helpers (service worker).
 * Depends on config.js (NECTAR_CONFIG) and STORAGE_KEYS from background.js.
 */

const AUTH_STORAGE_KEYS = {
  supabaseSession: "supabaseSession",
  subscriptionTier: "subscriptionTier",
  authUserEmail: "authUserEmail",
  authUserId: "authUserId",
  proStatusCachedAt: "proStatusCachedAt",
};

function supabaseAuthCookiePrefix() {
  return `sb-${NECTAR_CONFIG.SUPABASE_PROJECT_REF}-auth-token`;
}

function parseSupabaseSessionPayload(raw) {
  if (!raw) return null;

  let value = raw;
  if (value.startsWith("base64-")) {
    value = atob(value.slice(7));
  } else {
    try {
      value = decodeURIComponent(value);
    } catch {
      /* use raw */
    }
  }

  const parsed = JSON.parse(value);
  if (parsed?.access_token && parsed?.user?.id) return parsed;
  if (parsed?.currentSession?.access_token) return parsed.currentSession;
  if (parsed?.session?.access_token) return parsed.session;
  return null;
}

async function readSupabaseSessionFromWebCookies() {
  const prefix = supabaseAuthCookiePrefix();
  const urls = [
    NECTAR_CONFIG.WEB_APP_ORIGIN,
    "http://localhost:3000",
  ];

  for (const url of urls) {
    const cookies = await chrome.cookies.getAll({ url });
    const authCookies = cookies
      .filter((cookie) => cookie.name === prefix || cookie.name.startsWith(`${prefix}.`))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (!authCookies.length) continue;

    const combined = authCookies.map((cookie) => cookie.value).join("");
    const session = parseSupabaseSessionPayload(combined);
    if (session) return session;
  }

  return null;
}

async function getStoredSupabaseSession() {
  const stored = await chrome.storage.local.get(AUTH_STORAGE_KEYS.supabaseSession);
  return stored[AUTH_STORAGE_KEYS.supabaseSession] ?? null;
}

async function saveSupabaseSession(session) {
  if (!session?.access_token || !session?.user?.id) return;

  await chrome.storage.local.set({
    [AUTH_STORAGE_KEYS.supabaseSession]: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
      user: {
        id: session.user.id,
        email: session.user.email ?? null,
      },
    },
  });
}

function isSessionExpired(session) {
  if (!session?.expires_at) return false;
  const expiresMs = session.expires_at * 1000;
  return Date.now() >= expiresMs - 60_000;
}

async function refreshSupabaseSession(session) {
  if (!session?.refresh_token) {
    throw new Error("Session expired. Log in again at nectar-ai-web.vercel.app");
  }

  const response = await fetch(
    `${NECTAR_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        apikey: NECTAR_CONFIG.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error_description ?? data?.msg ?? "Could not refresh session.");
  }

  const nextSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? session.refresh_token,
    expires_at: data.expires_at ?? session.expires_at,
    user: session.user,
  };

  await saveSupabaseSession(nextSession);
  return nextSession;
}

async function resolveActiveSupabaseSession({ allowCookieSync = true } = {}) {
  let session = await getStoredSupabaseSession();

  if ((!session || isSessionExpired(session)) && allowCookieSync) {
    const cookieSession = await readSupabaseSessionFromWebCookies();
    if (cookieSession) {
      await saveSupabaseSession(cookieSession);
      session = await getStoredSupabaseSession();
    }
  }

  if (!session) return null;

  if (isSessionExpired(session)) {
    try {
      session = await refreshSupabaseSession(session);
    } catch {
      await clearAuthState();
      return null;
    }
  }

  return session;
}

async function fetchSubscriptionTierForUser(session) {
  const userId = session.user.id;
  const url =
    `${NECTAR_CONFIG.SUPABASE_URL}/rest/v1/profiles` +
    `?id=eq.${encodeURIComponent(userId)}&select=subscription_tier,full_name`;

  const response = await fetch(url, {
    headers: {
      apikey: NECTAR_CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      Accept: "application/json",
    },
  });

  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const message = rows?.message ?? rows?.error ?? `Profile lookup failed (${response.status})`;
    throw new Error(message);
  }

  const profile = Array.isArray(rows) ? rows[0] : null;
  return profile?.subscription_tier ?? "free";
}

async function clearAuthState() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.licenseKey]);

  await chrome.storage.local.set({
    [AUTH_STORAGE_KEYS.supabaseSession]: null,
    [AUTH_STORAGE_KEYS.subscriptionTier]: "free",
    [AUTH_STORAGE_KEYS.authUserEmail]: "",
    [AUTH_STORAGE_KEYS.authUserId]: "",
    [AUTH_STORAGE_KEYS.proStatusCachedAt]: null,
  });

  if (!stored[STORAGE_KEYS.licenseKey]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.isPro]: false });
  }
}

async function applyExternalSupabaseSession(rawSession) {
  let session = null;

  if (typeof rawSession === "string") {
    session = parseSupabaseSessionPayload(rawSession);
  } else if (rawSession?.access_token && rawSession?.user?.id) {
    session = rawSession;
  } else if (rawSession) {
    session = parseSupabaseSessionPayload(JSON.stringify(rawSession));
  }

  if (!session) {
    throw new Error("Invalid Supabase session payload.");
  }

  await saveSupabaseSession(session);
  const subscriptionTier = await fetchSubscriptionTierForUser(session);
  return cacheSubscriptionState({ session, subscriptionTier });
}

async function cacheSubscriptionState({ session, subscriptionTier }) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.isPro,
    STORAGE_KEYS.licenseKey,
  ]);
  const isPro =
    subscriptionTier === "pro" ||
    Boolean(stored[STORAGE_KEYS.isPro] && stored[STORAGE_KEYS.licenseKey]);

  await chrome.storage.local.set({
    [AUTH_STORAGE_KEYS.subscriptionTier]: subscriptionTier,
    [AUTH_STORAGE_KEYS.authUserEmail]: session?.user?.email ?? "",
    [AUTH_STORAGE_KEYS.authUserId]: session?.user?.id ?? "",
    [AUTH_STORAGE_KEYS.proStatusCachedAt]: Date.now(),
    [STORAGE_KEYS.isPro]: isPro,
  });

  return {
    isAuthenticated: Boolean(session?.user?.id),
    isPro,
    subscriptionTier,
    email: session?.user?.email ?? "",
    userId: session?.user?.id ?? "",
  };
}

async function getCachedAuthState() {
  const stored = await chrome.storage.local.get([
    AUTH_STORAGE_KEYS.subscriptionTier,
    AUTH_STORAGE_KEYS.authUserEmail,
    AUTH_STORAGE_KEYS.authUserId,
    AUTH_STORAGE_KEYS.proStatusCachedAt,
    AUTH_STORAGE_KEYS.supabaseSession,
    STORAGE_KEYS.isPro,
  ]);

  const session = stored[AUTH_STORAGE_KEYS.supabaseSession];
  const subscriptionTier = stored[AUTH_STORAGE_KEYS.subscriptionTier] ?? "free";

  return {
    isAuthenticated: Boolean(session?.user?.id),
    isPro: Boolean(stored[STORAGE_KEYS.isPro]) || subscriptionTier === "pro",
    subscriptionTier,
    email: stored[AUTH_STORAGE_KEYS.authUserEmail] ?? session?.user?.email ?? "",
    userId: stored[AUTH_STORAGE_KEYS.authUserId] ?? session?.user?.id ?? "",
    cachedAt: stored[AUTH_STORAGE_KEYS.proStatusCachedAt] ?? null,
  };
}

async function refreshSubscriptionStatus({ allowCookieSync = true } = {}) {
  const session = await resolveActiveSupabaseSession({ allowCookieSync });

  if (!session) {
    const cached = await getCachedAuthState();
    if (cached.isAuthenticated) {
      await clearAuthState();
    }

    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.isPro,
      STORAGE_KEYS.licenseKey,
      AUTH_STORAGE_KEYS.subscriptionTier,
    ]);
    const isPro =
      stored[AUTH_STORAGE_KEYS.subscriptionTier] === "pro" ||
      Boolean(stored[STORAGE_KEYS.isPro] && stored[STORAGE_KEYS.licenseKey]);

    return {
      isAuthenticated: false,
      isPro,
      subscriptionTier: stored[AUTH_STORAGE_KEYS.subscriptionTier] ?? "free",
      email: "",
      userId: "",
      cachedAt: Date.now(),
    };
  }

  const subscriptionTier = await fetchSubscriptionTierForUser(session);
  return cacheSubscriptionState({ session, subscriptionTier });
}
