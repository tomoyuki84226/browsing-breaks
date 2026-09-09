import {
  DEFAULT_APPEARANCE,
  INTERVAL_TYPES,
  MAX_PATTERN_LENGTH,
} from "./constants.js";

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const DEFAULT_MESSAGES = Object.freeze({
  validationUrlRequired: "URL正規表現を入力してください。",
  validationUrlTooLong: "URL正規表現は$1文字以内で入力してください。",
  validationUrlInvalid: "JavaScriptで使用できる正規表現を入力してください。",
  validationIntervalValue: "1以上の整数を入力してください。",
  validationIntervalType: "間隔方式を選択してください。",
  validationColor: "#RRGGBB形式で入力してください。",
});

function message(translate, key, substitutions) {
  if (translate) return translate(key, substitutions);
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  return values.reduce(
    (text, value, index) => text.replace(`$${index + 1}`, String(value)),
    DEFAULT_MESSAGES[key],
  );
}

export function validateUrlPattern(value, translate) {
  const pattern = String(value ?? "").trim();
  if (!pattern) return message(translate, "validationUrlRequired");
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return message(translate, "validationUrlTooLong", MAX_PATTERN_LENGTH);
  }
  try {
    new RegExp(pattern);
  } catch {
    return message(translate, "validationUrlInvalid");
  }
  return "";
}

export function validateIntervalValue(value, translate) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1
    ? ""
    : message(translate, "validationIntervalValue");
}

export function validateIntervalType(value, translate) {
  return Object.values(INTERVAL_TYPES).includes(value)
    ? ""
    : message(translate, "validationIntervalType");
}

export function validateColor(value, translate) {
  return COLOR_PATTERN.test(String(value ?? ""))
    ? ""
    : message(translate, "validationColor");
}

export function normalizeAppearance(value) {
  return {
    textColor: validateColor(value?.textColor)
      ? DEFAULT_APPEARANCE.textColor
      : value.textColor.toLowerCase(),
    backgroundColor: validateColor(value?.backgroundColor)
      ? DEFAULT_APPEARANCE.backgroundColor
      : value.backgroundColor.toLowerCase(),
  };
}

export function validateRule(rule, translate) {
  return {
    urlPattern: validateUrlPattern(rule?.urlPattern, translate),
    intervalType: validateIntervalType(rule?.intervalType, translate),
    intervalValue: validateIntervalValue(rule?.intervalValue, translate),
  };
}

export function isValidRule(rule) {
  return Object.values(validateRule(rule)).every((error) => !error);
}
