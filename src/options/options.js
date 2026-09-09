import {
  DEFAULT_APPEARANCE,
  INTERVAL_TYPES,
  SETTINGS_VERSION,
} from "../shared/constants.js";
import { getSettings } from "../shared/storage.js";
import {
  normalizeAppearance,
  validateColor,
  validateRule,
} from "../shared/validation.js";

const elements = {
  addRule: document.querySelector("#add-rule"),
  ruleList: document.querySelector("#rule-list"),
  emptyRules: document.querySelector("#empty-rules"),
  dialog: document.querySelector("#rule-dialog"),
  dialogTitle: document.querySelector("#dialog-title"),
  ruleForm: document.querySelector("#rule-form"),
  ruleId: document.querySelector("#rule-id"),
  ruleName: document.querySelector("#rule-name"),
  urlPattern: document.querySelector("#url-pattern"),
  urlPatternError: document.querySelector("#url-pattern-error"),
  urlExample: document.querySelector("#url-example"),
  duplicateWarning: document.querySelector("#duplicate-warning"),
  intervalType: document.querySelector("#interval-type"),
  intervalTypeError: document.querySelector("#interval-type-error"),
  intervalValue: document.querySelector("#interval-value"),
  intervalValueError: document.querySelector("#interval-value-error"),
  saveRule: document.querySelector("#save-rule"),
  cancelRule: document.querySelector("#cancel-rule"),
  appearanceForm: document.querySelector("#appearance-form"),
  textColorPicker: document.querySelector("#text-color-picker"),
  textColorText: document.querySelector("#text-color-text"),
  textColorError: document.querySelector("#text-color-error"),
  backgroundColorPicker: document.querySelector("#background-color-picker"),
  backgroundColorText: document.querySelector("#background-color-text"),
  backgroundColorError: document.querySelector("#background-color-error"),
  appearancePreview: document.querySelector("#appearance-preview"),
  appearanceStatus: document.querySelector("#appearance-status"),
  resetAppearance: document.querySelector("#reset-appearance"),
  toast: document.querySelector("#toast"),
};

let siteRules = [];
let toastTimer = null;

applyLocalization();
await initialize();

function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function applyLocalization() {
  document.documentElement.lang = chrome.i18n.getUILanguage().toLowerCase().startsWith("ja")
    ? "ja"
    : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
}

async function initialize() {
  const settings = await getSettings();
  siteRules = settings.siteRules;
  setAppearanceFields(settings.appearance);
  renderRules();
  await setCurrentSiteExample();

  elements.addRule.addEventListener("click", () => openRuleDialog());
  elements.cancelRule.addEventListener("click", () => elements.dialog.close());
  elements.ruleForm.addEventListener("submit", saveRule);
  elements.urlPattern.addEventListener("input", validateRuleForm);
  elements.intervalType.addEventListener("change", validateRuleForm);
  elements.intervalValue.addEventListener("input", validateRuleForm);
  elements.appearanceForm.addEventListener("submit", saveAppearance);
  elements.resetAppearance.addEventListener("click", resetAppearance);
  bindColorPair(elements.textColorPicker, elements.textColorText);
  bindColorPair(elements.backgroundColorPicker, elements.backgroundColorText);
}

function renderRules() {
  elements.ruleList.replaceChildren();
  elements.emptyRules.hidden = siteRules.length > 0;
  siteRules.forEach((rule) => {
    const article = document.createElement("article");
    article.className = `rule-card${rule.enabled ? "" : " disabled"}`;

    const copy = document.createElement("div");
    copy.className = "rule-copy";
    const title = document.createElement("h3");
    title.textContent = rule.name?.trim() || rule.urlPattern;
    const pattern = document.createElement("code");
    pattern.textContent = rule.urlPattern;
    const summary = document.createElement("p");
    summary.textContent =
      rule.intervalType === INTERVAL_TYPES.MINUTES
        ? t("ruleSummaryMinutes", String(rule.intervalValue))
        : t("ruleSummaryNavigations", String(rule.intervalValue));
    copy.append(title, pattern, summary);

    const actions = document.createElement("div");
    actions.className = "rule-actions";
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "switch";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(rule.enabled);
    toggle.setAttribute("aria-label", t("enableRule", title.textContent));
    const switchVisual = document.createElement("span");
    switchVisual.setAttribute("aria-hidden", "true");
    toggleLabel.append(toggle, switchVisual);
    toggle.addEventListener("change", () => toggleRule(rule.id, toggle.checked));

    const edit = actionButton(t("edit"), () => openRuleDialog(rule));
    const remove = actionButton(t("delete"), () => deleteRule(rule));
    remove.classList.add("danger");
    actions.append(toggleLabel, edit, remove);
    article.append(copy, actions);
    elements.ruleList.append(article);
  });
}

function actionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary compact";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function openRuleDialog(rule = null) {
  elements.dialogTitle.textContent = t(rule ? "editRuleDialogTitle" : "addRuleDialogTitle");
  elements.ruleId.value = rule?.id || "";
  elements.ruleName.value = rule?.name || "";
  elements.urlPattern.value = rule?.urlPattern || "";
  elements.intervalType.value = rule?.intervalType || INTERVAL_TYPES.MINUTES;
  elements.intervalValue.value = rule?.intervalValue || 10;
  clearRuleErrors();
  validateRuleForm();
  elements.dialog.showModal();
  elements.ruleName.focus();
}

function validateRuleForm() {
  const draft = readRuleDraft();
  const errors = validateRule(draft, t);
  elements.urlPatternError.textContent = errors.urlPattern;
  elements.intervalTypeError.textContent = errors.intervalType;
  elements.intervalValueError.textContent = errors.intervalValue;
  const duplicate = siteRules.some(
    (rule) => rule.id !== draft.id && rule.urlPattern === draft.urlPattern.trim(),
  );
  elements.duplicateWarning.textContent = duplicate
    ? t("duplicateWarning")
    : "";
  const valid = Object.values(errors).every((error) => !error);
  elements.saveRule.disabled = !valid;
  return valid;
}

function readRuleDraft() {
  return {
    id: elements.ruleId.value,
    name: elements.ruleName.value.trim(),
    urlPattern: elements.urlPattern.value.trim(),
    intervalType: elements.intervalType.value,
    intervalValue: Number(elements.intervalValue.value),
  };
}

async function saveRule(event) {
  event.preventDefault();
  if (!validateRuleForm()) return;
  const draft = readRuleDraft();
  const now = Date.now();
  const index = siteRules.findIndex((rule) => rule.id === draft.id);
  if (index >= 0) {
    const previous = siteRules[index];
    siteRules[index] = { ...previous, ...draft, id: previous.id, updatedAt: now };
  } else {
    siteRules.push({
      ...draft,
      id: crypto.randomUUID(),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  await persistRules();
  elements.dialog.close();
  renderRules();
  showToast(t("ruleSaved"));
}

async function toggleRule(id, enabled) {
  siteRules = siteRules.map((rule) =>
    rule.id === id ? { ...rule, enabled, updatedAt: Date.now() } : rule,
  );
  await persistRules();
  renderRules();
  showToast(t(enabled ? "ruleEnabled" : "ruleDisabled"));
}

async function deleteRule(rule) {
  const label = rule.name?.trim() || rule.urlPattern;
  if (!confirm(t("deleteConfirmation", label))) return;
  siteRules = siteRules.filter((candidate) => candidate.id !== rule.id);
  await persistRules();
  renderRules();
  showToast(t("ruleDeleted"));
}

async function persistRules() {
  await chrome.storage.sync.set({ settingsVersion: SETTINGS_VERSION, siteRules });
}

function bindColorPair(picker, text) {
  picker.addEventListener("input", () => {
    text.value = picker.value.toLowerCase();
    validateAppearanceForm();
  });
  text.addEventListener("input", () => {
    if (!validateColor(text.value)) picker.value = text.value;
    validateAppearanceForm();
  });
}

function setAppearanceFields(appearance) {
  const normalized = normalizeAppearance(appearance);
  elements.textColorPicker.value = normalized.textColor;
  elements.textColorText.value = normalized.textColor;
  elements.backgroundColorPicker.value = normalized.backgroundColor;
  elements.backgroundColorText.value = normalized.backgroundColor;
  updatePreview(normalized);
}

function validateAppearanceForm() {
  const textError = validateColor(elements.textColorText.value, t);
  const backgroundError = validateColor(elements.backgroundColorText.value, t);
  elements.textColorError.textContent = textError;
  elements.backgroundColorError.textContent = backgroundError;
  const valid = !textError && !backgroundError;
  if (valid) {
    updatePreview({
      textColor: elements.textColorText.value.toLowerCase(),
      backgroundColor: elements.backgroundColorText.value.toLowerCase(),
    });
  }
  return valid;
}

async function saveAppearance(event) {
  event.preventDefault();
  if (!validateAppearanceForm()) return;
  const appearance = {
    textColor: elements.textColorText.value.toLowerCase(),
    backgroundColor: elements.backgroundColorText.value.toLowerCase(),
  };
  await chrome.storage.sync.set({ settingsVersion: SETTINGS_VERSION, appearance });
  setAppearanceFields(appearance);
  elements.appearanceStatus.textContent = t("saved");
  setTimeout(() => (elements.appearanceStatus.textContent = ""), 2500);
}

async function resetAppearance() {
  setAppearanceFields(DEFAULT_APPEARANCE);
  await chrome.storage.sync.set({
    settingsVersion: SETTINGS_VERSION,
    appearance: DEFAULT_APPEARANCE,
  });
  elements.textColorError.textContent = "";
  elements.backgroundColorError.textContent = "";
  elements.appearanceStatus.textContent = t("appearanceReset");
}

function updatePreview(appearance) {
  elements.appearancePreview.style.color = appearance.textColor;
  elements.appearancePreview.style.backgroundColor = appearance.backgroundColor;
  elements.appearancePreview.style.borderColor = appearance.textColor;
}

function clearRuleErrors() {
  elements.urlPatternError.textContent = "";
  elements.intervalTypeError.textContent = "";
  elements.intervalValueError.textContent = "";
  elements.duplicateWarning.textContent = "";
  elements.saveRule.disabled = false;
}

async function setCurrentSiteExample() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const local = await chrome.storage.local.get({ optionsExampleUrl: "" });
    const sourceUrl =
      tab?.url && /^https?:\/\//.test(tab.url) ? tab.url : local.optionsExampleUrl;
    if (!sourceUrl || !/^https?:\/\//.test(sourceUrl)) return;
    const origin = new URL(sourceUrl).origin;
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    elements.urlExample.textContent = t("currentSiteExample", `^${escaped}/`);
  } catch {
    // 権限や対象ページの都合で取得できない場合は汎用例を維持する。
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}
