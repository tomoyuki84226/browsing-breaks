import {
  LOCAL_DEFAULTS,
  SETTINGS_VERSION,
  SYNC_DEFAULTS,
} from "./constants.js";
import { normalizeAppearance } from "./validation.js";

export async function getSettings() {
  const value = await chrome.storage.sync.get(SYNC_DEFAULTS);
  return {
    settingsVersion: Number(value.settingsVersion) || SETTINGS_VERSION,
    appearance: normalizeAppearance(value.appearance),
    siteRules: Array.isArray(value.siteRules) ? value.siteRules : [],
  };
}

export async function getRuntimeState() {
  const value = await chrome.storage.local.get(LOCAL_DEFAULTS);
  return {
    ruleStates: value.ruleStates ?? {},
    activeChallenges: value.activeChallenges ?? {},
    tabNavigationStates: value.tabNavigationStates ?? {},
  };
}
