import { INACTIVITY_RESET_MS, INTERVAL_TYPES } from "./constants.js";
import { isValidRule } from "./validation.js";

export function matchingRules(url, rules) {
  return rules.filter((rule) => {
    if (!rule.enabled || !isValidRule(rule)) return false;
    try {
      return new RegExp(rule.urlPattern).test(url);
    } catch {
      return false;
    }
  });
}

export function shouldKeepChallenge(rule, url) {
  return Boolean(rule) && matchingRules(url, [rule]).length === 1;
}

export function initialRuleState(rule, baselineAt) {
  const initialAt = Number.isFinite(baselineAt)
    ? baselineAt
    : Number.isFinite(rule.createdAt)
      ? rule.createdAt
      : Date.now();
  return {
    lastSolvedAt: initialAt,
    navigationCount: 0,
    lastNavigationAt: initialAt,
  };
}

export function normalizeRuleState(rule, state, now) {
  const initial = initialRuleState(rule);
  if (!state) return initial;
  return {
    ...initial,
    ...state,
    // 旧形式の状態には移行時点から12時間の猶予を与える。
    lastNavigationAt: Number.isFinite(state.lastNavigationAt)
      ? state.lastNavigationAt
      : now,
  };
}

export function shouldResetForInactivity(rule, state, now) {
  const current = normalizeRuleState(rule, state, now);
  const referenceAt =
    rule.intervalType === INTERVAL_TYPES.NAVIGATIONS
      ? current.lastNavigationAt
      : current.lastSolvedAt;
  const elapsed = now - referenceAt;
  return elapsed >= INACTIVITY_RESET_MS && elapsed >= 0;
}

export function resetStateForInactivity(rule, state, now) {
  const current = normalizeRuleState(rule, state, now);
  return rule.intervalType === INTERVAL_TYPES.NAVIGATIONS
    ? { ...current, navigationCount: 0, lastNavigationAt: now }
    : { ...current, lastSolvedAt: now };
}

export function evaluateRule(rule, state, now) {
  const current = normalizeRuleState(rule, state, now);
  if (rule.intervalType === INTERVAL_TYPES.MINUTES) {
    return {
      due: now - current.lastSolvedAt >= rule.intervalValue * 60_000,
      state: current,
    };
  }

  const updated = {
    ...current,
    navigationCount: current.navigationCount + 1,
    lastNavigationAt: now,
  };
  return {
    due: updated.navigationCount >= rule.intervalValue,
    state: updated,
  };
}

export function resetStateAfterSolve(rule, state, now) {
  const current = normalizeRuleState(rule, state, now);
  return rule.intervalType === INTERVAL_TYPES.MINUTES
    ? { ...current, lastSolvedAt: now }
    : { ...current, navigationCount: 0 };
}

export function reconcileRuleStates(oldRules, newRules, states, now = Date.now()) {
  const oldById = new Map(oldRules.map((rule) => [rule.id, rule]));
  const next = {};
  for (const rule of newRules) {
    const previousRule = oldById.get(rule.id);
    const shouldReset =
      !previousRule ||
      previousRule.intervalType !== rule.intervalType ||
      previousRule.urlPattern !== rule.urlPattern;
    const resetAt = previousRule
      ? Number.isFinite(rule.updatedAt)
        ? rule.updatedAt
        : now
      : Number.isFinite(rule.createdAt)
        ? rule.createdAt
        : now;
    next[rule.id] = shouldReset
      ? initialRuleState(rule, resetAt)
      : normalizeRuleState(rule, states[rule.id], now);
  }
  return next;
}

export function isDuplicateNavigation(previous, next, windowMs) {
  if (!previous || previous.url !== next.url) return false;

  // SPAの同じ到達URLは、webNavigationとContent Scriptの通知順や遅延に
  // 関係なく1つの論理遷移として扱う。同一URLのdocument遷移はリロードに
  // なり得るため、webNavigation自身の短時間の重複だけを除外する。
  if (next.kind !== "document") return true;
  if (previous.kind !== "document") return false;

  const elapsed = next.at - previous.at;
  return elapsed >= 0 && elapsed < windowMs;
}

export function generateProblem(random = Math.random) {
  return {
    left: Math.floor(random() * 9) + 1,
    right: Math.floor(random() * 9) + 1,
  };
}

export function isCorrectAnswer(challenge, answer) {
  return Number.isInteger(answer) && answer === challenge.left + challenge.right;
}
