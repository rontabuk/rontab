begin;

insert into public.categories (slug, name, is_active, sort_order)
values ('men', 'Men', true, -90), ('designer', 'Designer', true, -80), ('kids', 'Kids', true, -70)
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select root.slug || '-' || groups.slug, groups.name, root.id, true, groups.sort_order
from (values
  ('men', 'clothing', 'Clothing', 10),
  ('men', 'shoes', 'Shoes', 20),
  ('men', 'accessories', 'Accessories', 30),
  ('men', 'grooming', 'Grooming', 40),
  ('designer', 'women', 'Designer women', 10),
  ('designer', 'men', 'Designer men', 20),
  ('kids', 'girls-clothing', 'Girls clothing', 10),
  ('kids', 'boys-clothing', 'Boys clothing', 20),
  ('kids', 'toys', 'Toys', 30),
  ('kids', 'pushchairs-carriers-car-seats', 'Pushchairs, carriers & car seats', 40),
  ('kids', 'furniture-decor', 'Furniture & decor', 50),
  ('kids', 'bathing-changing', 'Bathing & changing', 60),
  ('kids', 'childproofing-safety-equipment', 'Childproofing & safety equipment', 70),
  ('kids', 'health-pregnancy', 'Health & pregnancy', 80),
  ('kids', 'nursing-feeding', 'Nursing & feeding', 90),
  ('kids', 'sleep-bedding', 'Sleep & bedding', 100),
  ('kids', 'school-supplies', 'School supplies', 110),
  ('kids', 'other-items', 'Other kids'' items', 120)
) as groups(root_slug, slug, name, sort_order)
join public.categories root on root.slug = groups.root_slug
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select parent.slug || '-' || (item.value->>'slug'), item.value->>'name', parent.id, true, item.ordinality::integer
from (values
  ('men-clothing', '[
    {"slug":"jeans","name":"Jeans"},
    {"slug":"outerwear","name":"Outerwear"},
    {"slug":"tops-t-shirts","name":"Tops & t-shirts"},
    {"slug":"suits-blazers","name":"Suits & blazers"},
    {"slug":"jumpers-sweaters","name":"Jumpers & sweaters"},
    {"slug":"trousers","name":"Trousers"},
    {"slug":"shorts","name":"Shorts"},
    {"slug":"socks-underwear","name":"Socks & underwear"},
    {"slug":"sleepwear","name":"Sleepwear"},
    {"slug":"swimwear","name":"Swimwear"},
    {"slug":"activewear","name":"Activewear"},
    {"slug":"costumes-special-outfits","name":"Costumes & special outfits"},
    {"slug":"other-clothing","name":"Other clothing"}
  ]'::jsonb),
  ('men-shoes', '[
    {"slug":"boat-shoes-loafers-moccasins","name":"Boat shoes, loafers & moccasins"},
    {"slug":"boots","name":"Boots"},
    {"slug":"clogs-mules","name":"Clogs & mules"},
    {"slug":"espadrilles","name":"Espadrilles"},
    {"slug":"flip-flops-slides","name":"Flip-flops & slides"},
    {"slug":"formal-shoes","name":"Formal shoes"},
    {"slug":"sandals","name":"Sandals"},
    {"slug":"slippers","name":"Slippers"},
    {"slug":"sports-shoes","name":"Sports shoes"},
    {"slug":"trainers","name":"Trainers"}
  ]'::jsonb),
  ('men-accessories', '[
    {"slug":"bags-backpacks","name":"Bags & backpacks"},
    {"slug":"bandanas-headscarves","name":"Bandanas & headscarves"},
    {"slug":"belts","name":"Belts"},
    {"slug":"braces","name":"Braces"},
    {"slug":"gloves","name":"Gloves"},
    {"slug":"handkerchiefs","name":"Handkerchiefs"},
    {"slug":"hats-caps","name":"Hats & caps"},
    {"slug":"jewellery","name":"Jewellery"},
    {"slug":"pocket-squares","name":"Pocket squares"},
    {"slug":"scarves-shawls","name":"Scarves & shawls"},
    {"slug":"sunglasses","name":"Sunglasses"},
    {"slug":"ties-bow-ties","name":"Ties & bow ties"},
    {"slug":"watches","name":"Watches"},
    {"slug":"other-accessories","name":"Other accessories"}
  ]'::jsonb),
  ('men-grooming', '[
    {"slug":"facial-care","name":"Facial care"},
    {"slug":"tools-accessories","name":"Tools & accessories"},
    {"slug":"hair-care","name":"Hair care"},
    {"slug":"body-care","name":"Body care"},
    {"slug":"hand-nail-care","name":"Hand & nail care"},
    {"slug":"aftershave-cologne","name":"Aftershave & cologne"},
    {"slug":"make-up","name":"Make-up"},
    {"slug":"grooming-kits","name":"Grooming kits"},
    {"slug":"other-grooming-items","name":"Other grooming items"}
  ]'::jsonb),
  ('designer-women', '[
    {"slug":"bags","name":"Designer bags"},
    {"slug":"shoes","name":"Designer shoes"},
    {"slug":"accessories","name":"Designer accessories"},
    {"slug":"clothing","name":"Designer clothing"}
  ]'::jsonb),
  ('designer-men', '[
    {"slug":"shoes","name":"Designer shoes"},
    {"slug":"accessories","name":"Designer accessories"},
    {"slug":"clothing","name":"Designer clothing"}
  ]'::jsonb),
  ('kids-girls-clothing', '[
    {"slug":"baby-girls-clothing","name":"Baby girls'' clothing"},
    {"slug":"shoes","name":"Shoes"},
    {"slug":"outerwear","name":"Outerwear"},
    {"slug":"jumpers-hoodies","name":"Jumpers & hoodies"},
    {"slug":"tops-t-shirts","name":"Tops & t-shirts"},
    {"slug":"dresses","name":"Dresses"},
    {"slug":"skirts","name":"Skirts"},
    {"slug":"trousers-shorts-dungarees","name":"Trousers, shorts & dungarees"},
    {"slug":"bags-backpacks","name":"Bags & backpacks"},
    {"slug":"accessories","name":"Accessories"},
    {"slug":"swimwear","name":"Swimwear"},
    {"slug":"underwear-socks","name":"Underwear & socks"},
    {"slug":"sleepwear-nightwear","name":"Sleepwear & nightwear"},
    {"slug":"activewear","name":"Activewear"},
    {"slug":"clothing-bundles","name":"Clothing bundles"},
    {"slug":"clothing-for-twins","name":"Clothing for twins"},
    {"slug":"fancy-dress-costumes","name":"Fancy dress & costumes"},
    {"slug":"formalwear-special-occasion-clothing","name":"Formal wear & special occasion clothing"},
    {"slug":"other-girls-clothing","name":"Other girls'' clothing"}
  ]'::jsonb),
  ('kids-boys-clothing', '[
    {"slug":"baby-boys-clothing","name":"Baby boys'' clothing"},
    {"slug":"shoes","name":"Shoes"},
    {"slug":"outerwear","name":"Outerwear"},
    {"slug":"jumpers-hoodies","name":"Jumpers & hoodies"},
    {"slug":"tops-t-shirts","name":"Tops & t-shirts"},
    {"slug":"trousers-shorts-dungarees","name":"Trousers, shorts & dungarees"},
    {"slug":"bags-backpacks","name":"Bags & backpacks"},
    {"slug":"accessories","name":"Accessories"},
    {"slug":"swimwear","name":"Swimwear"},
    {"slug":"underwear-socks","name":"Underwear & socks"},
    {"slug":"sleepwear-nightwear","name":"Sleepwear & nightwear"},
    {"slug":"activewear","name":"Activewear"},
    {"slug":"clothing-bundles","name":"Clothing bundles"},
    {"slug":"clothing-for-twins","name":"Clothing for twins"},
    {"slug":"fancy-dress-costumes","name":"Fancy dress & costumes"},
    {"slug":"formalwear-special-occasion-clothing","name":"Formal wear & special occasion clothing"},
    {"slug":"other-boys-clothing","name":"Other boys'' clothing"}
  ]'::jsonb),
  ('kids-toys', '[
    {"slug":"toy-figures-accessories","name":"Toy figures & accessories"},
    {"slug":"arts-crafts","name":"Arts & crafts"},
    {"slug":"baby-activities-toys","name":"Baby activities & toys"},
    {"slug":"blocks-building-toys","name":"Blocks & building toys"},
    {"slug":"dolls-accessories","name":"Dolls & accessories"},
    {"slug":"dress-up-pretend-play","name":"Dress up & pretend play"},
    {"slug":"educational-toys","name":"Educational toys"},
    {"slug":"electronic-toys","name":"Electronic toys"},
    {"slug":"musical-toys-instruments","name":"Musical toys & toy instruments"},
    {"slug":"novelty-fidget-toys","name":"Novelty & fidget toys"},
    {"slug":"outdoor-sports-toys","name":"Outdoor & sports toys"},
    {"slug":"soft-toys-stuffed-animals","name":"Soft toys & stuffed animals"},
    {"slug":"toy-cars-trains-other-vehicles","name":"Toy cars, trains & other vehicles"}
  ]'::jsonb),
  ('kids-pushchairs-carriers-car-seats', '[
    {"slug":"baby-carriers-wraps","name":"Baby carriers & wraps"},
    {"slug":"buggies-pushchairs","name":"Buggies & pushchairs"},
    {"slug":"buggy-accessories","name":"Buggy accessories"},
    {"slug":"car-seats","name":"Car seats"},
    {"slug":"booster-seats","name":"Booster seats"},
    {"slug":"car-seat-accessories","name":"Car seat accessories"}
  ]'::jsonb),
  ('kids-furniture-decor', '[
    {"slug":"kids-mattresses","name":"Kids'' mattresses"},
    {"slug":"playmats-padded-flooring","name":"Playmats & padded flooring"},
    {"slug":"playpens","name":"Playpens"},
    {"slug":"loungers-nests","name":"Loungers & nests"},
    {"slug":"decor-keepsakes","name":"Decor & keepsakes"},
    {"slug":"nursery-furniture","name":"Nursery furniture"},
    {"slug":"rugs-mats","name":"Rugs & mats"},
    {"slug":"chairs","name":"Chairs"},
    {"slug":"play-furniture","name":"Play furniture"},
    {"slug":"shelves","name":"Shelves"},
    {"slug":"table-desks","name":"Table & desks"},
    {"slug":"wardrobes","name":"Wardrobes"}
  ]'::jsonb),
  ('kids-bathing-changing', '[
    {"slug":"baby-changing-bags","name":"Baby changing bags"},
    {"slug":"bathing","name":"Bathing"},
    {"slug":"changing-mats-covers","name":"Changing mats & covers"},
    {"slug":"nappies","name":"Nappies"},
    {"slug":"nappy-storage-disposal","name":"Nappy storage & disposal"},
    {"slug":"potties","name":"Potties"},
    {"slug":"skincare-hygiene","name":"Skincare & hygiene"},
    {"slug":"step-stools","name":"Step stools"}
  ]'::jsonb),
  ('kids-childproofing-safety-equipment', '[
    {"slug":"baby-gates-guards","name":"Baby gates & guards"},
    {"slug":"childproofing-accessories","name":"Childproofing accessories"},
    {"slug":"hearing-protection","name":"Hearing protection"},
    {"slug":"safety-harnesses-reins","name":"Safety harnesses & reins"}
  ]'::jsonb),
  ('kids-health-pregnancy', '[
    {"slug":"humidifiers","name":"Humidifiers"},
    {"slug":"nasal-aspirators","name":"Nasal aspirators"},
    {"slug":"postpartum-care","name":"Postpartum care"},
    {"slug":"pregnancy-pillows","name":"Pregnancy pillows"},
    {"slug":"pregnancy-support-belts","name":"Pregnancy support belts"},
    {"slug":"scales","name":"Scales"},
    {"slug":"thermometers","name":"Thermometers"}
  ]'::jsonb),
  ('kids-nursing-feeding', '[
    {"slug":"baby-food-blenders-makers","name":"Baby food blenders & makers"},
    {"slug":"bibs","name":"Bibs"},
    {"slug":"bottle-feeding","name":"Bottle feeding"},
    {"slug":"breastfeeding","name":"Breastfeeding"},
    {"slug":"cups-dishes-utensils","name":"Cups, dishes & utensils"},
    {"slug":"feeding-pillows-covers","name":"Feeding pillows & covers"},
    {"slug":"dummies-soothers","name":"Dummies & soothers"},
    {"slug":"dummy-accessories","name":"Dummy accessories"},
    {"slug":"high-chairs","name":"High chairs"},
    {"slug":"high-chair-accessories","name":"High chair accessories"},
    {"slug":"muslins-burp-cloths","name":"Muslins & burp cloths"},
    {"slug":"sterilisers","name":"Sterilisers"}
  ]'::jsonb),
  ('kids-sleep-bedding', '[
    {"slug":"baby-monitors","name":"Baby monitors"},
    {"slug":"bed-rails-guards","name":"Bed rails & guards"},
    {"slug":"bedding-blankets-throws","name":"Bedding, blankets & throws"},
    {"slug":"blackout-shades","name":"Blackout shades"},
    {"slug":"heating-pads-hot-water-bottles","name":"Heating pads & hot water bottles"},
    {"slug":"nightlights-wake-up-lights","name":"Nightlights & wake-up lights"},
    {"slug":"sleep-sacks-wearable-blankets","name":"Sleep sacks & wearable blankets"},
    {"slug":"sleeping-bags","name":"Sleeping bags"},
    {"slug":"swaddles","name":"Swaddles"},
    {"slug":"white-noise-machines","name":"White noise machines"}
  ]'::jsonb),
  ('kids-school-supplies', '[
    {"slug":"lunch-boxes-bags","name":"Lunch boxes & bags"},
    {"slug":"school-bags","name":"School bags"},
    {"slug":"school-supplies","name":"School supplies"}
  ]'::jsonb)
) as presets(parent_slug, children)
join public.categories parent on parent.slug = presets.parent_slug
cross join lateral jsonb_array_elements(presets.children) with ordinality as item(value, ordinality)
on conflict (slug) do nothing;

commit;