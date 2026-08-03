/**
 * Nectar AI – Background Service Worker  (v1.9.0)
 * Supports Notion Page block appends AND Database item creation.
 * Auto-detects target type and attaches source/metadata tags.
 * Freemium usage limits + Supabase subscription validation.
 */

importScripts("config.js", "auth.js");

const NOTION_API_VERSION = "2022-06-28";
const NOTION_API_BASE = "https://api.notion.com/v1";
const MAX_RICH_TEXT_LENGTH = 2000;
const MAX_BLOCKS_PER_REQUEST = 100;

/** Legacy Lemon Squeezy license fallback (optional). */
const LEMON_SQUEEZY_API_KEY = "你的API Key貼在這裡";
const LEMON_SQUEEZY_LICENSE_ACTIVATE_URL =
  "https://api.lemonsqueezy.com/v1/licenses/activate";
const LEMON_SQUEEZY_LICENSE_VALIDATE_URL =
  "https://api.lemonsqueezy.com/v1/licenses/validate";
const FREE_EXTRACTION_LIMIT = NECTAR_CONFIG.FREE_EXTRACTION_LIMIT;

const STORAGE_KEYS = {
  notionApiKey: "notionApiKey",
  notionPageId: "notionPageId",
  isPro: "isPro",
  licenseKey: "licenseKey",
  extractionCount: "extractionCount",
  extractionMonth: "extractionMonth",
  instanceId: "instanceId",
};

const TEMPLATE_LABELS = {
  "social-post": "Social Post",
  "campaign-strategy": "Campaign Strategy",
  "bullet-summary": "Bullet Summary",
};

const PLATFORM_LABELS = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
};

// ── Freemium & license ────────────────────────────────────────────────────

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getInstanceId() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.instanceId);
  if (stored[STORAGE_KEYS.instanceId]) return stored[STORAGE_KEYS.instanceId];

  const instanceId =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `nectar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  await chrome.storage.local.set({ [STORAGE_KEYS.instanceId]: instanceId });
  return instanceId;
}

async function getNormalizedUsageState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.isPro,
    STORAGE_KEYS.extractionCount,
    STORAGE_KEYS.extractionMonth,
    STORAGE_KEYS.licenseKey,
    AUTH_STORAGE_KEYS.subscriptionTier,
    AUTH_STORAGE_KEYS.authUserEmail,
    AUTH_STORAGE_KEYS.authUserId,
    AUTH_STORAGE_KEYS.supabaseSession,
  ]);

  const month = currentMonthKey();
  let count = stored[STORAGE_KEYS.extractionCount] ?? 0;

  if (stored[STORAGE_KEYS.extractionMonth] !== month) {
    count = 0;
    await chrome.storage.local.set({
      [STORAGE_KEYS.extractionCount]: 0,
      [STORAGE_KEYS.extractionMonth]: month,
    });
  }

  const subscriptionTier = stored[AUTH_STORAGE_KEYS.subscriptionTier] ?? "free";
  const isAuthenticated = Boolean(stored[AUTH_STORAGE_KEYS.supabaseSession]?.user?.id);
  const isPro =
    subscriptionTier === "pro" ||
    Boolean(stored[STORAGE_KEYS.isPro] && stored[STORAGE_KEYS.licenseKey]);
  const limitReached = !isPro && count >= FREE_EXTRACTION_LIMIT;

  return {
    isPro,
    isAuthenticated,
    subscriptionTier,
    email: stored[AUTH_STORAGE_KEYS.authUserEmail] ?? "",
    userId: stored[AUTH_STORAGE_KEYS.authUserId] ?? "",
    count,
    limit: FREE_EXTRACTION_LIMIT,
    remaining: isPro ? null : Math.max(0, FREE_EXTRACTION_LIMIT - count),
    limitReached,
    month,
    licenseKey: stored[STORAGE_KEYS.licenseKey] ?? "",
  };
}

async function assertExtractionAllowed() {
  const usage = await getNormalizedUsageState();
  if (usage.isPro) return usage;

  if (usage.limitReached) {
    throw new Error(
      "Free limit reached (15/month). Upgrade to Nectar AI Pro for unlimited extractions."
    );
  }

  return usage;
}

async function recordExtraction() {
  const usage = await getNormalizedUsageState();
  if (usage.isPro) return usage;

  const count = usage.count + 1;
  await chrome.storage.local.set({
    [STORAGE_KEYS.extractionCount]: count,
    [STORAGE_KEYS.extractionMonth]: usage.month,
  });

  return {
    ...usage,
    count,
    remaining: Math.max(0, FREE_EXTRACTION_LIMIT - count),
    limitReached: count >= FREE_EXTRACTION_LIMIT,
  };
}

async function callLemonSqueezyLicenseEndpoint(url, licenseKey) {
  if (!LEMON_SQUEEZY_API_KEY || LEMON_SQUEEZY_API_KEY === "你的API Key貼在這裡") {
    throw new Error("Lemon Squeezy API key is not configured in background.js.");
  }

  const instanceName = await getInstanceId();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${LEMON_SQUEEZY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      license_key: licenseKey.trim(),
      instance_name: instanceName,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error ?? data?.message ?? `License request failed (${response.status}).`);
  }

  if (data.error) {
    throw new Error(data.error);
  }

  const isValid = data.valid === true || data.activated === true;
  if (!isValid) {
    throw new Error("Invalid or inactive license key.");
  }

  return data;
}

async function activateLicense(licenseKey) {
  const key = licenseKey?.trim();
  if (!key) throw new Error("Enter a license key to activate.");

  await callLemonSqueezyLicenseEndpoint(LEMON_SQUEEZY_LICENSE_ACTIVATE_URL, key);

  await chrome.storage.local.set({
    [STORAGE_KEYS.isPro]: true,
    [STORAGE_KEYS.licenseKey]: key,
  });

  return getNormalizedUsageState();
}

async function validateStoredLicense() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.isPro,
    STORAGE_KEYS.licenseKey,
  ]);

  if (!stored[STORAGE_KEYS.isPro] || !stored[STORAGE_KEYS.licenseKey]) {
    return getNormalizedUsageState();
  }

  try {
    await callLemonSqueezyLicenseEndpoint(
      LEMON_SQUEEZY_LICENSE_VALIDATE_URL,
      stored[STORAGE_KEYS.licenseKey]
    );
    return getNormalizedUsageState();
  } catch {
    await chrome.storage.local.set({ [STORAGE_KEYS.isPro]: false });
    return getNormalizedUsageState();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatNotionId(id) {
  const clean = id.replace(/-/g, "").trim();
  if (clean.length !== 32) return id.trim();
  return [
    clean.slice(0, 8),
    clean.slice(8, 12),
    clean.slice(12, 16),
    clean.slice(16, 20),
    clean.slice(20),
  ].join("-");
}

function chunkText(text, maxLen = MAX_RICH_TEXT_LENGTH) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}

function buildRichText(text) {
  return chunkText(text).map((chunk) => ({
    type: "text",
    text: { content: chunk },
  }));
}

function enrichMetadata(metadata = {}) {
  const platform = metadata.platform ?? "unknown";
  const platformTag = metadata.platformTag ?? PLATFORM_LABELS[platform] ?? platform;
  const templateMode = metadata.templateMode ?? "bullet-summary";
  const templateLabel = TEMPLATE_LABELS[templateMode] ?? templateMode;
  const createdAt = metadata.createdAt ?? new Date().toISOString();
  const createdAtDisplay =
    metadata.createdAtDisplay ?? new Date(createdAt).toLocaleString();

  const scopeLabel = metadata.extractionScope === "full" ? "Full Conversation" : "Latest Reply";
  const title =
    metadata.title ??
    `🍯 ${platformTag} · ${scopeLabel}${metadata.extractionScope === "full" ? "" : ` · ${templateLabel}`} · ${createdAtDisplay}`;

  return {
    platform,
    platformTag,
    templateMode,
    templateLabel,
    title,
    createdAt,
    createdAtDisplay,
  };
}

async function notionFetch(apiKey, path, options = {}) {
  return fetch(`${NOTION_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// ── Block builders ────────────────────────────────────────────────────────

function textToNotionBlocks(formattedText) {
  const blocks = [];

  for (const line of formattedText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: buildRichText(trimmed.slice(4)) },
      });
    } else if (trimmed.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: buildRichText(trimmed.slice(3)) },
      });
    } else if (trimmed.startsWith("# ")) {
      blocks.push({
        object: "block",
        type: "heading_1",
        heading_1: { rich_text: buildRichText(trimmed.slice(2)) },
      });
    } else if (trimmed === "---" || trimmed === "—") {
      blocks.push({ object: "block", type: "divider", divider: {} });
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: buildRichText(trimmed.replace(/^[-•]\s*/, "")),
        },
      });
    } else {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: buildRichText(trimmed) },
      });
    }
  }

  return blocks;
}

/** Metadata header blocks appended above formatted content. */
function buildMetadataBlocks(meta) {
  return [
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: buildRichText(meta.title) },
    },
    {
      object: "block",
      type: "callout",
      callout: {
        rich_text: buildRichText(
          `Source: ${meta.platformTag}  ·  Template: ${meta.templateLabel}  ·  ${meta.createdAtDisplay}`
        ),
        icon: { emoji: "🍯" },
        color: "yellow_background",
      },
    },
    { object: "block", type: "divider", divider: {} },
  ];
}

function buildAllContentBlocks(formattedText, metadata) {
  const meta = enrichMetadata(metadata);
  return [...buildMetadataBlocks(meta), ...textToNotionBlocks(formattedText)];
}

// ── Target type detection ─────────────────────────────────────────────────

async function resolveNotionTarget(apiKey, targetId) {
  const normalizedId = formatNotionId(targetId);

  const dbRes = await notionFetch(apiKey, `/databases/${normalizedId}`);
  if (dbRes.ok) {
    return { type: "database", id: normalizedId, schema: await dbRes.json() };
  }

  const blockRes = await notionFetch(apiKey, `/blocks/${normalizedId}`);
  if (blockRes.ok) {
    return { type: "page", id: normalizedId, schema: await blockRes.json() };
  }

  throw new Error(
    "Notion target not found. Verify your Page/Database ID and integration access."
  );
}

// ── Database property mapping ─────────────────────────────────────────────

/**
 * Map metadata onto database properties by type/name heuristics.
 * Gracefully handles any schema — always sets the title property at minimum.
 */
function buildDatabaseProperties(schema, meta) {
  const properties = {};
  const schemaProps = schema.properties ?? {};

  for (const [name, config] of Object.entries(schemaProps)) {
    const nameLower = name.toLowerCase();

    if (config.type === "title") {
      properties[name] = { title: buildRichText(meta.title) };
    } else if (config.type === "select" && /source|platform|tag/i.test(nameLower)) {
      const option = config.select?.options?.find(
        (o) => o.name.toLowerCase() === meta.platformTag.toLowerCase()
      );
      properties[name] = {
        select: { name: option?.name ?? meta.platformTag },
      };
    } else if (config.type === "multi_select" && /source|platform|tag/i.test(nameLower)) {
      properties[name] = {
        multi_select: [{ name: meta.platformTag }],
      };
    } else if (config.type === "date" && /date|created|time|when/i.test(nameLower)) {
      properties[name] = {
        date: { start: meta.createdAt.split("T")[0] },
      };
    } else if (config.type === "rich_text" && /source|platform|origin/i.test(nameLower)) {
      properties[name] = { rich_text: buildRichText(meta.platformTag) };
    } else if (config.type === "rich_text" && /template|type|format/i.test(nameLower)) {
      properties[name] = { rich_text: buildRichText(meta.templateLabel) };
    }
  }

  // Guarantee title property is set
  if (Object.keys(properties).length === 0) {
    const titleEntry = Object.entries(schemaProps).find(([, c]) => c.type === "title");
    if (titleEntry) {
      properties[titleEntry[0]] = { title: buildRichText(meta.title) };
    }
  }

  return properties;
}

// ── Export strategies ─────────────────────────────────────────────────────

async function appendBlocksToPage(apiKey, pageId, blocks) {
  for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_REQUEST) {
    const batch = blocks.slice(i, i + MAX_BLOCKS_PER_REQUEST);
    const response = await notionFetch(apiKey, `/blocks/${pageId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: batch }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(
        errorBody.message ?? errorBody.code ?? `Notion page append failed (${response.status})`
      );
    }
  }
}

async function createDatabaseItem(apiKey, databaseId, schema, properties, blocks) {
  const firstBatch = blocks.slice(0, MAX_BLOCKS_PER_REQUEST);
  const response = await notionFetch(apiKey, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children: firstBatch,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.message ?? errorBody.code ?? `Notion database create failed (${response.status})`
    );
  }

  const page = await response.json();

  // Append remaining blocks to the newly created page
  if (blocks.length > MAX_BLOCKS_PER_REQUEST) {
    const remaining = blocks.slice(MAX_BLOCKS_PER_REQUEST);
    await appendBlocksToPage(apiKey, page.id, remaining);
  }

  return page;
}

// ── Main export handler ───────────────────────────────────────────────────

async function exportToNotion({ formattedText, metadata = {}, apiKey, pageId }) {
  await assertExtractionAllowed();

  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.notionApiKey,
    STORAGE_KEYS.notionPageId,
  ]);

  const resolvedApiKey = (apiKey ?? stored[STORAGE_KEYS.notionApiKey] ?? "").trim();
  const resolvedTargetId = (pageId ?? stored[STORAGE_KEYS.notionPageId] ?? "").trim();

  if (!resolvedApiKey) {
    throw new Error("Notion Integration Secret not set. Save it in the popup.");
  }
  if (!resolvedTargetId) {
    throw new Error("Notion Target ID not set. Save a Page or Database ID in the popup.");
  }
  if (!formattedText?.trim()) {
    throw new Error("No content to export.");
  }

  const meta = enrichMetadata(metadata);
  const allBlocks = buildAllContentBlocks(formattedText, meta);
  const target = await resolveNotionTarget(resolvedApiKey, resolvedTargetId);

  if (target.type === "database") {
    const properties = buildDatabaseProperties(target.schema, meta);
    const page = await createDatabaseItem(
      resolvedApiKey,
      target.id,
      target.schema,
      properties,
      allBlocks
    );
    const usage = await recordExtraction();
    return {
      success: true,
      targetType: "database",
      pageId: page.id,
      blockCount: allBlocks.length,
      platformTag: meta.platformTag,
      usage,
    };
  }

  // Standard page — append blocks
  await appendBlocksToPage(resolvedApiKey, target.id, allBlocks);
  const usage = await recordExtraction();
  return {
    success: true,
    targetType: "page",
    blockCount: allBlocks.length,
    platformTag: meta.platformTag,
    usage,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "EXPORT_TO_NOTION") {
    exportToNotion(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "GET_USAGE_STATUS") {
    getNormalizedUsageState()
      .then((usage) => sendResponse({ success: true, usage }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "CHECK_EXTRACTION_ALLOWED") {
    assertExtractionAllowed()
      .then((usage) => sendResponse({ success: true, allowed: true, usage }))
      .catch((err) =>
        getNormalizedUsageState().then((usage) =>
          sendResponse({ success: true, allowed: false, error: err.message, usage })
        )
      );
    return true;
  }

  if (message.action === "RECORD_EXTRACTION") {
    recordExtraction()
      .then((usage) => sendResponse({ success: true, usage }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "ACTIVATE_LICENSE") {
    activateLicense(message.licenseKey)
      .then((usage) => sendResponse({ success: true, usage }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "REFRESH_SUBSCRIPTION") {
    refreshSubscriptionStatus({ allowCookieSync: true })
      .then(async (auth) => {
        const usage = await getNormalizedUsageState();
        sendResponse({ success: true, auth, usage });
      })
      .catch(async (err) => {
        const usage = await getNormalizedUsageState();
        sendResponse({ success: false, error: err.message, usage });
      });
    return true;
  }

  if (message.action === "SYNC_SUPABASE_SESSION") {
    applyExternalSupabaseSession(message.rawSession)
      .then(async (auth) => {
        const usage = await getNormalizedUsageState();
        sendResponse({ success: true, auth, usage });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "GET_AUTH_STATE") {
    getCachedAuthState()
      .then(async (auth) => {
        const usage = await getNormalizedUsageState();
        sendResponse({ success: true, auth, usage });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "SIGN_OUT") {
    clearAuthState()
      .then(async () => {
        const usage = await getNormalizedUsageState();
        sendResponse({ success: true, usage });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

refreshSubscriptionStatus({ allowCookieSync: true }).catch(() => {});
validateStoredLicense().catch(() => {});
