const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function isNewsIntent(text) {
  return /行情|板块|新闻|资讯|热点|走势/.test(text);
}

function isBuyIntent(text) {
  return /买入|能不能买|是否买|值得买|进场/.test(text) || /\b\d{6}(?:\.(?:SS|SZ))?\b/.test(text);
}

function extractSymbol(text) {
  const m = text.match(/\b(\d{6})(?:\.(SS|SZ))?\b/i);
  return m ? (m[2] ? `${m[1]}.${m[2]}` : m[1]) : null;
}

async function callLLM(messages) {
  const resp = await fetch('/api/llm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model: 'deepseek-chat', temperature: 0.6 })
  });
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || JSON.stringify(data);
  return text;
}

async function handleNews(text) {
  addMessage('assistant', '正在聚合主流媒体资讯并分析…');
  const q = encodeURIComponent(text);
  const resp = await fetch(`/api/news?q=${q}`);
  const data = await resp.json();
  if (data.error) {
    addMessage('assistant', `资讯聚合失败：${data.error}`);
    return;
  }
  const items = data.items || [];
  const bullet = items.map((it, i) => `${i + 1}. [${it.sourceDomain}] ${it.title}\n${it.link}`).join('\n\n');
  const llmMessages = [
    { role: 'system', content: '你是严谨的A股分析助手。请根据提供的主流媒体信息，提炼要点、交叉验证一致性，并给出简短结论与风险提示。用中文输出。' },
    { role: 'user', content: `查询主题：${text}\n资讯(${items.length}条)：\n${bullet}\n\n请整合分析上述信息，结构化输出：\n- 核心观点\n- 市场影响\n- 风险提示\n- 可关注的板块/个股（若明确）` }
  ];
  const summary = await callLLM(llmMessages);
  addMessage('assistant', summary);
}

async function handleBuy(text) {
  const sym = extractSymbol(text);
  if (!sym) {
    addMessage('assistant', '请提供6位A股代码，例如：是否买入600519？');
    return;
  }
  addMessage('assistant', `正在获取 ${sym} 的历史数据并执行交易规则…`);
  const resp = await fetch(`/api/strategy?symbol=${encodeURIComponent(sym)}`);
  const data = await resp.json();
  if (data.error) {
    addMessage('assistant', `分析失败：${data.error}${data.details ? ' - ' + data.details : ''}`);
    return;
  }
  const explanation = `代码：${data.symbol}\n现价：${data.currentPrice?.toFixed(2)}\n200日SMA：${data.sma200?.toFixed(2)}\n趋势：${data.isUpTrend ? '上升(价>200SMA)' : '非上升'}\n近7日：${data.recent7.map(v => v.toFixed(2)).join(', ')}\n7日最低(前6日)：${data.minPrev6?.toFixed(2)}\n7日最高(前6日)：${data.maxPrev6?.toFixed(2)}\n信号：低点触发=${data.signals.isFirst7Low}, 高点触发=${data.signals.isFirst7High}\n建议：${data.recommendation}\n理由：${data.explanation}`;
  addMessage('assistant', explanation);
}

async function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;
  addMessage('user', text);
  inputEl.value = '';

  try {
    if (isNewsIntent(text)) return handleNews(text);
    if (isBuyIntent(text)) return handleBuy(text);
    // default: plain LLM chat
    const reply = await callLLM([
      { role: 'system', content: '你是A股分析助手“小飞轮”，输出简洁、结构化、中文回答。' },
      { role: 'user', content: text }
    ]);
    addMessage('assistant', reply);
  } catch (e) {
    addMessage('assistant', `出错了：${String(e)}`);
  }
}

sendBtn.addEventListener('click', handleSend);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSend();
});

// Welcome message
addMessage('assistant', '你好，我是小飞轮。试试问“今天消费板块行情”或“是否买入600519”。');