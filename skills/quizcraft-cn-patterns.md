---
name: quizcraft-cn-patterns
description: Coding patterns from quizcraft-cn (综合刷题) repository
version: 1.0.0
source: local-git-analysis
analyzed_commits: 18
---

# QuizCraft CN Patterns

政治理论刷题系统，支持多题库、多种练习模式、AI解析生成。

## Commit Conventions

混合风格：
- **Conventional Commits** (推荐): `feat:`, `fix:`, `docs:`, `chore:`, `style:`
- **中文描述**: `feat: 添加题目解析显示功能`, `fix: 修复用户名输入框无法输入中文的问题`
- **英文描述**: `Fix user ID flow and ranking display`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| State | Zustand |
| UI | Tailwind + Framer Motion + Lucide icons |
| Backend | FastAPI (Python 3) |
| Desktop | Electron (可选) |
| AI | OpenAI/DeepSeek API |

## Architecture

```
.
├── server.py              # FastAPI 后端 (WebSocket + REST)
├── llm_service.py         # LLM 解析服务
├── start.sh               # 开发启动脚本
├── start_ops.sh           # 生产部署脚本
├── web-app/               # React 前端
│   ├── src/
│   │   ├── pages/         # 页面组件 (Home, Practice, Quiz, Ranking, Extract, Result)
│   │   ├── components/    # 共享组件 (Layout)
│   │   ├── stores/        # Zustand 状态管理
│   │   ├── api/           # API 客户端 (client.ts)
│   │   ├── hooks/         # 自定义 hooks
│   │   ├── types/         # TypeScript 类型定义
│   │   └── utils/         # 工具函数 (format, validators)
│   ├── .env.ops           # ops 部署环境配置
│   └── vite.config.ts     # 多模式构建
├── electron-app/          # Electron 桌面壳
│   ├── main.js
│   └── preload.js
└── tiku/                  # 题库 JSON 数据
```

## Dual Deployment Modes

### Development (`./start.sh`)
- Backend: `http://localhost:10086`
- Frontend: `http://localhost:5173`
- Full feature set

### Ops/Production (`./start_ops.sh`)
- Frontend proxies `/api` → backend
- Simplified UI (only Practice + Ranking)
- Environment vars: `BACKEND_PORT`, `FRONTEND_PORT`

## Workflows

### Adding a New Page

1. Create `web-app/src/pages/NewPage.tsx`
2. Add route in `web-app/src/main.tsx`
3. Update navigation in `web-app/src/components/Layout.tsx`
4. Add API calls in `web-app/src/api/client.ts`
5. Create store if needed in `web-app/src/stores/`

### Adding a New API Endpoint

1. Add endpoint in `server.py` (FastAPI route)
2. Add request/response models using Pydantic
3. Update `web-app/src/api/client.ts` with fetch call
4. Handle errors with user-friendly messages

### Question Bank Processing

1. Upload PDF/Word/TXT via Extract page
2. Auto-parse → preview → manual edit
3. Optional: AI analysis via `llm_service.py`
4. Export as standard JSON to `tiku/`

## Coding Patterns

### Frontend

```typescript
// Zustand store pattern
import { create } from 'zustand';

interface QuizStore {
  questions: Question[];
  currentIndex: number;
  // actions
  nextQuestion: () => void;
  reset: () => void;
}

export const useQuizStore = create<QuizStore>((set) => ({
  questions: [],
  currentIndex: 0,
  nextQuestion: () => set((s) => ({ currentIndex: s.currentIndex + 1 })),
  reset: () => set({ currentIndex: 0 }),
}));
```

### Backend

```python
# FastAPI endpoint pattern
from pydantic import BaseModel

class AnswerRequest(BaseModel):
    question_id: str
    user_answer: int | List[int]

@app.post("/api/answer")
async def submit_answer(req: AnswerRequest):
    # Validate, process, return result
    return {"correct": True, "analysis": "..."}
```

### WebSocket Progress

```python
# Real-time progress updates
await manager.send_progress(
    client_id,
    current=5,
    total=100,
    message="正在处理第 5 题"
)
```

## Key Files (High Change Frequency)

| File | Commits | Purpose |
|------|---------|---------|
| `web-app/src/pages/Practice.tsx` | 5 | 主练习页面 |
| `web-app/src/api/client.ts` | 5 | API 调用层 |
| `server.py` | 4 | 后端核心 |
| `start.sh` / `start_ops.sh` | 3 | 启动脚本 |

## Chinese Input Handling

关键修复：`Practice.tsx` 使用 `onChange` 而非 `onKeyDown` 处理中文输入，避免 composition events 干扰。

## Testing Patterns

暂无自动化测试。推荐添加：
- Backend: pytest + FastAPI TestClient
- Frontend: Vitest + React Testing Library