import { getKv, setKv } from './_lib.js';
import { ensureSchema } from './_schema.js';

// 밴드 앱 안에서만 채팅방을 쓰는 가족(민결이)을 위해,
// 새 메시지가 오면 가족 밴드에 알림 글을 올려 밴드 푸시가 울리게 한다.
// 밴드에는 알림 글이 늘 1개만 남도록, 새 글을 올리면 이전 알림 글은 지운다.
//
// 환경변수
//   BAND_ACCESS_TOKEN  밴드 개발자 센터에서 받은 연결 토큰 (필수, 비밀)
//   BAND_NAME          알림을 올릴 밴드 이름 (필수, 예: 우리 가족)
//   BAND_SKIP_AUTHORS  이 이름이 보낸 메시지는 밴드로 알리지 않음 (쉼표로 여러 명)

const API = 'https://openapi.band.us';
const SITE = 'https://family-chat-ten-rouge.vercel.app';
const QUIET_MS = 60 * 1000; // 1분 안에 연달아 온 메시지는 한 번만 알린다

export const bandEnabled = () => !!(process.env.BAND_ACCESS_TOKEN && process.env.BAND_NAME);

async function call(method, path, params) {
  const qs = new URLSearchParams({ access_token: process.env.BAND_ACCESS_TOKEN, ...params });
  const res = method === 'GET'
    ? await fetch(`${API}${path}?${qs}`)
    : await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: qs.toString(),
    });
  const data = await res.json().catch(() => ({}));
  if (data.result_code !== 1) {
    throw new Error(`밴드 API 오류 ${path}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.result_data;
}

export async function listBandNames() {
  const data = await call('GET', '/v2.1/bands', {});
  return (data.bands || []).map((b) => b.name);
}

async function bandKey() {
  const want = process.env.BAND_NAME.trim();
  const cached = await getKv('band');
  if (cached && cached.name === want && cached.key) return cached.key;
  const data = await call('GET', '/v2.1/bands', {});
  const found = (data.bands || []).find((b) => b.name.trim() === want);
  if (!found) throw new Error(`'${want}' 밴드를 찾지 못했어요`);
  await setKv('band', { name: want, key: found.band_key });
  return found.band_key;
}

// kind: 'message' | 'call'
export async function notifyBand(author, text, kind = 'message') {
  if (!bandEnabled()) return;
  const skip = (process.env.BAND_SKIP_AUTHORS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (kind === 'message' && skip.includes(author)) return;

  await ensureSchema();
  const last = (await getKv('band_last')) || {};
  if (kind === 'message' && last.at && Date.now() - last.at < QUIET_MS) return;

  const key = await bandKey();
  const content = kind === 'call'
    ? `📞 ${author}님이 전화하고 있어요!\n채팅방에서 받아 주세요 👉 ${SITE}`
    : `🏠 우리 가족 채팅방에 새 메시지가 왔어요\n${author}: ${text}\n👉 ${SITE}`;

  const posted = await call('POST', '/v2.2/band/post/create', { band_key: key, content, do_push: 'true' });
  await setKv('band_last', { at: Date.now(), post_key: posted.post_key });

  // 이전 알림 글은 지워서 밴드를 깔끔하게 둔다
  if (last.post_key) {
    await call('POST', '/v2/band/post/remove', { band_key: key, post_key: last.post_key })
      .catch((e) => console.error('이전 밴드 알림 지우기 실패', e.message));
  }
}
