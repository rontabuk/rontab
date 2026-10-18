import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

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
    "@/components/ShopFollowButton": { ShopFollowButton: "follow" },
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
    render() {
      hookIndex = 0;
      const tree = cardModule.exports.ProductCard({ product: {
        slug: "reel", name: "Reel", maker: "Shop", description: "Description", image: "reel.mp4", imageAlt: "Reel", mediaType: "video", price: 10,
      } });
      const elements = nodes(tree);
      const media = elements.find((node) => node.type === "video");
      media.props.ref.current = video;
      pendingEffects.splice(0).forEach((effect) => effect());
      return { media, playButton: elements.find((node) => node.props["aria-label"] === "Play video with sound") };
    },
  };
}

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
  };
  const dependencies = {
    "server-only": {},
    react: { cache: (callback) => callback },
    "next/cache": { cacheLife: (value) => lifetimes.push(value), cacheTag: (value) => tags.push(value) },
    "@/data/products": { getOverlayTone: () => "sage" },
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

test("public data uses a short tagged cache, well within the signed URL lifetime", async () => {
  const state = fixture();
  await state.catalog.getPublicCatalog();
  assert.equal(state.tags.includes("public-catalog"), true);
  assert.equal(state.lifetimes[0].stale, 30);
  assert.equal(state.lifetimes[0].revalidate, 30);
  assert.equal(state.lifetimes[0].expire, 60);
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
        if (!(index in state)) state[index] = index === 4 ? mobile : initial;
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
    return browserModule.exports.ProductBrowser({ initialQuery: "", initialCategory: "all", categories, products, followedShopIds: [] });
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

function adminActionsFixture() {
  const calls = [];
  const paths = [];
  let rpcError = null;
  const validationModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/validation.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: validationModule, exports: validationModule.exports, URL });
  class FormError extends Error {}
  const dependencies = {
    "next/cache": { revalidatePath: (path) => paths.push(path), updateTag: (tag) => paths.push(tag) },
    "next/navigation": {},
    "@/lib/admin/access": { requireAdmin: async () => ({ supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { error: rpcError }; } } }) },
    "@/lib/form-state": { FormError, runFormAction: async (action) => { try { await action(); return { error: null }; } catch (error) { return { error: error instanceof FormError ? error.message : "Save failed" }; } } },
    "@/lib/supabase/server": {},
    "@/lib/validation": validationModule.exports,
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