import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  validateColor,
  validateIntervalValue,
  validateUrlPattern,
} from "../src/shared/validation.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url)));

test("英語と日本語のメッセージカタログが同じキーを持つ", async () => {
  const [english, japanese] = await Promise.all([
    readJson("../_locales/en/messages.json"),
    readJson("../_locales/ja/messages.json"),
  ]);
  assert.deepEqual(Object.keys(english).sort(), Object.keys(japanese).sort());
  for (const catalog of [english, japanese]) {
    for (const entry of Object.values(catalog)) {
      assert.equal(typeof entry.message, "string");
      assert.notEqual(entry.message, "");
    }
  }
});

test("画面とmanifestが参照する翻訳キーがカタログに存在する", async () => {
  const [catalog, ...sources] = await Promise.all([
    readJson("../_locales/en/messages.json"),
    readFile(new URL("../manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../src/options/options.html", import.meta.url), "utf8"),
    readFile(new URL("../src/options/options.js", import.meta.url), "utf8"),
    readFile(new URL("../src/content/content-script.js", import.meta.url), "utf8"),
    readFile(new URL("../src/background/service-worker.js", import.meta.url), "utf8"),
  ]);
  const referencedKeys = new Set();
  const patterns = [
    /__MSG_([A-Za-z0-9_]+)__/g,
    /data-i18n(?:-aria-label)?="([A-Za-z0-9_]+)"/g,
    /\bt\("([A-Za-z0-9_]+)"/g,
  ];
  for (const source of sources) {
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) referencedKeys.add(match[1]);
    }
  }
  assert.deepEqual(
    [...referencedKeys].filter((key) => !catalog[key]),
    [],
  );
});

test("入力検証は指定された言語の翻訳関数を利用する", () => {
  const translate = (key, substitution) => `${key}:${substitution ?? ""}`;
  assert.equal(validateUrlPattern("", translate), "validationUrlRequired:");
  assert.equal(validateUrlPattern("x".repeat(501), translate), "validationUrlTooLong:500");
  assert.equal(validateIntervalValue(0, translate), "validationIntervalValue:");
  assert.equal(validateColor("red", translate), "validationColor:");
});
