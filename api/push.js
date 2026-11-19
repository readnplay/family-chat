import { db, getUser } from './_lib.js';
import { vapidKeys, isPushEndpoint, sendToSubs } from './_push.js';

// GET: 알림 공개 열쇠 / POST: 이 기기 알림 등록·해제
export default async function handler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: '다시 들어와 주세요' });

  try {
    if (req.method === 'GET') return res.json({ publicKey: vapidKeys().publicKey });

    if (req.method === 'POST') {
      const { action, subscription, endpoint } = req.body || {};

      if (action === 'test') {
        const { data } = await db().from('push_subscriptions').select('endpoint, name, sub').eq('endpoint', String(endpoint || ''));
        if (!data || !data.length) return res.status(404).json({ error: '이 기기는 아직 알림이 등록되지 않았어요' });
        await sendToSubs(data, { title: '🔔 알림 시험', body: '이렇게 소리·진동과 함께 알려 드려요!', url: '/', tag: 'family-test' });
        return res.json({ ok: true });
      }

      if (action === 'unsubscribe') {
        if (typeof endpoint === 'string') {
          await db().from('push_subscriptions').delete().eq('endpoint', endpoint);
        }
        return res.json({ ok: true });
      }

      const sub = subscription || {};
      if (!isPushEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
        return res.status(400).json({ error: '알림 정보가 잘못됐어요' });
      }
      const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
      const { error } = await db().from('push_subscriptions').upsert({
        endpoint: sub.endpoint, name: user, sub: clean, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 요청이에요' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '알림 설정 중 문제가 생겼어요' });
  }
}
