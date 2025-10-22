# 小飞轮 · A股分析助手

简约美观的对话式 AI 炒股小助手：
- 技能1：聚合财联社、第一财经、经济观察报等主流媒体资讯，并用 LLM 结构化总结。
- 技能2：基于 200 日 SMA 与 7 日高低点的简易趋势策略，给出买入/卖出/观望建议。

## 本地运行
```
npm ci --omit=dev
cp .env.example .env  # 如无，可直接创建并填入密钥
node server.js
# 打开 http://localhost:3000/
```
环境变量：
- `DEEPSEEK_API_KEY`：你的 DeepSeek 密钥
- `PORT`（可选）：默认 3000

## Render 部署（推荐）
1. 将仓库推送到 GitHub/GitLab。
2. 在 Render 创建 Web Service：
   - Build Command: `npm ci --omit=dev`
   - Start Command: `node server.js`
   - Health Check Path: `/healthz`
   - Auto Deploy: 开启
3. 在 Render 的「Environment」中设置：
   - `DEEPSEEK_API_KEY`: 你的密钥（不要提交 `.env`）
4. 部署完成后访问 Render 提供的 `https://<服务名>.onrender.com`。

可选：使用本仓库的 `render.yaml` 直接导入模板。

## Railway/Heroku
- 使用 `Procfile` 自动识别进程：`web: node server.js`
- 在平台环境变量中设置 `DEEPSEEK_API_KEY`。

## Docker 自托管
```
docker build -t xiaofeilun .
docker run -d -p 80:3000 --env DEEPSEEK_API_KEY=你的密钥 --name xiaofeilun xiaofeilun
```
建议用 Nginx 反代到 `http://127.0.0.1:3000`，并配置 HTTPS（Let’s Encrypt）。

## 安全建议
- 切勿提交 `.env`；通过云平台环境变量管理密钥。
- 如需限制访问来源，可在 `server.js` 的 CORS 政策中指定白名单域名。

## 路由
- `GET /`：前端页面
- `POST /api/llm`：LLM 代理
- `GET /api/news?q=`：资讯聚合
- `GET /api/strategy?symbol=`：策略分析
- `GET /healthz`：健康检查

## 许可
内部使用演示，未附加开源许可。