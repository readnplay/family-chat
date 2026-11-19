import pg from 'pg';

// 새로 필요한 표를 서버가 스스로 만든다 (이미 있으면 그냥 넘어감).
const SQL = `
create table if not exists public.call_signals (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  call_id     text not null,
  from_name   text not null,
  to_name     text not null,
  kind        text not null,
  data        jsonb
);
create index if not exists call_signals_to_idx on public.call_signals (to_name, id);
alter table public.call_signals enable row level security;
grant all on table public.call_signals to service_role;

create table if not exists public.login_attempts (
  id  bigint generated always as identity primary key,
  at  timestamptz not null default now(),
  ip  text not null
);
create index if not exists login_attempts_at_idx on public.login_attempts (at);
alter table public.login_attempts enable row level security;
grant all on table public.login_attempts to service_role;

notify pgrst, 'reload schema';
`;

let done = null;

export function ensureSchema() {
  if (!done) {
    done = run().then(() => true).catch((err) => {
      console.error('표 만들기 실패', err.message);
      done = null;
      return false;
    });
  }
  return done;
}

async function run() {
  const raw = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!raw) throw new Error('POSTGRES_URL 환경변수가 없습니다.');
  const url = new URL(raw);
  url.search = '';
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(SQL);
  } finally {
    await client.end().catch(() => {});
  }
}
