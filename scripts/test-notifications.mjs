import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import ts from "typescript";

function loadModule(path, dependencies) {
  const testModule = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, URLSearchParams,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected test import: ${name}`);
    },
  }, { filename: path });
  return testModule.exports;
}

const channels = loadModule("src/lib/notifications/channels.ts", {});
const messages = ["announcement", "verify-email", "support-case", "collaboration-request", "creator-programme", "reward-result"];
const ads = ["new-product", "loyalty-offer"];
const items = [...messages, ...ads].map((kind) => ({
  id: `${kind}-fixture`, kind, title: `Title for ${kind}`, body: `Body for ${kind}`,
  href: `/destination/${kind}`, createdAt: "2026-10-18T08:00:00.000Z",
}));

function renderInbox(tab = "messages", overrides = {}) {
  const { NotificationsCenter } = loadModule("src/components/NotificationsCenter.tsx", {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/link": { __esModule: true, default: (props) => {
      const anchorProps = { ...props };
      delete anchorProps.replace;
      delete anchorProps.scroll;
      return React.createElement("a", anchorProps, props.children);
    } },
    "next/navigation": { useRouter: () => ({}), useSearchParams: () => new URLSearchParams(`tab=${tab}`) },
    "lucide-react": icons,
    "@/lib/notifications/channels": channels,
    "@/lib/notifications/read-state": {
      useNotificationReads: ({ readIds }) => ({ isUnread: (item) => !readIds.includes(item.id), markRead: async () => true, saving: false, error: null }),
    },
    "@/app/account/actions": { sendVisitorEmailVerification: async () => ({ error: null }) },
  });
  return renderToStaticMarkup(React.createElement(NotificationsCenter, {
    items, userId: "fixture-user", readIds: [], lastSeenAt: null, ...overrides,
  }));
}

test("every notification kind belongs to exactly one inbox section", () => {
  for (const kind of messages) assert.equal(channels.getNotificationChannel({ kind }), "messages");
  for (const kind of ads) assert.equal(channels.getNotificationChannel({ kind }), "ads");
});

test("Messages contains administration, support, creator and account messages but no ads", () => {
  const html = renderInbox();
  for (const kind of messages) assert.ok(html.includes(`Title for ${kind}`));
  for (const kind of ads) assert.ok(!html.includes(`Title for ${kind}`));
  assert.match(html, /aria-label="6 unread messages"/);
  assert.match(html, /aria-label="2 unread ad notifications"/);
  assert.ok(html.includes("Resend confirmation email"));
});

test("Ad notifications contains products and offers but no personal messages", () => {
  const html = renderInbox("ads");
  for (const kind of ads) assert.ok(html.includes(`Title for ${kind}`));
  for (const kind of messages) assert.ok(!html.includes(`Title for ${kind}`));
  assert.match(html, /aria-labelledby="inbox-ads-tab"/);
});

test("section unread badges respect saved read state independently", () => {
  const html = renderInbox("messages", { readIds: items.filter((item) => messages.includes(item.kind)).map((item) => item.id) });
  assert.ok(!html.includes('aria-label="6 unread messages"'));
  assert.ok(html.includes('aria-label="2 unread ad notifications"'));
});

test("empty sections show distinct empty states", () => {
  assert.ok(renderInbox("messages", { items: [] }).includes("No messages yet"));
  assert.ok(renderInbox("ads", { items: [] }).includes("No ad notifications yet"));
});

test("guest sign-in returns to the selected section without rendering personal items", () => {
  const html = renderInbox("ads", { userId: null, items: [] });
  assert.ok(html.includes("next=%2Fnotifications%3Ftab%3Dads"));
  assert.ok(html.includes("No ad notifications yet"));
});

test("a directly opened older announcement stays visible without recent feed items", () => {
  const html = renderInbox("ads", { items: [], message: {
    id: "older-announcement", title: "Older administration message", body: "Still available",
    link_url: null, created_at: "2026-06-01T08:00:00.000Z",
  } });
  assert.ok(html.includes("Older administration message"));
  assert.ok(!html.includes('data-empty="true"'));
  assert.ok(html.includes('aria-labelledby="inbox-messages-tab"'));
});