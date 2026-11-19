import * as webpush from 'web-push';
import crypto from 'node:crypto';
import { db, SUPABASE_KEY } from './_lib.js';

const PUSH_HOSTS = [
  'fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com',
  'notify.windows.com', 'push.samsunginternet.com',
];

export function isPushEndpoint(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

// 알림용 열쇠(VAPID). 환경변수가 없으면 Supabase 비밀 키에서 항상 같은 값으로 만들어 낸다.
let keys;
export function vapidKeys() {
  if (keys) return keys;
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    if (!SUPABASE_KEY) throw new Error('Supabase 환경변수가 없습니다.');
    const d = crypto.createHash('sha256').update('family-chat-vapid|' + SUPABASE_KEY).digest();
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    privateKey = d.toString('base64url');
    publicKey = ecdh.getPublicKey().toString('base64url');
  }
  webpush.setVapidDetails('https://family-chat-ten-rouge.vercel.app', publicKey, privateKey);
  keys = { publicKey, privateKey };
  return keys;
}

// 보낸 사람을 뺀 가족 모두에게 알림을 보낸다.
export async function notifyFamily(author, text) {
  vapidKeys();
  const { data, error } = await db().from('push_subscriptions').select('endpoint, name, sub');
  if (error) throw error;
  const payload = JSON.stringify({ title: author, body: text, url: '/' });
  await Promise.allSettled(
    data.filter((s) => s.name !== author).map(async (s) => {
      try {
        await webpush.sendNotification(s.sub, payload, { TTL: 60 * 60 * 24, urgency: 'high' });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db().from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        } else {
          console.error('push 실패', err.statusCode, err.body || err.message);
        }
      }
    })
  );
}
