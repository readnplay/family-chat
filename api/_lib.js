import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export const BUCKET = 'family';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

let client;
export function db() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 없습니다.');
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// 작은 설정값 저장소 (표 kv)
export async function getKv(key) {
  const { data } = await db().from('kv').select('value').eq('key', key).maybeSingle();
  return data ? data.value : null;
}
export async function setKv(key, value) {
  await db().from('kv').upsert({ key, value, updated_at: new Date().toISOString() });
}

// 가족 비밀번호를 바꾸면 기존 로그인은 모두 풀리도록 비밀번호를 서명 키에 섞는다.
function signingKey() {
  const base = process.env.SESSION_SECRET || SUPABASE_KEY || '';
  const pw = process.env.FAMILY_PASSWORD || '';
  if (!base || !pw) throw new Error('FAMILY_PASSWORD 환경변수가 없습니다.');
  return base + '|' + pw;
}

function hmac(text) {
  return crypto.createHmac('sha256', signingKey()).update(text).digest('base64url');
}

export function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function signToken(name) {
  const payload = Buffer.from(
    JSON.stringify({ n: name, e: Date.now() + 1000 * 60 * 60 * 24 * 365 })
  ).toString('base64url');
  return payload + '.' + hmac(payload);
}

export function getUser(req) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sig, hmac(payload))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.n || data.e < Date.now()) return null;
    return data.n;
  } catch {
    return null;
  }
}
