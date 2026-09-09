export const SETTINGS_VERSION = 1;

export const DEFAULT_APPEARANCE = Object.freeze({
  textColor: "#c9d1d9",
  backgroundColor: "#000000",
});

export const INTERVAL_TYPES = Object.freeze({
  MINUTES: "minutes",
  NAVIGATIONS: "navigations",
});

export const SYNC_DEFAULTS = Object.freeze({
  settingsVersion: SETTINGS_VERSION,
  appearance: DEFAULT_APPEARANCE,
  siteRules: [],
});

export function createInitialSiteRules(now = Date.now(), createId = () => crypto.randomUUID()) {
  return [
    {
      id: createId(),
      name: "YouTube(long)",
      urlPattern: "^https://www\\.youtube\\.com/watch\\?v=",
      intervalType: INTERVAL_TYPES.NAVIGATIONS,
      intervalValue: 5,
      enabled: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: createId(),
      name: "YouTube(short)",
      urlPattern: "^https://www\\.youtube\\.com/shorts/",
      intervalType: INTERVAL_TYPES.NAVIGATIONS,
      intervalValue: 10,
      enabled: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: createId(),
      name: "X",
      urlPattern: "^https://x\\.com/",
      intervalType: INTERVAL_TYPES.NAVIGATIONS,
      intervalValue: 15,
      enabled: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export const LOCAL_DEFAULTS = Object.freeze({
  ruleStates: {},
  activeChallenges: {},
  tabNavigationStates: {},
});

export const MESSAGE_TYPES = Object.freeze({
  CONTENT_READY: "contentReady",
  URL_CHANGED: "urlChanged",
  SHOW_CHALLENGE: "showChallenge",
  HIDE_CHALLENGE: "hideChallenge",
  SUBMIT_ANSWER: "submitAnswer",
  CHALLENGE_RESULT: "challengeResult",
  APPLY_APPEARANCE: "applyAppearance",
});

export const DUPLICATE_WINDOW_MS = 750;
export const INACTIVITY_RESET_MS = 12 * 60 * 60 * 1000;
export const MAX_PATTERN_LENGTH = 500;
