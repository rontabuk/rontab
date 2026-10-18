begin;

insert into public.categories (slug, name, is_active, sort_order)
values ('books-media', 'Books & Media', true, -40),
       ('hobbies-collectables', 'Hobbies & collectables', true, -30),
       ('sports', 'Sports', true, -20)
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select root.slug || '-' || groups.slug, groups.name, root.id, true, groups.sort_order
from (values
  ('books-media', 'books', 'Books', 10),
  ('books-media', 'magazines', 'Magazines', 20),
  ('books-media', 'music', 'Music', 30),
  ('books-media', 'video', 'Video', 40),
  ('hobbies-collectables', 'trading-cards', 'Trading cards', 10),
  ('hobbies-collectables', 'board-games', 'Board games', 20),
  ('hobbies-collectables', 'puzzles', 'Puzzles', 30),
  ('hobbies-collectables', 'tabletop-miniature-gaming', 'Tabletop & miniature gaming', 40),
  ('hobbies-collectables', 'memorabilia', 'Memorabilia', 50),
  ('hobbies-collectables', 'coins-banknotes', 'Coins & banknotes', 60),
  ('hobbies-collectables', 'stamps', 'Stamps', 70),
  ('hobbies-collectables', 'postcards', 'Postcards', 80),
  ('hobbies-collectables', 'musical-instruments-gear', 'Musical instruments & gear', 90),
  ('hobbies-collectables', 'arts-crafts', 'Arts & crafts', 100),
  ('hobbies-collectables', 'collectables-storage', 'Collectables storage', 110),
  ('hobbies-collectables', 'gaming-accessories', 'Gaming accessories', 120),
  ('sports', 'cycling', 'Cycling', 10),
  ('sports', 'fitness-running-yoga', 'Fitness, running & yoga', 20),
  ('sports', 'outdoor-sports', 'Outdoor sports', 30),
  ('sports', 'water-sports', 'Water sports', 40),
  ('sports', 'team-sports', 'Team sports', 50),
  ('sports', 'racket-sports', 'Racket sports', 60),
  ('sports', 'golf', 'Golf', 70),
  ('sports', 'equestrian', 'Equestrian', 80),
  ('sports', 'skateboards-scooters', 'Skateboards & scooters', 90),
  ('sports', 'boxing-martial-arts', 'Boxing & martial arts', 100),
  ('sports', 'casual-sports-games', 'Casual sports & games', 110),
  ('sports', 'winter-sports', 'Winter sports', 120)
) as groups(root_slug, slug, name, sort_order)
join public.categories root on root.slug = groups.root_slug
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select parent.slug || '-' || trim(both '-' from regexp_replace(lower(replace(item.value, '''', '')), '[^a-z0-9]+', '-', 'g')),
       item.value, parent.id, true, item.ordinality::integer
from (values
  ('books-media-books', '[
    "Fiction", "Non-fiction", "Kids & young adults", "Comics, manga & graphic novels", "Textbooks & study materials", "Colouring, puzzle & activity books"
  ]'::jsonb),
  ('books-media-music', '["Audio cassettes", "CDs", "MiniDiscs", "Vinyl records"]'::jsonb),
  ('books-media-video', '["4K Blu-ray", "Betamax", "Blu-ray", "DVD", "HD DVD", "LaserDisc", "VHS"]'::jsonb),
  ('hobbies-collectables-trading-cards', '[
    "Single trading cards", "Booster packs", "Booster boxes", "Card decks", "Trading card lots", "Uncut card sheets"
  ]'::jsonb),
  ('hobbies-collectables-memorabilia', '["Sports memorabilia", "Music memorabilia", "Film & TV memorabilia", "Other memorabilia"]'::jsonb),
  ('hobbies-collectables-coins-banknotes', '["Banknotes", "Coins", "Lots & sets", "Medals & tokens", "Share certificates"]'::jsonb),
  ('hobbies-collectables-stamps', '["Individual stamps", "Stamp lots & sets", "First day covers", "Stamp catalogues & guides", "Stamp tools & equipment"]'::jsonb),
  ('hobbies-collectables-musical-instruments-gear', '[
    "Guitars & bass guitars", "Amps & pedals", "Drums & percussion", "Keyboards & synths", "String instruments", "Wind instruments",
    "Studio & live sound gear", "DJ gear", "Karaoke gear", "Music-making accessories"
  ]'::jsonb),
  ('hobbies-collectables-arts-crafts', '[
    "Sewing, knitting & needlecraft", "Painting", "Drawing & sketching", "Calligraphy", "Jewellery-making", "Papercraft", "Die cutting",
    "Candle making", "Sculpting & pottery", "Crafting supplies", "Crafting tools"
  ]'::jsonb),
  ('hobbies-collectables-collectables-storage', '[
    "Albums & binders", "Collectables storage boxes", "Card sleeves", "Card screwdowns", "Deck boxes", "Album & binder dividers",
    "Album & binder refills", "Puzzle mats", "Other collectables storage"
  ]'::jsonb),
  ('hobbies-collectables-gaming-accessories', '["Dice", "Gaming stones & tokens", "Gaming playmats", "Other gaming accessories"]'::jsonb),
  ('sports-cycling', '[
    "Bikes", "Kids'' bikes", "Bike helmets", "Cycling accessories & tools", "Indoor cycling trainers", "Bike trailers", "Kids'' bike seats", "Bike parts"
  ]'::jsonb),
  ('sports-fitness-running-yoga', '[
    "Exercise machines", "Strength training", "Running", "Yoga & pilates equipment", "Home fitness accessories", "Water bottles"
  ]'::jsonb),
  ('sports-outdoor-sports', '[
    "Climbing & bouldering", "Camping tents & sleeping gear", "Camping stoves & cookware", "Binoculars & scopes", "Coolers",
    "Hydration systems & packs", "Camping furniture", "Torches, headlamps & lanterns", "Trekking poles", "Compasses", "Hiking backpacks",
    "Fishing & hunting", "Other outdoor sports accessories"
  ]'::jsonb),
  ('sports-water-sports', '[
    "Inflatable rafts", "Swimming", "Kayaks", "Kitesurf boards", "Skimboards", "Stand-up paddle boards", "Surfboards", "Towable tubes",
    "Wakeboards", "Water skis", "Personal flotation devices", "Water sport helmets", "Wetsuits, gloves & booties", "Water sports accessories"
  ]'::jsonb),
  ('sports-team-sports', '[
    "Football", "Basketball", "Volleyball", "Rugby", "Practice & referee equipment", "American football", "Baseball & softball", "Handball",
    "Cricket", "Field hockey", "Floorball", "Gaelic sports", "Lacrosse", "Netball", "Australian rules", "Other team sports equipment"
  ]'::jsonb),
  ('sports-racket-sports', '["Tennis", "Squash", "Badminton", "Racketball", "Table tennis", "Padel", "Pickleball", "Racket sport eye protection"]'::jsonb),
  ('sports-golf', '["Golf accessories", "Golf bags", "Golf balls", "Golf clubs", "Golf gloves", "Golf trolleys", "Golf training equipment"]'::jsonb),
  ('sports-equestrian', '["Body protectors", "Riding gloves", "Riding hats", "Riding hat silks", "Saddles & tack"]'::jsonb),
  ('sports-skateboards-scooters', '["Longboards", "Skateboards", "Scooters", "Skate helmets", "Skate pads", "Skate parts & accessories", "Skateboard parts & accessories"]'::jsonb),
  ('sports-boxing-martial-arts', '[
    "Boxing & martial arts head protection", "Boxing & martial arts body protection", "Punching & kicking pads", "Boxing & martial arts gloves",
    "Hand wraps", "Martial arts belts", "Heavy punching bags", "Punching bag stands", "Speed punching bags", "Other martial arts equipment"
  ]'::jsonb),
  ('sports-casual-sports-games', '[
    "Boules & other games", "Darts equipment", "Flying discs & disc golf", "Outdoor trampolines", "Playground balls", "Pool & snooker",
    "Roundnet & spikeball", "Table football", "Tenpin bowling"
  ]'::jsonb),
  ('sports-winter-sports', '[
    "Ski equipment", "Snowboard equipment", "Ice hockey", "Figure skating accessories", "Sledging", "Snowshoes", "Gaiters", "Ski goggles", "Winter sports helmets"
  ]'::jsonb)
) as presets(parent_slug, children)
join public.categories parent on parent.slug = presets.parent_slug
cross join lateral jsonb_array_elements_text(presets.children) with ordinality as item(value, ordinality)
on conflict (slug) do nothing;

commit;