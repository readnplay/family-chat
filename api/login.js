import crypto from 'node:crypto';
import { db, safeEqual, signToken } from './_lib.js';
import { ensureSchema } from './_schema.js';

const IP_LIMIT = 5;          // 한 곳(같은 인터넷)에서 15분 동안 5번 틀리면 잠금
const IP_WINDOW = 15 * 60e3;
const ALL_LIMIT = 30;        // 어디서든 합쳐서 1시간에 30번 틀리면 모두 잠금
const ALL_WINDOW = 60 * 60e3;

function ipOf(req) {
  const raw = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return crypto.createHash('sha256').update('family-chat-ip|' + raw).digest('hex').slice(0, 32);
}

async function failCounts(ip) {
  const since = (ms) => new Date(Date.now() - ms).toISOString();
  const [a, b] = await Promise.all([
    db().from('login_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('at', since(IP_WINDOW)),
    db().from('login_attempts').select('id', { count: 'exact', head: true }).gte('at', since(ALL_WINDOW)),
  ]);
  if (a.error || b.error) return null;
  return { ip: a.count || 0, all: b.count || 0 };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 됩니다' });

  const { name, password } = req.body || {};
  const cleanName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!cleanName) return res.status(400).json({ error: '이름을 적어 주세요' });

  const expected = process.env.FAMILY_PASSWORD;
  if (!expected) return res.status(500).json({ error: '아직 가족 비밀번호가 설정되지 않았어요' });

  await ensureSchema();
  const ip = ipOf(req);
  const counts = await failCounts(ip).catch(() => null);
  if (counts && counts.ip >= IP_LIMIT) {
    return res.status(429).json({ error: '비밀번호를 여러 번 틀려서 잠겼어요. 15분 뒤에 다시 해 주세요' });
  }
  if (counts && counts.all >= ALL_LIMIT) {
    return res.status(429).json({ error: '비밀번호 시도가 너무 많아 잠시 잠겼어요. 1시간 뒤에 다시 해 주세요' });
  }

  if (!safeEqual(String(password || ''), expected)) {
    await db().from('login_attempts').insert({ ip }).then(() => {}, () => {});
    await new Promise((r) => setTimeout(r, 800));
    const left = counts ? IP_LIMIT - counts.ip - 1 : null;
    return res.status(401).json({
      error: left > 0 ? `가족 비밀번호가 맞지 않아요 (${left}번 더 할 수 있어요)`
        : left === 0 ? '비밀번호를 여러 번 틀려서 잠겼어요. 15분 뒤에 다시 해 주세요'
        : '가족 비밀번호가 맞지 않아요',
    });
  }

  await db().from('login_attempts').delete().eq('ip', ip).then(() => {}, () => {});
  return res.status(200).json({ token: signToken(cleanName), name: cleanName });
}
