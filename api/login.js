import { safeEqual, signToken } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 됩니다' });

  const { name, password } = req.body || {};
  const cleanName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!cleanName) return res.status(400).json({ error: '이름을 적어 주세요' });

  const expected = process.env.FAMILY_PASSWORD;
  if (!expected) return res.status(500).json({ error: '아직 가족 비밀번호가 설정되지 않았어요' });

  if (!safeEqual(String(password || ''), expected)) {
    await new Promise((r) => setTimeout(r, 800)); // 마구 대입하기 어렵게
    return res.status(401).json({ error: '가족 비밀번호가 맞지 않아요' });
  }

  return res.status(200).json({ token: signToken(cleanName), name: cleanName });
}
