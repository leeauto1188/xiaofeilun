import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fetch } from 'undici';
import { parseStringPromise } from 'xml2js';
import yahooFinance from 'yahoo-finance2';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// DeepSeek Chat API proxy
app.post('/api/llm', async (req, res) => {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'DeepSeek API key not configured' });
    }
    const { messages, model = 'deepseek-chat', temperature = 0.7 } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages required (OpenAI-format array)' });
    }

    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json(data);
    }
    return res.json(data);
  } catch (err) {
    console.error('LLM error:', err);
    res.status(500).json({ error: 'LLM request failed', details: String(err) });
  }
});

// News aggregation using Google News RSS with site filters
const NEWS_SOURCES = [
  { domain: 'cls.cn', name: '财联社' },
  { domain: 'yicai.com', name: '第一财经' },
  { domain: 'eeo.com.cn', name: '经济观察报' },
];

async function fetchRssFor(domain, q) {
  const url = `https://news.google.com/rss/search?q=site:${domain}+${encodeURIComponent(q)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Xiaofeilun' } });
  const xml = await resp.text();
  const parsed = await parseStringPromise(xml, { explicitArray: false });
  const items = parsed?.rss?.channel?.item || [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.filter(Boolean).map(it => ({
    title: it.title,
    link: it.link,
    pubDate: it.pubDate,
    sourceDomain: domain,
  }));
}

app.get('/api/news', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'q required' });

    const results = (await Promise.all(NEWS_SOURCES.map(s => fetchRssFor(s.domain, q)))).flat();
    // Deduplicate by title
    const seen = new Set();
    const deduped = [];
    for (const item of results) {
      const key = (item.title || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
    deduped.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    res.json({ query: q, count: deduped.length, items: deduped.slice(0, 15) });
  } catch (err) {
    console.error('news error:', err);
    res.status(500).json({ error: 'news fetch failed', details: String(err) });
  }
});

// Strategy analysis for A-shares using Yahoo Finance (direct REST)
function mapToYahooSymbol(sym) {
  // If already has suffix, return
  if (/\.SS$|\.SZ$/i.test(sym)) return sym.toUpperCase();
  const s = sym.replace(/\s/g, '');
  // Shanghai: 600/601/603/605
  if (/^(600|601|603|605)\d{3}$/.test(s)) return `${s}.SS`;
  // Shenzhen: 000/001/002/300/301
  if (/^(000|001|002|300|301)\d{3}$/.test(s)) return `${s}.SZ`;
  return s;
}

function sma(values, period) {
  if (values.length < period) return null;
  const start = values.length - period;
  const slice = values.slice(start);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

app.get('/api/strategy', async (req, res) => {
  try {
    const raw = (req.query.symbol || '').toString().trim();
    if (!raw) return res.status(400).json({ error: 'symbol required (e.g., 600519 or 600519.SS)' });
    const symbol = mapToYahooSymbol(raw);

    const periodDays = Number(req.query.days || 300);
    const end = new Date();
    const start = new Date(end.getTime() - periodDays * 24 * 3600 * 1000);

    // Prefer fixed range to ensure enough history
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y&includePrePost=false`;

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Xiaofeilun' } });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Yahoo API ${resp.status}: ${text.slice(0, 200)}`);
    }
    const j = await resp.json();
    const closes = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => Number.isFinite(v));

    if (!closes || closes.length < 210) {
      return res.status(400).json({ error: 'insufficient history', got: closes?.length || 0 });
    }

    const currentPrice = closes[closes.length - 1];
    const sma200 = sma(closes, 200);
    const recentWindow = closes.slice(-7);
    const prev6 = closes.slice(-7, -1);

    const minPrev6 = Math.min(...prev6);
    const maxPrev6 = Math.max(...prev6);
    const isUpTrend = sma200 != null && currentPrice > sma200;
    const isFirst7Low = prev6.length === 6 && currentPrice < minPrev6;
    const isFirst7High = prev6.length === 6 && currentPrice > maxPrev6;

    let action = 'hold';
    let reason = '';
    if (isUpTrend && isFirst7Low) {
      action = 'buy';
      reason = '多头规则触发：价格在200日均线上方且今日首次创7日新低，逢低买入。';
    } else if (isFirst7High) {
      action = 'sell';
      reason = '空头规则触发：今日首次创7日新高，逢高卖出。';
    } else {
      reason = '未满足买入/卖出触发条件，建议观望。';
    }

    res.json({
      symbol,
      currentPrice,
      sma200,
      isUpTrend,
      recent7: recentWindow,
      minPrev6,
      maxPrev6,
      signals: { isFirst7Low, isFirst7High },
      recommendation: action,
      explanation: reason,
    });
  } catch (err) {
    console.error('strategy error:', err);
    res.status(500).json({ error: 'strategy failed', details: String(err) });
  }
});

// Fallback to index.html for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/healthz', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`小飞轮 server running at http://${host}:${port}`);
});