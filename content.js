/**
 * Nectar AI – Content Script  (v1.5.0)
 * Multi-platform: ChatGPT · Claude · Gemini
 * Injects Nectar buttons, extracts responses, exports with source metadata.
 */

const NECTAR_VERSION = "1.9.2";

const STORAGE_KEYS = {
  templateMode: "templateMode",
  extractionScope: "extractionScope",
};

/** Per-platform DOM configuration */
const PLATFORMS = {
  chatgpt: {
    label: "ChatGPT",
    hostMatch: "chatgpt.com",
    turnSelector:
      '[data-message-author-role="user"], [data-message-author-role="assistant"]',
    assistantSelectors: [
      '[data-message-author-role="assistant"]',
      'article[data-turn="assistant"]',
      '[data-testid="conversation-turn"][data-turn="assistant"]',
    ],
    contentSelectors: [".markdown", ".prose", '[class*="markdown"]'],
    userContentSelectors: [".whitespace-pre-wrap", ".markdown", ".prose", "div[data-message-author-role]"],
    actionBarSelectors: [
      '[data-testid="copy-turn-action-button"]',
      'button[aria-label="Copy"]',
      'button[aria-label="Good response"]',
      'button[aria-label="Copy code"]',
    ],
  },
  claude: {
    label: "Claude",
    hostMatch: "claude.ai",
    turnSelector: '[data-testid="user-message"], [data-testid="assistant-message"]',
    assistantSelectors: [
      '[data-testid="assistant-message"]',
      '[data-test-render="assistant"]',
      ".font-claude-message",
    ],
    contentSelectors: [".standard-markdown", ".prose", ".markdown"],
    userContentSelectors: [".font-user-message", ".prose", ".markdown", '[class*="message"]'],
    actionBarSelectors: [
      'button[aria-label="Copy"]',
      'button[aria-label="Copy message"]',
    ],
  },
  gemini: {
    label: "Gemini",
    hostMatch: "gemini.google.com",
    turnSelector:
      'message-content.user-query, message-content.model-response, .model-response, [data-test-id="user-query"], [data-test-id="model-response"]',
    assistantSelectors: [
      ".model-response-text",
      "message-content.model-response",
      ".model-response",
      '[data-test-id="model-response"]',
      ".response-container",
      "model-response",
    ],
    contentSelectors: [
      ".model-response-text",
      ".markdown",
      ".prose",
      ".response-content",
      "message-content",
    ],
    userContentSelectors: [".query-text", ".user-query-text", ".markdown", "message-content"],
    actionBarSelectors: [
      'button[aria-label="Copy"]',
      'button[aria-label="Copy response"]',
      "copy-button",
      '[data-test-id="copy-button"]',
    ],
  },
};

(function () {
  "use strict";

  if (window.__NECTAR_AI_VERSION__ === NECTAR_VERSION) return;
  window.__NECTAR_AI_VERSION__ = NECTAR_VERSION;

  // ── Styles ────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById("nectar-ai-styles")) return;
    const style = document.createElement("style");
    style.id = "nectar-ai-styles";
    style.textContent = `
      .nectar-ai-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 28px;
        padding: 0 10px;
        font-size: 13px;
        font-weight: 500;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: rgba(0, 0, 0, 0.55);
        background: transparent;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
        margin-left: 4px;
        margin-top: 4px;
        line-height: 1;
        transition: background 0.18s, border-color 0.18s, color 0.18s, transform 0.12s;
      }
      html.dark .nectar-ai-btn, .dark .nectar-ai-btn,
      [data-theme="dark"] .nectar-ai-btn,
      .dark-theme .nectar-ai-btn {
        color: rgba(255, 255, 255, 0.65);
        background: rgba(255, 255, 255, 0.04);
        border-color: rgba(255, 255, 255, 0.1);
      }
      .nectar-ai-btn:hover:not(:disabled) {
        background: rgba(245, 158, 11, 0.1);
        border-color: rgba(245, 158, 11, 0.35);
        color: #d97706;
      }
      html.dark .nectar-ai-btn:hover:not(:disabled),
      .dark .nectar-ai-btn:hover:not(:disabled) {
        background: rgba(245, 158, 11, 0.14);
        border-color: rgba(251, 191, 36, 0.4);
        color: #fbbf24;
      }
      .nectar-ai-btn:active:not(:disabled) { transform: scale(0.96); }
      .nectar-ai-btn:disabled { opacity: 0.65; cursor: wait; }
      .nectar-ai-btn.nectar-loading {
        border-color: rgba(245, 158, 11, 0.4);
        animation: nectar-border-pulse 1.2s ease-in-out infinite;
      }
      @keyframes nectar-border-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
        50%       { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2); }
      }
      .nectar-ai-btn.nectar-success {
        color: #16a34a;
        border-color: rgba(34, 197, 94, 0.4);
        background: rgba(34, 197, 94, 0.08);
      }
      html.dark .nectar-ai-btn.nectar-success { color: #4ade80; background: rgba(34, 197, 94, 0.12); }
      .nectar-ai-label { display: inline; }
      .nectar-ai-check {
        display: none;
        font-size: 14px;
        font-weight: 700;
        animation: nectar-check-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }
      .nectar-ai-btn.nectar-success .nectar-ai-label { display: none; }
      .nectar-ai-btn.nectar-success .nectar-ai-check  { display: inline-block; }
      @keyframes nectar-check-pop {
        0%   { transform: scale(0) rotate(-45deg); opacity: 0; }
        70%  { transform: scale(1.25); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      .nectar-ai-btn.nectar-error {
        color: #dc2626;
        border-color: rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.06);
      }
      .nectar-ai-bar {
        display: flex;
        align-items: center;
        gap: 2px;
        margin-top: 6px;
        padding-top: 2px;
      }

      /* ── Floating selection extractor ── */
      .nectar-float-btn {
        position: fixed;
        z-index: 2147483646;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 32px;
        padding: 0 14px;
        font-size: 13px;
        font-weight: 600;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: #1a1a1a;
        background: linear-gradient(135deg, #fde68a, #f59e0b);
        border: none;
        border-radius: 999px;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.45), 0 2px 6px rgba(0,0,0,0.12);
        transition: transform 0.12s ease, box-shadow 0.15s ease;
        pointer-events: auto;
      }
      .nectar-float-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(245, 158, 11, 0.55);
      }
      .nectar-float-btn:disabled { opacity: 0.75; cursor: wait; }

      .nectar-float-tooltip {
        position: fixed;
        z-index: 2147483647;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        font-family: ui-sans-serif, system-ui, sans-serif;
        color: #166534;
        background: #dcfce7;
        border: 1px solid #86efac;
        border-radius: 999px;
        box-shadow: 0 4px 12px rgba(34, 197, 94, 0.25);
        pointer-events: none;
        opacity: 1;
        transition: opacity 0.5s ease;
      }
      .nectar-float-tooltip.nectar-fade-out { opacity: 0; }
    `;
    document.head.appendChild(style);
  }

  // ── Platform detection ────────────────────────────────────────────────────

  function detectPlatform() {
    const host = window.location.hostname;
    for (const [key, cfg] of Object.entries(PLATFORMS)) {
      if (host.includes(cfg.hostMatch)) return key;
    }
    return null;
  }

  function getPlatformConfig(platform) {
    return PLATFORMS[platform] ?? null;
  }

  // ── Text utilities ────────────────────────────────────────────────────────

  /** Strip UI chrome noise from scraped text. */
  function cleanExtractedText(text) {
    const UI_LINE =
      /^(Copy code|Copied!?|Copy|Regenerate|Edit message|Good response|Bad response|Share( conversation)?|Listen|Read aloud|Thumb up|Thumb down|Report|More actions)$/i;

    return text
      .split("\n")
      .filter((line) => !UI_LINE.test(line.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractTextFromElement(el, platform, role = "assistant") {
    const cfg = getPlatformConfig(platform);
    const contentSels =
      role === "user"
        ? (cfg?.userContentSelectors ?? [".markdown", ".prose"])
        : (cfg?.contentSelectors ?? [".markdown", ".prose"]);

    for (const sel of contentSels) {
      const node = el.matches?.(sel) ? el : el.querySelector(sel);
      if (node?.innerText?.trim()) return cleanExtractedText(node.innerText);
    }

    if (el?.innerText?.trim()) return cleanExtractedText(el.innerText);
    return null;
  }

  /** Gemini-specific selector registry (DOM changes frequently — multiple fallbacks). */
  const GEMINI = {
    turnSelectors: [
      "chat-turn",
      "conversation-turn",
      ".conversation-turn",
      ".conversation-container > *",
      '[data-test-id="conversation-turn"]',
      "main infinite-scroller > div",
    ],
    userSelectors: [
      "user-query",
      ".user-query",
      ".user-prompt-container",
      '[data-test-id="user-query"]',
      '[data-message-author="user"]',
      "message-content.user-query",
      ".query-text",
    ],
    userTextSelectors: [".query-text", ".query-text-line", ".user-prompt-container"],
    modelSelectors: [
      "model-response",
      ".model-response",
      '[data-test-id="model-response"]',
      '[data-message-author="model"]',
      "message-content.model-response",
    ],
    modelTextSelectors: [
      "message-content",
      ".message-content",
      ".markdown-main-panel",
      ".markdown",
      ".model-response-text",
      ".response-content",
    ],
    wrapperSelectors: [
      "main",
      '[role="main"]',
      ".conversation-container",
      "chat-history",
      "infinite-scroller",
    ],
    messageNodeSelectors: [
      "chat-turn",
      "user-query",
      "model-response",
      "message-content",
      '[data-test-id="user-query"]',
      '[data-test-id="model-response"]',
      ".query-text",
    ],
  };

  function isGeminiThoughtPanel(el) {
    return !!el?.closest?.("model-thoughts, .thoughts-container, .thoughts-content");
  }

  function extractGeminiUserText(el) {
    for (const sel of GEMINI.userTextSelectors) {
      const node = el.matches?.(sel) ? el : el.querySelector(sel);
      if (node?.innerText?.trim()) return cleanExtractedText(node.innerText);
    }
    if (el?.innerText?.trim()) return cleanExtractedText(el.innerText);
    return null;
  }

  function extractGeminiModelText(el) {
    if (isGeminiThoughtPanel(el)) return null;

    for (const sel of GEMINI.modelTextSelectors) {
      const nodes = el.matches?.(sel) ? [el] : [...el.querySelectorAll(sel)];
      for (const node of nodes) {
        if (isGeminiThoughtPanel(node)) continue;
        if (node.innerText?.trim()) return cleanExtractedText(node.innerText);
      }
    }

    if (el?.innerText?.trim()) return cleanExtractedText(el.innerText);
    return null;
  }

  /** Sort elements top-to-bottom by DOM position (index 0 → N). */
  function sortByDocumentOrder(elements) {
    return [...elements].sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  /** Remove parent elements when a nested child is also matched. */
  function keepInnermostElements(elements) {
    return elements.filter(
      (el) => !elements.some((other) => other !== el && el.contains(other))
    );
  }

  /**
   * Strategy 1 — walk each Gemini turn container and pull user + model text.
   * Iterates index 0 → N, never .pop() or [length - 1].
   */
  function getGeminiTurnsFromContainers() {
    let turnElements = [];

    for (const sel of GEMINI.turnSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        turnElements = [...els];
        console.log("[Nectar AI] Gemini turn selector:", sel, "→", els.length, "turns");
        break;
      }
    }

    const blocks = [];

    turnElements.forEach((turn, turnIndex) => {
      let userText = "";
      for (const sel of GEMINI.userSelectors) {
        const el = turn.querySelector(sel);
        if (!el) continue;
        userText = extractGeminiUserText(el);
        if (userText) break;
      }
      if (userText) blocks.push({ role: "user", text: userText, turnIndex });

      let modelText = "";
      for (const sel of GEMINI.modelSelectors) {
        const el = turn.querySelector(sel);
        if (!el || isGeminiThoughtPanel(el)) continue;
        modelText = extractGeminiModelText(el);
        if (modelText) break;
      }
      if (modelText) blocks.push({ role: "assistant", text: modelText, turnIndex });
    });

    return blocks;
  }

  /**
   * Strategy 2 — query ALL user + model elements on the page, dedupe, sort top→bottom.
   * Fallback when turn containers aren't found.
   */
  function getGeminiFlatBlocks() {
    const candidates = [];

    for (const sel of GEMINI.userSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const text = extractGeminiUserText(el);
        if (text) candidates.push({ role: "user", text, el });
      });
    }

    for (const sel of [...GEMINI.modelSelectors, "message-content"]) {
      document.querySelectorAll(sel).forEach((el) => {
        if (isGeminiThoughtPanel(el)) return;
        const text = extractGeminiModelText(el);
        if (text) candidates.push({ role: "assistant", text, el });
      });
    }

    const innermost = keepInnermostElements(candidates.map((c) => c.el));
    const innerSet = new Set(innermost);

    return sortByDocumentOrder(
      candidates.filter((c) => innerSet.has(c.el))
    ).map(({ role, text }, index) => ({ role, text, index }));
  }

  function getGeminiRoleFromNode(el) {
    if (
      el.matches?.(
        "user-query, .user-query, message-content.user-query, [data-test-id='user-query'], [data-message-author='user']"
      ) ||
      el.closest?.("user-query, message-content.user-query")
    ) {
      return "user";
    }
    return "assistant";
  }

  function resolveGeminiMessageNode(el) {
    return (
      el.closest?.("chat-turn") ??
      el.closest?.("user-query") ??
      el.closest?.("model-response") ??
      el.closest?.("message-content") ??
      el
    );
  }

  /** Find the main Gemini conversation wrapper element. */
  function findGeminiConversationWrapper() {
    for (const sel of GEMINI.wrapperSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        console.log("[Nectar AI] Gemini wrapper found:", sel);
        return el;
      }
    }
    return document.querySelector("main") ?? document.body;
  }

  /**
   * Feature A — Container-level full scraper.
   * Queries ALL message nodes inside the conversation wrapper, top → bottom.
   */
  function getGeminiContainerBlocks() {
    const wrapper = findGeminiConversationWrapper();
    const combinedSelector = GEMINI.messageNodeSelectors.join(", ");
    const nodes = wrapper.querySelectorAll(combinedSelector);

    const blocks = [];
    const seen = new Set();

    for (const el of sortByDocumentOrder([...nodes])) {
      if (isGeminiThoughtPanel(el)) continue;

      const container = resolveGeminiMessageNode(el);
      if (seen.has(container)) continue;
      seen.add(container);

      const role = getGeminiRoleFromNode(container);
      const text =
        role === "user"
          ? extractGeminiUserText(container)
          : extractGeminiModelText(container);

      if (text) blocks.push({ role, text });
    }

    if (blocks.length > 0) {
      console.log("[Nectar AI] Gemini container-level blocks:", blocks.length);
      return blocks;
    }

    // TreeWalker fallback — walk structured child nodes inside wrapper
    return getGeminiContainerBlocksViaWalker(wrapper);
  }

  /** Fallback: TreeWalker through wrapper for message web-components. */
  function getGeminiContainerBlocksViaWalker(wrapper) {
    const blocks = [];
    const seen = new Set();

    const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (isGeminiThoughtPanel(node)) return NodeFilter.FILTER_REJECT;
        const tag = node.tagName?.toLowerCase() ?? "";
        if (["user-query", "model-response", "chat-turn", "message-content"].includes(tag)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        if (node.matches?.('[data-test-id="user-query"], [data-test-id="model-response"]')) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });

    let node = walker.nextNode();
    while (node) {
      if (!seen.has(node)) {
        seen.add(node);
        const role = getGeminiRoleFromNode(node);
        const text =
          role === "user" ? extractGeminiUserText(node) : extractGeminiModelText(node);
        if (text) blocks.push({ role, text });
      }
      node = walker.nextNode();
    }

    console.log("[Nectar AI] Gemini TreeWalker blocks:", blocks.length);
    return blocks;
  }

  /** Dedicated Gemini full-conversation scraper (container → turn → flat). */
  function getGeminiConversationTurns() {
    const containerBlocks = getGeminiContainerBlocks();
    if (containerBlocks.length > 0) return containerBlocks;

    const turnBlocks = getGeminiTurnsFromContainers();
    if (turnBlocks.length > 0) {
      console.log("[Nectar AI] Gemini turn-based blocks:", turnBlocks.length);
      return turnBlocks;
    }

    const flatBlocks = getGeminiFlatBlocks();
    console.log("[Nectar AI] Gemini flat-query blocks:", flatBlocks.length);
    return flatBlocks;
  }

  /** Determine whether a message container is from the user or the AI. */
  function getRoleFromElement(el, platform) {
    if (platform === "chatgpt") {
      const role = el.getAttribute("data-message-author-role");
      return role === "user" ? "user" : "assistant";
    }
    if (platform === "claude") {
      if (
        el.matches('[data-testid="user-message"], .font-user-message') ||
        el.closest('[data-testid="user-message"]')
      ) {
        return "user";
      }
      return "assistant";
    }
    if (platform === "gemini") {
      if (
        el.matches("message-content.user-query, .user-query, [data-test-id='user-query']") ||
        el.classList?.contains("user-query") ||
        el.closest("message-content.user-query")
      ) {
        return "user";
      }
      return "assistant";
    }
    return "assistant";
  }

  function resolveTurnContainer(el, platform) {
    if (platform === "chatgpt") {
      // Always use the top-level role container
      return el.closest("[data-message-author-role]") ?? el;
    }
    if (platform === "claude") {
      return (
        el.closest('[data-testid="user-message"]') ??
        el.closest('[data-testid="assistant-message"]') ??
        el.closest(".font-user-message") ??
        el.closest(".font-claude-message") ??
        el
      );
    }
    if (platform === "gemini") {
      return (
        el.closest("message-content") ??
        el.closest(".model-response") ??
        el.closest(".response-container") ??
        el
      );
    }
    return el;
  }

  /** Platform selectors that match ALL user + assistant message containers. */
  function getFullConversationSelector(platform) {
    switch (platform) {
      case "chatgpt":
        return "[data-message-author-role]";
      case "claude":
        return '[data-testid="user-message"], [data-testid="assistant-message"], .font-user-message, .font-claude-message';
      case "gemini":
        return "message-content, .model-response, .response-container";
      default:
        return "";
    }
  }

  /** Return every conversation turn in DOM order — never .pop() or last-only. */
  function getAllConversationTurns(platform) {
    if (platform === "gemini") return getGeminiConversationTurns();

    const selector = getFullConversationSelector(platform);
    if (!selector) return [];

    const seen = new Set();
    const turns = [];

    for (const el of document.querySelectorAll(selector)) {
      const container = resolveTurnContainer(el, platform);
      if (seen.has(container)) continue;
      seen.add(container);

      const role = getRoleFromElement(container, platform);
      const text = extractTextFromElement(container, platform, role);
      if (!text) continue;

      turns.push({ role, text, element: container });
    }

    return turns;
  }

  /** Build structured transcript with platform-specific headings. */
  function formatTranscript(turns, platform) {
    const parts =
      platform === "gemini"
        ? ["# Nectar AI - Full Chat Export", ""]
        : ["## Full Conversation Transcript", ""];

    turns.forEach(({ role, text }, index) => {
      if (role === "user") {
        parts.push("### 👤 User:", text, "");
      } else if (platform === "gemini") {
        parts.push("### 🐝 Nectar AI (Gemini):", text, "");
      } else {
        parts.push("### 🤖 AI:", text, "");
      }
      if (index < turns.length - 1) parts.push("---", "");
    });

    return parts.join("\n").trim();
  }

  /** Scrape ALL visible user + assistant messages into one transcript string. */
  function extractFullConversation(platform) {
    const turns = getAllConversationTurns(platform);
    console.log("[Nectar AI] Extracted total blocks:", turns.length, "| platform:", platform);

    if (!turns.length) return null;
    return formatTranscript(turns, platform);
  }

  /** Collect all assistant message elements for the active platform. */
  function getAllAssistantMessages(platform) {
    const cfg = getPlatformConfig(platform);
    if (!cfg) return [];

    const seen = new Set();
    const results = [];

    for (const sel of cfg.assistantSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        // Walk up to a reasonable container to avoid nested duplicates
        const container =
          el.closest('[data-message-author-role="assistant"]') ??
          el.closest(".model-response") ??
          el.closest('[data-testid="assistant-message"]') ??
          el.closest("message-content") ??
          el;

        if (!seen.has(container)) {
          seen.add(container);
          results.push(container);
        }
      });
      if (results.length) break;
    }

    return results;
  }

  function extractLatestAssistantText(platform) {
    const messages = getAllAssistantMessages(platform);
    if (!messages.length) return null;
    return extractTextFromElement(messages[messages.length - 1], platform);
  }

  // ── Metadata builder ──────────────────────────────────────────────────────

  const TEMPLATE_LABELS = {
    "bullet-summary": "Bullet Summary",
    "social-post": "Social Post",
    "campaign-strategy": "Campaign Strategy",
  };

  function buildExportMetadata(platform, templateMode, rawText, extractionScope = "latest") {
    const platformTag = PLATFORMS[platform]?.label ?? platform;
    const templateLabel = TEMPLATE_LABELS[templateMode] ?? templateMode;
    const createdAt = new Date().toISOString();
    const createdAtDisplay = new Date(createdAt).toLocaleString();
    const snippet = rawText.split("\n")[0].slice(0, 55).trim();

    const title =
      extractionScope === "full"
        ? `🍯 ${platformTag} · Full Conversation · ${createdAtDisplay}`
        : extractionScope === "selection"
          ? `🍯 ${platformTag} · Selection · ${createdAtDisplay}`
          : `🍯 ${platformTag} · ${templateLabel}${snippet ? ` — ${snippet}${rawText.length > 55 ? "…" : ""}` : ""}`;

    return {
      platform,
      platformTag,
      templateMode,
      templateLabel,
      extractionScope,
      title,
      createdAt,
      createdAtDisplay,
    };
  }

  // ── Template formatters ───────────────────────────────────────────────────

  function formatBulletSummary(rawText) {
    const bullets = rawText
      .split(/\n+/)
      .flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed) return [];
        if (trimmed.length > 200 && !/^[-•*]\s/.test(trimmed)) {
          return trimmed.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 10);
        }
        return [trimmed.replace(/^[-•*]\s*/, "")];
      })
      .filter(Boolean)
      .map((p) => `- ${p}`);
    return ["## Bullet Summary", "", ...bullets].join("\n");
  }

  function formatSocialPost(rawText) {
    const lines = rawText.split("\n").filter((l) => l.trim());
    const hook = lines[0]?.slice(0, 120) ?? rawText.slice(0, 120);
    const body = lines.slice(1).join("\n").trim() || rawText;
    const hashtags = [...rawText.matchAll(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/g)]
      .map((m) => m[1].replace(/\s+/g, "")).filter((t) => t.length > 3)
      .slice(0, 5).map((t) => `#${t}`).join(" ");
    return [
      "## Social Post", "", `🔥 ${hook}`, "", body, "",
      "✨ What do you think? Drop a comment!",
      hashtags ? `\n${hashtags} #AI #Insights` : "\n#AI #Insights",
    ].join("\n").trim();
  }

  function formatCampaignStrategy(rawText) {
    const paragraphs = rawText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
    const third = Math.max(1, Math.ceil(paragraphs.length / 3));
    const toBullets = (items) =>
      (items.length ? items : ["Review and refine based on context."])
        .flatMap((i) => i.split("\n")).map((l) => l.replace(/^[-•*]\s*/, "").trim())
        .filter(Boolean).map((l) => `- ${l}`).join("\n");

    return [
      "## Campaign Strategy", "", "## Objective",
      paragraphs[0] ?? lines.slice(0, Math.ceil(lines.length / 3)).join(" ") ?? rawText.slice(0, 300),
      "", "## Key Pillars",
      toBullets(paragraphs.slice(1, third + 1).length ? paragraphs.slice(1, third + 1) : lines.slice(Math.ceil(lines.length / 3), Math.ceil((lines.length * 2) / 3))),
      "", "## Action Items",
      toBullets(paragraphs.slice(third + 1).length ? paragraphs.slice(third + 1) : lines.slice(Math.ceil((lines.length * 2) / 3))),
    ].join("\n").trim();
  }

  function formatByTemplate(rawText, templateMode) {
    switch (templateMode) {
      case "bullet-summary":    return formatBulletSummary(rawText);
      case "social-post":       return formatSocialPost(rawText);
      case "campaign-strategy": return formatCampaignStrategy(rawText);
      default:                  return rawText;
    }
  }

  async function getActiveExtractionScope(override) {
    if (override === "full" || override === "single") return override === "full" ? "full" : "latest";
    if (override) return override;
    const stored = await chrome.storage.local.get(STORAGE_KEYS.extractionScope);
    return stored[STORAGE_KEYS.extractionScope] ?? "latest";
  }

  async function getActiveTemplateMode(override) {
    if (override) return override;
    const stored = await chrome.storage.local.get(STORAGE_KEYS.templateMode);
    return stored[STORAGE_KEYS.templateMode] ?? "bullet-summary";
  }

  // ── Notion export ─────────────────────────────────────────────────────────

  async function exportToNotion(formattedText, metadata) {
    const result = await chrome.runtime.sendMessage({
      action: "EXPORT_TO_NOTION",
      payload: { formattedText, metadata },
    });
    if (!result?.success) throw new Error(result?.error ?? "Notion export failed.");
    return result;
  }

  // ── Injected button UI ────────────────────────────────────────────────────

  function setButtonState(btn, state, message) {
    btn.classList.remove("nectar-success", "nectar-error", "nectar-loading");
    const label = btn.querySelector(".nectar-ai-label");
    if (label) label.textContent = message;
    if (state === "loading") btn.classList.add("nectar-loading");
    if (state === "success") btn.classList.add("nectar-success");
    if (state === "error")   btn.classList.add("nectar-error");
  }

  function resetButton(btn, delayMs = 3500) {
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove("nectar-success", "nectar-error", "nectar-loading");
      btn.innerHTML =
        '<span class="nectar-ai-label">Nectar 🍯</span>' +
        '<span class="nectar-ai-check" aria-hidden="true">✓</span>';
    }, delayMs);
  }

  async function handleNectarButtonClick(assistantEl, btn) {
    btn.disabled = true;
    setButtonState(btn, "loading", "Saving...");

    try {
      const platform = detectPlatform();
      const rawText = extractTextFromElement(assistantEl, platform);
      if (!rawText) throw new Error("No text found.");

      const templateMode = await getActiveTemplateMode();
      const formattedText = formatByTemplate(rawText, templateMode);
      const metadata = buildExportMetadata(platform, templateMode, rawText);

      await exportToNotion(formattedText, metadata);

      setButtonState(btn, "success", "Saved!");
      resetButton(btn, 2800);
    } catch (err) {
      console.error("[Nectar AI]", err);
      const msg = err.message.length > 28 ? err.message.slice(0, 28) + "…" : err.message;
      setButtonState(btn, "error", msg);
      resetButton(btn, 4000);
    }
  }

  // ── Button injection (all platforms) ─────────────────────────────────────

  function findActionBar(assistantEl, platform) {
    const cfg = getPlatformConfig(platform);
    const anchors = cfg?.actionBarSelectors ?? ['button[aria-label="Copy"]'];

    for (const sel of anchors) {
      const anchor = assistantEl.querySelector(sel);
      if (anchor?.parentElement) return anchor.parentElement;
    }

    // Fallback bar below content
    let bar = assistantEl.querySelector(".nectar-ai-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "nectar-ai-bar";
      const contentSels = cfg?.contentSelectors ?? [".markdown"];
      let inserted = false;
      for (const sel of contentSels) {
        const content = assistantEl.querySelector(sel);
        if (content) { content.after(bar); inserted = true; break; }
      }
      if (!inserted) assistantEl.appendChild(bar);
    }
    return bar;
  }

  function createNectarButton(assistantEl) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nectar-ai-btn";
    btn.title = "Save this response to Notion";
    btn.innerHTML =
      '<span class="nectar-ai-label">Nectar 🍯</span>' +
      '<span class="nectar-ai-check" aria-hidden="true">✓</span>';
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleNectarButtonClick(assistantEl, btn);
    });
    return btn;
  }

  function injectButtonIfMissing(assistantEl) {
    if (assistantEl.querySelector(".nectar-ai-btn")) return;
    const actionBar = findActionBar(assistantEl, detectPlatform());
    if (!actionBar) return;
    actionBar.appendChild(createNectarButton(assistantEl));
  }

  function injectButtonsOnAllMessages() {
    const platform = detectPlatform();
    if (!platform) return;
    getAllAssistantMessages(platform).forEach(injectButtonIfMissing);
  }

  function startButtonObserver() {
    const platform = detectPlatform();
    if (!platform) return;

    injectStyles();
    injectButtonsOnAllMessages();

    const observer = new MutationObserver(() => injectButtonsOnAllMessages());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Feature B: Highlight Selection Extractor ─────────────────────────────

  let floatBtn = null;
  let floatTooltip = null;
  let floatHideTimer = null;

  function removeFloatUI() {
    clearTimeout(floatHideTimer);
    floatBtn?.remove();
    floatBtn = null;
    floatTooltip?.remove();
    floatTooltip = null;
  }

  function showFloatTooltip(x, y) {
    floatTooltip = document.createElement("div");
    floatTooltip.className = "nectar-float-tooltip";
    floatTooltip.textContent = "Saved to Notion! ✅";
    floatTooltip.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
    floatTooltip.style.top = `${Math.max(y - 40, 8)}px`;
    document.body.appendChild(floatTooltip);

    floatHideTimer = setTimeout(() => {
      floatTooltip?.classList.add("nectar-fade-out");
      setTimeout(removeFloatUI, 550);
    }, 1400);
  }

  function showFloatButton(x, y) {
    removeFloatUI();

    floatBtn = document.createElement("button");
    floatBtn.type = "button";
    floatBtn.className = "nectar-float-btn";
    floatBtn.textContent = "Nectar 🍯";
    floatBtn.style.left = `${Math.min(x + 8, window.innerWidth - 120)}px`;
    floatBtn.style.top = `${Math.max(y - 40, 8)}px`;

    // Prevent mousedown from clearing the text selection before click fires
    floatBtn.addEventListener("mousedown", (e) => e.preventDefault());

    floatBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const text = window.getSelection()?.toString()?.trim();
      if (!text) { removeFloatUI(); return; }

      floatBtn.disabled = true;
      floatBtn.textContent = "Saving...";

      try {
        const platform = detectPlatform();
        const templateMode = await getActiveTemplateMode();
        const formattedText = `## Highlighted Selection\n\n${cleanExtractedText(text)}`;
        const metadata = buildExportMetadata(platform, templateMode, text, "selection");
        metadata.title = `🍯 ${PLATFORMS[platform]?.label ?? platform} · Selection · ${metadata.createdAtDisplay}`;

        await exportToNotion(formattedText, metadata);
        window.getSelection()?.removeAllRanges();
        removeFloatUI();
        showFloatTooltip(x, y);
      } catch (err) {
        console.error("[Nectar AI] Selection export error:", err);
        floatBtn.textContent = "Error";
        setTimeout(removeFloatUI, 1800);
      }
    });

    document.body.appendChild(floatBtn);
  }

  function handleSelectionMouseUp(e) {
    if (e.target?.closest?.(".nectar-float-btn, .nectar-float-tooltip, .nectar-ai-btn")) return;

    // Defer so the browser finalises the selection range first
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString()?.trim();

      if (!text || text.length < 2) {
        removeFloatUI();
        return;
      }

      let x = e.clientX;
      let y = e.clientY;

      try {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          x = rect.right;
          y = rect.top;
        }
      } catch { /* use mouse coords */ }

      showFloatButton(x, y);
    }, 12);
  }

  function startSelectionExtractor() {
    if (!detectPlatform()) return;

    document.addEventListener("mouseup", handleSelectionMouseUp);

    // Dismiss float button when clicking elsewhere (but not before button click)
    document.addEventListener("mousedown", (e) => {
      if (e.target?.closest?.(".nectar-float-btn, .nectar-float-tooltip")) return;
      setTimeout(() => {
        const sel = window.getSelection()?.toString()?.trim();
        if (!sel) removeFloatUI();
      }, 180);
    });
  }

  // ── Popup-triggered extraction ────────────────────────────────────────────

  function extractNectar({ template = "bullet-summary", mode = "single" } = {}) {
    const platform = detectPlatform();
    if (!platform) {
      return { success: false, error: "Unsupported page. Open ChatGPT, Claude, or Gemini." };
    }

    const isFull = mode === "full";
    let rawText;
    let formattedText;

    if (isFull) {
      // Collect ALL turns — never last-only
      rawText = extractFullConversation(platform);
      if (!rawText) {
        return {
          success: false,
          error: `No conversation found on ${PLATFORMS[platform].label}. Start a chat first.`,
        };
      }
      formattedText = rawText;
    } else {
      rawText = extractLatestAssistantText(platform);
      if (!rawText) {
        return {
          success: false,
          error: `No assistant response found on ${PLATFORMS[platform].label}. Scroll to the latest reply.`,
        };
      }
      formattedText = formatByTemplate(rawText, template);
    }

    const metadata = buildExportMetadata(platform, template, rawText, isFull ? "full" : "latest");

    return {
      success: true,
      data: {
        platform,
        templateMode: template,
        mode,
        rawText,
        formattedText,
        metadata,
        charCount: rawText.length,
        turnCount: isFull ? getAllConversationTurns(platform).length : 1,
      },
    };
  }

  // ── Message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "PING") {
      sendResponse({ pong: true, version: NECTAR_VERSION });
      return;
    }

    if (message.action === "EXTRACT_NECTAR") {
      // Popup sends explicit mode + template — use directly, no storage fallback
      if (message.fromPopup) {
        const mode = message.mode === "full" ? "full" : "single";
        const template = message.template ?? "bullet-summary";
        console.log("[Nectar AI] Extract request:", { mode, template });
        sendResponse(extractNectar({ mode, template }));
        return true;
      }

      // Fallback for other callers: read from storage
      Promise.all([
        getActiveTemplateMode(message.template ?? message.templateMode),
        getActiveExtractionScope(message.mode ?? message.extractionScope),
      ]).then(([template, scope]) => {
        const mode = scope === "full" ? "full" : "single";
        sendResponse(extractNectar({ mode, template }));
      });
      return true;
    }

    return true;
  });

  startButtonObserver();
  startSelectionExtractor();
  console.log(`[Nectar AI] v${NECTAR_VERSION} ready —`, detectPlatform() ?? "unsupported host");
})();
