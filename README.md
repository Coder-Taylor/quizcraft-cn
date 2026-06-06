# QuizCraft CN（刷题助手 v2.0）

GitHub 仓库：<https://github.com/jry21223/quizcraft-cn>

基于 React + TypeScript + FastAPI + PostgreSQL 的刷题系统，支持智能题库提取、AI 解析生成、排行榜统计和生产部署。题库内容仍保留在 `tiku/*.json` 中用于版本化，运行统计和迁移审计进入 PostgreSQL。

## 当前技术选型

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端 | React 18、TypeScript 5、Vite 5 | 单页应用、开发服务和生产构建 |
| UI 与状态 | Tailwind CSS、Framer Motion、Zustand、React Router、Chart.js、Lucide React | 页面样式、动画、客户端状态、路由、统计图表和图标 |
| 后端 | Python 3.11、FastAPI、Pydantic v2、Uvicorn | REST API、WebSocket 进度推送、请求校验和 ASGI 服务 |
| 数据库 | PostgreSQL、psycopg 3 | 用户统计、排行榜、题目统计、题库元数据和题目快照 |
| 题库内容 | `tiku/*.json` + PostgreSQL 双写 | JSON 继续作为可版本化题库源，DB 用于运行统计、审计和后续切库准备 |
| 文件与 AI | PyPDF2、python-docx、httpx、OpenAI/DeepSeek/自定义兼容接口 | PDF/Word/TXT 导入和 AI 解析生成 |
| 部署 | Nginx、systemd、环境文件 | 静态前端托管、`/api`/`/ws` 反代、后端进程管理和密钥配置 |

## ✨ 新特性

### 前端 (React + TypeScript)
- ⚡ **现代化 UI**：流畅的动画效果和响应式设计
- 🎯 **多种练习模式**：随机、难题、章节模式
- 📊 **实时统计**：答题正确率、用时统计
- ⭐ **收藏功能**：收藏难题重点复习
- 📝 **错题本**：自动记录答错的题目
- 🎨 **主题切换**：支持不同题库的主题色

### 后端 (FastAPI)
- 🚀 **高性能**：基于 FastAPI 的异步处理
- 📚 **多格式支持**：兼容新旧题库格式
- 🔧 **自动转换**：自动将旧格式转换为新标准
- 💾 **PostgreSQL 持久化**：排行榜、用户统计、题目统计和题库快照进入数据库
- 🔐 **管理接口保护**：题库提取、AI 解析、导出和保存接口需要 `X-Admin-Token`

### 题库提取工具
- 📄 **多格式导入**：支持 PDF、Word、TXT
- 🤖 **AI 解析**：使用 OpenAI/DeepSeek 生成答案解析
- ✏️ **可视化编辑**：提取后可编辑题目内容
- 💾 **一键导出**：导出为标准 JSON 格式
- 🔁 **题库双写**：保存题库时同时写入 `tiku/{key}.json` 和 PostgreSQL

## 🚀 快速开始

### 1. 安装依赖

```bash
# 后端依赖
scripts/install_deps.sh
```

### 2. 启动开发环境

```bash
./start.sh
```

或分别启动：

```bash
# 启动后端
python3 server.py

# 启动前端（新终端）
cd web-app
npm run dev
```

### 3. 访问应用

- 前端: http://localhost:5173
- 后端 API: http://localhost:10086
- API 文档: http://localhost:10086/docs

### 4. 部署 ops 版本

```bash
scripts/install_deps.sh
STATIC_DEPLOY_DIR=/var/www/quizcraft-cn scripts/build_ops.sh
```

`ops` 版本默认保留刷题、排行榜和 `beetle` 页面，前端请求地址默认为同源 `/api`。生产环境建议用 Nginx 托管 `web-app/dist` 的静态文件，并用 systemd 管理后端服务。

如果你用 Nginx/Caddy 反向代理，请把：

- `/` 指向静态目录，例如 `/var/www/quizcraft-cn`
- `/api` 和 `/ws` 转发到后端服务 `10086`

常用环境变量：

```bash
APP_HOST=127.0.0.1
APP_PORT=10086
CORS_ORIGINS=https://your-domain.example
DATABASE_URL=postgresql://quizcraft:change-me@127.0.0.1:5432/quizcraft
ADMIN_TOKEN=change-me
```

生产环境必须配置 `ADMIN_TOKEN`，并用 `CORS_ORIGINS` 显式写出允许访问的前端来源。默认 CORS 只允许本地开发地址，不再使用 `*`。

部署示例在 `deploy/`：

- `quizcraft-cn.env.example`：systemd 环境文件模板
- `quizcraft-cn.service.example`：后端 systemd service 模板
- `nginx.conf.example`：Nginx 反代和静态站点模板

本地预览仍可使用：

```bash
./start_ops.sh
```

`start_ops.sh` 不再安装依赖，只负责构建并启动本地预览。依赖安装请显式运行 `scripts/install_deps.sh`。

### 5. 数据迁移与校验

生产环境先配置 `DATABASE_URL`，再初始化并迁移旧排行榜：

```bash
.venv/bin/python scripts/migrate_rankings_to_db.py
.venv/bin/python scripts/check_bank_db_consistency.py
.venv/bin/python scripts/smoke_backend.py
```

迁移脚本会把旧 `rankings_v2.json` 和 `question_stats.json` 导入 PostgreSQL。题库校验脚本会检查 JSON 与 DB 中的题库 key、题目数量、题目 ID 和答案字段是否一致。

运行时数据已经迁移到 PostgreSQL；`rankings_v2.json` 和 `question_stats.json` 不应再提交到 Git。

### 6. Electron 桌面端（可选）

```bash
# 先启动后端和 web-app 开发服务，再开 Electron
cd electron-app
npm install
npm run dev
```

## 📁 项目结构

```
.
├── server.py                    # FastAPI 后端入口
├── db_storage.py                # PostgreSQL 数据访问层
├── requirements.txt             # Python 依赖
├── start.sh                     # 本地开发启动脚本
├── start_ops.sh                 # 本地 ops 预览脚本
├── README.md                    # 项目说明
│
├── scripts/                    # 安装、构建、迁移和 smoke test 脚本
│   ├── install_deps.sh
│   ├── build_ops.sh
│   ├── run_backend.sh
│   ├── migrate_rankings_to_db.py
│   ├── check_bank_db_consistency.py
│   └── smoke_backend.py
│
├── deploy/                     # 生产部署模板
│   ├── quizcraft-cn.env.example
│   ├── quizcraft-cn.service.example
│   └── nginx.conf.example
│
├── web-app/                    # React 前端
│   ├── src/
│   │   ├── components/         # 组件
│   │   ├── pages/              # 页面
│   │   ├── stores/             # 状态管理 (Zustand)
│   │   ├── api/                # API 客户端
│   │   ├── types/              # TypeScript 类型
│   │   └── utils/              # 工具函数
│   ├── package.json
│   └── vite.config.ts
│
├── electron-app/               # Electron 桌面端壳
│   ├── main.js
│   ├── preload.js
│   └── package.json
│
└── tiku/                       # 版本化题库 JSON
```

## 🎯 使用指南

### 刷题流程

1. **选择题库**：首页选择要练习的题库
2. **选择模式**：
   - 随机模式：随机抽取题目
   - 难题模式：专攻正确率低的题目
   - 章节模式：按章节针对性练习
3. **开始答题**：选择答案，查看解析
4. **查看结果**：统计正确率和用时

### 题库提取流程

1. **上传文件**：支持 PDF、Word、TXT 格式
2. **自动解析**：系统自动提取题目、选项、答案
3. **检查编辑**：核对题目内容，手动修正
4. **生成解析**（可选）：配置 API Key，AI 自动生成解析
5. **导出题库**：下载标准 JSON 格式文件

题库提取、AI 解析、导出和保存属于管理操作，需要在页面中配置管理 Token。对应接口会校验请求头 `X-Admin-Token`：

- `POST /api/extract/parse`
- `POST /api/extract/analyze`
- `POST /api/extract/export`
- `POST /api/banks/save`

普通刷题接口保持公开：

- `GET /api/banks`
- `POST /api/practice/start`
- `POST /api/practice/submit`
- `GET /api/ranking`

## 🔧 配置 AI 解析

在题库提取页面配置：

| 提供商 | API Key | 模型 |
|--------|---------|------|
| OpenAI | sk-... | gpt-3.5-turbo |
| DeepSeek | sk-... | deepseek-chat |
| 自定义 | - | - |

## 📊 题库格式

### 标准格式

```json
{
  "meta": {
    "name": "题库名称",
    "total": 100,
    "created_at": "2024-01-01T00:00:00Z"
  },
  "questions": [
    {
      "id": "q0001",
      "type": "single",      // single | multi | judge
      "chapter": "第一章",
      "chapter_id": "ch01",
      "content": "题目内容",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": 0,           // 单选: 索引, 多选: [0,1], 判断: true/false
      "analysis": "解析内容",
      "stats": {
        "total": 100,
        "correct": 80,
        "rate": 80
      }
    }
  ]
}
```

## 🛠️ 开发计划

- [ ] 用户登录系统
- [ ] 云端数据同步
- [ ] 更强大的 AI 解析
- [ ] 错题导出 PDF
- [ ] 模拟考试模式
- [ ] 学习进度图表

## 📄 License

MIT License
