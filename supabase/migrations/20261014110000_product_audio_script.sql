alter table public.products
	add column audio_script text not null default '',
	add constraint products_description_max_length_check
		check (char_length(description) <= 1000),
	add constraint products_audio_script_max_length_check
		check (char_length(audio_script) <= 300);