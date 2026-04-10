import { kv } from '@vercel/kv';

const LEADERBOARD_KEY = 'wbu_sbti_leaderboard';
const RATE_LIMIT_PREFIX = 'wbu_sbti_rl:';

async function checkRateLimit(ip) {
  const key = RATE_LIMIT_PREFIX + ip;
  const count = await kv.incr(key);
  if (count === 1) {
    await kv.expire(key, 30);
  }
  return count <= 10;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const data = await kv.hgetall(LEADERBOARD_KEY);

      if (!data || Object.keys(data).length === 0) {
        return res.status(200).json({ s: [] });
      }

      const entries = Object.entries(data)
        .map(([c, n]) => [c, Number(n) || 0])
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);

      return res.status(200).json({ s: entries });
    }

    if (req.method === 'POST') {
      const { typeCode, typeName } = req.body || {};

      if (!typeCode || typeof typeCode !== 'string' || typeCode.length > 20) {
        return res.status(400).json({ error: '无效的 typeCode' });
      }

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      const allowed = await checkRateLimit(ip);
      if (!allowed) {
        return res.status(429).json({ error: '提交太频繁，请稍后再试' });
      }

      await kv.hincrby(LEADERBOARD_KEY, typeCode, 1);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Leaderboard API error:', err);
    return res.status(500).json({ error: '服务器错误' });
  }
}
