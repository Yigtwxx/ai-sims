-- Characters table, RLS policies and the private `thumbnails` storage bucket.

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  base text not null check (base in ('male', 'female')),
  config jsonb not null,
  schema_version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  thumbnail_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index characters_user_id_idx on public.characters (user_id);

-- Keep updated_at fresh on every update.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger characters_set_updated_at
before update on public.characters
for each row execute function public.set_updated_at();

alter table public.characters enable row level security;

create policy "characters_select_own"
on public.characters for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "characters_insert_own"
on public.characters for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "characters_update_own"
on public.characters for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "characters_delete_own"
on public.characters for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Private bucket for character thumbnails. Object path: {uid}/{characterId}.webp
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', false)
on conflict (id) do nothing;

create policy "thumbnails_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'thumbnails'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "thumbnails_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'thumbnails'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "thumbnails_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'thumbnails'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'thumbnails'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "thumbnails_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'thumbnails'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
