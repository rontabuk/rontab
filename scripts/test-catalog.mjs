import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

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
  return { catalog: testModule.exports, queries, signedBatches, lifetimes, tags, failProducts(error) { productError = error; } };
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