import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialSiteRules,
  DEFAULT_APPEARANCE,
  INACTIVITY_RESET_MS,
} from "../src/shared/constants.js";
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
} from "../src/shared/core.js";
import {
  normalizeAppearance,
  validateColor,
  validateIntervalValue,
  validateUrlPattern,
} from "../src/shared/validation.js";

const baseRule = {
  id: "one",
  name: "Example",
  urlPattern: "^https://example\\.com/",
  intervalType: "navigations",
  intervalValue: 3,
  enabled: true,
  createdAt: 1_000,
};

test("初期サイト設定は指定した3サイトを無効状態で作成する", () => {
  let id = 0;
  const rules = createInitialSiteRules(12_345, () => `initial-${++id}`);

  assert.deepEqual(
    rules.map(({ id: ruleId, name, urlPattern, intervalType, intervalValue, enabled }) => ({
      id: ruleId,
      name,
      urlPattern,
      intervalType,
      intervalValue,
      enabled,
    })),
    [
      {
        id: "initial-1",
        name: "YouTube(long)",
        urlPattern: "^https://www\\.youtube\\.com/watch\\?v=",
        intervalType: "navigations",
        intervalValue: 5,
        enabled: false,
      },
      {
        id: "initial-2",
        name: "YouTube(short)",
        urlPattern: "^https://www\\.youtube\\.com/shorts/",
        intervalType: "navigations",
        intervalValue: 10,
        enabled: false,
      },
      {
        id: "initial-3",
        name: "X",
        urlPattern: "^https://x\\.com/",
        intervalType: "navigations",
        intervalValue: 15,
        enabled: false,
      },
    ],
  );
  assert.ok(rules.every((rule) => rule.createdAt === 12_345 && rule.updatedAt === 12_345));
});

test("URL正規表現と間隔値の境界を検証する", () => {
  assert.equal(validateUrlPattern("["), "JavaScriptで使用できる正規表現を入力してください。");
  assert.equal(validateUrlPattern(baseRule.urlPattern), "");
  assert.notEqual(validateIntervalValue(0), "");
  assert.equal(validateIntervalValue(1), "");
  assert.equal(validateIntervalValue(60), "");
  assert.equal(validateIntervalValue(61), "");
  assert.equal(validateIntervalValue(Number.MAX_SAFE_INTEGER), "");
  assert.notEqual(validateIntervalValue(Number.MAX_SAFE_INTEGER + 1), "");
  assert.notEqual(validateIntervalValue(1.5), "");
});

test("色を検証し、不足データを初期色で補完する", () => {
  assert.equal(validateColor("#Ab12f0"), "");
  assert.notEqual(validateColor("#fff"), "");
  assert.deepEqual(normalizeAppearance({}), DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({ textColor: "#FFFFFF", backgroundColor: "#123456" }), {
    textColor: "#ffffff",
    backgroundColor: "#123456",
  });
});

test("一致ルールは一覧順で返し、無効ルールを除く", () => {
  const rules = [
    baseRule,
    { ...baseRule, id: "two", urlPattern: "example", intervalValue: 1 },
    { ...baseRule, id: "three", enabled: false },
  ];
  assert.deepEqual(matchingRules("https://example.com/a", rules).map((rule) => rule.id), ["one", "two"]);
});

test("出題は移動先が出題元ルールに一致する間だけ維持する", () => {
  assert.equal(shouldKeepChallenge(baseRule, "https://example.com/next"), true);
  assert.equal(shouldKeepChallenge(baseRule, "https://other.example/"), false);
  assert.equal(
    shouldKeepChallenge({ ...baseRule, enabled: false }, "https://example.com/next"),
    false,
  );
  assert.equal(shouldKeepChallenge(undefined, "https://example.com/next"), false);
});

test("移動回数方式は閾値で期限到達し、正解後に0へ戻る", () => {
  let state = { lastSolvedAt: 1_000, navigationCount: 0, lastNavigationAt: 1_000 };
  assert.equal((state = evaluateRule(baseRule, state, 2_000).state).navigationCount, 1);
  assert.equal(state.lastNavigationAt, 2_000);
  const second = evaluateRule(baseRule, state, 3_000);
  assert.equal(second.due, false);
  const third = evaluateRule(baseRule, second.state, 4_000);
  assert.equal(third.due, true);
  assert.equal(resetStateAfterSolve(baseRule, third.state, 5_000).navigationCount, 0);
});

test("時間方式は期限到達後の判定で出題し、正解日時を更新する", () => {
  const rule = { ...baseRule, intervalType: "minutes", intervalValue: 10 };
  const state = { lastSolvedAt: 1_000, navigationCount: 7, lastNavigationAt: 500 };
  assert.equal(evaluateRule(rule, state, 600_999).due, false);
  assert.equal(evaluateRule(rule, state, 601_000).due, true);
  assert.deepEqual(resetStateAfterSolve(rule, state, 700_000), {
    lastSolvedAt: 700_000,
    navigationCount: 7,
    lastNavigationAt: 500,
  });
});

test("方式・URL変更だけ状態をリセットし、値変更と無効化では維持する", () => {
  const state = {
    one: { lastSolvedAt: 2_000, navigationCount: 2, lastNavigationAt: 3_000 },
  };
  assert.deepEqual(
    reconcileRuleStates(
      [baseRule],
      [{ ...baseRule, intervalValue: 5, enabled: false }],
      state,
      9_000,
    ).one,
    state.one,
  );
  assert.deepEqual(
    reconcileRuleStates(
      [baseRule],
      [{ ...baseRule, intervalType: "minutes", updatedAt: 8_000 }],
      state,
      9_000,
    ).one,
    { lastSolvedAt: 8_000, navigationCount: 0, lastNavigationAt: 8_000 },
  );
  assert.deepEqual(reconcileRuleStates([baseRule], [], state, 9_000), {});
});

test("移動回数方式は最後の移動から12時間で現在遷移を数えず初期化する", () => {
  const state = {
    lastSolvedAt: 1_000,
    navigationCount: 7,
    lastNavigationAt: 5_000,
  };
  assert.equal(
    shouldResetForInactivity(baseRule, state, 5_000 + INACTIVITY_RESET_MS - 1),
    false,
  );
  const now = 5_000 + INACTIVITY_RESET_MS;
  assert.equal(shouldResetForInactivity(baseRule, state, now), true);
  assert.equal(shouldResetForInactivity(baseRule, state, now + 1), true);
  const reset = resetStateForInactivity(baseRule, state, now);
  assert.deepEqual(reset, {
    ...state,
    navigationCount: 0,
    lastNavigationAt: now,
  });
  const next = evaluateRule(baseRule, reset, now + 1);
  assert.equal(next.due, false);
  assert.equal(next.state.navigationCount, 1);
});

test("時間方式は基準日時から12時間で現在遷移に出題せず基準を更新する", () => {
  const rule = { ...baseRule, intervalType: "minutes", intervalValue: 10 };
  const state = {
    lastSolvedAt: 2_000,
    navigationCount: 0,
    lastNavigationAt: 3_000,
  };
  const now = 2_000 + INACTIVITY_RESET_MS;
  assert.equal(shouldResetForInactivity(rule, state, now), true);
  assert.equal(shouldResetForInactivity(rule, state, now + 1), true);
  const reset = resetStateForInactivity(rule, state, now);
  assert.deepEqual(reset, {
    ...state,
    lastSolvedAt: now,
  });
  assert.equal(evaluateRule(rule, reset, now + 10 * 60_000 - 1).due, false);
  assert.equal(evaluateRule(rule, reset, now + 10 * 60_000).due, true);
});

test("旧形式の移動状態には移行時点から12時間の猶予を与える", () => {
  const legacy = { lastSolvedAt: 1_000, navigationCount: 4 };
  const migrated = normalizeRuleState(baseRule, legacy, 50_000);
  assert.equal(migrated.navigationCount, 4);
  assert.equal(migrated.lastNavigationAt, 50_000);
  assert.equal(shouldResetForInactivity(baseRule, migrated, 50_000), false);
});

test("SPAの同一到達URLは通知元・順序・遅延に関係なく重複とみなす", () => {
  const history = { url: "https://example.com/a", kind: "history", at: 1_000 };
  const content = { url: history.url, kind: "content-spa", at: 10_000 };
  assert.equal(isDuplicateNavigation(history, content, 750), true);
  assert.equal(isDuplicateNavigation(content, { ...history, at: 20_000 }, 750), true);
  assert.equal(
    isDuplicateNavigation(history, { ...content, url: "https://example.com/b" }, 750),
    false,
  );
});

test("同一URLのリロードは加算し、document通知自身の短時間重複だけを除く", () => {
  const spa = { url: "https://example.com/a", kind: "history", at: 1_000 };
  const reload = { url: spa.url, kind: "document", at: 1_100 };
  assert.equal(isDuplicateNavigation(spa, reload, 750), false);
  assert.equal(isDuplicateNavigation(reload, { ...reload, at: 1_749 }, 750), true);
  assert.equal(isDuplicateNavigation(reload, { ...reload, at: 1_850 }, 750), false);
});

test("問題は1～9で生成し、整数の正解だけを受け付ける", () => {
  assert.deepEqual(generateProblem(() => 0), { left: 1, right: 1 });
  assert.deepEqual(generateProblem(() => 0.999999), { left: 9, right: 9 });
  assert.equal(isCorrectAnswer({ left: 7, right: 5 }, 12), true);
  assert.equal(isCorrectAnswer({ left: 7, right: 5 }, 12.0), true);
  assert.equal(isCorrectAnswer({ left: 7, right: 5 }, 11), false);
});
