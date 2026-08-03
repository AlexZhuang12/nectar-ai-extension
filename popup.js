/**
 * Nectar AI – Popup Script
 * Persists settings, orchestrates extract/export, drives status badge UI.
 */

const CONTENT_SCRIPT_VERSION = "1.9.2";

const SUPPORTED_HOSTS = ["chatgpt.com", "claude.ai", "gemini.google.com"];

const WEB_APP_LOGIN_URL = "https://nectar-ai-web.vercel.app/auth?redirect=/dashboard";
const WEB_APP_DASHBOARD_URL = "https://nectar-ai-web.vercel.app/dashboard";
const WEB_APP_ORIGIN = "https://nectar-ai-web.vercel.app";

const STORAGE_KEYS = {
  notionApiKey: "notionApiKey",
  notionPageId: "notionPageId",
  templateMode: "templateMode",
  exportTarget: "exportTarget",
  extractionScope: "extractionScope",
};

const AUTH_STORAGE_KEYS = {
  supabaseSession: "supabaseSession",
  authToken: "authToken",
  subscriptionTier: "subscriptionTier",
  authUserEmail: "authUserEmail",
  authUserId: "authUserId",
  isPro: "isPro",
  extractionCount: "extractionCount",
  extractionMonth: "extractionMonth",
};

const FREE_EXTRACTION_LIMIT = 15;

document.addEventListener("DOMContentLoaded", () => {
  const extractBtn          = document.getElementById("btn-extract");
  const saveNotionBtn       = document.getElementById("btn-save-notion");
  const openVaultBtn        = document.getElementById("btn-open-vault");
  const exportTarget        = document.getElementById("export-target");
  const templateMode        = document.getElementById("template-mode");
  const extractionScope     = document.getElementById("extraction-scope");
  const notionSettings      = document.getElementById("notion-settings");
  const notionApiKey        = document.getElementById("notion-api-key");
  const notionPageId        = document.getElementById("notion-page-id");
  const statusBadge         = document.getElementById("status-badge");
  const statusLabel         = statusBadge.querySelector(".status-label");
  const headerProBadge      = document.getElementById("header-pro-badge");
  const authBanner          = document.getElementById("auth-banner");
  const accountStrip        = document.getElementById("account-strip");
  const accountEmail        = document.getElementById("account-email");
  const accountTier         = document.getElementById("account-tier");
  const proBanner           = document.getElementById("pro-banner");
  const proStatus           = document.getElementById("pro-status");
  const upgradeCallout      = document.getElementById("upgrade-callout");
  const usageMeter          = document.getElementById("usage-meter");
  const usageCount          = document.getElementById("usage-count");
  const usageBar            = document.getElementById("usage-bar");
  const loginBtn                = document.getElementById("btn-login");
  const syncAccountBtn            = document.getElementById("btn-sync-account");
  const syncAccountBannerBtn      = document.getElementById("btn-sync-account-banner");
  const upgradeDashboardBtn       = document.getElementById("btn-upgrade-dashboard");
  const upgradeProBtn       = document.getElementById("btn-upgrade-pro");

  let usageState = null;

  function setStatus(message, type = "ready") {
    statusBadge.className = `status-badge status-${type}`;
    statusLabel.textContent = message;
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /** Load auth + usage instantly from chrome.storage.local (no network). */
  async function loadAuthFromStorage() {
    const stored = await chrome.storage.local.get(Object.values(AUTH_STORAGE_KEYS));

    const month = currentMonthKey();
    let count = stored[AUTH_STORAGE_KEYS.extractionCount] ?? 0;
    if (stored[AUTH_STORAGE_KEYS.extractionMonth] !== month) count = 0;

    const subscriptionTier = stored[AUTH_STORAGE_KEYS.subscriptionTier] ?? "free";
    const session = stored[AUTH_STORAGE_KEYS.supabaseSession];
    const isAuthenticated = Boolean(session?.user?.id || stored[AUTH_STORAGE_KEYS.authUserId]);
    const isPro = subscriptionTier === "pro";

    return {
      isPro,
      isAuthenticated,
      subscriptionTier,
      email: stored[AUTH_STORAGE_KEYS.authUserEmail] ?? session?.user?.email ?? "",
      userId: stored[AUTH_STORAGE_KEYS.authUserId] ?? session?.user?.id ?? "",
      count,
      limit: FREE_EXTRACTION_LIMIT,
      remaining: isPro ? null : Math.max(0, FREE_EXTRACTION_LIMIT - count),
      limitReached: !isPro && count >= FREE_EXTRACTION_LIMIT,
    };
  }

  async function fetchUsageStatus() {
    const result = await chrome.runtime.sendMessage({ action: "GET_USAGE_STATUS" });
    if (!result?.success) throw new Error(result?.error ?? "Could not load usage status.");
    usageState = result.usage;
    return usageState;
  }

  async function refreshSubscription() {
    const result = await chrome.runtime.sendMessage({ action: "REFRESH_SUBSCRIPTION" });
    if (result?.usage) {
      usageState = result.usage;
      renderUsageUI(result.usage);
    }
    return result;
  }

  function renderUsageUI(usage) {
    usageState = usage;
    const isPro = usage.subscriptionTier === "pro";
    const isAuthenticated = Boolean(usage.isAuthenticated);
    const isFreePlan = !isPro;

    headerProBadge.classList.toggle("hidden", !isPro);
    proStatus.classList.toggle("hidden", !isPro);
    authBanner.classList.toggle("hidden", isPro || isAuthenticated);
    accountStrip.classList.toggle("hidden", !isAuthenticated);
    upgradeCallout.classList.toggle("hidden", !isAuthenticated || isPro);
    proBanner.classList.add("hidden");

    if (isAuthenticated) {
      accountEmail.textContent = usage.email || "Signed in";
      accountTier.textContent = isPro ? "Pro plan" : "Free plan";
      accountTier.classList.toggle("account-tier-pro", isPro);
    }

    if (isPro) {
      usageMeter.classList.add("hidden");
      extractBtn.disabled = false;
      setStatus("PRO — Unlimited extractions", "pro");
      return;
    }

    const count = usage.count ?? 0;
    const limit = usage.limit ?? FREE_EXTRACTION_LIMIT;
    const remaining = usage.remaining ?? Math.max(0, limit - count);
    const pct = Math.min(100, Math.round((remaining / limit) * 100));

    usageCount.textContent = `${remaining} / ${limit} Left`;
    usageBar.style.width = `${pct}%`;
    usageMeter.classList.toggle("usage-warning", remaining <= 3);
    usageMeter.classList.remove("hidden");

    if (usage.limitReached) {
      proBanner.classList.remove("hidden");
      extractBtn.disabled = true;
      setStatus("Free limit reached", "error");
    } else {
      extractBtn.disabled = false;
      if (!isAuthenticated) setStatus("Ready — sign in to sync Pro", "ready");
      else if (isFreePlan) setStatus("Ready", "ready");
    }
  }

  async function refreshUsageUI({ refreshRemote = false } = {}) {
    try {
      if (refreshRemote) {
        await refreshSubscription();
        return;
      }
      const usage = await fetchUsageStatus();
      renderUsageUI(usage);
    } catch (err) {
      console.error("[Nectar AI]", err);
    }
  }

  async function checkExtractionAllowed() {
    const result = await chrome.runtime.sendMessage({ action: "CHECK_EXTRACTION_ALLOWED" });
    if (result?.usage) renderUsageUI(result.usage);
    if (!result?.allowed) {
      throw new Error(result?.error ?? "Extraction not allowed.");
    }
  }

  function buildNotionUrl(pageId) {
    const clean = pageId.replace(/-/g, "").trim();
    return `https://www.notion.so/${clean}`;
  }

  function updateVaultButton(pageId) {
    openVaultBtn.disabled = !pageId?.trim();
  }

  function toggleNotionSettings() {
    const isNotion = exportTarget.value === "notion";
    notionSettings.classList.toggle("hidden", !isNotion);
    openVaultBtn.classList.toggle("hidden", !isNotion);
    if (isNotion) notionSettings.open = true;
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));

    if (stored[STORAGE_KEYS.notionApiKey]) notionApiKey.value = stored[STORAGE_KEYS.notionApiKey];
    if (stored[STORAGE_KEYS.notionPageId])  notionPageId.value  = stored[STORAGE_KEYS.notionPageId];
    if (stored[STORAGE_KEYS.templateMode])    templateMode.value    = stored[STORAGE_KEYS.templateMode];
    if (stored[STORAGE_KEYS.exportTarget])    exportTarget.value    = stored[STORAGE_KEYS.exportTarget];
    if (stored[STORAGE_KEYS.extractionScope]) extractionScope.value = stored[STORAGE_KEYS.extractionScope];

    updateVaultButton(notionPageId.value);
  }

  async function saveExtractionScope() {
    await chrome.storage.local.set({ [STORAGE_KEYS.extractionScope]: extractionScope.value });
  }

  async function saveTemplateMode() {
    await chrome.storage.local.set({ [STORAGE_KEYS.templateMode]: templateMode.value });
  }

  async function saveExportTarget() {
    await chrome.storage.local.set({ [STORAGE_KEYS.exportTarget]: exportTarget.value });
    toggleNotionSettings();
  }

  async function saveNotionSettings() {
    const apiKey = notionApiKey.value.trim();
    const pageId = notionPageId.value.trim();
    if (!apiKey || !pageId) {
      setStatus("Fill in both Notion fields", "error");
      return;
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.notionApiKey]: apiKey,
      [STORAGE_KEYS.notionPageId]: pageId,
    });
    updateVaultButton(pageId);
    setStatus("Settings saved", "success");
    setTimeout(() => {
      if (usageState?.isPro) setStatus("PRO — Unlimited extractions", "pro");
      else setStatus("Ready", "ready");
    }, 2000);
  }

  function openNotionVault() {
    const pageId = notionPageId.value.trim();
    if (!pageId) {
      setStatus("Set a Page ID first", "error");
      return;
    }
    chrome.tabs.create({ url: buildNotionUrl(pageId) });
  }

  function openLoginPage() {
    chrome.tabs.create({ url: WEB_APP_LOGIN_URL });
  }

  function openDashboard() {
    chrome.tabs.create({ url: WEB_APP_DASHBOARD_URL });
  }

  async function handleSyncAccount() {
    syncAccountBtn.disabled = true;
    if (syncAccountBannerBtn) syncAccountBannerBtn.disabled = true;
    setStatus("Syncing account...", "exporting");

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const preferTabId = activeTab?.url?.includes("nectar-ai-web.vercel.app") ? activeTab.id : null;

      const result = await chrome.runtime.sendMessage({
        action: "SYNC_ACCOUNT",
        preferTabId,
      });

      if (result?.usage) {
        usageState = result.usage;
        renderUsageUI(result.usage);
      }

      if (!result?.success) {
        throw new Error(
          result?.error ??
            "No session found. Open nectar-ai-web.vercel.app, log in, then Sync Account."
        );
      }

      if (result.usage?.subscriptionTier === "pro") {
        setStatus("PRO — Unlimited extractions", "pro");
      } else {
        setStatus("Account synced", "success");
      }
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      syncAccountBtn.disabled = false;
      if (syncAccountBannerBtn) syncAccountBannerBtn.disabled = false;
      setTimeout(() => {
        if (usageState?.subscriptionTier === "pro") setStatus("PRO — Unlimited extractions", "pro");
        else if (!usageState?.limitReached) setStatus("Ready", "ready");
      }, 2500);
    }
  }

  async function ensureContentScript(tabId) {
    let needsInject = true;
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { action: "PING" });
      if (ping?.pong && ping.version === CONTENT_SCRIPT_VERSION) needsInject = false;
    } catch { /* not loaded */ }

    if (needsInject) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    }
  }

  async function extractFromActiveTab(tabId) {
    const mode = extractionScope.value === "full" ? "full" : "single";

    const response = await chrome.tabs.sendMessage(tabId, {
      action: "EXTRACT_NECTAR",
      mode,
      template: templateMode.value,
      fromPopup: true,
    });

    if (!response?.success) throw new Error(response?.error ?? "Could not extract text.");
    return response.data;
  }

  async function exportToNotion(formattedText, metadata) {
    const apiKey = notionApiKey.value.trim();
    const pageId = notionPageId.value.trim();
    if (apiKey && pageId) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.notionApiKey]: apiKey,
        [STORAGE_KEYS.notionPageId]: pageId,
      });
    }

    const result = await chrome.runtime.sendMessage({
      action: "EXPORT_TO_NOTION",
      payload: { formattedText, metadata },
    });
    if (!result?.success) throw new Error(result?.error ?? "Notion export failed.");
    if (result.usage) renderUsageUI(result.usage);
    return result;
  }

  async function recordClipboardExtraction() {
    const result = await chrome.runtime.sendMessage({ action: "RECORD_EXTRACTION" });
    if (result?.usage) renderUsageUI(result.usage);
  }

  async function handleExtract() {
    extractBtn.disabled = true;
    setStatus("Exporting...", "exporting");
    await saveTemplateMode();
    await saveExtractionScope();

    try {
      await checkExtractionAllowed();

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");

      const url = tab.url ?? "";
      if (!SUPPORTED_HOSTS.some((h) => url.includes(h))) {
        throw new Error("Open ChatGPT, Claude, or Gemini first.");
      }

      await ensureContentScript(tab.id);
      const data = await extractFromActiveTab(tab.id);

      if (exportTarget.value === "notion") {
        await exportToNotion(data.formattedText, data.metadata ?? {
          platform: data.platform,
          templateMode: data.templateMode,
        });
        setStatus("Success!", "success");
      } else {
        await navigator.clipboard.writeText(data.formattedText);
        await recordClipboardExtraction();
        setStatus("Success!", "success");
      }

      setTimeout(() => {
        if (usageState?.isPro) setStatus("PRO — Unlimited extractions", "pro");
        else setStatus("Ready", "ready");
      }, 3000);
    } catch (err) {
      console.error("[Nectar AI]", err);
      setStatus(err.message, "error");
      if (usageState?.limitReached) extractBtn.disabled = true;
      setTimeout(() => {
        if (usageState?.isPro) setStatus("PRO — Unlimited extractions", "pro");
        else if (usageState?.limitReached) setStatus("Free limit reached", "error");
        else setStatus("Ready", "ready");
      }, 4000);
    } finally {
      if (!usageState?.limitReached || usageState?.isPro) {
        extractBtn.disabled = false;
      }
    }
  }

  templateMode.addEventListener("change", saveTemplateMode);
  extractionScope.addEventListener("change", saveExtractionScope);
  exportTarget.addEventListener("change", saveExportTarget);
  notionPageId.addEventListener("input", () => updateVaultButton(notionPageId.value));
  saveNotionBtn.addEventListener("click", saveNotionSettings);
  openVaultBtn.addEventListener("click", openNotionVault);
  extractBtn.addEventListener("click", handleExtract);
  loginBtn.addEventListener("click", openLoginPage);
  syncAccountBtn.addEventListener("click", handleSyncAccount);
  if (syncAccountBannerBtn) syncAccountBannerBtn.addEventListener("click", handleSyncAccount);
  upgradeDashboardBtn.addEventListener("click", openDashboard);
  upgradeProBtn.addEventListener("click", openDashboard);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      changes.subscriptionTier ||
      changes.supabaseSession ||
      changes.authToken ||
      changes.authUserId ||
      changes.isPro ||
      changes.extractionCount
    ) {
      loadAuthFromStorage().then(renderUsageUI).catch(console.error);
    }
  });

  loadSettings().then(async () => {
    toggleNotionSettings();

    const cached = await loadAuthFromStorage();
    renderUsageUI(cached);

    refreshUsageUI({ refreshRemote: true });
  });
});