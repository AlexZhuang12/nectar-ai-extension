/**
 * Nectar AI – sync Supabase session from the web app into the extension.
 */
(function () {
  const MESSAGE_TYPE = "NECTAR_EXTENSION_AUTH_SYNC";

  function findSupabaseAuthEntry() {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.includes("-auth-token")) {
          const value = localStorage.getItem(key);
          if (value) return value;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function syncSession(rawSession) {
    if (!rawSession || !chrome?.runtime?.id) return;

    chrome.runtime.sendMessage(
      {
        action: "SYNC_SUPABASE_SESSION",
        rawSession,
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== MESSAGE_TYPE) return;
    syncSession(event.data.rawSession);
  });

  const script = document.createElement("script");
  script.textContent = `
    (function () {
      try {
        var raw = null;
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf("-auth-token") !== -1) {
            raw = localStorage.getItem(key);
            if (raw) break;
          }
        }
        if (raw) {
          window.postMessage({ type: "${MESSAGE_TYPE}", rawSession: raw }, "*");
        }
      } catch (e) {}
    })();
  `;
  (document.documentElement || document.head).appendChild(script);
  script.remove();

  const localSession = findSupabaseAuthEntry();
  if (localSession) syncSession(localSession);
})();
