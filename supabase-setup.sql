-- 우리 가족 채팅방: Supabase SQL Editor에 통째로 붙여넣고 Run 하세요.

-- 1) 대화 저장 표
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  author      text not null,
  kind        text not null default 'text' check (kind in ('text', 'image', 'video')),
  body        text,
  media_path  text,
  media_type  text
);

-- 바깥에서 직접 읽지 못하게 잠그고, 서버(Vercel)만 접근하게 한다.
alter table public.messages enable row level security;
grant all on table public.messages to service_role;

-- 2) 사진·동영상 보관함 (비공개, 파일 1개 최대 50MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family', 'family', false, 52428800, array['image/*', 'video/*'])
on conflict (id) do nothing;
