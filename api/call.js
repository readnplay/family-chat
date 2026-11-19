import { waitUntil } from '@vercel/functions';
import { db, getUser } from './_lib.js';
import { ensureSchema } from './_schema.js';
import { notifyNames } from './_push.js';

const KINDS = ['offer', 'answer', 'decline', 'busy', 'hangup', 'taken'];
const ID_RE = /^[0-9a-f-]{36}$/;

function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URLS) {
    list.push({
      urls: process.env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return list;
}

// GET: 통화할 수 있는 가족 목록 / POST: 통화 신호 보내기
export default async function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: '다시 들어와 주세요' });

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const [subs, msgs] = await Promise.all([
        db().from('push_subscriptions').select('name'),
        db().from('messages').select('author').order('id', { ascending: false }).limit(1000),
      ]);
      const names = new Set();
      for (const r of subs.data || []) names.add(r.name);
      for (const r of msgs.data || []) names.add(r.author);
      names.delete(user);
      return res.json({ members: [...names].sort((a, b) => a.localeCompare(b, 'ko')), iceServers: iceServers() });
    }

    if (req.method === 'POST') {
      const { to, kind, call_id, data } = req.body || {};
      if (!KINDS.includes(kind) || !ID_RE.test(String(call_id || ''))
          || typeof to !== 'string' || !to || to.length > 20) {
        return res.status(400).json({ error: '통화 정보가 잘못됐어요' });
      }
      if (data && JSON.stringify(data).length > 30000) {
        return res.status(413).json({ error: '통화 정보가 너무 커요' });
      }
      const { error } = await db().from('call_signals').insert({
        call_id, from_name: user, to_name: to, kind, data: data || null,
      });
      if (error) throw error;

      if (kind === 'offer') {
        const video = !!(data && data.video);
        waitUntil(notifyNames([to], {
          title: `📞 ${user}님의 ${video ? '영상통화' : '전화'}`,
          body: '눌러서 받아 주세요',
          url: '/', tag: 'family-call', call: true,
        }).catch((e) => console.error('통화 알림 실패', e)));
      }
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 요청이에요' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '통화 연결 중 문제가 생겼어요' });
  }
}
