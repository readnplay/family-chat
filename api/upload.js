import crypto from 'node:crypto';
import { db, BUCKET, getUser } from './_lib.js';

const MAX_BYTES = 50 * 1024 * 1024; // Supabase 무료 플랜 파일 1개 최대 크기
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/3gpp': '3gp', 'video/x-m4v': 'm4v',
};

// 파일을 Supabase에 직접 올릴 수 있는 1회용 주소를 만들어 준다.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 됩니다' });
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: '다시 들어와 주세요' });

  const { type, size } = req.body || {};
  const ext = EXT[type];
  if (!ext) return res.status(400).json({ error: '이 형식의 파일은 보낼 수 없어요' });
  if (!(size > 0) || size > MAX_BYTES) {
    return res.status(413).json({ error: '파일이 너무 커요 (50MB까지 보낼 수 있어요)' });
  }

  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const path = `uploads/${month}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw error;
    return res.json({ path: data.path, signedUrl: data.signedUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '파일 올릴 준비가 안 됐어요. 잠시 후 다시 해 주세요' });
  }
}
