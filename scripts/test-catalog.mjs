import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);

function sellerCatalogueFixture({ canPromote = true, canDelete = true } = {}) {
  const React = nodeRequire("react");
  const state = [];
  let cursor = 0;
  const sourceModule = { exports: {} };
  const dependencies = {
    react: { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value) => { state[index] = value; }]; } },
    "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
    "lucide-react": nodeRequire("lucide-react"),
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/image": { default: ({ fill, unoptimized, sizes, ...props }) => React.createElement("img", { ...props, "data-unoptimized": Boolean(unoptimized), "data-sizes": sizes, ...(fill ? { style: { position: "absolute", inset: 0 } } : {}) }) },
    "@/components/DismissibleDetails": { DismissibleDetails: ({ children, className }) => React.createElement("details", { className }, children) },
    "@/components/seller/DeleteProductDialog": { DeleteProductDialog: ({ product }) => React.createElement("section", { role: "alertdialog", "data-product-id": product.id }) },
    "@/lib/format": { formatCompactNumber: (value) => String(value), formatDate: (value) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)), formatPrice: (value) => value === null ? "Price on request" : `£${value}` },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/seller/SellerProductList.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: sourceModule, exports: sourceModule.exports, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected catalogue import: ${name}`);
  } });
  const products = [
    { id: "coffee", name: "Porcelain coffee cup", category_id: "tableware", categoryName: "Tableware", price: 25, click_count: 128, status: "approved", previewUrl: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=200" },
    { id: "trainers", name: "Everyday running trainers", category_id: "footwear", categoryName: "Footwear", price: 85, click_count: 64, status: "approved", previewUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=200" },
    { id: "bag", name: "Lightweight everyday backpack", category_id: "accessories", categoryName: "Accessories", price: 45, click_count: 12, status: "pending", previewUrl: null },
    { id: "missing", name: "Handcrafted ceramic collection with an exceptionally long product name", category_id: "tableware", categoryName: "Tableware", price: null, click_count: 0, status: "rejected", previewUrl: null },
  ].map((product, index) => ({ slug: product.id, currency: "GBP", created_at: `2026-10-${19 - index}T12:00:00Z`, mediaTypes: product.previewUrl ? ["image"] : [], previewMediaType: "image", ...product }));
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  return {
    render() { cursor = 0; return sourceModule.exports.SellerProductList({ products, canPromote, canDelete }); },
    nodes,
    set(tree, label, value) { const control = nodes(tree).find((node) => node.props?.["aria-label"] === label || (label === "Search" && node.props?.type === "search")); assert.ok(control, `Missing ${label} control`); control.props.onChange({ target: { value } }); },
    rows(tree) { return nodes(tree).filter((node) => node.props?.className === "seller-catalog-row").map((node) => node.key); },
  };
}

test("seller catalogue combines search, category and status filters and can clear them", () => {
  const fixture = sellerCatalogueFixture();
  fixture.set(fixture.render(), "Search", "CERAMIC");
  fixture.set(fixture.render(), "Category", "tableware");
  fixture.set(fixture.render(), "Status", "rejected");
  assert.equal(fixture.rows(fixture.render()).join(), "missing");
  const reset = fixture.nodes(fixture.render()).find((node) => node.type === "button" && node.props?.onClick);
  reset.props.onClick();
  assert.equal(fixture.rows(fixture.render()).length, 4);
});

test("seller catalogue sorts prices with missing prices last and orders shop clicks", () => {
  const fixture = sellerCatalogueFixture();
  fixture.set(fixture.render(), "Sort products", "price-low");
  assert.equal(fixture.rows(fixture.render()).join(), "coffee,bag,trainers,missing");
  fixture.set(fixture.render(), "Sort products", "price-high");
  assert.equal(fixture.rows(fixture.render()).join(), "trainers,bag,coffee,missing");
  fixture.set(fixture.render(), "Sort products", "clicks");
  assert.equal(fixture.rows(fixture.render())[0], "coffee");
});

test("catalogue promotion actions are limited to approved products and disappear for inactive sellers", () => {
  const fixture = sellerCatalogueFixture();
  const links = fixture.nodes(fixture.render()).filter((node) => node.props?.href?.endsWith("/offer"));
  assert.equal(links.length, 2);
  const inactive = sellerCatalogueFixture({ canPromote: false, canDelete: false });
  const tree = inactive.render();
  assert.equal(inactive.nodes(tree).filter((node) => node.props?.href?.endsWith("/offer")).length, 0);
  assert.equal(inactive.nodes(tree).filter((node) => node.type === "button" && node.props?.children?.includes?.("Delete product")).length, 0);
});

test("delete product menu opens the confirmation dialog for the chosen product", () => {
  const fixture = sellerCatalogueFixture();
  const dialogFor = (tree) => fixture.nodes(tree).find((node) => node.props?.product && node.props?.onCancel);
  assert.equal(dialogFor(fixture.render()), undefined);
  const deleteButtons = fixture.nodes(fixture.render()).filter((node) => node.type === "button" && node.props?.children?.includes?.("Delete product"));
  assert.equal(deleteButtons.length, 4);
  deleteButtons[2].props.onClick({ currentTarget: { closest: () => null } });
  const dialog = dialogFor(fixture.render());
  assert.equal(dialog?.props.product.id, "bag");
  dialog.props.onCancel();
  assert.equal(dialogFor(fixture.render()), undefined);
});

if (process.argv.includes("--seller-preview") || process.argv.includes("--shop-preview")) {
  const { createServer } = await import("node:http");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const React = nodeRequire("react");
  const cardModule = { exports: {} };
  const cardDependencies = {
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/image": { default: ({ fill, unoptimized, priority, sizes, ...props }) => React.createElement("img", { ...props, "data-priority": Boolean(priority), "data-unoptimized": Boolean(unoptimized), "data-sizes": sizes, ...(fill ? { style: { position: "absolute", width: "100%", height: "100%", objectFit: "cover" } } : {}) }) },
    "@/components/ShopVisitLink": { ShopVisitLink: ({ children, slug, productName, ...props }) => React.createElement("a", { ...props, href: `/visit/${slug}`, "aria-label": `Visit shop for ${productName}` }, children) },
    "@/components/seller/SellerVerificationBadge": { SellerVerificationBadge: () => null },
    "@/lib/format": { formatCompactNumber: String, formatPrice: (price) => `GBP ${price}` },
    "@/lib/preferences/client": { DEFAULT_CLIENT_PREFERENCES: { autoplayReels: false, reelSoundEnabled: false }, readClientPreferences() {}, subscribeToClientPreferences() {} },
    "@/lib/supabase/client": { createSupabaseBrowserClient: () => null },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/ProductCard.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: cardModule, exports: cardModule.exports, require: (name) => Object.hasOwn(cardDependencies, name) ? cardDependencies[name] : nodeRequire(name) });
  createServer((request, response) => {
    const fixture = sellerCatalogueFixture();
    const query = new URL(request.url, "http://127.0.0.1:3002").searchParams;
    if (process.argv.includes("--shop-preview")) {
      const owner = query.get("owner") !== "0";
      const product = { id: "10000000-0000-4000-8000-000000000001", slug: "trainers", name: "Everyday running trainers", maker: "Independent shop", description: "Lightweight running trainers for everyday use.", price: 85, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500", imageAlt: "Red running trainers", mediaType: "image", shopSlug: "independent-shop" };
      const css = ["src/app/globals.css", "src/app/shops/[slug]/shop.css"].map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n");
      const icons = nodeRequire("lucide-react");
      const content = React.createElement("main", { className: "public-shop-page" },
        React.createElement("a", { className: "public-shop-back", href: owner ? "/seller/products" : "/products" }, owner ? "Shop workspace" : "Browse products"),
        React.createElement("header", { className: "public-shop-hero" },
          React.createElement("span", { className: "public-shop-logo public-shop-logo-fallback" }, "S"),
          React.createElement("div", {},
            React.createElement("div", { className: "public-shop-title-row" }, React.createElement("h1", { className: "public-shop-name" }, "Independent shop"), owner && React.createElement("a", { className: "seller-profile-edit-button", href: "/seller/profile/edit", "aria-label": "Edit shop profile" }, React.createElement(icons.Pencil, { size: 14 }), "Edit")),
            React.createElement("p", { className: "public-shop-description" }, "Everyday products from an independent local shop."),
            React.createElement("div", { className: "public-shop-meta" }, React.createElement("span", {}, "London"), React.createElement("span", {}, "2 followers")),
            owner && React.createElement("nav", { className: "public-shop-owner-contacts", "aria-label": "Your saved contact links" }, ...["MapPin", "Mail", "Store", "Globe2", "Phone", "Link2"].map((icon, index) => React.createElement("a", { key: icon, href: "#", title: icon, "aria-label": icon, "data-contact-kind": ["location", "email", "shop", "website", "phone", "other"][index] }, React.createElement(icons[icon], { size: 19 }))))
          )),
        React.createElement("div", { className: "public-shop-section-heading" }, React.createElement("h2", {}, "Products"), React.createElement("span", {}, "3")),
        React.createElement("div", { className: "public-shop-products" }, ...Array.from({ length: 3 }, (_, index) => React.createElement(cardModule.exports.ProductCard, { product: { ...product, id: `${product.id.slice(0, -1)}${index}`, slug: `${product.slug}-${index}` }, showSellerOfferActions: owner, key: index }))));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${renderToStaticMarkup(content)}</body></html>`);
      return;
    }
    if (query.has("search")) fixture.set(fixture.render(), "Search", query.get("search"));
    const css = ["src/app/globals.css", "src/app/admin/admin.css", "src/app/seller/seller.css"].map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;650;700&display=swap" rel="stylesheet"><style>:root{--font-body:'DM Sans';--font-display:'DM Sans'}${css}</style></head><body><div class="admin-shell admin-shell-hide-mobile-account"><aside class="admin-sidebar"><a class="admin-brand" href="#">RonTab</a><p class="admin-sidebar-label">Shop workspace</p><nav class="admin-nav"><a href="#">Profile</a><a href="#" aria-current="page">Your products</a><a href="#">Your offers</a></nav></aside><div class="admin-main"><main class="admin-overview seller-overview seller-products-page"><header class="admin-page-heading seller-products-page-heading"><div><h1>Your products</h1><p>Independent shop</p></div><a class="seller-products-add-button" href="#">+ Add product</a></header>${renderToStaticMarkup(fixture.render())}</main></div></div></body></html>`);
  }).listen(3002, "127.0.0.1", () => console.log("Isolated seller catalogue preview: http://127.0.0.1:3002"));
}

const categoryModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/categories.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: categoryModule, exports: categoryModule.exports });

function reelFixture({ desktop = true, autoplay = true } = {}) {
  const hooks = [];
  const pendingEffects = [];
  const observers = [];
  let hookIndex = 0;
  let preferenceListener;
  let preferences = { autoplayReels: autoplay, reelSoundEnabled: false };
  const video = Object.assign(new EventTarget(), {
    paused: true, muted: true, duration: 100, currentTime: 0, playCalls: 0,
    pause() { this.paused = true; },
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
  });
  const element = (type, props) => ({ type, props: props ?? {} });
  const dependencies = {
    react: {
      useState(initial) {
        const index = hookIndex++;
        if (!hooks[index]) hooks[index] = { value: initial };
        return [hooks[index].value, (value) => { hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value; }];
      },
      useRef(initial) {
        const index = hookIndex++;
        if (!hooks[index]) hooks[index] = { current: initial };
        return hooks[index];
      },
      useEffect(callback, dependencies) {
        const index = hookIndex++;
        const previous = hooks[index];
        if (!previous || dependencies.some((value, position) => value !== previous.dependencies[position])) {
          pendingEffects.push(() => {
            previous?.cleanup?.();
            hooks[index] = { dependencies, cleanup: callback() };
          });
        }
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "next/image": { default: "image" },
    "next/link": { default: "link" },
    "lucide-react": new Proxy({}, { get: (_target, name) => String(name) }),
    "@/components/ShopVisitLink": { ShopVisitLink: "visit" },
    "@/components/seller/SellerVerificationBadge": { SellerVerificationBadge: "badge" },
    "@/lib/format": { formatCompactNumber: String, formatPrice: String },
    "@/lib/preferences/client": {
      DEFAULT_CLIENT_PREFERENCES: { autoplayReels: true, reelSoundEnabled: false },
      readClientPreferences: () => preferences,
      subscribeToClientPreferences(callback) { preferenceListener = callback; return () => {}; },
    },
    "@/lib/supabase/client": { createSupabaseBrowserClient: () => null },
  };
  const cardModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/ProductCard.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: cardModule, exports: cardModule.exports,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected import: ${name}`);
    },
    window: { matchMedia: () => ({ matches: desktop, addEventListener() {}, removeEventListener() {} }) },
    document: { querySelectorAll: () => [video] },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { this.callback([{ isIntersecting: true }]); }
      disconnect() {}
    },
  });
  const nodes = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  };
  return {
    video, observers,
    unmount() { hooks.forEach((hook) => hook.cleanup?.()); },
    setAutoplay(value) { preferences = { ...preferences, autoplayReels: value }; preferenceListener(); },
    render(options = {}) {
      hookIndex = 0;
      const tree = cardModule.exports.ProductCard({ product: {
        id: "reel-id", slug: "reel", name: "Reel", maker: "Shop", description: "Description", image: "reel.mp4", imageAlt: "Reel", mediaType: "video", price: 10,
      }, ...options });
      const elements = nodes(tree);
      const media = elements.find((node) => node.type === "video");
      media.props.ref.current = video;
      pendingEffects.splice(0).forEach((effect) => effect());
      return { tree, elements, media, playButton: elements.find((node) => node.props["aria-label"] === "Play video with sound") };
    },
  };
}

test("product card replaces the external visit only for seller offer controls and keeps the price", () => {
  const fixture = reelFixture();
  const original = fixture.render();
  assert.equal(original.elements.filter((node) => node.type === "visit").length, 1);
  assert.equal(original.elements.filter((node) => node.props.href?.startsWith("/seller/products/")).length, 0);
  const owner = fixture.render({ showSellerOfferActions: true });
  assert.equal(owner.elements.filter((node) => node.type === "visit").length, 0);
  assert.deepEqual(owner.elements.filter((node) => node.props.href?.startsWith("/seller/products/")).map((node) => node.props.href), ["/seller/products/reel-id/offer", "/seller/products/reel-id/creator-opportunity"]);
  assert.ok(owner.elements.some((node) => node.props.className === "product-visit-price" && node.props.children === "10"));
  assert.ok(owner.elements.filter((node) => node.props.href?.startsWith("/seller/products/")).every((node) => node.props.title && node.props["aria-label"]));
  const preview = fixture.render({ showSellerOfferActions: true, previewOnly: true });
  assert.equal(preview.elements.filter((node) => node.props.href?.startsWith("/seller/products/")).length, 0);
  for (const view of [original, owner]) {
    assert.ok(view.elements.some((node) => node.props.className?.includes("advertiser-avatar")));
    assert.equal(view.elements.find((node) => node.props.className === "product-description-name-text").props.children, "Shop");
    assert.equal(view.elements.find((node) => node.props.className === "product-description-maker-name").props.children, "Reel");
    assert.equal(view.elements.find((node) => node.props.className === "product-card-description").props.children, "Description");
  }
});

test("public shop contact icons use only the consent-filtered RPC, with a safe unmigrated fallback", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  let missing = false;
  const calls = [];
  const dependencies = {
    "server-only": {}, "react/jsx-runtime": nodeRequire("react/jsx-runtime"), "lucide-react": nodeRequire("lucide-react"),
    "@icons-pack/react-simple-icons": nodeRequire("@icons-pack/react-simple-icons"),
    "@/lib/seller/access": { getSellerAccount() { throw new Error("Public contacts must not read private seller account data."); } },
    "@/lib/seller/social-links": { sellerSocialPlatforms: [] }, "@/lib/validation": {},
    "@/lib/supabase/server": { createSupabasePublicClient: () => ({ rpc: async (name, parameters) => {
      calls.push({ name, parameters });
      return missing ? { data: null, error: { code: "PGRST202" } } : { data: [{ kind: "instagram", href: "https://www.instagram.com/shop" }, { kind: "phone", href: "tel:+447700900123" }], error: null };
    } }) },
  };
  const target = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/seller/SellerProfileContactLinks.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: target, exports: target.exports, URL, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected contact import: ${name}`);
  } });
  const props = { sellerProfileId: "shop-id", shopUrl: "https://shop.example.invalid", publicPhone: "+447700900123", isOwner: false };
  const html = renderToStaticMarkup(await target.exports.SellerProfileContactLinks(props));
  assert.match(html, /aria-label="Shop contact links"/);
  assert.match(html, /href="https:\/\/www.instagram.com\/shop"/);
  assert.match(html, /href="tel:\+447700900123"/);
  assert.doesNotMatch(html, /mailto:/);
  assert.equal(calls[0].name, "get_public_seller_contact_links");
  assert.equal(calls[0].parameters.p_seller_profile_id, "shop-id");
  missing = true;
  const fallback = renderToStaticMarkup(await target.exports.SellerProfileContactLinks(props));
  assert.match(fallback, /href="https:\/\/shop.example.invalid"/);
  assert.match(fallback, /href="tel:\+447700900123"/);
  assert.doesNotMatch(fallback, /instagram|mailto:/);
});

test("shop owner controls are server-verified and hidden from guests, visitors, admins and other sellers", async () => {
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  for (const viewer of [{ role: "guest" }, { role: "visitor", userId: "visitor-user" }, { role: "admin", userId: "owner-user" }, { role: "seller", userId: "other-user" }, { role: "seller", userId: "owner-user" },
    { role: "seller", userId: "owner-user", privateShop: true }, { role: "guest", privateShop: true }, { role: "seller", userId: "other-user", privateShop: true },
    { role: "seller", userId: "owner-user", privateShop: true, inactiveShop: true }]) {
    const ownershipQueries = [];
    const seller = { id: "shop-id", slug: "test-shop", shop_name: "Test shop", status: viewer.inactiveShop ? "pending" : "active", is_public: !viewer.privateShop };
    const sessionClient = { from(table) {
      assert.equal(table, "seller_profiles");
      const filters = {};
      const query = { select: () => query, eq: (column, value) => { filters[column] = value; return query; }, maybeSingle: async () => {
        ownershipQueries.push(filters);
        return { data: filters.slug === seller.slug && filters.user_id === "owner-user" ? seller : null, error: null };
      } };
      return query;
    }, rpc: async () => ({ data: false, error: null }) };
    const publicClient = { from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: viewer.privateShop ? null : seller, error: null }) };
      return query;
    }, rpc: async (name) => ({ data: name === "get_public_seller_verification_badges" ? [] : name === "get_public_seller_follower_count" ? 0 : null, error: null }) };
    const dependencies = {
      "react/jsx-runtime": nodeRequire("react/jsx-runtime"), "lucide-react": nodeRequire("lucide-react"),
      "next/image": { default: "image" }, "next/link": { default: "link" }, "next/navigation": { notFound() { throw new Error("Not found"); } }, "next/server": { connection: async () => {} },
      "@/components/ActionForm": { ActionForm: "form" }, "@/components/seller/SellerVerificationBadge": { SellerVerificationBadge: "badge" },
      "@/components/seller/SellerProfileEditButton": { SellerProfileEditButton: "edit-profile" },
      "@/components/seller/SellerProfileContactLinks": { SellerProfileContactLinks: "private-contacts" },
      "@/components/seller/SellerNavigation": { SellerNavigation: "seller-navigation" },
      "@/components/WorkspaceShell": { WorkspaceShell: "workspace-shell" },
      "@/components/ProductCard": { ProductCard: "card" }, "@/components/SiteChrome": { SiteHeader: "header" }, "@/app/visitor/shop-follow-actions": { followShop() {} },
      "@/lib/auth/viewer": { getViewer: async () => viewer }, "@/lib/format": { formatNumber: String },
      "@/lib/supabase/catalog": { getPublicCatalog: async () => ({ products: [{ id: "product-id", slug: "product", sellerProfileId: seller.id }] }) },
      "@/lib/supabase/server": { createSupabasePublicClient: () => publicClient, createSupabaseServerClient: async () => sessionClient }, "./shop.css": {},
    };
    const target = { exports: {} };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/shops/[slug]/page.tsx", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: target, exports: target.exports, require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected shop import: ${name}`);
    } });
    const render = () => target.exports.default({ params: Promise.resolve({ slug: seller.slug }), searchParams: Promise.resolve({ saved: "1" }) });
    const isOwner = viewer.role === "seller" && viewer.userId === "owner-user";
    if (viewer.privateShop && !isOwner) {
      await assert.rejects(render(), /Not found/);
      continue;
    }
    const tree = await render();
    const card = nodes(tree).find((node) => node.type === "card");
    const workspace = nodes(tree).find((node) => node.type === "workspace-shell");
        assert.equal(Boolean(workspace), isOwner);
        if (isOwner) {
          assert.equal(workspace.props.navigation.type, "seller-navigation");
          assert.equal(workspace.props.navigation.props.activeHref, "/seller/profile");
          assert.equal(workspace.props.sectionLabel, "SHOP WORKSPACE");
        }
    assert.equal(card.props.muteAutoplay, true);
    assert.equal(card.props.showSellerOfferActions, isOwner && !viewer.inactiveShop, `${viewer.role}:${viewer.userId}`);
    assert.equal(ownershipQueries.length, viewer.role === "seller" ? 1 : 0);
    if (viewer.role === "seller") assert.deepEqual(ownershipQueries[0], { slug: seller.slug, user_id: viewer.userId });
    assert.equal(nodes(tree).some((node) => node.type === "edit-profile"), viewer.role === "seller" && viewer.userId === "owner-user");
    const contacts = nodes(tree).find((node) => node.type === "private-contacts");
    assert.ok(contacts);
    assert.equal(contacts.props.isOwner, isOwner);
    assert.equal(contacts.props.sellerProfileId, seller.id);
    assert.equal(nodes(tree).some((node) => node.props?.className === "public-shop-private-notice"), Boolean(isOwner && viewer.privateShop));
    assert.equal(nodes(tree).some((node) => node.props?.children === "Shop profile saved successfully."), isOwner);
  }
});

test("video metadata preview handles events and removes its listener on unmount", () => {
  const state = reelFixture();
  state.render();
  state.video.currentTime = 0;
  state.video.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(state.video.currentTime, 0.1);
  assert.equal(state.video.playCalls, 0);
  state.unmount();
  state.video.currentTime = 0;
  state.video.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(state.video.currentTime, 0);
});

test("desktop reels never autoplay or replay and manual play enables sound", () => {
  const state = reelFixture();
  state.render();
  const view = state.render();
  assert.equal(state.video.playCalls, 0);
  assert.equal(state.video.paused, true);
  view.media.props.onEnded({ currentTarget: state.video });
  assert.equal(state.video.playCalls, 0);
  view.playButton.props.onClick();
  assert.equal(state.video.playCalls, 1);
  assert.equal(state.video.muted, false);
  view.playButton.props.onClick();
  assert.equal(state.video.paused, true);
});

test("saved autoplay opt-out prevents even the initial mobile play call", () => {
  const state = reelFixture({ desktop: false, autoplay: false });
  state.render();
  const view = state.render();
  assert.equal(state.video.playCalls, 0);
  view.media.props.onEnded({ currentTarget: state.video });
  assert.equal(state.video.playCalls, 0);
});

test("mobile autoplay remains available but disabling it cancels stale visibility callbacks", () => {
  const state = reelFixture({ desktop: false });
  state.render();
  assert.equal(state.video.playCalls, 0);
  state.render();
  assert.equal(state.video.playCalls, 1);
  state.setAutoplay(false);
  state.render();
  assert.equal(state.video.paused, true);
  state.observers[0].callback([{ isIntersecting: true }]);
  assert.equal(state.video.playCalls, 1);
});

function categoryPickerFixture(initialValue = "") {
  const pickerModule = { exports: {} };
  const element = (type, props) => ({ type, props: props ?? {} });
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/seller/ProductCategoryPicker.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: pickerModule, exports: pickerModule.exports,
    require(name) {
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
      if (name === "@/lib/categories") return categoryModule.exports;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const categories = [
    { id: "women", name: "Women" },
    { id: "shoes", name: "Shoes", parent_id: "women" },
    { id: "boots", name: "Boots", parent_id: "shoes" },
    { id: "restaurants", name: "Restaurants" },
    { id: "pizza", name: "Pizza", parent_id: "restaurants" },
    { id: "kitchen", name: "Kitchen" },
  ];
  let value = initialValue;
  return {
    categories,
    render() {
      const tree = pickerModule.exports.ProductCategoryPicker({ categories, value, onChange(next) { value = next; } });
      return {
        savedValue: tree.props.children[0].props.value,
        selects: Array.from(tree.props.children[1], (label) => label.props.children[1]),
      };
    },
  };
}

test("seller category picker reveals only children of the selected parent and resets stale descendants", () => {
  const state = categoryPickerFixture();
  let view = state.render();
  assert.equal(view.selects.length, 1);
  assert.equal(view.selects[0].props.required, true);
  assert.deepEqual(Array.from(view.selects[0].props.children[1], (option) => option.props.value), ["women", "restaurants", "kitchen"]);
  view.selects[0].props.onChange({ target: { value: "women" } });
  view = state.render();
  assert.equal(view.selects.length, 2);
  assert.deepEqual(Array.from(view.selects[1].props.children[1], (option) => option.props.value), ["shoes"]);
  view.selects[1].props.onChange({ target: { value: "shoes" } });
  view = state.render();
  assert.equal(view.selects.length, 3);
  view.selects[2].props.onChange({ target: { value: "boots" } });
  assert.equal(state.render().savedValue, "boots");
  state.render().selects[0].props.onChange({ target: { value: "restaurants" } });
  view = state.render();
  assert.equal(view.savedValue, "restaurants");
  assert.equal(view.selects.length, 2);
  assert.equal(view.selects[1].props.value, "");
  assert.deepEqual(Array.from(view.selects[1].props.children[1], (option) => option.props.value), ["pizza"]);
  view.selects[1].props.onChange({ target: { value: "pizza" } });
  assert.equal(state.render().savedValue, "pizza");
  assert.equal(state.render().selects.length, 2);
});

test("seller editing reconstructs an existing category path and permits general categories", () => {
  const state = categoryPickerFixture("boots");
  let view = state.render();
  assert.deepEqual(view.selects.map((select) => select.props.value), ["women", "shoes", "boots"]);
  view.selects[2].props.onChange({ target: { value: "" } });
  assert.equal(state.render().savedValue, "shoes");
  state.render().selects[1].props.onChange({ target: { value: "" } });
  assert.equal(state.render().savedValue, "women");
  assert.equal(state.render().selects.length, 2);
  state.render().selects[0].props.onChange({ target: { value: "kitchen" } });
  view = state.render();
  assert.equal(view.savedValue, "kitchen");
  assert.equal(view.selects.length, 1);
});

test("seller picker excludes orphaned and hidden category branches", () => {
  const state = categoryPickerFixture("boots");
  state.categories.splice(0, 1);
  const view = state.render();
  assert.equal(view.savedValue, "");
  assert.equal(view.selects.length, 1);
  assert.deepEqual(Array.from(view.selects[0].props.children[1], (option) => option.props.value), ["restaurants", "kitchen"]);
  state.categories.length = 0;
  assert.equal(state.render().savedValue, "");
  assert.equal(state.render().selects[0].props.required, true);
});

function fixture() {
  const products = Array.from({ length: 40 }, (_, index) => ({
    id: `product-${index}`,
    slug: `product-${index}`,
    name: `Product ${index}`,
    description: "A product",
    status: index === 39 ? "pending" : "approved",
    category_id: index < 4 ? "kitchen-id" : "home-id",
    seller_profile_id: "seller-id",
  }));
  const tables = {
    products,
    top_video_ads: [
      { id: "ad-active", title: "Active ad", storage_path: "active.mp4", media_type: "video", display_seconds: 8, target_url: null, is_active: true },
      { id: "ad-inactive", title: "Inactive ad", storage_path: "inactive.jpg", media_type: "image", display_seconds: 5, target_url: "https://example.test", is_active: false },
    ],
    categories: [
      { id: "kitchen-id", slug: "kitchen", name: "Kitchen", is_active: true },
      { id: "home-id", slug: "home", name: "Home", is_active: true },
    ],
    seller_profiles: [{ id: "seller-id", shop_name: "Shop" }],
    product_images: products.map((product) => ({
      product_id: product.id, media_type: "image", storage_path: `${product.id}.jpg`,
    })),
  };
  const queries = [];
  const signedBatches = [];
  const lifetimes = [];
  const tags = [];
  let productError = null;
  const database = {
    from(table) {
      const filters = [];
      const query = {
        table, filters,
        select() { return this; },
        eq(column, value) { filters.push((row) => row[column] === value); return this; },
        neq(column, value) { filters.push((row) => row[column] !== value); return this; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return this; },
        order() { return this; },
        limit(value) { this.limitValue = value; return this; },
        then(resolve, reject) {
          queries.push(this);
          const rows = tables[table].filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({
            data: rows.slice(0, this.limitValue ?? rows.length),
            error: table === "products" ? productError : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc() { return { data: [], error: null }; },
    storage: {
      from(bucket) {
        return {
          getPublicUrl(path) { return { data: { publicUrl: `https://storage.example.test/${bucket}/${path}` } }; },
        };
      },
    },
  };
  const dependencies = {
    "server-only": {},
    react: { cache: (callback) => callback },
    "next/cache": { cacheLife: (value) => lifetimes.push(value), cacheTag: (value) => tags.push(value) },
    "@/lib/categories": categoryModule.exports,
    "@/lib/supabase/server": { createSupabasePublicClient: () => database },
    "@/lib/supabase/storage": {
      async createProductMediaUrls(_client, paths) {
        signedBatches.push(paths);
        return new Map(paths.map((path) => [path, `https://example.test/${path}`]));
      },
    },
  };
  const testModule = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/supabase/catalog.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, console,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { catalog: testModule.exports, tables, queries, signedBatches, lifetimes, tags, failProducts(error) { productError = error; } };
}

test("detail queries fetch and sign only the requested approved product", async () => {
  const state = fixture();
  const product = await state.catalog.getPublicProduct("product-3");
  assert.equal(product.slug, "product-3");
  const query = state.queries.find((item) => item.table === "products");
  assert.equal(query.limitValue, 1);
  assert.equal(state.signedBatches.flat().length, 1);
});

test("missing and unapproved products return null without loading media", async () => {
  for (const slug of ["missing", "product-39"]) {
    const state = fixture();
    assert.equal(await state.catalog.getPublicProduct(slug), null);
    assert.equal(state.queries.some((query) => query.table === "product_images"), false);
  }
});

test("related products prefer the same category then fill only the remaining slots", async () => {
  const state = fixture();
  const related = await state.catalog.getRelatedPublicProducts("product-0", "kitchen");
  assert.equal(related.length, 8);
  assert.equal(related.slice(0, 3).every((product) => product.category === "kitchen"), true);
  assert.equal(related.slice(3).every((product) => product.category === "home"), true);
  assert.equal(related.some((product) => product.slug === "product-0"), false);
  assert.equal(new Set(related.map((product) => product.id)).size, 8);
  assert.equal(state.signedBatches.flat().length, 8);
  assert.deepEqual(state.queries.filter((query) => query.table === "products").map((query) => query.limitValue), [8, 5]);
});

test("a full category does not fetch unrelated products", async () => {
  const state = fixture();
  const related = await state.catalog.getRelatedPublicProducts("product-4", "home");
  assert.equal(related.length, 8);
  assert.equal(related.every((product) => product.category === "home"), true);
  assert.equal(state.queries.filter((query) => query.table === "products").length, 1);
});

test("public catalog uses a tagged cache shorter than the signed URL lifetime", async () => {
  const state = fixture();
  await state.catalog.getPublicCatalog();
  assert.equal(state.tags.includes("public-catalog"), true);
  assert.equal(state.lifetimes[0].stale, 300);
  assert.equal(state.lifetimes[0].revalidate, 600);
  assert.equal(state.lifetimes[0].expire, 3300);
});

test("public top video ads use a tagged cache and only include active ads", async () => {
  const state = fixture();
  const ads = await state.catalog.getTopVideoAds();
  assert.deepEqual(ads.map((ad) => ad.id), ["ad-active"]);
  assert.equal(ads[0].mediaUrl, "https://storage.example.test/top-video-ads/active.mp4");
  assert.equal(state.tags.includes("top-video-ads"), true);
  assert.equal(state.lifetimes[0].stale, 300);
  assert.equal(state.lifetimes[0].revalidate, 600);
  assert.equal(state.lifetimes[0].expire, 3300);
});

test("database failures propagate rather than being cached as an empty catalog", async () => {
  const state = fixture();
  state.failProducts(new Error("database unavailable"));
  await assert.rejects(state.catalog.getPublicProduct("product-0"), /database unavailable/);
});

test("category branches and breadcrumbs use parent relationships rather than slug prefixes", () => {
  const categories = [
    { id: "women", name: "Women" },
    { id: "footwear", name: "Shoes", parentId: "women" },
    { id: "boots", name: "Boots", parentId: "footwear" },
    { id: "home", name: "Home" },
  ];
  assert.deepEqual([...categoryModule.exports.getCategoryBranchIds(categories, "women")], ["women", "footwear", "boots"]);
  assert.equal(categoryModule.exports.getCategoryPath(categories, "boots").map((category) => category.name).join(" / "), "Women / Shoes / Boots");
});

test("hidden parents, missing parents and cycles do not leak child categories", () => {
  const visible = categoryModule.exports.getVisibleCategoryRows([
    { id: "hidden", is_active: false },
    { id: "child", parent_id: "hidden", is_active: true },
    { id: "orphan", parent_id: "missing", is_active: true },
    { id: "cycle-one", parent_id: "cycle-two", is_active: true },
    { id: "cycle-two", parent_id: "cycle-one", is_active: true },
    { id: "visible", is_active: true },
  ]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "visible");
});

test("public catalog exposes hierarchy and excludes products assigned to hidden branches", async () => {
  const state = fixture();
  state.tables.categories[0].parent_id = "home-id";
  let result = await state.catalog.getPublicCatalog();
  assert.equal(result.categories.find((category) => category.id === "kitchen").parentId, "home");
  state.tables.categories[1].is_active = false;
  result = await state.catalog.getPublicCatalog();
  assert.equal(result.categories.length, 0);
  assert.equal(result.products.length, 0);
});

function browserFixture(mobile = false, extraCategories = []) {
  const state = [];
  let stateIndex = 0;
  const Card = () => null;
  const element = (type, props) => ({ type, props: props ?? {} });
  const dependencies = {
    react: {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = index === 3 ? mobile : initial;
        return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
      },
      useEffect() {},
      useRef(initial) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = { current: initial };
        return state[index];
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_target, name) => String(name) }),
    "@/components/ProductCard": { ProductCard: Card },
    "@/lib/categories": categoryModule.exports,
  };
  const browserModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/ProductBrowser.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: browserModule, exports: browserModule.exports,
    require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected import: ${name}`); },
  });
  const categories = [
    { id: "women", name: "Women", parentId: null },
    { id: "shoes", name: "Shoes", parentId: "women" },
    { id: "boots", name: "Boots", parentId: "shoes" },
    { id: "clothing", name: "Clothing", parentId: "women" },
    { id: "dresses", name: "Dresses", parentId: "clothing" },
    { id: "kitchen", name: "Kitchen", parentId: null },
    ...extraCategories,
  ];
  const leaves = extraCategories.filter((category) => !extraCategories.some((child) => child.parentId === category.id)).map((category) => category.id);
  const products = ["boots", "dresses", "kitchen", ...leaves].map((category) => ({ slug: category, category, name: category, description: "", maker: "Shop", categoryName: category }));
  const render = () => {
    stateIndex = 0;
    return browserModule.exports.ProductBrowser({ initialQuery: "", initialCategory: "all", categories, products });
  };
  const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props.children)] : [];
  const find = (tree, predicate) => nodes(tree).find(predicate);
  const text = (node) => Array.isArray(node) ? node.map(text).join("") : typeof node === "string" ? node : node?.props ? text(node.props.children) : "";
  const button = (tree, label) => find(tree, (node) => node.type === "button" && text(node) === label);
  return { render, find, button, cards: (tree) => nodes(tree).filter((node) => node.type === Card).map((node) => node.props.product.slug) };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "phone" : "desktop"} navigation opens Women and filters all descendants or a selected leaf`, () => {
    const browser = browserFixture(mobile);
    let tree = browser.render();
    const trigger = browser.find(tree, (node) => node.props.id === "category-trigger-women");
    assert.ok(trigger);
    assert.equal(browser.find(tree, (node) => node.props.id === "category-trigger-boots"), undefined);
    trigger.props.onClick();
    tree = browser.render();
    assert.ok(browser.find(tree, (node) => node.props.id === (mobile ? "mobile-category-tabs" : "category-menu")));
    browser.button(tree, "All Women").props.onClick();
    tree = browser.render();
    assert.deepEqual(browser.cards(tree), ["boots", "dresses"]);
    assert.equal(browser.find(tree, (node) => node.props.id === "category-menu"), undefined);
    browser.find(tree, (node) => node.props.id === "category-trigger-women").props.onClick();
    tree = browser.render();
    if (mobile) {
      browser.button(tree, "Shoes").props.onClick({ currentTarget: {} });
      tree = browser.render();
      assert.ok(browser.find(tree, (node) => node.props.id === "mobile-category-sheet-title"));
    }
    browser.button(tree, "Boots").props.onClick();
    tree = browser.render();
    assert.deepEqual(browser.cards(tree), ["boots"]);
    assert.ok(browser.find(tree, (node) => node.props["aria-label"] === "Selected category"));
    if (mobile) {
      assert.ok(browser.find(tree, (node) => node.props.id === "mobile-category-tabs"));
      assert.equal(browser.find(tree, (node) => node.props.id === "mobile-category-sheet-title"), undefined);
      browser.button(tree, "All").props.onClick();
      assert.equal(browser.find(browser.render(), (node) => node.props.id === "mobile-category-tabs"), undefined);
    }
  });

  test(`${mobile ? "phone" : "desktop"} supports all seeded departments without leaking products across departments`, () => {
    const departments = [
      { root: "men", name: "Men", group: "Shoes", leaf: "Formal shoes" },
      { root: "designer", name: "Designer", group: "Designer women", leaf: "Designer bags" },
      { root: "kids", name: "Kids", group: "Nursing & feeding", leaf: "Sterilisers" },
      { root: "home", name: "Home", group: "Small kitchen appliances", leaf: "Kettles" },
      { root: "electronics", name: "Electronics", group: "Computers & accessories", leaf: "Laptops" },
      { root: "books-media", name: "Books & Media", group: "Books", leaf: "Fiction", direct: "Magazines" },
      { root: "hobbies-collectables", name: "Hobbies & collectables", group: "Trading cards", leaf: "Booster packs", direct: "Board games" },
      { root: "sports", name: "Sports", group: "Cycling", leaf: "Bikes" },
      { root: "grocery", name: "Grocery", group: "Fruit & vegetables", leaf: "Fruit", direct: "Tea & coffee" },
    ];
    const extraCategories = departments.flatMap((department) => [
      { id: department.root, name: department.name, parentId: null },
      { id: `${department.root}-group`, name: department.group, parentId: department.root },
      { id: `${department.root}-leaf`, name: department.leaf, parentId: `${department.root}-group` },
      ...(department.direct ? [{ id: `${department.root}-direct`, name: department.direct, parentId: department.root }] : []),
    ]);
    const browser = browserFixture(mobile, extraCategories);
    for (const department of departments) {
      let tree = browser.render();
      browser.find(tree, (node) => node.props.id === `category-trigger-${department.root}`).props.onClick();
      tree = browser.render();
      assert.ok(browser.find(tree, (node) => node.props["aria-label"] === `${department.name} categories`));
      if (mobile) {
        const tabs = browser.find(tree, (node) => node.props.id === "mobile-category-tabs");
        browser.button(tabs, department.group).props.onClick({ currentTarget: {} });
        tree = browser.render();
      }
      browser.button(tree, department.leaf).props.onClick();
      tree = browser.render();
      assert.deepEqual(browser.cards(tree), [`${department.root}-leaf`]);
      assert.equal(browser.find(tree, (node) => node.props.id === "category-menu"), undefined);
      const breadcrumb = browser.find(tree, (node) => node.props["aria-label"] === "Selected category");
      assert.ok(browser.find(breadcrumb, (node) => node.type === "button" && node.props.children === department.name));
      if (department.direct) {
        browser.find(tree, (node) => node.props.id === `category-trigger-${department.root}`).props.onClick();
        tree = browser.render();
        browser.button(tree, department.direct).props.onClick();
        tree = browser.render();
        assert.deepEqual(browser.cards(tree), [`${department.root}-direct`]);
        assert.equal(browser.find(tree, (node) => node.props.id === "category-menu"), undefined);
      }
    }
  });
  test(`${mobile ? "phone" : "desktop"} shows flat restaurant branches once and filters the root or a direct branch`, () => {
    const browser = browserFixture(mobile, [
      { id: "restaurants", name: "Restaurants", parentId: null },
      { id: "restaurants-pizza", name: "Pizza", parentId: "restaurants" },
      { id: "restaurants-burgers", name: "Burgers", parentId: "restaurants" },
    ]);
    let tree = browser.render();
    browser.find(tree, (node) => node.props.id === "category-trigger-restaurants").props.onClick();
    tree = browser.render();
    const menu = browser.find(tree, (node) => node.props.id === (mobile ? "mobile-category-tabs" : "category-menu"));
    if (!mobile) assert.ok(menu.props.className.includes("category-menu-flat"));
    assert.equal(browser.find(menu, (node) => node.props.id === "category-menu-items"), undefined);
    browser.button(menu, "All Restaurants").props.onClick();
    tree = browser.render();
    assert.deepEqual(browser.cards(tree), ["restaurants-pizza", "restaurants-burgers"]);
    browser.find(tree, (node) => node.props.id === "category-trigger-restaurants").props.onClick();
    tree = browser.render();
    browser.button(tree, "Pizza").props.onClick();
    tree = browser.render();
    assert.deepEqual(browser.cards(tree), ["restaurants-pizza"]);
    assert.equal(browser.find(tree, (node) => node.props.id === "category-menu"), undefined);
    assert.ok(browser.find(tree, (node) => node.props["aria-label"] === "Selected category"));
  });
}

test("phone product catalog uses the single two-column card grid without a layout toggle", () => {
  const browser = browserFixture(true);
  const tree = browser.render();
  const grid = browser.find(tree, (node) => node.props.id === "product-grid");
  assert.equal(grid.props.className, "product-grid");
  assert.equal(browser.find(tree, (node) => node.props.className === "product-view-toggle"), undefined);
});

function adminActionsFixture() {
  const calls = [];
  const paths = [];
  let rpcError = null;
  const validationModule = { exports: {} };
  const offerPolicyModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/validation.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: validationModule, exports: validationModule.exports, URL });
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/seller/offer-policy.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: offerPolicyModule, exports: offerPolicyModule.exports });
  class FormError extends Error {}
  const dependencies = {
    "next/cache": { revalidatePath: (path) => paths.push(path), updateTag: (tag) => paths.push(tag) },
    "next/navigation": {},
    "@/lib/admin/access": { requireAdmin: async () => ({ supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { error: rpcError }; } } }) },
    "@/lib/form-state": { FormError, runFormAction: async (action) => { try { await action(); return { error: null }; } catch (error) { return { error: error instanceof FormError ? error.message : "Save failed" }; } } },
    "@/lib/supabase/server": {},
    "@/lib/validation": validationModule.exports,
    "@/lib/seller/offer-policy": offerPolicyModule.exports,
  };
  const actionModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/admin/(protected)/actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: actionModule, exports: actionModule.exports, crypto: globalThis.crypto,
    require: (name) => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected import: ${name}`); },
  });
  return { actions: actionModule.exports, calls, paths, fail(error) { rpcError = error; } };
}

test("new category slugs are generated for English and non-Latin names", async () => {
  for (const name of ["Summer hats", "\u062d\u0642\u0627\u0626\u0628"]) {
    const state = adminActionsFixture();
    const form = new FormData();
    form.set("name", name);
    form.set("sort_order", "10");
    form.set("is_active", "on");
    const result = await state.actions.saveCategoryDetails(form);
    assert.equal(result.error, null);
    assert.match(state.calls[0].args.p_slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(state.calls[0].args.p_name, name);
    assert.equal(state.calls[0].args.p_is_active, true);
    assert.ok(state.paths.includes("public-catalog"));
  }
});

test("editing preserves a supplied slug, description, image and parent", async () => {
  const state = adminActionsFixture();
  const form = new FormData();
  const categoryId = "00000000-0000-4000-8000-000000000001";
  const parentId = "00000000-0000-4000-8000-000000000002";
  for (const [key, value] of Object.entries({ category_id: categoryId, parent_id: parentId, name: "Renamed", slug: "original-slug", description: "Original description", image_url: "https://example.test/image.jpg", sort_order: "20", is_active: "on" })) form.set(key, value);
  assert.equal((await state.actions.saveCategoryDetails(form)).error, null);
  const saved = state.calls[0].args;
  assert.equal(saved.p_slug, "original-slug");
  assert.equal(saved.p_description, "Original description");
  assert.equal(saved.p_image_url, "https://example.test/image.jpg");
  assert.equal(saved.p_parent_id, parentId);
  state.fail({ code: "23505" });
  assert.match((await state.actions.saveCategoryDetails(form)).error, /slug is already used/);
});

test("visibility saves only ID and visibility, and invalid IDs never reach the database", async () => {
  const state = adminActionsFixture();
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal((await state.actions.setCategoryVisibility(id, false)).error, null);
  assert.equal(state.calls[0].name, "admin_set_category_visibility");
  assert.deepEqual(Object.keys(state.calls[0].args).sort(), ["p_category_id", "p_is_active"]);
  assert.equal(state.calls[0].args.p_is_active, false);
  assert.ok((await state.actions.setCategoryVisibility("invalid", true)).error);
  assert.equal(state.calls.length, 1);
});

test("seller profile entry redirects to the canonical shop profile and preserves save feedback", async () => {
  const target = { exports: {} };
  const dependencies = {
    "next/server": { connection: async () => {} },
    "next/navigation": { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
    "@/lib/seller/access": { getSellerAccount: async () => ({ seller: { slug: "my-shop" } }) },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/app/seller/(protected)/profile/page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: target, exports: target.exports, require: (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected profile import: ${name}`);
  } });
  await assert.rejects(target.exports.default({ searchParams: Promise.resolve({}) }), /REDIRECT:\/shops\/my-shop$/);
  await assert.rejects(target.exports.default({ searchParams: Promise.resolve({ saved: "1" }) }), /REDIRECT:\/shops\/my-shop\?saved=1$/);
});