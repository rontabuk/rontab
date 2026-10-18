update public.categories
set sort_order = -85
where slug = 'restaurants' and parent_id is null;