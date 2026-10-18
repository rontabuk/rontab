begin;

insert into public.categories (slug, name, is_active, sort_order)
values ('restaurants', 'Restaurants', true, -10), ('grocery', 'Grocery', true, -5)
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select root.slug || '-' || groups.slug, groups.name, root.id, true, groups.sort_order
from (values
  ('restaurants', 'pizza', 'Pizza', 10),
  ('restaurants', 'burgers', 'Burgers', 20),
  ('restaurants', 'fried-chicken', 'Fried chicken', 30),
  ('restaurants', 'shawarma-kebabs', 'Shawarma & kebabs', 40),
  ('restaurants', 'arabic-middle-eastern', 'Arabic & Middle Eastern', 50),
  ('restaurants', 'turkish', 'Turkish', 60),
  ('restaurants', 'indian', 'Indian', 70),
  ('restaurants', 'chinese', 'Chinese', 80),
  ('restaurants', 'japanese-sushi', 'Japanese & sushi', 90),
  ('restaurants', 'italian', 'Italian', 100),
  ('restaurants', 'greek', 'Greek', 110),
  ('restaurants', 'mexican', 'Mexican', 120),
  ('restaurants', 'seafood', 'Seafood', 130),
  ('restaurants', 'vegetarian-vegan', 'Vegetarian & vegan', 140),
  ('restaurants', 'healthy-food-salads', 'Healthy food & salads', 150),
  ('restaurants', 'breakfast-brunch', 'Breakfast & brunch', 160),
  ('restaurants', 'sandwiches-wraps', 'Sandwiches & wraps', 170),
  ('restaurants', 'bakeries-pastries', 'Bakeries & pastries', 180),
  ('restaurants', 'desserts-ice-cream', 'Desserts & ice cream', 190),
  ('restaurants', 'cafes-drinks', 'Cafes & drinks', 200),
  ('grocery', 'fruit-vegetables', 'Fruit & vegetables', 10),
  ('grocery', 'meat-poultry', 'Meat & poultry', 20),
  ('grocery', 'fish-seafood', 'Fish & seafood', 30),
  ('grocery', 'dairy-eggs', 'Dairy & eggs', 40),
  ('grocery', 'bread-bakery', 'Bread & bakery', 50),
  ('grocery', 'rice-pasta-grains', 'Rice, pasta & grains', 60),
  ('grocery', 'pulses-beans', 'Pulses & beans', 70),
  ('grocery', 'canned-jarred-food', 'Canned & jarred food', 80),
  ('grocery', 'frozen-food', 'Frozen food', 90),
  ('grocery', 'ready-meals', 'Ready meals', 100),
  ('grocery', 'oils-cooking-essentials', 'Oils & cooking essentials', 110),
  ('grocery', 'herbs-spices-seasonings', 'Herbs, spices & seasonings', 120),
  ('grocery', 'sauces-condiments', 'Sauces & condiments', 130),
  ('grocery', 'breakfast-cereals-spreads', 'Breakfast cereals & spreads', 140),
  ('grocery', 'snacks-crisps', 'Snacks & crisps', 150),
  ('grocery', 'sweets-chocolate', 'Sweets & chocolate', 160),
  ('grocery', 'nuts-dried-fruit', 'Nuts & dried fruit', 170),
  ('grocery', 'water-juices-soft-drinks', 'Water, juices & soft drinks', 180),
  ('grocery', 'tea-coffee', 'Tea & coffee', 190),
  ('grocery', 'baby-food-essentials', 'Baby food & essentials', 200),
  ('grocery', 'cleaning-laundry', 'Cleaning & laundry', 210),
  ('grocery', 'paper-household-essentials', 'Paper & household essentials', 220)
) as groups(root_slug, slug, name, sort_order)
join public.categories root on root.slug = groups.root_slug
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select parent.slug || '-' || trim(both '-' from regexp_replace(lower(replace(item.value, '''', '')), '[^a-z0-9]+', '-', 'g')),
       item.value, parent.id, true, item.ordinality::integer
from (values
  ('grocery-fruit-vegetables', '["Fruit", "Vegetables", "Fresh herbs"]'::jsonb),
  ('grocery-meat-poultry', '["Beef", "Lamb", "Chicken"]'::jsonb),
  ('grocery-fish-seafood', '["Fresh fish", "Shellfish", "Smoked & preserved fish"]'::jsonb),
  ('grocery-dairy-eggs', '["Milk", "Cheese", "Yogurt", "Butter & cream", "Eggs"]'::jsonb),
  ('grocery-bread-bakery', '["Bread", "Rolls & wraps", "Pastries", "Cakes"]'::jsonb),
  ('grocery-rice-pasta-grains', '["Rice", "Pasta", "Grains & couscous"]'::jsonb),
  ('grocery-frozen-food', '["Frozen vegetables", "Frozen fruit", "Frozen meat & poultry", "Frozen fish & seafood", "Frozen ready meals"]'::jsonb),
  ('grocery-oils-cooking-essentials', '["Cooking oils", "Flour & baking ingredients", "Sugar & sweeteners"]'::jsonb),
  ('grocery-water-juices-soft-drinks', '["Water", "Juices", "Soft drinks"]'::jsonb),
  ('grocery-baby-food-essentials', '["Baby food", "Nappies & wipes"]'::jsonb),
  ('grocery-cleaning-laundry', '["Laundry", "Dishwashing", "Household cleaning"]'::jsonb),
  ('grocery-paper-household-essentials', '["Toilet rolls", "Tissues & kitchen rolls", "Food bags & foil"]'::jsonb)
) as presets(parent_slug, children)
join public.categories parent on parent.slug = presets.parent_slug
cross join lateral jsonb_array_elements_text(presets.children) with ordinality as item(value, ordinality)
on conflict (slug) do nothing;

commit;