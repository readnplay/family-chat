import { db, BUCKET, getUser, signToken } from './_lib.js';
import { ensureSchema } from './_schema.js';

const PATH_RE = /^uploads\/\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;
const URL_TTL = 60 * 60 * 24 * 7;

const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 20);

// GET: 가족 프로필 사진 목록 / POST: 내 사진 바꾸기·지우기, 이름 바꾸기
export default async function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: '다시 들어와 주세요' });

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const { data, error } = await db().from('profiles').select('name, avatar_path').not('avatar_path', 'is', null);
      if (error) throw error;
      let urls = new Map();
      if (data.length) {
        const { data: signed, error: e2 } = await db().storage.from(BUCKET)
          .createSignedUrls(data.map((p) => p.avatar_path), URL_TTL);
        if (e2) throw e2;
        urls = new Map(signed.map((s) => [s.path, s.signedUrl]));
      }
      return res.json({
        profiles: data.map((p) => ({ name: p.name, path: p.avatar_path, url: urls.get(p.avatar_path) || null })),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: '지원하지 않는 요청이에요' });
    const { action, avatar_path, name } = req.body || {};
    const { data: mine } = await db().from('profiles').select('avatar_path').eq('name', user).maybeSingle();
    const oldPath = mine && mine.avatar_path;

    if (action === 'avatar') {
      if (typeof avatar_path !== 'string' || !PATH_RE.test(avatar_path)) {
        return res.status(400).json({ error: '사진 정보가 잘못됐어요' });
      }
      const { error } = await db().from('profiles')
        .upsert({ name: user, avatar_path, updated_at: new Date().toISOString() });
      if (error) throw error;
      if (oldPath && oldPath !== avatar_path) await db().storage.from(BUCKET).remove([oldPath]);
      const { data: s } = await db().storage.from(BUCKET).createSignedUrl(avatar_path, URL_TTL);
      return res.json({ ok: true, path: avatar_path, url: s && s.signedUrl });
    }

    if (action === 'remove_avatar') {
      await db().from('profiles').upsert({ name: user, avatar_path: null, updated_at: new Date().toISOString() });
      if (oldPath) await db().storage.from(BUCKET).remove([oldPath]);
      return res.json({ ok: true });
    }

    if (action === 'rename') {
      const next = cleanName(name);
      if (!next) return res.status(400).json({ error: '새 이름을 적어 주세요' });
      if (next === user) return res.json({ ok: true, name: user, token: signToken(user) });

      // 다른 가족이 이미 쓰는 이름이면 섞이지 않게 막는다
      const [a, b, c] = await Promise.all([
        db().from('messages').select('id', { count: 'exact', head: true }).eq('author', next),
        db().from('profiles').select('name', { count: 'exact', head: true }).eq('name', next),
        db().from('push_subscriptions').select('endpoint', { count: 'exact', head: true }).eq('name', next),
      ]);
      if ((a.count || 0) + (b.count || 0) + (c.count || 0) > 0) {
        return res.status(409).json({ error: '이미 다른 가족이 쓰는 이름이에요' });
      }

      const results = await Promise.all([
        db().from('messages').update({ author: next }).eq('author', user),
        db().from('push_subscriptions').update({ name: next }).eq('name', user),
        db().from('reads').update({ name: next }).eq('name', user),
        mine ? db().from('profiles').update({ name: next, updated_at: new Date().toISOString() }).eq('name', user)
          : Promise.resolve({}),
      ]);
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;
      return res.json({ ok: true, name: next, token: signToken(next) });
    }

    return res.status(400).json({ error: '알 수 없는 요청이에요' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '프로필을 바꾸다 문제가 생겼어요' });
  }
}
