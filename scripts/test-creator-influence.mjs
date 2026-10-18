import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const influenceModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/creator/influence.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: influenceModule, exports: influenceModule.exports });
const { getCreatorInfluenceLevel } = influenceModule.exports;

test("influence levels change only at the published thresholds", () => {
  const thresholds = [100, 500, 1000, 5000, 10000];
  for (const threshold of thresholds) {
    assert.equal(getCreatorInfluenceLevel(threshold - 1).next.minimum, threshold);
    assert.equal(getCreatorInfluenceLevel(threshold).level.minimum, threshold);
    assert.equal(getCreatorInfluenceLevel(threshold - 1).remaining, 1);
  }
  assert.equal(getCreatorInfluenceLevel(10000).next, null);
  assert.equal(getCreatorInfluenceLevel(100000).remaining, 0);
});

test("zero and invalid influence never earn a badge", () => {
  for (const points of [0, -1, NaN, Infinity, 99.9]) {
    assert.equal(getCreatorInfluenceLevel(points).level.symbol, "none");
  }
});

function loadModule(path, dependencies) {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: loaded, exports: loaded.exports,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return loaded.exports;
}

const { CreatorInfluenceBadge, CreatorInfluenceSummary } = loadModule("../src/components/creator/CreatorInfluence.tsx", {
  "react/jsx-runtime": jsxRuntime,
  "lucide-react": { Shield: () => createElement("svg", { "data-icon": "shield" }), Star: () => createElement("svg", { "data-icon": "star" }) },
  "@/lib/creator/influence": influenceModule.exports,
  "@/lib/format": { formatNumber: (value) => new Intl.NumberFormat("en-GB").format(value) },
  "./CreatorInfluence.css": {},
});

test("earned influence uses stars and shields, never an approval check", () => {
  assert.equal(renderToStaticMarkup(createElement(CreatorInfluenceBadge, { points: 99 })), "");
  const star = renderToStaticMarkup(createElement(CreatorInfluenceBadge, { points: 1000 }));
  assert.match(star, /Gold star/);
  assert.match(star, /1,000 qualified first referrals/);
  assert.match(star, /data-icon="star"/);
  const shield = renderToStaticMarkup(createElement(CreatorInfluenceBadge, { points: 10000 }));
  assert.match(shield, /Gold shield/);
  assert.match(shield, /data-icon="shield"/);
});

test("studio shows separate metrics and remaining progress without merging balances", () => {
  const html = renderToStaticMarkup(createElement(CreatorInfluenceSummary, { showProgress: true, influence: {
    creator_profile_id: "creator", fan_count: 3000, first_referral_count: 2000, qualified_referrals: 999, active_referrals_30d: 70,
  } }));
  assert.match(html, /1 more qualified referrals to gold star/);
  assert.match(html, /value="499" max="500"/);
  assert.match(html, /2,000/);
  assert.match(html, /3,000/);
  assert.match(html, /not spendable/);
  assert.match(renderToStaticMarkup(createElement(CreatorInfluenceSummary)), /currently unavailable/);
});

const { getCreatorInfluence } = loadModule("../src/lib/creator/influence-server.ts", { "server-only": {} });

test("aggregate loader deduplicates and batches at 200 without per-creator requests", async () => {
  const calls = [];
  const ids = Array.from({ length: 201 }, (_, index) => `creator-${index}`);
  const rows = await getCreatorInfluence({ rpc: async (name, args) => {
    assert.equal(name, "get_creator_influence");
    calls.push(args.p_creator_profile_ids);
    return { data: args.p_creator_profile_ids.map((id) => ({ creator_profile_id: id, qualified_referrals: 1 })), error: null };
  } }, [...ids, ids[0]]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].length, 200);
  assert.equal(calls[1].length, 1);
  assert.equal(rows.size, 201);
});

test("undeployed influence is unavailable; real database errors are not hidden", async () => {
  const unavailable = await getCreatorInfluence({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }, ["creator"]);
  assert.equal(unavailable.size, 0);
  await assert.rejects(() => getCreatorInfluence({ rpc: async () => ({ data: null, error: { code: "42501", message: "Permission denied" } }) }, ["creator"]), /Permission denied/);
  const empty = await getCreatorInfluence({ rpc: () => { throw new Error("Empty lists must not query"); } }, []);
  assert.equal(empty.size, 0);
});

test("certificates use qualified influence, matching colours, and a dated live-profile reference", async () => {
  const canvasModule = { exports: {} };
  const text = [];
  const context = {
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText: (value) => ({ width: value.length * 10 }),
    fillText(value) { text.push({ value, color: this.fillStyle }); },
  };
  const dependencies = {
    react: {}, "lucide-react": {},
    "react/jsx-runtime": jsxRuntime,
    "@/components/creator/CreatorVerificationBadge": {},
    "@/components/creator/CreatorInfluence": {},
    "@/lib/creator/influence": influenceModule.exports,
    "@/lib/format": { formatNumber: (value) => new Intl.NumberFormat("en-GB").format(value) },
  };
  const output = ts.transpileModule(readFileSync(new URL("../src/components/creator/CreatorFanTools.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(`${output}\nmodule.exports.certificate = createCertificateCanvas;`, {
    module: canvasModule, exports: canvasModule.exports,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    document: { fonts: { ready: Promise.resolve() }, createElement: () => ({ getContext: () => context }) },
    window: { location: { origin: "https://rontab.example" } },
  });
  for (const [points, label, color] of [[100, "BRONZE STAR", "#80502c"], [500, "SILVER STAR", "#485763"], [1000, "GOLD STAR", "#765400"], [5000, "SILVER SHIELD", "#485763"], [10000, "GOLD SHIELD", "#765400"]]) {
    text.length = 0;
    await canvasModule.exports.certificate({ displayName: "Creator", code: "RT-TEST", fanCount: 30000, influencePoints: points, platforms: ["YouTube"], profileUrl: "/creators/test" });
    assert.ok(text.some((entry) => entry.value.startsWith(label) && entry.color === color));
    assert.ok(text.some((entry) => /Snapshot \d{4}-\d{2}-\d{2}/.test(entry.value) && entry.value.includes("https://rontab.example/creators/test")));
    assert.ok(!text.some((entry) => entry.value.includes("10,000+ RONTAB FANS")));
  }
  text.length = 0;
  await canvasModule.exports.certificate({ displayName: "Creator", code: "RT-TEST", fanCount: 30000, platforms: [], profileUrl: "/creators/test" });
  assert.ok(text.some((entry) => entry.value === "ADMIN-APPROVED CREATOR"));
});