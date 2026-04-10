import { kv } from '@vercel/kv';

const VOTE_KEY = 'wbu_sbti_hated_votes';
const VOTED_ZSET = 'wbu_sbti_hated_voted';
const RATE_LIMIT_PREFIX = 'wbu_sbti_rl:';
const VOTE_EXPIRE_MS = 365 * 24 * 60 * 60 * 1000; // 365 days

async function checkRateLimit(ip) {
  const key = RATE_LIMIT_PREFIX + ip;
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, 30);
  return count <= 10;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const [data, ip] = [
        await kv.hgetall(VOTE_KEY),
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
      ];
      const hasVoted = await kv.zscore(VOTED_ZSET, ip);

      if (!data || Object.keys(data).length === 0) {
        return res.status(200).json({ s: [], v: !!hasVoted });
      }

      const entries = Object.entries(data)
        .map(([c, n]) => [c, Number(n) || 0])
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);

      return res.status(200).json({ s: entries, v: !!hasVoted });
    }

    if (req.method === 'POST') {
      const { votes } = req.body || {};
      if (!votes || !Array.isArray(votes) || votes.length === 0)
        return res.status(400).json({ e: '请至少选择一个人格投票' });
      for (const code of votes) {
        if (!code || typeof code !== 'string' || code.length > 20)
          return res.status(400).json({ e: '无效的人格类型' });
      }

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      const alreadyVoted = await kv.zscore(VOTED_ZSET, ip);
      if (alreadyVoted) return res.status(409).json({ e: '你已经投过票了' });

      const allowed = await checkRateLimit(ip);
      if (!allowed) return res.status(429).json({ e: '提交太频繁' });

      const pipeline = kv.pipeline();
      for (const code of votes) {
        pipeline.hincrby(VOTE_KEY, code, 1);
      }
      pipeline.zadd(VOTED_ZSET, { score: Date.now(), member: ip });
      await pipeline.exec();

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ e: 'Method not allowed' });
  } catch (err) {
    console.error('Hated vote error:', err);
    return res.status(500).json({ e: '服务器错误' });
  }
}
