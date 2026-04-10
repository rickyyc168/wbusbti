import { kv } from '@vercel/kv';

const VOTE_KEY = 'wbu_sbti_popular_votes';
const VOTED_KEY = 'wbu_sbti_popular_voted:';
const RATE_LIMIT_PREFIX = 'wbu_sbti_rl_vote:';

async function checkRateLimit(ip) {
  const key = RATE_LIMIT_PREFIX + ip;
  const count = await kv.incr(key);
  if (count === 1) {
    await kv.expire(key, 60);
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
      const data = await kv.hgetall(VOTE_KEY);
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      const hasVoted = await kv.get(VOTED_KEY + ip);

      if (!data || Object.keys(data).length === 0) {
        return res.status(200).json({ total: 0, types: 0, sorted: [], hasVoted: !!hasVoted });
      }

      let total = 0;
      const entries = Object.entries(data).map(([code, count]) => {
        const n = Number(count) || 0;
        total += n;
        return { code, count: n };
      });
      entries.sort((a, b) => b.count - a.count);

      return res.status(200).json({ total, types: entries.length, sorted: entries, hasVoted: !!hasVoted });
    }

    if (req.method === 'POST') {
      const { votes } = req.body || {};
      // votes is an object: { "CTRL": 3, "BOSS": 1, ... } meaning user gave 3 votes to CTRL, 1 to BOSS etc.
      // Or simpler: votes is an array of type codes the user voted for
      if (!votes || !Array.isArray(votes) || votes.length === 0) {
        return res.status(400).json({ error: '请至少选择一个人格投票' });
      }

      // Validate all type codes
      for (const code of votes) {
        if (!code || typeof code !== 'string' || code.length > 20) {
          return res.status(400).json({ error: '无效的人格类型' });
        }
      }

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

      // Check if already voted
      const alreadyVoted = await kv.get(VOTED_KEY + ip);
      if (alreadyVoted) {
        return res.status(409).json({ error: '你已经投过票了，每人只能投一次' });
      }

      const allowed = await checkRateLimit(ip);
      if (!allowed) {
        return res.status(429).json({ error: '提交太频繁，请稍后再试' });
      }

      // Record votes (1 vote per type selected)
      for (const code of votes) {
        await kv.hincrby(VOTE_KEY, code, 1);
      }

      // Mark as voted (expire in 365 days)
      await kv.set(VOTED_KEY + ip, '1', { ex: 86400 * 365 });

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Popular vote API error:', err);
    return res.status(500).json({ error: '服务器错误' });
  }
}
