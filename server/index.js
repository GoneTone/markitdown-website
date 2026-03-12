const express = require('express');
const rateLimit = require('express-rate-limit');
const { fetchUrlHandler } = require('./fetch-url');

const app = express();
const PORT = process.env.PORT || 3002;

// 信任一層 proxy（nginx），讓 req.ip 取得真實 IP
app.set('trust proxy', 1);

// Rate limiting：每個 IP 每分鐘 30 次
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請求過於頻繁，請稍後再試' },
});

app.use('/fetch-url', limiter);

// 路由
app.get('/fetch-url', fetchUrlHandler);

// 健康檢查
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});

module.exports = app;
