import { waitUntil } from '@vercel/functions';
import { db, BUCKET, getUser } from './_lib.js';
import { notifyFamily } from './_push.js';

const PAGE = 80;
const URL_TTL = 60 * 60 * 24 * 7; // 사진·영상 주소는 7일 동안 유효
const PATH_RE = /^uploads\/\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

async function withUrls(rows) {
  const paths = rows.filter((r) => r.media_path).map((r) => r.media_path);
  if (!paths.length) return rows;
  const { data, error } = await db().storage.from(BUCKET).createSignedUrls(paths, URL_TTL);
  if (error) throw error;
  const map = new Map(data.map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => (r.media_path ? { ...r, url: map.get(r.media_path) || null } : r));
}

export default async function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: '다시 들어와 주세요' });

  try {
    if (req.method === 'GET') {
      const after = parseInt(req.query.after, 10) || 0;
      const before = parseInt(req.query.before, 10) || 0;

      // 나에게 온 통화 신호(최근 1분)도 같이 가져간다
      const sigPromise = req.query.sig === undefined ? Promise.resolve(undefined)
        : db().from('call_signals')
          .select('id, created_at, call_id, from_name, kind, data')
          .eq('to_name', user).gt('id', parseInt(req.query.sig, 10) || 0)
          .gte('created_at', new Date(Date.now() - 60000).toISOString())
          .order('id', { ascending: true }).limit(50)
          .then(({ data, error }) => (error ? [] : data));
      const now = new Date().toISOString();

      if (after) {
        const { data, error } = await db()
          .from('messages').select('*')
          .gt('id', after).order('id', { ascending: true }).limit(200);
        if (error) throw error;
        return res.json({ messages: await withUrls(data), signals: await sigPromise, now });
      }

      let q = db().from('messages').select('*');
      if (before) q = q.lt('id', before);
      const { data, error } = await q.order('id', { ascending: false }).limit(PAGE + 1);
      if (error) throw error;
      const hasMore = data.length > PAGE;
      const rows = data.slice(0, PAGE).reverse();
      return res.json({ messages: await withUrls(rows), hasMore, signals: await sigPromise, now });
    }

    if (req.method === 'POST') {
      const { kind = 'text', body, media_path, media_type, quiet } = req.body || {};
      const text = typeof body === 'string' ? body.trim().slice(0, 4000) : '';
      const row = { author: user, kind, body: text || null };

      if (kind === 'text') {
        if (!text) return res.status(400).json({ error: '내용이 비어 있어요' });
      } else if (kind === 'image' || kind === 'video') {
        if (typeof media_path !== 'string' || !PATH_RE.test(media_path)) {
          return res.status(400).json({ error: '파일 정보가 잘못됐어요' });
        }
        row.media_path = media_path;
        row.media_type = String(media_type || '').slice(0, 60) || null;
      } else {
        return res.status(400).json({ error: '알 수 없는 메시지 종류예요' });
      }

      const { data, error } = await db().from('messages').insert(row).select().single();
      if (error) throw error;

      // 답장은 바로 돌려주고, 가족 알림은 뒤에서 마저 보낸다
      const preview = kind === 'image' ? '📷 사진을 보냈어요'
        : kind === 'video' ? '🎬 동영상을 보냈어요'
        : text.length > 120 ? text.slice(0, 120) + '…' : text;
      if (!quiet) waitUntil(notifyFamily(user, preview).catch((e) => console.error('알림 실패', e)));

      const [message] = await withUrls([data]);
      return res.json({ message });
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!id) return res.status(400).json({ error: '어떤 메시지인지 몰라요' });
      const { data: found, error: e1 } = await db()
        .from('messages').select('*').eq('id', id).maybeSingle();
      if (e1) throw e1;
      if (!found) return res.json({ ok: true });
      if (found.author !== user) return res.status(403).json({ error: '내가 보낸 메시지만 지울 수 있어요' });

      const { error: e2 } = await db().from('messages').delete().eq('id', id);
      if (e2) throw e2;
      if (found.media_path) await db().storage.from(BUCKET).remove([found.media_path]);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 요청이에요' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '서버에 문제가 생겼어요. 잠시 후 다시 해 주세요' });
  }
}
