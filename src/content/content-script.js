(() => {
  const TYPES = {
    CONTENT_READY: "contentReady",
    URL_CHANGED: "urlChanged",
    SHOW_CHALLENGE: "showChallenge",
    HIDE_CHALLENGE: "hideChallenge",
    SUBMIT_ANSWER: "submitAnswer",
    APPLY_APPEARANCE: "applyAppearance",
  };
  const HOST_ID = "browsing-breaks-lock-host";
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

  let currentChallenge = null;
  let currentAppearance = { textColor: "#c9d1d9", backgroundColor: "#000000" };
  let host = null;
  let shadow = null;
  let answerInput = null;
  let errorElement = null;
  let lastUrl = location.href;
  let observer = null;
  let previousOverflow = null;
  let urlPollTimer = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === TYPES.SHOW_CHALLENGE && message.challenge) {
      currentChallenge = message.challenge;
      currentAppearance = message.appearance || currentAppearance;
      renderLock();
    } else if (message?.type === TYPES.HIDE_CHALLENGE) {
      unlock();
    } else if (message?.type === TYPES.APPLY_APPEARANCE && message.appearance) {
      currentAppearance = message.appearance;
      applyAppearance();
    }
  });

  safeSendMessage({ type: TYPES.CONTENT_READY, url: location.href })
    .then((response) => {
      if (response?.challenge) {
        currentChallenge = response.challenge;
        currentAppearance = response.appearance || currentAppearance;
        renderLock();
      }
    });

  // webNavigationを補完し、pushState/replaceState/hash変更を確実に拾う。
  urlPollTimer = setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    void safeSendMessage({ type: TYPES.URL_CHANGED, url: lastUrl });
  }, 300);

  async function safeSendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      // 拡張機能の更新・再読み込みで古いContent Scriptのコンテキストが
      // 無効になった場合、同期例外を表へ出さずURL監視を終了する。
      if (!hasRuntimeContext() && urlPollTimer !== null) {
        clearInterval(urlPollTimer);
        urlPollTimer = null;
      }
      return undefined;
    }
  }

  function hasRuntimeContext() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function renderLock() {
    if (!currentChallenge) return;
    if (!document.documentElement) {
      requestAnimationFrame(renderLock);
      return;
    }

    if (!host || !host.isConnected) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("role", "presentation");
      host.style.cssText = [
        "all: initial",
        "position: fixed",
        "inset: 0",
        "display: block",
        "width: 100vw",
        "height: 100vh",
        "z-index: 2147483647",
        "isolation: isolate",
        "background: var(--bb-background, #000000)",
      ].join(";");
      shadow = host.attachShadow({ mode: "closed" });

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("src/content/modal.css");
      shadow.append(link);

      const overlay = document.createElement("div");
      overlay.className = "overlay";
      overlay.lang = chrome.i18n.getUILanguage().toLowerCase().startsWith("ja") ? "ja" : "en";
      overlay.innerHTML = `
        <main class="card" role="dialog" aria-modal="true" aria-labelledby="browsing-breaks-title">
          <h1 id="browsing-breaks-title">${t("breakTime")}</h1>
          <p class="problem" aria-live="polite"></p>
          <form novalidate>
            <label for="browsing-breaks-answer">${t("answerLabel")}</label>
            <input id="browsing-breaks-answer" type="text" inputmode="numeric" autocomplete="off" placeholder="${t("answerPlaceholder")}" />
            <button type="submit">${t("submitAnswer")}</button>
            <p class="error" role="alert" aria-live="assertive"></p>
          </form>
          <p class="hint">${t("solveHint")}</p>
        </main>`;
      shadow.append(overlay);
      answerInput = shadow.querySelector("input");
      errorElement = shadow.querySelector(".error");
      shadow.querySelector("form").addEventListener("submit", submitAnswer);
    }

    shadow.querySelector(".problem").textContent =
      `${currentChallenge.left} + ${currentChallenge.right} = ?`;
    if (!host.isConnected) document.documentElement.append(host);
    if (!previousOverflow) {
      previousOverflow = {
        value: document.documentElement.style.getPropertyValue("overflow"),
        priority: document.documentElement.style.getPropertyPriority("overflow"),
      };
    }
    document.documentElement.style.setProperty("overflow", "hidden", "important");
    applyAppearance();
    installGuards();
    queueMicrotask(() => answerInput?.focus());
  }

  async function submitAnswer(event) {
    event.preventDefault();
    const answer = answerInput.value;
    answerInput.disabled = true;
    errorElement.textContent = "";
    try {
      const result = await safeSendMessage({
        type: TYPES.SUBMIT_ANSWER,
        answer,
      });
      if (result?.correct) {
        unlock();
        return;
      }
      errorElement.textContent = result?.error || t("answerUnavailable");
    } catch {
      errorElement.textContent = t("answerUnavailableRetry");
    }
    answerInput.disabled = false;
    answerInput.select();
    answerInput.focus();
  }

  function applyAppearance() {
    if (!host) return;
    host.style.setProperty("--bb-text", currentAppearance.textColor);
    host.style.setProperty("--bb-background", currentAppearance.backgroundColor);
  }

  function installGuards() {
    if (!observer) {
      observer = new MutationObserver(() => {
        if (currentChallenge && host && !host.isConnected && document.documentElement) {
          document.documentElement.append(host);
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    }
    window.addEventListener("keydown", blockOutsideInteraction, true);
    window.addEventListener("keyup", blockOutsideInteraction, true);
    window.addEventListener("keypress", blockOutsideInteraction, true);
    window.addEventListener("pointerdown", blockOutsideInteraction, true);
    window.addEventListener("click", blockOutsideInteraction, true);
    window.addEventListener("touchstart", blockOutsideInteraction, { capture: true, passive: false });
    window.addEventListener("wheel", blockOutsideInteraction, { capture: true, passive: false });
  }

  function blockOutsideInteraction(event) {
    if (!currentChallenge) return;
    const insideModal = event.composedPath().includes(host);
    if (insideModal && event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    answerInput?.focus();
  }

  function unlock() {
    currentChallenge = null;
    host?.remove();
    if (document.documentElement && previousOverflow) {
      if (previousOverflow.value) {
        document.documentElement.style.setProperty(
          "overflow",
          previousOverflow.value,
          previousOverflow.priority,
        );
      } else {
        document.documentElement.style.removeProperty("overflow");
      }
    }
    window.removeEventListener("keydown", blockOutsideInteraction, true);
    window.removeEventListener("keyup", blockOutsideInteraction, true);
    window.removeEventListener("keypress", blockOutsideInteraction, true);
    window.removeEventListener("pointerdown", blockOutsideInteraction, true);
    window.removeEventListener("click", blockOutsideInteraction, true);
    window.removeEventListener("touchstart", blockOutsideInteraction, true);
    window.removeEventListener("wheel", blockOutsideInteraction, true);
    observer?.disconnect();
    observer = null;
    host = null;
    shadow = null;
    answerInput = null;
    errorElement = null;
    previousOverflow = null;
  }
})();
