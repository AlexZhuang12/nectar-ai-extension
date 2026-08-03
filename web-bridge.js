/**
 * Nectar AI – Web App Bridge
 * Runs on nectar-ai-web.vercel.app to read Supabase auth (cookies + localStorage)
 * and sync session + profile to the extension background worker.
 */
(function () {
  const MESSAGE_TYPE = "NECTAR_EXTENSION_AUTH_SYNC";
  const PROJECT_REF = "ioblgxwmqqkaachecbnz";
  const COOKIE_PREFIX = `sb-${PROJECT_REF}-auth-token`;

  function syncSession(rawSession, profile) {
    if (!rawSession || !chrome?.runtime?.id) {
      return Promise.resolve({ success: false, error: "Missing session or extension context." });
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "SYNC_SUPABASE_SESSION",
          rawSession,
          profile: profile ?? null,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response ?? { success: false });
        }
      );
    });
  }

  function collectAuthFromPage() {
    return new Promise((resolve) => {
      const requestId = `nectar-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      function onMessage(event) {
        if (event.source !== window || event.data?.type !== MESSAGE_TYPE) return;
        if (event.data.requestId && event.data.requestId !== requestId) return;

        window.removeEventListener("message", onMessage);
        resolve({
          rawSession: event.data.rawSession ?? null,
          profile: event.data.profile ?? null,
          source: event.data.source ?? "unknown",
        });
      }

      window.addEventListener("message", onMessage);

      const script = document.createElement("script");
      script.textContent = `
        (function () {
          var requestId = ${JSON.stringify(requestId)};
          var prefix = ${JSON.stringify(COOKIE_PREFIX)};
          var messageType = ${JSON.stringify(MESSAGE_TYPE)};

          function parseSession(raw) {
            if (!raw) return null;
            var value = raw;
            try {
              if (value.indexOf("base64-") === 0) {
                value = atob(value.slice(7));
              } else {
                value = decodeURIComponent(value);
              }
              var parsed = JSON.parse(value);
              if (parsed && parsed.access_token && parsed.user && parsed.user.id) return parsed;
              if (parsed && parsed.currentSession && parsed.currentSession.access_token) return parsed.currentSession;
              if (parsed && parsed.session && parsed.session.access_token) return parsed.session;
            } catch (e) {}
            return null;
          }

          function readLocalStorageSession() {
            try {
              for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf("-auth-token") !== -1) {
                  var raw = localStorage.getItem(key);
                  if (raw) return raw;
                }
              }
            } catch (e) {}
            return null;
          }

          function readCookieSession() {
            try {
              var parts = document.cookie.split(";").map(function (c) { return c.trim(); });
              var authParts = [];
              for (var i = 0; i < parts.length; i++) {
                var eq = parts[i].indexOf("=");
                if (eq === -1) continue;
                var name = parts[i].slice(0, eq);
                var value = parts[i].slice(eq + 1);
                if (name === prefix || name.indexOf(prefix + ".") === 0) {
                  authParts.push({ name: name, value: value });
                }
              }
              authParts.sort(function (a, b) {
                return a.name.localeCompare(b.name, undefined, { numeric: true });
              });
              if (!authParts.length) return null;
              return authParts.map(function (p) { return p.value; }).join("");
            } catch (e) {}
            return null;
          }

          function readProfileHint() {
            try {
              var raw = localStorage.getItem("nectar-extension-profile");
              if (!raw) return null;
              return JSON.parse(raw);
            } catch (e) {}
            return null;
          }

          var raw = readCookieSession() || readLocalStorageSession();
          var session = parseSession(raw);
          var profile = readProfileHint();

          window.postMessage({
            type: messageType,
            requestId: requestId,
            rawSession: raw,
            profile: profile,
            source: raw ? (readCookieSession() ? "cookie" : "localStorage") : "none",
            hasSession: Boolean(session && session.access_token)
          }, "*");
        })();
      `;

      (document.documentElement || document.head).appendChild(script);
      script.remove();

      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({ rawSession: null, profile: null, source: "timeout" });
      }, 3000);
    });
  }

  async function runAuthSync() {
    const collected = await collectAuthFromPage();
    if (!collected.rawSession) {
      return {
        success: false,
        source: collected.source,
        error: "No Supabase session found on this page.",
      };
    }

    const result = await syncSession(collected.rawSession, collected.profile);
    return {
      ...result,
      source: collected.source,
      hasProfile: Boolean(collected.profile),
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== MESSAGE_TYPE) return;
    if (event.data.requestId) return;
    syncSession(event.data.rawSession, event.data.profile ?? null);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "REQUEST_AUTH_SYNC") {
      runAuthSync()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      runAuthSync().catch(() => {});
    });
  } else {
    runAuthSync().catch(() => {});
  }

  let syncTimer = null;
  window.addEventListener("storage", (event) => {
    if (!event.key || !event.key.includes("-auth-token")) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      runAuthSync().catch(() => {});
    }, 300);
  });
})();
