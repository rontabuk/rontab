import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const container = "supabase_db_rontab";
const totalCapacity = process.argv.includes("--total-capacity");
const discountLimit = process.argv.includes("--discount-limit");
const freeProduct = process.argv.includes("--free-product");
const freeOffer = process.argv.includes("--free") || freeProduct;
const sameRequest = process.argv.includes("--same-request");
const multiCity = process.argv.includes("--multi-city");
const pointsCost = freeOffer ? 0 : 10;
const reservationKey = randomUUID();
const ids = {
  admin: randomUUID(),
  seller: randomUUID(),
  visitorOne: randomUUID(),
  visitorTwo: randomUUID(),
  request: randomUUID(),
  offer: randomUUID(),
  location: randomUUID(),
  secondLocation: randomUUID(),
  secondOffer: randomUUID(),
  secondRequest: randomUUID(),
  product: randomUUID(),
};
if ((discountLimit || freeProduct) && (sameRequest || multiCity || totalCapacity || (discountLimit && freeProduct))) throw new Error("Run the booking-limit race modes separately.");

function runSql(sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(sql);
  });
}

function escapeSql(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function fail(message) {
  throw new Error(message);
}

const cityResult = await runSql(`
select city_id from public.supported_cities city
join public.supported_countries country using (country_code)
where city.country_code = 'GB' and city.is_enabled and country.is_enabled
order by city.city_name limit 1;
`);
if (cityResult.code !== 0) fail(cityResult.stderr || "Could not read local supported cities.");
const cityId = cityResult.stdout.trim().split(/\r?\n/).at(-1);
if (!cityId || !/^GB-[A-Za-z0-9_-]+$/.test(cityId)) fail("No enabled UK city is available in local Supabase.");

const londonToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const [year, month, day] = londonToday.split("-").map(Number);
const offerDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
const secondDate = new Date(Date.UTC(year, month - 1, day + 2)).toISOString().slice(0, 10);
const weekday = new Date(`${offerDate}T00:00:00Z`).getUTCDay();
let fixtureCreated = false;

const cleanupSql = `
begin;
delete from public.seller_offer_point_transactions where coupon_id in (select id from public.seller_offer_coupons where offer_id in (${escapeSql(ids.offer)}::uuid, ${escapeSql(ids.secondOffer)}::uuid));
delete from public.seller_offer_coupons where offer_id in (${escapeSql(ids.offer)}::uuid, ${escapeSql(ids.secondOffer)}::uuid);
delete from public.seller_offer_daily_quotas where location_id in (${escapeSql(ids.location)}::uuid, ${escapeSql(ids.secondLocation)}::uuid);
delete from public.seller_offer_schedules where location_id in (${escapeSql(ids.location)}::uuid, ${escapeSql(ids.secondLocation)}::uuid);
delete from public.seller_offer_locations where id in (${escapeSql(ids.location)}::uuid, ${escapeSql(ids.secondLocation)}::uuid);
delete from public.seller_offers where id in (${escapeSql(ids.offer)}::uuid, ${escapeSql(ids.secondOffer)}::uuid);
delete from public.seller_offer_requests where id in (${escapeSql(ids.request)}::uuid, ${escapeSql(ids.secondRequest)}::uuid);
delete from public.products where id = ${escapeSql(ids.product)}::uuid;
delete from auth.users where id in (${escapeSql(ids.admin)}::uuid, ${escapeSql(ids.seller)}::uuid, ${escapeSql(ids.visitorOne)}::uuid, ${escapeSql(ids.visitorTwo)}::uuid);
commit;
`;

try {
  const setupSql = `
begin;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  (${escapeSql(ids.admin)}::uuid, 'authenticated', 'authenticated', ${escapeSql(`${ids.admin}@offer-race.invalid`)}, '', now(), '{"role":"admin"}', '{}', now(), now()),
  (${escapeSql(ids.seller)}::uuid, 'authenticated', 'authenticated', ${escapeSql(`${ids.seller}@offer-race.invalid`)}, '', now(), '{}', ${escapeSql(JSON.stringify({ account_type: "seller", shop_name: "Race test seller", shop_slug: `race-${ids.seller}` }))}::jsonb, now(), now()),
  (${escapeSql(ids.visitorOne)}::uuid, 'authenticated', 'authenticated', ${escapeSql(`${ids.visitorOne}@offer-race.invalid`)}, '', now(), '{}', '{"account_type":"visitor"}', now(), now()),
  (${escapeSql(ids.visitorTwo)}::uuid, 'authenticated', 'authenticated', ${escapeSql(`${ids.visitorTwo}@offer-race.invalid`)}, '', now(), '{}', '{"account_type":"visitor"}', now(), now());

select set_config('request.jwt.claim.sub', ${escapeSql(ids.admin)}, false);
select set_config('request.jwt.claims', jsonb_build_object('sub', ${escapeSql(ids.admin)}, 'role', 'authenticated', 'app_metadata', '{"role":"admin"}'::jsonb)::text, false);
update public.seller_profiles set status = 'active', is_public = true where user_id = ${escapeSql(ids.seller)}::uuid;
update public.profiles set city_id = ${escapeSql(cityId)}, email_verified_at = now() where id in (${escapeSql(ids.visitorOne)}::uuid, ${escapeSql(ids.visitorTwo)}::uuid);
${multiCity ? `update public.profiles set city_id = (select city.city_id from public.supported_cities city join public.supported_countries country using(country_code)
where city.country_code = 'GB' and city.is_enabled and country.is_enabled and city.city_id <> ${escapeSql(cityId)} order by city.city_name limit 1)
where id = ${escapeSql(ids.visitorTwo)}::uuid;` : ""}
update public.loyalty_accounts set points_balance = 50 where visitor_id in (${escapeSql(ids.visitorOne)}::uuid, ${escapeSql(ids.visitorTwo)}::uuid);
${freeProduct ? `insert into public.products(id,seller_profile_id,category_id,name,slug,description,external_url,status)
select ${escapeSql(ids.product)}::uuid, seller.id, (select id from public.categories limit 1), 'Race product', ${escapeSql(`race-${ids.product}`)}, 'Free-product cooldown race fixture.', 'https://example.invalid/product', 'approved'
from public.seller_profiles seller where seller.user_id = ${escapeSql(ids.seller)}::uuid;` : ""}

insert into public.seller_offer_requests (
  id, seller_profile_id, status, offer_kind, title, description, benefit_details,
  media_url, media_type, valid_from, valid_until, capacity_acknowledged,
  seller_terms_accepted_at, reviewed_by, reviewed_at
)
select ${escapeSql(ids.request)}::uuid, seller.id, 'approved', '${freeProduct ? "free_item" : "discount"}', 'Race test offer',
  'Temporary offer fixture for concurrent reservation testing.', 'One local voucher.',
  'https://example.invalid/race.jpg', 'image', ${escapeSql(offerDate)}::date, ${escapeSql(offerDate)}::date,
  true, now(), ${escapeSql(ids.admin)}::uuid, now()
from public.seller_profiles seller where seller.user_id = ${escapeSql(ids.seller)}::uuid;

insert into public.seller_offers (
  id, request_id, seller_profile_id, status, offer_kind, title, description, benefit_details,
  media_url, media_type, points_cost, terms, valid_from, valid_until, approved_by, published_at
  ${totalCapacity ? ", max_claims" : ""}
  ${multiCity ? ", daily_claim_limit" : ""}
  ${freeProduct ? ", product_id" : ""}
)
select ${escapeSql(ids.offer)}::uuid, ${escapeSql(ids.request)}::uuid, seller.id, 'published', '${freeProduct ? "free_item" : "discount"}',
  'Race test offer', 'Temporary offer fixture for concurrent reservation testing.', 'One local voucher.',
  'https://example.invalid/race.jpg', 'image', ${pointsCost}, 'Test-only voucher terms with early cancellation.',
  ${escapeSql(offerDate)}::date, ${escapeSql(totalCapacity ? secondDate : offerDate)}::date, ${escapeSql(ids.admin)}::uuid, now()
  ${totalCapacity ? ", 1" : ""}
  ${multiCity ? ", 1" : ""}
  ${freeProduct ? `, ${escapeSql(ids.product)}::uuid` : ""}
from public.seller_profiles seller where seller.user_id = ${escapeSql(ids.seller)}::uuid;

insert into public.seller_offer_locations (id, offer_id, city_id, branch_name)
values (${escapeSql(ids.location)}::uuid, ${escapeSql(ids.offer)}::uuid, ${escapeSql(cityId)}, 'Race test branch');
insert into public.seller_offer_schedules (location_id, weekday, starts_at, ends_at, daily_capacity)
values (${escapeSql(ids.location)}::uuid, ${weekday}, '10:00', '12:00', ${discountLimit ? 10 : 1});
insert into public.seller_offer_daily_quotas (location_id, offer_date, starts_at, ends_at, capacity)
values (${escapeSql(ids.location)}::uuid, ${escapeSql(offerDate)}::date, '10:00', '12:00', ${discountLimit ? 10 : 1});
${freeProduct ? `insert into public.seller_offer_requests select (jsonb_populate_record(null::public.seller_offer_requests, to_jsonb(request) || jsonb_build_object('id', ${escapeSql(ids.secondRequest)}))).*
from public.seller_offer_requests request where request.id = ${escapeSql(ids.request)}::uuid;
insert into public.seller_offers select (jsonb_populate_record(null::public.seller_offers, to_jsonb(offer) || jsonb_build_object('id', ${escapeSql(ids.secondOffer)}, 'request_id', ${escapeSql(ids.secondRequest)}))).*
from public.seller_offers offer where offer.id = ${escapeSql(ids.offer)}::uuid;
insert into public.seller_offer_locations(id,offer_id,city_id,branch_name) values(${escapeSql(ids.secondLocation)}::uuid, ${escapeSql(ids.secondOffer)}::uuid, ${escapeSql(cityId)}, 'Republished product branch');
insert into public.seller_offer_daily_quotas(location_id,offer_date,starts_at,ends_at,capacity) values(${escapeSql(ids.secondLocation)}::uuid, ${escapeSql(offerDate)}::date, '10:00', '12:00', 1);` : ""}
${multiCity ? `insert into public.seller_offer_locations(id, offer_id, city_id, branch_name)
select ${escapeSql(ids.secondLocation)}::uuid, ${escapeSql(ids.offer)}::uuid, city_id, 'Shared redemption branch'
from public.profiles where id = ${escapeSql(ids.visitorTwo)}::uuid;
insert into public.seller_offer_daily_quotas(location_id, offer_date, starts_at, ends_at, capacity)
values(${escapeSql(ids.secondLocation)}::uuid, ${escapeSql(offerDate)}::date, '10:00', '12:00', 1);` : ""}
${totalCapacity ? `insert into public.seller_offer_daily_quotas (location_id, offer_date, starts_at, ends_at, capacity)
values (${escapeSql(ids.location)}::uuid, ${escapeSql(secondDate)}::date, '10:00', '12:00', 1);` : ""}
commit;
`;

  const setup = await runSql(setupSql);
  if (setup.code !== 0) fail(`Could not set up concurrency fixture: ${setup.stderr}`);
  fixtureCreated = true;

  const reserve = (visitorId, targetDate = offerDate, locationId = ids.location, offerId = ids.offer) => runSql(`
begin;
set request.jwt.claim.sub = ${escapeSql(visitorId)};
set request.jwt.claims = ${escapeSql(JSON.stringify({ sub: visitorId, role: "authenticated", app_metadata: {} }))};
select public.reserve_seller_offer_coupon(
  ${escapeSql(offerId)}::uuid,
  ${escapeSql(locationId)}::uuid,
  ${escapeSql(targetDate)}::date,
  '10:00'::time,
  ${sameRequest ? `${escapeSql(reservationKey)}::uuid` : "gen_random_uuid()"}
);
commit;
`);

  if (discountLimit) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const seed = await reserve(ids.visitorOne);
      if (seed.code !== 0) fail(`Could not seed two discount reservations: ${seed.stderr}`);
    }
  }
  const results = await Promise.all([reserve(ids.visitorOne), reserve(sameRequest || discountLimit || freeProduct ? ids.visitorOne : ids.visitorTwo,
    totalCapacity ? secondDate : offerDate, (multiCity && !sameRequest) || freeProduct ? ids.secondLocation : ids.location, freeProduct ? ids.secondOffer : ids.offer)]);
  const successes = results.filter((result) => result.code === 0);
  const quotaRejections = results.filter((result) => result.code !== 0 && result.stderr.toLowerCase().includes(discountLimit ? "3-reservation limit" : freeProduct ? "every 7 days" : totalCapacity ? "total capacity" : "daily offer quota is full"));
  if (successes.length !== (sameRequest ? 2 : 1) || quotaRejections.length !== (sameRequest ? 0 : 1)) {
    fail(`Expected one reservation success and one full-quota rejection. Results: ${JSON.stringify(results)}`);
  }

  const verifySql = `
do $$
begin
  if (select sum(reserved_count) from public.seller_offer_daily_quotas where location_id in (${escapeSql(ids.location)}::uuid, ${escapeSql(ids.secondLocation)}::uuid)) <> ${discountLimit ? 3 : 1}
    or (select count(*) from public.seller_offer_coupons where offer_id in (${escapeSql(ids.offer)}::uuid, ${escapeSql(ids.secondOffer)}::uuid) and status = 'reserved') <> ${discountLimit ? 3 : 1}
    or (select sum(points_balance) from public.loyalty_accounts where visitor_id in (${escapeSql(ids.visitorOne)}::uuid, ${escapeSql(ids.visitorTwo)}::uuid)) <> ${100 - pointsCost * (discountLimit ? 3 : 1)}
    or (select count(*) from public.seller_offer_point_transactions transaction join public.seller_offer_coupons coupon on coupon.id = transaction.coupon_id
      where coupon.offer_id in (${escapeSql(ids.offer)}::uuid, ${escapeSql(ids.secondOffer)}::uuid) and transaction.transaction_type = 'spent') <> ${freeOffer ? 0 : discountLimit ? 3 : 1} then
    raise exception 'Concurrent reservations oversold the quota or charged points more than once.';
  end if;
end;
$$;
`;
  const verification = await runSql(verifySql);
  if (verification.code !== 0) fail(`Concurrency invariant failed: ${verification.stderr}`);
  console.log(`PASS: ${discountLimit ? "only the third concurrent discount reservation succeeded" : freeProduct ? "the same visitor could not race two offers for the same free product" : sameRequest ? "duplicate concurrent requests returned one voucher" : totalCapacity ? "total offer capacity held across different dates" : multiCity ? "shared daily capacity held across two different cities" : "one of two simultaneous visitors reserved the final daily place"}; ${freeOffer ? "no points ledger entries" : "each successful voucher charged exactly once"}.`);
} finally {
  if (fixtureCreated) {
    const cleanup = await runSql(cleanupSql);
    if (cleanup.code !== 0) {
      console.error(`WARNING: concurrency fixture cleanup failed: ${cleanup.stderr}`);
      process.exitCode = 1;
    }
  }
}