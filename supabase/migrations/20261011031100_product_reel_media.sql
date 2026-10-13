alter table public.product_images
	add column media_type text not null default 'image'
		check (media_type in ('image', 'video'));

create unique index product_images_one_video_per_product_idx
	on public.product_images (product_id)
	where media_type = 'video';

update storage.buckets
set file_size_limit = 104857600,
	allowed_mime_types = array[
		'image/jpeg',
		'image/png',
		'image/webp',
		'video/mp4',
		'video/webm'
	]::text[]
where id = 'product-images';
