import {
  createInitialSiteRules,
  DUPLICATE_WINDOW_MS,
  INACTIVITY_RESET_MS,
  MESSAGE_TYPES,
  SETTINGS_VERSION,
} from "../shared/constants.js";
import {
  evaluateRule,
  generateProblem,
  isCorrectAnswer,
  isDuplicateNavigation,
  matchingRules,
  normalizeRuleState,
  reconcileRuleStates,
  resetStateAfterSolve,
  resetStateForInactivity,
  shouldKeepChallenge,
  shouldResetForInactivity,
} from "../shared/core.js";
import { getRuntimeState, getSettings } from "../shared/storage.js";
import { normalizeAppearance } from "../shared/validation.js";

let operationQueue = Promise.resolve();
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
const enqueue = (operation) => {
  operationQueue = operationQueue.then(operation, operation);
  return operationQueue;
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(["siteRules"]);
  const hasStoredSiteRules = Object.prototype.hasOwnProperty.call(stored, "siteRules");
  const settings = await getSettings();
  await chrome.storage.sync.set({
    settingsVersion: SETTINGS_VERSION,
    appearance: settings.appearance,
    siteRules: hasStoredSiteRules ? settings.siteRules : createInitialSiteRules(),
  });
});

chrome.runtime.onStartup.addListener(() => {
  void enqueue(() => resetStaleRuntimeState(Date.now()));
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.url && /^https?:\/\//.test(tab.url)) {
    await chrome.storage.local.set({ optionsExampleUrl: tab.url });
  }
  await chrome.runtime.openOptionsPage();
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  void enqueue(() => handleNavigation(details.tabId, details.url, "document", Date.now()));
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void enqueue(() => handleNavigation(details.tabId, details.url, "history", Date.now()));
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void enqueue(() => handleNavigation(details.tabId, details.url, "hash", Date.now()));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab?.id || !message || typeof message.type !== "string") return false;

  if (message.type === MESSAGE_TYPES.CONTENT_READY) {
    enqueue(() => handleContentReady(sender.tab.id, sender.tab.url || message.url))
      .then(sendResponse)
      .catch(() => sendResponse({ challenge: null }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.URL_CHANGED) {
    if (typeof message.url !== "string" || !/^https?:\/\//.test(message.url)) return false;
    if (!isSameOrigin(message.url, sender.url || sender.tab.url)) return false;
    enqueue(() =>
      handleNavigation(sender.tab.id, message.url, "content-spa", Date.now()),
    ).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.SUBMIT_ANSWER) {
    enqueue(() => handleAnswer(sender.tab.id, message.answer))
      .then(sendResponse)
      .catch(() => sendResponse({ correct: false, error: t("gradingFailed") }));
    return true;
  }
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.mutedInfo || changeInfo.mutedInfo.muted) return;
  void enqueue(async () => {
    const { activeChallenges } = await getRuntimeState();
    if (activeChallenges[String(tabId)]) {
      await chrome.tabs.update(tabId, { muted: true }).catch(() => undefined);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    const runtime = await getRuntimeState();
    delete runtime.activeChallenges[String(tabId)];
    delete runtime.tabNavigationStates[String(tabId)];
    await chrome.storage.local.set({
      activeChallenges: runtime.activeChallenges,
      tabNavigationStates: runtime.tabNavigationStates,
    });
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (changes.siteRules) {
    void enqueue(async () => {
      const { ruleStates } = await getRuntimeState();
      const next = reconcileRuleStates(
        Array.isArray(changes.siteRules.oldValue) ? changes.siteRules.oldValue : [],
        Array.isArray(changes.siteRules.newValue) ? changes.siteRules.newValue : [],
        ruleStates,
      );
      await chrome.storage.local.set({ ruleStates: next });
    });
  }
  if (changes.appearance) {
    void broadcastAppearance(normalizeAppearance(changes.appearance.newValue));
  }
});

async function handleContentReady(tabId, url) {
  const runtime = await getRuntimeState();
  const key = String(tabId);
  if (!runtime.tabNavigationStates[key]) {
    runtime.tabNavigationStates[key] = { url: String(url || ""), at: Date.now() };
    await chrome.storage.local.set({
      ruleStates: runtime.ruleStates,
      tabNavigationStates: runtime.tabNavigationStates,
    });
  }
  const challenge = runtime.activeChallenges[key];
  if (!challenge) return { challenge: null };
  const settings = await getSettings();
  const rule = settings.siteRules.find((candidate) => candidate.id === challenge.ruleId);
  let stale = false;
  if (rule) {
    const now = Date.now();
    runtime.ruleStates[rule.id] = normalizeRuleState(
      rule,
      runtime.ruleStates[rule.id],
      now,
    );
    if (shouldResetForInactivity(rule, runtime.ruleStates[rule.id], now)) {
      stale = true;
      runtime.ruleStates[rule.id] = resetStateForInactivity(
        rule,
        runtime.ruleStates[rule.id],
        now,
      );
    }
  }
  if (stale || !shouldKeepChallenge(rule, String(url || ""))) {
    delete runtime.activeChallenges[key];
    await chrome.storage.local.set({
      ruleStates: runtime.ruleStates,
      activeChallenges: runtime.activeChallenges,
      tabNavigationStates: runtime.tabNavigationStates,
    });
    await notifyChallengeCleared(tabId);
    await restoreMute(tabId, challenge);
    return { challenge: null };
  }
  await chrome.storage.local.set({ ruleStates: runtime.ruleStates });
  await chrome.tabs.update(tabId, { muted: true }).catch(() => undefined);
  return { challenge: publicChallenge(challenge), appearance: settings.appearance };
}

async function handleNavigation(tabId, url, kind, now) {
  if (!Number.isInteger(tabId) || !/^https?:\/\//.test(url)) return;
  const settings = await getSettings();
  const runtime = await getRuntimeState();
  const key = String(tabId);
  const event = { url, kind, at: now };
  const previous = runtime.tabNavigationStates[key];

  if (!previous) {
    runtime.tabNavigationStates[key] = event;
    const staleRuleIds = new Set();
    for (const rule of settings.siteRules) {
      runtime.ruleStates[rule.id] = normalizeRuleState(
        rule,
        runtime.ruleStates[rule.id],
        now,
      );
      if (shouldResetForInactivity(rule, runtime.ruleStates[rule.id], now)) {
        runtime.ruleStates[rule.id] = resetStateForInactivity(
          rule,
          runtime.ruleStates[rule.id],
          now,
        );
        staleRuleIds.add(rule.id);
      }
    }
    const staleChallenge = runtime.activeChallenges[key];
    const challengeRule = staleChallenge
      ? settings.siteRules.find((rule) => rule.id === staleChallenge.ruleId)
      : null;
    const keepChallenge = Boolean(
      staleChallenge &&
        !staleRuleIds.has(staleChallenge.ruleId) &&
        shouldKeepChallenge(challengeRule, url),
    );
    if (staleChallenge && !keepChallenge) {
      delete runtime.activeChallenges[key];
    }
    await chrome.storage.local.set({
      ruleStates: runtime.ruleStates,
      activeChallenges: runtime.activeChallenges,
      tabNavigationStates: runtime.tabNavigationStates,
    });
    if (staleChallenge && !keepChallenge) {
      await notifyChallengeCleared(tabId);
      await restoreMute(tabId, staleChallenge);
    } else if (keepChallenge) {
      await chrome.tabs.update(tabId, { muted: true }).catch(() => undefined);
    }
    return;
  }
  if (isDuplicateNavigation(previous, event, DUPLICATE_WINDOW_MS)) return;

  runtime.tabNavigationStates[key] = event;
  let challengeToRelease = null;
  const resetRuleIds = new Set();
  if (runtime.activeChallenges[key]) {
    const challenge = runtime.activeChallenges[key];
    const rule = settings.siteRules.find((candidate) => candidate.id === challenge.ruleId);
    let stale = false;
    if (rule) {
      runtime.ruleStates[rule.id] = normalizeRuleState(
        rule,
        runtime.ruleStates[rule.id],
        now,
      );
      if (shouldResetForInactivity(rule, runtime.ruleStates[rule.id], now)) {
        stale = true;
        resetRuleIds.add(rule.id);
        runtime.ruleStates[rule.id] = resetStateForInactivity(
          rule,
          runtime.ruleStates[rule.id],
          now,
        );
      }
    }
    if (!stale && shouldKeepChallenge(rule, url)) {
      await chrome.storage.local.set({
        ruleStates: runtime.ruleStates,
        tabNavigationStates: runtime.tabNavigationStates,
      });
      await chrome.tabs.update(tabId, { muted: true }).catch(() => undefined);
      return;
    }
    delete runtime.activeChallenges[key];
    challengeToRelease = challenge;
  }

  const matches = matchingRules(url, settings.siteRules);
  let dueRule = null;
  for (const rule of matches) {
    if (resetRuleIds.has(rule.id)) continue;
    runtime.ruleStates[rule.id] = normalizeRuleState(
      rule,
      runtime.ruleStates[rule.id],
      now,
    );
    if (shouldResetForInactivity(rule, runtime.ruleStates[rule.id], now)) {
      runtime.ruleStates[rule.id] = resetStateForInactivity(
        rule,
        runtime.ruleStates[rule.id],
        now,
      );
      continue;
    }
    const result = evaluateRule(rule, runtime.ruleStates[rule.id], now);
    runtime.ruleStates[rule.id] = result.state;
    if (result.due && !dueRule) dueRule = rule;
  }

  if (!dueRule) {
    await chrome.storage.local.set({
      ruleStates: runtime.ruleStates,
      activeChallenges: runtime.activeChallenges,
      tabNavigationStates: runtime.tabNavigationStates,
    });
    if (challengeToRelease) {
      await notifyChallengeCleared(tabId);
      await restoreMute(tabId, challengeToRelease);
    }
    return;
  }

  let previouslyMuted;
  let mutedByExtension;
  if (challengeToRelease) {
    previouslyMuted = challengeToRelease.previouslyMuted;
    mutedByExtension = challengeToRelease.mutedByExtension;
    await chrome.tabs.update(tabId, { muted: true }).catch(() => undefined);
  } else {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    previouslyMuted = Boolean(tab?.mutedInfo?.muted);
    mutedByExtension = false;
    if (!previouslyMuted) {
      const muted = await chrome.tabs.update(tabId, { muted: true }).catch(() => null);
      mutedByExtension = Boolean(muted?.mutedInfo?.muted);
    }
  }
  const problem = generateProblem();
  const challenge = {
    ruleId: dueRule.id,
    url,
    ...problem,
    previouslyMuted,
    mutedByExtension,
    createdAt: now,
  };
  runtime.activeChallenges[key] = challenge;
  await chrome.storage.local.set({
    ruleStates: runtime.ruleStates,
    activeChallenges: runtime.activeChallenges,
    tabNavigationStates: runtime.tabNavigationStates,
  });
  await chrome.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPES.SHOW_CHALLENGE,
    challenge: publicChallenge(challenge),
    appearance: settings.appearance,
  }).catch(() => undefined);
}

async function handleAnswer(tabId, rawAnswer) {
  const runtime = await getRuntimeState();
  const key = String(tabId);
  const challenge = runtime.activeChallenges[key];
  if (!challenge) return { correct: false, error: t("challengeMissing") };

  const answerText = String(rawAnswer ?? "").trim();
  if (!/^-?\d+$/.test(answerText)) {
    return { correct: false, error: t("integerRequired") };
  }
  const answer = Number(answerText);
  if (!Number.isSafeInteger(answer) || !isCorrectAnswer(challenge, answer)) {
    return { correct: false, error: t("incorrectAnswer") };
  }

  const { siteRules } = await getSettings();
  const rule = siteRules.find((candidate) => candidate.id === challenge.ruleId);
  if (rule) {
    runtime.ruleStates[rule.id] = resetStateAfterSolve(
      rule,
      runtime.ruleStates[rule.id],
      Date.now(),
    );
  }
  delete runtime.activeChallenges[key];
  await chrome.storage.local.set({
    ruleStates: runtime.ruleStates,
    activeChallenges: runtime.activeChallenges,
  });

  if (challenge.mutedByExtension && !challenge.previouslyMuted) {
    await restoreMute(tabId, challenge);
  }
  return { correct: true };
}

function publicChallenge(challenge) {
  return { left: challenge.left, right: challenge.right };
}

function isSameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

async function restoreMute(tabId, challenge) {
  if (challenge.mutedByExtension && !challenge.previouslyMuted) {
    await chrome.tabs.update(tabId, { muted: false }).catch(() => undefined);
  }
}

async function notifyChallengeCleared(tabId) {
  await chrome.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPES.HIDE_CHALLENGE,
  }).catch(() => undefined);
}

async function resetStaleRuntimeState(now) {
  const settings = await getSettings();
  const runtime = await getRuntimeState();
  const rulesById = new Map(settings.siteRules.map((rule) => [rule.id, rule]));
  const staleRuleIds = new Set();

  for (const rule of settings.siteRules) {
    runtime.ruleStates[rule.id] = normalizeRuleState(
      rule,
      runtime.ruleStates[rule.id],
      now,
    );
    if (shouldResetForInactivity(rule, runtime.ruleStates[rule.id], now)) {
      runtime.ruleStates[rule.id] = resetStateForInactivity(
        rule,
        runtime.ruleStates[rule.id],
        now,
      );
      staleRuleIds.add(rule.id);
    }
  }

  const challengesToUnmute = [];
  for (const [tabId, challenge] of Object.entries(runtime.activeChallenges)) {
    if (staleRuleIds.has(challenge.ruleId) || !rulesById.has(challenge.ruleId)) {
      challengesToUnmute.push([Number(tabId), challenge]);
      delete runtime.activeChallenges[tabId];
    }
  }
  for (const [tabId, state] of Object.entries(runtime.tabNavigationStates)) {
    if (now - state.at >= INACTIVITY_RESET_MS) {
      delete runtime.tabNavigationStates[tabId];
    }
  }

  await chrome.storage.local.set({
    ruleStates: runtime.ruleStates,
    activeChallenges: runtime.activeChallenges,
    tabNavigationStates: runtime.tabNavigationStates,
  });
  await Promise.allSettled(
    challengesToUnmute.map(async ([tabId, challenge]) => {
      await notifyChallengeCleared(tabId);
      await restoreMute(tabId, challenge);
    }),
  );
}

async function broadcastAppearance(appearance) {
  const { activeChallenges } = await getRuntimeState();
  await Promise.allSettled(
    Object.keys(activeChallenges).map((tabId) =>
      chrome.tabs.sendMessage(Number(tabId), {
        type: MESSAGE_TYPES.APPLY_APPEARANCE,
        appearance,
      }),
    ),
  );
}
