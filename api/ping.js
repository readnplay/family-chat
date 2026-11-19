import { db, BUCKET } from './_lib.js';

// 상태 확인용. Supabase 무료 프로젝트는 7일 동안 아무 요청이 없으면 잠들기 때문에
// Vercel 크론이 하루 한 번 이 주소를 불러서 깨워 둔다.
export default async function handler(req, res) {
  const result = { db: false, storage: false, password: !!process.env.FAMILY_PASSWORD };
  try {
    const { error } = await db().from('messages').select('id').limit(1);
    result.db = !error;
    const { error: e2 } = await db().storage.getBucket(BUCKET);
    result.storage = !e2;
  } catch (err) {
    console.error(err);
  }
  const ok = result.db && result.storage && result.password;
  return res.status(ok ? 200 : 500).json({ ok, ...result });
}
