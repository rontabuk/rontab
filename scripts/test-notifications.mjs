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
const messages = ["announcement", "verify-email", "support-case", "creator-programme", "reward-result"];
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
    "@/lib/notifications/actions": { loadMoreNotifications: async () => ({ error: null, page: { items: [], readIds: [], hasMore: false } }) },
    "@/lib/notifications/read-state": {
      useNotificationReads: ({ readIds, items, unreadCounts }) => ({
        isUnread: (item) => !readIds.includes(item.id),
        getUnreadCount: (channel) => unreadCounts?.[channel] ?? items.filter((item) => channels.getNotificationChannel(item) === channel && !readIds.includes(item.id)).length,
        markRead: async () => true, saving: false, error: null,
      }),
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
  assert.match(html, /aria-label="5 unread messages"/);
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
  assert.ok(!html.includes('aria-label="5 unread messages"'));
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

test("an eligible older announcement stays visible when absent from the recent feed", () => {
  const html = renderInbox("ads", { items: [], message: {
    id: "older-announcement", title: "Older administration message", body: "Still available",
    link_url: null, created_at: "2026-06-01T08:00:00.000Z",
  } });
  assert.ok(html.includes("Older administration message"));
  assert.ok(!html.includes('data-empty="true"'));
  assert.ok(html.includes('aria-labelledby="inbox-messages-tab"'));
});

function notificationClient(tables = {}, rpcs = {}) {
  return {
    from(table) {
      let rows = [...(tables[table] ?? [])];
      const query = {
        select() { return query; },
        eq(column, value) { rows = rows.filter((row) => row[column] === value); return query; },
        gte(column, value) { rows = rows.filter((row) => Date.parse(row[column]) >= Date.parse(value)); return query; },
        in(column, values) { rows = rows.filter((row) => values.includes(row[column])); return query; },
        order(column, { ascending }) {
          rows.sort((first, second) => (Date.parse(first[column]) - Date.parse(second[column])) * (ascending ? 1 : -1));
          return query;
        },
        limit(count) { rows = rows.slice(0, count); return query; },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
      return query;
    },
    rpc(name, args) {
      if (name.startsWith("get_notification_inbox") && !Object.hasOwn(rpcs, name)) return Promise.resolve({ data: null, error: { code: "PGRST202" } });
      return Promise.resolve({ data: typeof rpcs[name] === "function" ? rpcs[name](args) : rpcs[name] ?? [], error: null });
    },
  };
}

async function notificationFeed(viewer, tables = {}, rpcs = {}) {
  const { getNotificationFeed } = loadModule("src/lib/notifications/feed.ts", {
    "server-only": {},
    react: { cache: (callback) => callback },
    "@/lib/auth/viewer": { getViewer: async () => viewer },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => notificationClient(tables, rpcs) },
  });
  return getNotificationFeed();
}

const signupAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const beforeSignup = new Date(Date.parse(signupAt) - 1000).toISOString();
const afterSignup = new Date(Date.parse(signupAt) + 1000).toISOString();
const announcementId = "12345678-1234-4234-8234-123456789012";
const announcement = { id: announcementId, title: "Administration", body: "Message", link_url: null, audience: "everyone", is_active: true };

for (const role of ["visitor", "seller", "admin"]) {
  test(`${role} notifications start at account creation and retain existing read state`, async () => {
    const feed = await notificationFeed({ role, userId: "new-user", createdAt: signupAt }, {
      site_announcements: [
        { ...announcement, id: "old", created_at: beforeSignup },
        { ...announcement, id: "boundary", created_at: signupAt },
        { ...announcement, id: "new", created_at: afterSignup },
      ],
      products: [
        { id: "old", slug: "old", name: "Old", status: "approved", published_at: beforeSignup },
        { id: "new", slug: "new", name: "New", status: "approved", published_at: afterSignup },
      ],
      notification_item_reads: [{ notification_id: "announcement-new" }],
      notification_reads: [{ last_seen_at: afterSignup }],
    });
    const ids = Array.from(feed.items, (item) => item.id);
    assert.ok(!ids.includes("announcement-old"));
    assert.ok(!ids.includes("product-old"));
    assert.ok(ids.includes("announcement-boundary"));
    assert.ok(ids.includes("announcement-new"));
    assert.ok(ids.includes("product-new"));
    assert.deepEqual(Array.from(feed.readIds), ["announcement-new"]);
    assert.equal(feed.lastSeenAt, afterSignup);
    if (role === "visitor") assert.ok(feed.items.some((item) => item.kind === "verify-email"));
  });
}

test("old active reward offers do not become new-account notifications or consume the limit", async () => {
  const offers = Array.from({ length: 50 }, (_, index) => ({ id: `old-${index}`, title: "Existing offer", starts_at: beforeSignup }));
  offers.push({ id: "new", title: "New offer", starts_at: afterSignup });
  const feed = await notificationFeed({ role: "visitor", userId: "new-user", createdAt: signupAt, emailVerifiedAt: signupAt }, {}, {
    get_visitor_loyalty_offers: offers,
    get_visitor_loyalty_result_notifications: [{ claim_id: "own", claim_status: "won", offer_title: "Own result", result_at: afterSignup }],
    get_visitor_marketplace_support_notifications: [{ notification_id: "support-own", status: "resolved", target_name: "Own report", updated_at: afterSignup }],
    get_creator_collaboration_notifications: [{ notification_id: "creator-own", title: "Own collaboration", body: "Update", href: "/creators", created_at: afterSignup }],
  });
  assert.deepEqual(Array.from(feed.items.filter((item) => item.kind === "loyalty-offer"), (item) => item.id), ["offer-new"]);
  for (const id of ["result-own", "support-own"]) assert.ok(feed.items.some((item) => item.id === id));
  assert.ok(!feed.items.some((item) => item.id === "creator-own"), "visitor accounts do not receive creator programme notifications");
  assert.equal(offers.length, 51);
});

test("standalone creator accounts receive creator programme notifications but no visitor rewards", async () => {
  const feed = await notificationFeed({ role: "creator", userId: "creator-user", createdAt: signupAt }, {}, {
    get_visitor_loyalty_offers: [{ id: "new", title: "New offer", starts_at: afterSignup }],
    get_creator_collaboration_notifications: [{ notification_id: "creator-own", title: "Own opportunity", body: "Update", href: "/creator/opportunities", created_at: afterSignup }],
  });
  assert.ok(feed.items.some((item) => item.id === "creator-own"));
  assert.ok(!feed.items.some((item) => item.kind === "loyalty-offer"));
});

test("existing accounts keep the existing announcement and product recency windows", async () => {
  const feed = await notificationFeed({ role: "seller", userId: "existing-user", createdAt: "2020-01-01T00:00:00.000Z" }, {
    site_announcements: [{ ...announcement, created_at: new Date(Date.now() - 61 * 86400000).toISOString() }],
    products: [{ id: "expired", status: "approved", published_at: new Date(Date.now() - 15 * 86400000).toISOString() }],
  });
  assert.equal(feed.items.filter((item) => item.kind !== "welcome").length, 0);
});

async function openAnnouncement(viewer, createdAt) {
  const { default: NotificationRoute } = loadModule("src/app/notifications/[id]/page.tsx", {
    "react/jsx-runtime": jsxRuntime,
    react: React,
    "next/server": { connection: async () => {} },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/components/SiteChrome": { SiteHeader: () => null },
    "@/components/NotificationsCenter": { NotificationsCenter: () => null },
    "@/lib/notifications/feed": { getNotificationFeed: async () => ({ items: [], userId: viewer.userId, readIds: [], lastSeenAt: null }) },
    "@/lib/auth/viewer": { getViewer: async () => viewer },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => notificationClient({ site_announcements: [{ ...announcement, created_at: createdAt }] }) },
  });
  const route = NotificationRoute({ params: Promise.resolve({ id: announcementId }) });
  const content = route.props.children[1].props.children;
  return content.type(content.props);
}

test("signed-in users cannot open announcements from before their registration", async () => {
  for (const role of ["visitor", "seller"]) {
    await assert.rejects(openAnnouncement({ role, userId: "new-user", createdAt: signupAt }, beforeSignup), /NOT_FOUND/);
    const allowed = await openAnnouncement({ role, userId: "new-user", createdAt: signupAt }, signupAt);
    assert.equal(allowed.props.message.id, announcementId);
  }
});

test("administrators can still inspect older announcements and guests can read public ones", async () => {
  for (const role of ["admin", "guest"]) {
    const result = await openAnnouncement({ role, userId: "reader", createdAt: signupAt }, beforeSignup);
    assert.equal(result.props.message.id, announcementId);
  }
});

test("each account has one stable welcome message independent of email confirmation", async () => {
  const viewer = { role: "visitor", userId: "new-user", createdAt: signupAt };
  const rpcs = {
    get_notification_inbox: ({ p_channel }) => p_channel === "messages" ? [{ notification_id: `welcome-${viewer.userId}`, kind: "welcome", title: "Welcome to RonTab", body: "Your account is ready", href: "/products", created_at: signupAt, is_read: false }] : [],
    get_notification_inbox_counts: [{ channel: "messages", unread_count: 1 }],
  };
  const first = await notificationFeed(viewer, {}, rpcs);
  const second = await notificationFeed(viewer, {}, rpcs);
  const welcome = first.items.filter((item) => item.kind === "welcome");
  assert.equal(welcome.length, 1);
  assert.equal(welcome[0].id, `welcome-${viewer.userId}`);
  assert.equal(welcome[0].createdAt, signupAt);
  assert.equal(second.items.find((item) => item.kind === "welcome").id, welcome[0].id);
  assert.ok(first.items.some((item) => item.kind === "verify-email"));
});

test("durable inbox pages are bounded while unread counts include the entire archive", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({ notification_id: `announcement-${index}`, kind: "announcement", title: "Saved message", body: "Saved body", href: "/notifications", created_at: beforeSignup, is_read: index === 0 }));
  const feed = await notificationFeed({ role: "seller", userId: "existing", createdAt: "2020-01-01T00:00:00.000Z" }, {}, {
    get_notification_inbox: ({ p_channel, p_limit }) => { assert.equal(p_limit, 21); return p_channel === "messages" ? rows : []; },
    get_notification_inbox_counts: [{ channel: "messages", unread_count: 99 }],
  });
  assert.equal(feed.items.length, 20);
  assert.equal(feed.hasMore.messages, true);
  assert.equal(feed.hasMore.ads, false);
  assert.equal(feed.unreadCounts.messages, 99);
  assert.deepEqual(Array.from(feed.readIds), ["announcement-0"]);
});

test("load-more availability and full unread counts are rendered independently of page size", () => {
  const html = renderInbox("messages", { hasMore: { messages: true, ads: false }, unreadCounts: { messages: 99, ads: 42 } });
  assert.ok(html.includes("Load more"));
  assert.ok(html.includes('aria-label="99 unread messages"'));
  assert.ok(html.includes('aria-label="42 unread ad notifications"'));
  assert.ok(!renderInbox("ads", { hasMore: { messages: true, ads: false } }).includes("Load more"));
});

test("pagination actions reject other accounts and malformed cursors before querying", async () => {
  let queryCount = 0;
  const cursor = { createdAt: signupAt, id: `announcement-${announcementId}` };
  const { loadMoreNotifications } = loadModule("src/lib/notifications/actions.ts", {
    "@/lib/auth/viewer": { getViewer: async () => ({ role: "visitor", userId: "own-account" }) },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ rpc: async (name, args) => {
      queryCount += 1;
      assert.equal(name, "get_notification_inbox");
      assert.equal(args.p_before_time, signupAt);
      assert.equal(args.p_before_id, cursor.id);
      assert.equal(args.p_limit, 21);
      return { data: [], error: null };
    } }) },
    "@/lib/notifications/feed": { notificationPage: (rows) => ({ items: rows, readIds: [], hasMore: false }) },
  });
  assert.ok((await loadMoreNotifications("messages", cursor, "other-account")).error);
  assert.ok((await loadMoreNotifications("messages", { ...cursor, createdAt: "invalid" }, "own-account")).error);
  assert.ok((await loadMoreNotifications("unknown", cursor, "own-account")).error);
  assert.equal(queryCount, 0);
  const result = await loadMoreNotifications("messages", cursor, "own-account");
  assert.equal(result.error, null);
  assert.equal(queryCount, 1);
});