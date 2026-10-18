begin;

insert into public.categories (slug, name, is_active, sort_order)
values ('home', 'Home', true, -60), ('electronics', 'Electronics', true, -50)
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select root.slug || '-' || groups.slug, groups.name, root.id, true, groups.sort_order
from (values
  ('home', 'small-kitchen-appliances', 'Small kitchen appliances', 10),
  ('home', 'large-appliances', 'Large appliances', 20),
  ('home', 'cookware-bakeware', 'Cookware & bakeware', 30),
  ('home', 'kitchen-tools', 'Kitchen tools', 40),
  ('home', 'tableware', 'Tableware', 50),
  ('home', 'household-care', 'Household care', 60),
  ('home', 'textiles', 'Textiles', 70),
  ('home', 'accessories', 'Home accessories', 80),
  ('home', 'office-supplies', 'Office supplies', 90),
  ('home', 'celebrations-holidays', 'Celebrations & holidays', 100),
  ('home', 'tools-diy', 'Tools & DIY', 110),
  ('home', 'outdoor-garden', 'Outdoor & garden', 120),
  ('home', 'furniture', 'Furniture', 130),
  ('home', 'pet-care', 'Pet care', 140),
  ('electronics', 'video-games-consoles', 'Video games & consoles', 10),
  ('electronics', 'computers-accessories', 'Computers & accessories', 20),
  ('electronics', 'mobile-phones-communication', 'Mobile phones & communication', 30),
  ('electronics', 'audio-headphones-hi-fi', 'Audio, headphones & hi-fi', 40),
  ('electronics', 'cameras-accessories', 'Cameras & accessories', 50),
  ('electronics', 'tablets-e-readers-accessories', 'Tablets, e-readers & accessories', 60),
  ('electronics', 'tv-home-cinema', 'TV & home cinema', 70),
  ('electronics', 'beauty-personal-care', 'Beauty & personal care electronics', 80),
  ('electronics', 'wearables', 'Wearables', 90),
  ('electronics', 'other-devices-accessories', 'Other devices & accessories', 100)
) as groups(root_slug, slug, name, sort_order)
join public.categories root on root.slug = groups.root_slug
on conflict (slug) do nothing;

insert into public.categories (slug, name, parent_id, is_active, sort_order)
select parent.slug || '-' || trim(both '-' from regexp_replace(lower(replace(item.value, '''', '')), '[^a-z0-9]+', '-', 'g')),
       item.value, parent.id, true, item.ordinality::integer
from (values
  ('home-small-kitchen-appliances', '[
    "Kettles", "Coffee, tea & espresso making", "Toasters", "Blenders, mixers & food processors",
    "Microwaves", "Fryers", "Electric grills & griddles", "Hotplates", "Juicers", "Water & drink dispensers",
    "Speciality appliances", "Small kitchen appliance accessories", "Small kitchen appliance parts"
  ]'::jsonb),
  ('home-large-appliances', '[
    "Washing machines", "Tumble dryers", "Dishwashers", "Ovens & cookers", "Cooker hobs", "Fridges", "Freezers",
    "Fridge freezers", "Speciality large appliances", "Large appliance parts & accessories"
  ]'::jsonb),
  ('home-cookware-bakeware', '[
    "Pots", "Pans", "Baking trays", "Oven & roasting dishes", "Baking moulds", "Speciality cookware & bakeware",
    "Cookware & bakeware sets", "Cookware & bakeware accessories"
  ]'::jsonb),
  ('home-kitchen-tools', '[
    "Chopping boards", "Cooking utensils", "Kitchen scales", "Measuring cups & spoons", "Food thermometers",
    "Mixing bowls", "Colanders, sieves & strainers", "Food storage", "Bar tools", "Speciality kitchen tools"
  ]'::jsonb),
  ('home-tableware', '["Dinnerware", "Drinkware", "Serveware"]'::jsonb),
  ('home-household-care', '["Heating, cooling & air", "Irons & garment care", "Vacuums & cleaning"]'::jsonb),
  ('home-textiles', '[
    "Bedding", "Blankets", "Curtains & blinds", "Cushions", "Slipcovers", "Rugs & mats", "Table linen", "Tapestries", "Towels"
  ]'::jsonb),
  ('home-accessories', '[
    "Candles & home fragrance", "Clocks", "Sculptures & figurines", "Decorative accessories", "Artificial plants & flowers",
    "Fireplace accessories", "Lighting", "Display shelves", "Picture & photo frames", "Mirrors", "Storage & organisation", "Vases", "Wall decor"
  ]'::jsonb),
  ('home-office-supplies', '[
    "Planners & personal organisers", "Notebooks & writing pads", "Pencil cases", "Bookmarks", "Calculators", "Desk accessories",
    "Document organisers", "Writing supplies", "Technical drawing tools", "Tape, clips & fasteners", "Staplers & hole punches",
    "Presentation supplies", "Office electronics", "Safes"
  ]'::jsonb),
  ('home-celebrations-holidays', '[
    "Banners, flags & bunting", "Cards & envelopes", "Gift wrap & bags", "Holiday decor", "Party decorations", "Table decorations", "Tree decorations", "Wreaths"
  ]'::jsonb),
  ('home-tools-diy', '[
    "Power tools", "Hand tools", "Measuring tools", "Painting tools & accessories", "Plumbing tools", "Electrician''s tools",
    "Masonry tools", "Tool accessories", "Protective gear", "Tool carrying & storage", "Workshop & worksite equipment", "Hardware", "Smart home & security"
  ]'::jsonb),
  ('home-outdoor-garden', '[
    "Outdoor power tools", "Outdoor power tool accessories", "Outdoor hand tools", "Pots, plants & accessories", "Watering equipment",
    "Outdoor & garden decor", "Outdoor cooking & grilling", "Spas, pools & equipment", "Weather instruments", "Snow removal tools"
  ]'::jsonb),
  ('home-furniture', '[
    "Beds", "Chests of drawers & wardrobes", "Outdoor furniture", "Screens & room dividers", "Seating", "Storage furniture", "Tables & desks", "Trolleys & carts"
  ]'::jsonb),
  ('home-pet-care', '["Dogs", "Cats", "Small pets", "Fish", "Birds", "Reptiles"]'::jsonb),
  ('electronics-video-games-consoles', '[
    "Consoles", "Games", "Controllers", "Gaming headsets", "Simulators", "Virtual reality", "Accessories"
  ]'::jsonb),
  ('electronics-computers-accessories', '[
    "Laptops", "Desktop computers", "Computer parts & components", "Blank media", "Computer accessories", "Laptop accessories",
    "Docking stations & USB hubs", "Keyboards & accessories", "Mice", "Mouse pads", "Monitors & accessories", "Computer speakers",
    "Computer microphones", "Webcams", "Networking devices", "Printers & accessories", "Scanners & accessories", "Touch & stylus pads"
  ]'::jsonb),
  ('electronics-mobile-phones-communication', '[
    "Mobile phones", "Mobile phone parts & accessories", "Landline phones", "Fax machines", "Radio communication", "Dummy mobile phones"
  ]'::jsonb),
  ('electronics-audio-headphones-hi-fi', '[
    "Headphones & earbuds", "Handheld music players", "Portable radios", "Portable speakers", "Smart speakers", "Home audio systems",
    "Audio device accessories", "Home audio & hi-fi parts"
  ]'::jsonb),
  ('electronics-cameras-accessories', '[
    "Cameras", "Lenses", "Memory cards", "Tripods & monopods", "Stabilisers & mounts", "Darkroom equipment", "Studio equipment",
    "Camera drones & accessories", "Accessories", "Camera replacement parts", "Other photography equipment"
  ]'::jsonb),
  ('electronics-tablets-e-readers-accessories', '["Tablets", "e-Readers", "Digital notepads", "PDAs", "Accessories"]'::jsonb),
  ('electronics-tv-home-cinema', '[
    "Televisions", "Streaming devices", "Television antennas", "Satellite dishes", "Video decoders", "Television receivers",
    "Home cinema systems", "Blu-ray players", "DVD players", "VCRs", "Other video playback devices", "TV & home cinema accessories"
  ]'::jsonb),
  ('electronics-beauty-personal-care', '[
    "Hairstyling tools", "Beauty tools", "Shaving & hair removal", "Massage tools", "Electric dental & oral care", "Nail care tools", "Personal scales"
  ]'::jsonb),
  ('electronics-wearables', '["Smartwatches", "Fitness trackers", "Smart glasses", "Smart rings", "Replacement bands", "Smartwatch cases"]'::jsonb),
  ('electronics-other-devices-accessories', '[
    "3D printing & scanning", "GPS & satellite navigation devices", "Item finders", "Luggage scales", "Adaptors", "Cables", "Chargers",
    "Power banks", "Surge protectors & power strips", "Batteries & power supplies", "Other accessories"
  ]'::jsonb)
) as presets(parent_slug, children)
join public.categories parent on parent.slug = presets.parent_slug
cross join lateral jsonb_array_elements_text(presets.children) with ordinality as item(value, ordinality)
on conflict (slug) do nothing;

commit;