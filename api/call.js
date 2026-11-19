import { waitUntil } from '@vercel/functions';
import { db, getUser, getKv, setKv } from './_lib.js';
import { ensureSchema } from './_schema.js';
import { notifyNames } from './_push.js';
import { notifyBand } from './_band.js';

const KINDS = ['offer', 'answer', 'decline', 'busy', 'hangup', 'taken'];
const ID_RE = /^[0-9a-f-]{36}$/;

export function turnMode() {
  if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) return 'cloudflare';
  if (process.env.TURN_URLS) return 'custom';
  return 'off';
}

// 직접 연결이 막힌 집·통신사에서도 통화가 되도록 중계 서버(TURN) 정보를 붙인다
async function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (turnMode() === 'cloudflare') {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.CF_TURN_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      });
      const d = await r.json();
      const servers = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
      for (const s of servers) {
        const urls = (Array.isArray(s.urls) ? s.urls : [s.urls])
          .filter((u) => !/:53(\?|$)/.test(u)); // 53번 포트는 브라우저가 막아서 기다리기만 한다
        if (urls.length) list.push({ ...s, urls });
      }
      if (!servers.length) console.error('TURN 응답 이상', r.status, JSON.stringify(d).slice(0, 200));
    } catch (e) {
      console.error('TURN 정보 받기 실패', e.message);
    }
  }
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
      return res.json({ members: [...names].sort((a, b) => a.localeCompare(b, 'ko')), iceServers: await iceServers() });
    }

    if (req.method === 'POST') {
      const { to, kind, call_id, data } = req.body || {};

      // 통화가 왜 실패했는지 남겨 두는 기록 (주소 같은 정보는 빼고 종류·상태만)
      if (kind === 'diag') {
        const d = data || {};
        const pick = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 10) : []);
        const entry = {
          at: new Date().toISOString(), role: String(d.role || '').slice(0, 10), result: String(d.result || '').slice(0, 20),
          video: !!d.video, conn: String(d.conn || '').slice(0, 15), ice: String(d.ice || '').slice(0, 15),
          local: pick(d.local), remote: pick(d.remote), pair: String(d.pair || '').slice(0, 30),
          browser: String(d.browser || '').slice(0, 20), turn: turnMode(),
        };
        console.log('통화 기록', JSON.stringify(entry));
        const prev = (await getKv('call_diag')) || [];
        await setKv('call_diag', [entry, ...prev].slice(0, 10));
        return res.json({ ok: true });
      }

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
        waitUntil(notifyBand(user, '', 'call').catch((e) => console.error('밴드 통화 알림 실패', e.message)));
      }
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: '지원하지 않는 요청이에요' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '통화 연결 중 문제가 생겼어요' });
  }
}
