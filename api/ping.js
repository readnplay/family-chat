import { db } from './_lib.js';

// Supabase 무료 프로젝트는 7일 동안 아무 요청이 없으면 잠든다.
// Vercel 크론이 하루 한 번 이 주소를 불러서 깨워 둔다.
export default async function handler(req, res) {
  try {
    const { error } = await db().from('messages').select('id').limit(1);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false });
  }
}
