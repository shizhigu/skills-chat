# Skills Chat - Product Requirements Document (v2)

## Background & Context

### The Problem

当前 AI 聊天产品提供的是通用型对话体验。用户需要自行构造复杂的 prompt 才能获得专业领域的高质量回答。我们要做的是一个 **AI Agent 角色商店**——每个角色就是一个经过精心调教的垂类专家，点进去就直接进入最专业的对话场景，所有的 prompt、skills、MCP 接口都已打包好。

你可以是**财务顾问**、**摄影师**、**插画师**、**法律顾问**、**数据分析师**、**写作者**。选择一个 Persona 进入后，就是在跟这个领域最专业的人对话。

### Why Now

- Claude Agent SDK TypeScript 版已成熟（v0.2.x），完整支持 streaming、tool use、multi-turn session、hooks、subagent、MCP 集成
- MCP 生态爆发：GitHub 上已有数百个专业领域的 MCP server（金融数据、图像处理、法律检索、数据分析等）
- E2B 沙盒可在 200ms 内启动 Firecracker microVM，零冷启动
- React Router v7 (Remix) 提供了 SSR + 全栈一体的最佳 DX

---

## Product Vision

> **Skills Chat** 是一个 AI Agent 角色市场平台。每个角色都是一个开箱即用的垂类 AI 专家——预制好了 system prompt、专业 skills、MCP 工具链和沙盒环境。用户只需选择角色，即刻获得该领域最专业的 AI 助手。

---

## Core Concepts

### 1. Persona（角色）= Agent 商品

一个 Persona 就是一个可售卖的 AI Agent 产品，包含完整的人设 + 能力包：

```typescript
interface Persona {
  slug: string                   // URL 标识: "financial-advisor"
  name: string                   // "财务顾问"
  description: string            // 角色介绍
  systemPrompt: string           // 基础人设 prompt
  defaultSkills: Skill[]         // 默认加载的技能
  availableSkills: Skill[]       // 可选加载的技能
  mcpServers: McpServerConfig[]  // 预配置的 MCP 服务
  toolPermissions: string[]      // 允许的工具列表
  sandboxConfig: SandboxConfig   // 沙盒配置
  defaultModel: string           // 默认模型
}
```

### 2. Skill（技能）= 可插拔能力模块

```typescript
interface Skill {
  slug: string                   // "financial-report-analysis"
  name: string                   // "财报分析"
  prompt: string                 // 注入到 system message 的专业 prompt
  requiredTools: string[]        // 该技能需要的工具
  category: SkillCategory        // 分类
}
```

### 3. MCP Server = 外部工具链

每个 Persona 预配置了该领域需要的 MCP servers，提供专业数据源和工具能力。

### 4. Sandbox = 安全执行环境

E2B Firecracker microVM，支持代码执行、文件生成、依赖安装。

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 Frontend (React Router v7 / Remix)               │
│                 Layout: shadcn-admin pattern                     │
│  ┌────────────┐ ┌───────────────────────┐ ┌──────────────────┐  │
│  │  Sidebar    │ │     Main Content      │ │  Right Panel     │  │
│  │            │ │                       │ │                  │  │
│  │ - Sessions │ │  - Persona Grid (/)   │ │ - Active Skills  │  │
│  │ - Personas │ │  - Chat (/chat/:id)   │ │ - Sandbox Files  │  │
│  │ - Settings │ │  - Settings           │ │ - MCP Status     │  │
│  └────────────┘ └───────────────────────┘ └──────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ SSE (streaming) + Fetch (REST)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Backend (React Router v7 server / Node.js 20+)      │
│                                                                  │
│  Route Loaders & Actions                                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                Claude Agent SDK (TypeScript)              │   │
│  │                                                          │   │
│  │  query({                                                 │   │
│  │    prompt: userMessage | streamInput,                    │   │
│  │    options: {                                            │   │
│  │      model: persona.defaultModel,                       │   │
│  │      systemPrompt: assembledPrompt,                     │   │
│  │      resume: sessionId,         // 会话恢复             │   │
│  │      allowedTools: [...],       // 按 Persona 控制      │   │
│  │      mcpServers: {...},         // 按 Persona 注入      │   │
│  │      agents: {...},             // 自定义 subagent      │   │
│  │      hooks: {...},              // 生命周期钩子          │   │
│  │      includePartialMessages: true, // 流式              │   │
│  │      maxTurns: 30,                                      │   │
│  │      maxBudgetUsd: 5.0,                                 │   │
│  │      permissionMode: 'bypassPermissions',               │   │
│  │    }                                                    │   │
│  │  })                                                     │   │
│  └──────────────┬──────────────────────────────────────────┘   │
│                 │                                               │
│  ┌──────────────▼──────────────────────────────────────────┐   │
│  │  Neon PostgreSQL (via Drizzle ORM)                       │   │
│  │  - Users, Sessions, Messages, MessageParts               │   │
│  │  - Personas, Skills, MCP configs                         │   │
│  │  - Usage tracking & billing                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Sandbox Manager (E2B)                                    │   │
│  │  - 按需创建/销毁 Firecracker microVM                      │   │
│  │  - 文件上传/下载                                           │   │
│  │  - 代码执行 (Python/Node.js/Shell)                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend

| 层次 | 技术选型 | 理由 |
|------|---------|------|
| 框架 | **React Router v7 (Remix)** | 全栈一体、loader/action 模式、SSR + streaming |
| 构建 | **Vite** | 极快 HMR，React Router v7 默认构建工具 |
| UI 库 | **shadcn/ui + Tailwind CSS 4** | 参考 shadcn-admin 布局方案 |
| 状态管理 | **Zustand** | 轻量、简洁 |
| Markdown | **react-markdown + rehype + Shiki** | Markdown 渲染 + 代码高亮 |
| 表单 | **React Hook Form + Zod** | 类型安全的表单验证 |
| 图标 | **Lucide React** | 与 shadcn/ui 一致 |
| 实时通信 | **SSE (Server-Sent Events)** | 单向流式输出，Agent SDK 天然支持 |

### Backend

| 层次 | 技术选型 | 理由 |
|------|---------|------|
| Runtime | **Node.js 20+** | Agent SDK TS 原生支持 |
| Agent 核心 | **@anthropic-ai/claude-agent-sdk** | 完整的 agent 能力（非裸 API） |
| API 层 | **React Router v7 Route Handlers** | loader + action 全栈路由 |
| 数据库 | **Neon (Serverless PostgreSQL)** | 自动扩缩、分支、连接池 |
| ORM | **Drizzle ORM** | 零冷启动、原生 Neon 驱动、SQL-like API |
| 文件存储 | **Cloudflare R2** | S3 兼容、免出站费 |
| 认证 | **Clerk** | 与 shadcn-admin 一致，开箱即用 |
| 沙盒 | **E2B (Firecracker microVM)** | 200ms 启动、全语言支持 |

### Infrastructure

| 层次 | 技术选型 | 理由 |
|------|---------|------|
| 部署 | **Vercel / Railway** | React Router v7 一键部署 |
| 数据库 | **Neon** | Serverless PG、分支、自动扩缩 |
| 监控 | **Sentry** | 错误追踪 |

---

## Layout Design（参考 shadcn-admin）

### 整体布局结构

参考 shadcn-admin 的三区布局模式：

```
┌─────────────────────────────────────────────────────────────────┐
│ SidebarProvider (collapsible: 'icon' | 'offcanvas')             │
│ ┌────────────┐ ┌──────────────────────────────────────────────┐ │
│ │  Sidebar   │ │ ┌─────────────────────────────────────────┐ │ │
│ │  (16rem /  │ │ │ Header (sticky, scroll shadow)          │ │ │
│ │   3rem     │ │ │ [SidebarTrigger] [Search] [Theme] [User]│ │ │
│ │  collapsed)│ │ └─────────────────────────────────────────┘ │ │
│ │            │ │                                              │ │
│ │ ┌────────┐ │ │ ┌─────────────────────────────────────────┐ │ │
│ │ │TeamSwi-│ │ │ │ Main (@container/content)               │ │ │
│ │ │tcher   │ │ │ │                                         │ │ │
│ │ └────────┘ │ │ │  Route Content Here                     │ │ │
│ │            │ │ │  (Persona Grid / Chat / Settings)        │ │ │
│ │ NavGroup:  │ │ │                                         │ │ │
│ │ ┌────────┐ │ │ └─────────────────────────────────────────┘ │ │
│ │ │Personas│ │ │                                              │ │
│ │ │Sessions│ │ └──────────────────────────────────────────────┘ │
│ │ │Skills  │ │                                                  │
│ │ │Settings│ │                                                  │
│ │ └────────┘ │                                                  │
│ │            │                                                  │
│ │ ┌────────┐ │                                                  │
│ │ │NavUser │ │                                                  │
│ │ │(底部)  │ │                                                  │
│ │ └────────┘ │                                                  │
│ └────────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Route Structure (React Router v7)

```
app/
├── root.tsx                          // Root layout + providers
├── routes/
│   ├── _auth.tsx                     // Auth layout (sign-in, sign-up)
│   ├── _auth.sign-in.tsx
│   ├── _auth.sign-up.tsx
│   │
│   ├── _app.tsx                      // Authenticated layout (sidebar + header)
│   ├── _app._index.tsx               // Home: Persona Grid
│   ├── _app.chat.$sessionId.tsx      // Chat page
│   ├── _app.personas.tsx             // All personas listing
│   ├── _app.personas.$slug.tsx       // Persona detail
│   ├── _app.skills.tsx               // Skill market
│   ├── _app.settings.tsx             // Settings layout
│   ├── _app.settings.account.tsx
│   ├── _app.settings.appearance.tsx
│   ├── _app.settings.api-keys.tsx
│   └── _app.settings.usage.tsx
│
├── components/
│   ├── layout/
│   │   ├── app-sidebar.tsx           // 主侧边栏
│   │   ├── nav-group.tsx             // 导航分组
│   │   ├── nav-user.tsx              // 用户信息
│   │   ├── header.tsx                // 顶部栏
│   │   └── main.tsx                  // 内容容器
│   ├── chat/
│   │   ├── chat-messages.tsx         // 消息列表
│   │   ├── chat-input.tsx            // 输入框
│   │   ├── chat-message.tsx          // 单条消息
│   │   ├── tool-call-display.tsx     // 工具调用展示
│   │   └── streaming-indicator.tsx   // 流式状态
│   ├── persona/
│   │   ├── persona-card.tsx          // Persona 卡片
│   │   └── persona-grid.tsx          // 卡片网格
│   └── ui/                           // shadcn/ui components
│       ├── sidebar.tsx               // shadcn-admin sidebar
│       └── ...
│
├── lib/
│   ├── agent/
│   │   ├── agent-service.ts          // Agent SDK 封装
│   │   ├── prompt-assembler.ts       // System prompt 组装
│   │   ├── mcp-registry.ts           // MCP server 注册
│   │   └── sandbox-manager.ts        // E2B 沙盒管理
│   └── db/
│       ├── schema.ts                 // Drizzle schema
│       ├── index.ts                  // DB client
│       └── queries.ts                // 常用查询
│
└── styles/
    └── globals.css                   // Tailwind + theme
```

### Chat Page 布局（核心页面）

```
┌──────────────────────────────────────────────────────────────┐
│ Sidebar │ Header: [Persona Avatar + Name] [Skills: 4] [⚙]  │
│         ├────────────────────────────┬───────────────────────┤
│ Sessions│                            │ Right Panel           │
│         │  Chat Messages (scroll)    │                       │
│ Today   │                            │ Active Skills         │
│ · 财报  │  ┌──────────────────────┐  │ ┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅     │
│   分析  │  │ AI: 我来帮你分析这份  │  │ ✅ 财报分析           │
│ · 税务  │  │ 财务报表...          │  │ ✅ 税务规划           │
│   咨询  │  └──────────────────────┘  │ ☐ 投资组合分析        │
│         │                            │ ☐ 风险评估            │
│ Older   │  ┌──────────────────────┐  │                       │
│ · ...   │  │ User: 请分析附件中的  │  │ MCP Servers           │
│         │  │ Q3 财报数据          │  │ ┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅     │
│         │  └──────────────────────┘  │ ● Yahoo Finance       │
│         │                            │ ● Calc Tools          │
│         │  ┌──────────────────────┐  │                       │
│         │  │ AI: [streaming ▌]    │  │ Sandbox Files         │
│         │  └──────────────────────┘  │ ┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅     │
│         │                            │ 📄 analysis.md        │
│         │  ┌───────────────────┐     │ 📊 charts.png         │
│         │  │ Message input [📎]│     │ [Download All]        │
│         │  └───────────────────┘     │                       │
└─────────┴────────────────────────────┴───────────────────────┘
```

---

## Preset Personas（垂类 Agent 商品）

### 1. 财务顾问 (Financial Advisor)

```yaml
slug: financial-advisor
name: 财务顾问
description: 专业的财务分析、税务规划、投资建议助手
systemPrompt: |
  你是一位拥有 CFA/CPA 资质的资深财务顾问。你精通财务报表分析、
  税务规划、投资组合管理、公司估值和风险评估。你的回答应该：
  - 基于数据和财务模型，而非泛泛之谈
  - 明确区分事实陈述和个人建议
  - 引用相关法规和会计准则
  - 提供量化分析和具体计算过程
  - 在涉及重大决策时提醒用户寻求持牌专业人士意见

toolPermissions:
  - Read, Write, Bash, WebSearch, WebFetch, Glob, Grep, NotebookEdit
  - mcp__yahoo-finance__*
  - mcp__calculator__*
  - mcp__sequential-thinking__*

sandboxConfig:
  enabled: true
  provider: e2b
  template: base  # Python + pandas/numpy/matplotlib 预装

defaultSkills:
  - financial-report-analysis   # 财报分析
  - tax-planning                # 税务规划
  - investment-portfolio        # 投资组合分析
  - financial-modeling          # 财务建模

availableSkills:
  - risk-assessment             # 风险评估
  - valuation                   # 公司估值
  - budgeting                   # 预算编制
  - audit-preparation           # 审计准备

mcpServers:
  financial-datasets:
    # https://github.com/financial-datasets/mcp-server
    command: npx
    args: ["-y", "@financial-datasets/mcp-server"]
    env: { FINANCIAL_DATASETS_API_KEY: "${FINANCIAL_DATASETS_API_KEY}" }
    # 股票价格、财务报表、市场新闻
  financial-planner:
    # https://github.com/scripbox/financial-planner-mcp
    command: npx
    args: ["-y", "@scripbox/financial-planner-mcp"]
    # SIP 计算、投资规划、目标达成策略
  sequential-thinking:
    # https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking
    command: npx
    args: ["-y", "@modelcontextprotocol/server-sequentialthinking"]
    # 复杂问题分步推理
```

**核心 Skills 详情：**

| Skill | Prompt 摘要 | 依赖工具 |
|-------|------------|---------|
| 财报分析 | 分析三张报表（利润表、资产负债表、现金流量表），计算关键比率（ROE/ROA/流动比率/负债率），识别趋势和异常 | Bash(Python), Read, WebSearch |
| 税务规划 | 根据收入结构和资产状况，提供合法节税方案。了解中国/美国税法体系。区分税务筹划和避税 | WebSearch, Write |
| 投资组合 | 分析资产配置比例，计算夏普比率和最大回撤，提供再平衡建议 | Bash(Python), mcp__financial-datasets__ |
| 财务建模 | 构建 DCF、LBO、三张报表联动模型。输出 Python/Excel 可执行模型 | Bash(Python), Write |

---

### 2. 摄影师 (Photographer)

```yaml
slug: photographer
name: 摄影师
description: 专业的摄影技术顾问、后期处理、作品点评助手
systemPrompt: |
  你是一位拥有 20 年经验的专业摄影师，精通风光、人像、商业摄影。
  你擅长：
  - 分析构图、光线、色彩搭配
  - 提供相机参数设定建议（光圈/快门/ISO/白平衡）
  - 后期处理指导（Lightroom/Photoshop 工作流）
  - 作品点评和改进建议
  - 设备选购和镜头推荐
  当用户上传照片时，你会从构图、曝光、色彩、主题表达四个维度进行分析。

toolPermissions:
  - Read, Write, WebSearch, WebFetch
  - mcp__sharp-image__*
  - mcp__exif-reader__*

sandboxConfig:
  enabled: true
  provider: e2b

defaultSkills:
  - photo-critique              # 作品点评
  - camera-settings             # 相机参数
  - post-processing             # 后期处理指导
  - composition-analysis        # 构图分析

availableSkills:
  - gear-recommendation         # 器材推荐
  - lighting-setup              # 布光方案
  - portfolio-review            # 作品集评审
  - photography-business        # 摄影商业化

mcpServers:
  sharp-image:
    # https://github.com/greatSumini/sharp-mcp
    command: npx
    args: ["-y", "sharp-mcp"]
    # 图片处理：裁剪、调色、水印、格式转换
  exif-reader:
    # https://github.com/stass/exif-mcp
    command: npx
    args: ["-y", "exif-mcp"]
    # EXIF 信息读取：相机型号、参数、GPS
  unsplash:
    # https://github.com/drumnation/unsplash-smart-mcp-server
    command: npx
    args: ["-y", "unsplash-smart-mcp-server"]
    env: { UNSPLASH_ACCESS_KEY: "${UNSPLASH_ACCESS_KEY}" }
    # 高质量参考图搜索
```

---

### 3. 插画师 (Illustrator)

```yaml
slug: illustrator
name: 插画师
description: 专业的插画创作、风格指导、AI 绘图提示词助手
systemPrompt: |
  你是一位资深插画师和视觉艺术指导。你精通：
  - 多种插画风格（扁平化、水彩、日系、美漫、像素风）
  - SVG / CSS / Canvas 可编程图形创作
  - AI 绘图工具的 prompt 编写（Midjourney/DALL-E/Stable Diffusion）
  - 配色理论和色彩心理学
  - 品牌视觉设计和 IP 形象设计
  当用户描述需求时，你会先确认风格方向，然后提供详细的视觉方案。

toolPermissions:
  - Read, Write, Bash, WebSearch, WebFetch
  - mcp__sharp-image__*
  - mcp__svgmaker__*
  - mcp__color-scheme__*

sandboxConfig:
  enabled: true
  provider: e2b

defaultSkills:
  - svg-illustration            # SVG 插画创作
  - ai-prompt-crafting          # AI 绘图提示词
  - color-palette               # 配色方案
  - style-guide                 # 风格指南

availableSkills:
  - brand-illustration          # 品牌插画
  - icon-design                 # 图标设计
  - character-design            # 角色设计
  - animation-concepts          # 动效概念

mcpServers:
  sharp-image:
    # https://github.com/greatSumini/sharp-mcp
    command: npx
    args: ["-y", "sharp-mcp"]
  svgmaker:
    # https://github.com/GenWaveLLC/svgmaker-mcp
    command: npx
    args: ["-y", "svgmaker-mcp"]
    # AI 驱动的 SVG 生成和编辑
  color-scheme:
    # https://github.com/deepakkumardewani/color-scheme-mcp
    command: npx
    args: ["-y", "color-scheme-mcp"]
    # 配色方案生成（互补、类似、三角等）
  color-convert:
    # https://github.com/bennyzen/mcp-color-convert
    command: npx
    args: ["-y", "mcp-color-convert"]
    # 颜色转换、分析、无障碍检查
```

---

### 4. 数据分析师 (Data Analyst)

```yaml
slug: data-analyst
name: 数据分析师
description: 专业的数据分析、可视化、SQL 查询、统计建模助手
systemPrompt: |
  你是一位资深数据分析师。你精通：
  - Python 数据分析全栈（pandas, numpy, scipy, matplotlib, seaborn, plotly）
  - SQL 查询优化和数据库设计
  - 统计分析和假设检验
  - 数据可视化和仪表板设计
  - 数据清洗和 ETL 流程
  你的工作方式是：先理解业务问题，再选择合适的分析方法，最后用数据讲故事。
  所有代码应可直接运行，并附带详细注释。

toolPermissions:
  - Read, Write, Bash, Glob, Grep, WebSearch, WebFetch, NotebookEdit
  - mcp__postgres__*
  - mcp__sequential-thinking__*

sandboxConfig:
  enabled: true
  provider: e2b
  template: data-analysis  # pandas/numpy/matplotlib/seaborn/plotly/jupyter 预装
  maxMemoryMb: 2048

defaultSkills:
  - python-data-analysis        # Python 数据分析
  - sql-query                   # SQL 查询
  - data-visualization          # 数据可视化
  - statistical-analysis        # 统计分析

availableSkills:
  - ml-modeling                 # 机器学习建模
  - ab-testing                  # A/B 测试
  - data-cleaning               # 数据清洗
  - dashboard-design            # 仪表板设计

mcpServers:
  dbhub:
    # https://github.com/bytebase/dbhub - 多数据库支持
    command: npx
    args: ["-y", "@bytebase/dbhub", "--transport", "stdio"]
    env: { DATABASE_URL: "${USER_DB_URL}" }
    # 零依赖多数据库 MCP (Postgres, MySQL, SQLite, SQL Server)
  echarts:
    # https://github.com/hustcc/mcp-echarts
    command: npx
    args: ["-y", "mcp-echarts"]
    # 交互式数据可视化 (bar, line, pie, scatter, funnel 等)
  excel:
    # https://github.com/yzfly/mcp-excel-server
    command: npx
    args: ["-y", "mcp-excel-server"]
    # Excel 文件读写和分析
  sequential-thinking:
    # https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking
    command: npx
    args: ["-y", "@modelcontextprotocol/server-sequentialthinking"]
```

---

### 5. 法律顾问 (Legal Advisor)

```yaml
slug: legal-advisor
name: 法律顾问
description: 专业的法律咨询、合同审查、法规检索助手
systemPrompt: |
  你是一位执业律师，拥有丰富的法律实务经验。你擅长：
  - 合同审查和起草（劳动合同、商业合同、股权协议）
  - 公司法务（设立、变更、合规）
  - 知识产权保护（商标、专利、著作权）
  - 劳动法和雇佣关系
  - 法律文书写作
  重要声明：你的回答仅供参考，不构成正式法律意见。涉及重大法律决策时，
  你会建议用户咨询持牌律师。你会明确标注所引用的法律法规。

toolPermissions:
  - Read, Write, WebSearch, WebFetch, Glob
  - mcp__court-listener__*
  - mcp__legal-mcp__*
  - mcp__sequential-thinking__*

sandboxConfig:
  enabled: false  # 法律咨询通常不需要代码执行

defaultSkills:
  - contract-review             # 合同审查
  - legal-research              # 法律检索
  - legal-writing               # 法律文书写作
  - compliance-check            # 合规检查

availableSkills:
  - ip-protection               # 知识产权保护
  - labor-law                   # 劳动法咨询
  - corporate-governance        # 公司治理
  - dispute-resolution          # 纠纷解决

mcpServers:
  court-listener:
    # https://github.com/Travis-Prall/court-listener-mcp
    command: npx
    args: ["-y", "court-listener-mcp"]
    env: { COURTLISTENER_API_KEY: "${COURTLISTENER_API_KEY}" }
    # 美国 3,352 法院判例检索 + 联邦法规 (eCFR)
  legal-mcp:
    # https://github.com/agentic-ops/legal-mcp
    command: npx
    args: ["-y", "@agentic-ops/legal-mcp"]
    # 法律文档分析、案件管理、引用管理
  cerebra-legal:
    # https://github.com/yoda-digital/mcp-cerebra-legal-server
    command: npx
    args: ["-y", "mcp-cerebra-legal-server"]
    # 企业级法律推理（消费者保护、合同分析）
  sequential-thinking:
    # https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking
    command: npx
    args: ["-y", "@modelcontextprotocol/server-sequentialthinking"]
```

---

### 6. 写作者 (Writer)

```yaml
slug: writer
name: 写作者
description: 专业的内容创作、文案撰写、编辑润色助手
systemPrompt: |
  你是一位资深内容创作者和编辑。你精通：
  - 多种文体写作（博客、营销文案、技术文档、小说、学术论文）
  - SEO 优化写作
  - 内容策略和选题规划
  - 文本编辑和润色（语法、风格、结构）
  - 多语言翻译和本地化
  你的写作风格灵活多变，能根据目标受众和平台调整语调。
  你注重结构清晰、论点有力、语言精准。

toolPermissions:
  - Read, Write, WebSearch, WebFetch, Glob
  - mcp__memory__*

sandboxConfig:
  enabled: true
  provider: e2b

defaultSkills:
  - content-writing             # 内容写作
  - copywriting                 # 文案撰写
  - editing-proofreading        # 编辑润色
  - seo-writing                 # SEO 写作

availableSkills:
  - academic-writing            # 学术写作
  - creative-writing            # 创意写作
  - translation                 # 翻译
  - content-strategy            # 内容策略

mcpServers:
  memory:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-memory"]
    # 持久记忆：记住用户的写作偏好、品牌语调、常用术语
```

---

### Persona 总览

| # | Persona | 核心场景 | 沙盒 | MCP Servers | 默认 Skills |
|---|---------|---------|------|------------|------------|
| 1 | 财务顾问 | 财报分析、税务规划、投资建议 | Yes | Yahoo Finance, Calculator, Sequential Thinking | 4 |
| 2 | 摄影师 | 作品点评、参数建议、后期指导 | Yes | Sharp Image, EXIF Reader | 4 |
| 3 | 插画师 | SVG 创作、AI 提示词、配色 | Yes | Sharp Image | 4 |
| 4 | 数据分析师 | Python 分析、SQL、可视化 | Yes (2GB) | PostgreSQL, Sequential Thinking | 4 |
| 5 | 法律顾问 | 合同审查、法规检索、文书 | No | CourtListener, Legal MCP, Sequential Thinking | 4 |
| 6 | 写作者 | 内容创作、文案、编辑润色 | Yes | Memory (持久记忆) | 4 |

---

## Claude Agent SDK Integration（完整能力利用）

### 核心 API: `query()`

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// 返回 AsyncGenerator<SDKMessage> + 控制方法
const response = query({
  prompt: userMessage,        // 或 AsyncIterable<SDKUserMessage> 用于流式输入
  options: {
    // ── 模型配置 ──
    model: 'claude-sonnet-4-5-20250929',
    maxThinkingTokens: 10000,
    betas: ['context-1m-2025-08-07'],  // 1M 上下文

    // ── System Prompt ──
    systemPrompt: assembledSystemPrompt,  // 组装后的完整 prompt

    // ── 会话管理 ──
    resume: sessionId,          // 恢复已有会话
    forkSession: false,         // 是否 fork 而不是继续
    persistSession: true,       // 持久化会话状态

    // ── 工具控制 ──
    allowedTools: persona.toolPermissions,
    disallowedTools: ['Task'],  // 禁用某些工具

    // ── MCP 服务器 ──
    mcpServers: buildMcpServers(persona),

    // ── 自定义 Subagent ──
    agents: {
      'data-validator': {
        description: '验证数据质量和完整性',
        prompt: '你是数据质量检查专家...',
        tools: ['Read', 'Bash', 'Glob'],
        model: 'haiku',
      },
    },

    // ── 权限模式 ──
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,

    // ── 流式输出 ──
    includePartialMessages: true,  // 启用 token-by-token 流式

    // ── 限制 ──
    maxTurns: 30,
    maxBudgetUsd: 5.0,

    // ── 环境 ──
    cwd: '/tmp/sandbox-workspace',
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ...persona.mcpEnvVars,
    },

    // ── 生命周期钩子 ──
    hooks: {
      PreToolUse: [{
        matcher: 'Bash|Write|Edit',
        hooks: [async (input, toolUseID) => {
          // 记录工具调用到数据库
          await logToolCall(sessionId, input.tool_name, input.tool_input);
          return { continue: true };
        }],
      }],
      PostToolUse: [{
        hooks: [async (input) => {
          // 工具执行完成后更新状态
          await updateToolCallStatus(input.tool_use_id, 'complete');
          return { continue: true };
        }],
      }],
      SessionStart: [{
        hooks: [async () => {
          await createSandboxIfNeeded(persona.sandboxConfig);
          return { continue: true };
        }],
      }],
    },

    // ── 结构化输出 ──
    outputFormat: needsStructured ? {
      type: 'json_schema',
      schema: persona.outputSchema,
    } : undefined,

    // ── 沙盒设置 ──
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
    },

    // ── 隔离模式 ──
    settingSources: [],  // 不读取文件系统配置
  },
});
```

### 消息流处理

```typescript
async function handleAgentStream(
  response: Query,
  sessionId: string,
  onChunk: (data: StreamChunk) => void
) {
  let agentSessionId: string | undefined;

  for await (const message of response) {
    switch (message.type) {
      // ── 初始化 ──
      case 'system':
        if (message.subtype === 'init') {
          agentSessionId = message.session_id;
          // 存储 session_id 用于后续恢复
          await db.update(sessions)
            .set({ agentSessionId })
            .where(eq(sessions.id, sessionId));

          // 检查 MCP 服务器状态
          for (const server of message.mcp_servers) {
            if (server.status === 'failed') {
              onChunk({ type: 'mcp_error', server: server.name });
            }
          }
        }
        break;

      // ── 流式 token ──
      case 'assistant':
        if (message.subtype === 'partial') {
          // 逐 token 推送到前端
          for (const block of message.content) {
            if (block.type === 'text') {
              onChunk({ type: 'text_delta', text: block.text });
            } else if (block.type === 'tool_use') {
              onChunk({
                type: 'tool_call',
                toolName: block.name,
                toolInput: block.input,
                toolCallId: block.id,
              });
            }
          }
        }
        break;

      // ── 完整的 assistant 消息 ──
      case 'assistant':
        // 完整消息 -> 保存到数据库
        await saveAssistantMessage(sessionId, message);
        break;

      // ── 最终结果 ──
      case 'result':
        if (message.subtype === 'success') {
          onChunk({
            type: 'done',
            totalCost: message.total_cost_usd,
            usage: message.usage,
            turns: message.num_turns,
          });
        } else {
          onChunk({
            type: 'error',
            subtype: message.subtype,
            errors: message.errors,
          });
        }
        break;

      // ── 工具执行进度 ──
      case 'tool_progress':
        onChunk({ type: 'tool_progress', data: message });
        break;
    }
  }
}
```

### System Prompt 组装

```typescript
function assembleSystemPrompt(
  persona: Persona,
  activeSkills: Skill[]
): string {
  const sections: string[] = [];

  // 1. 角色基础人设
  sections.push(`# 角色定义\n\n${persona.systemPrompt}`);

  // 2. 激活的技能 prompts
  for (const skill of activeSkills) {
    sections.push(`# Skill: ${skill.name}\n\n${skill.prompt}`);
  }

  // 3. MCP 工具说明
  if (persona.mcpServers.length > 0) {
    const toolGuide = persona.mcpServers
      .map(s => `- mcp__${s.name}__*: ${s.description}`)
      .join('\n');
    sections.push(`# 可用外部工具\n\n${toolGuide}`);
  }

  // 4. 输出规范
  sections.push(`# 输出规范\n
- 使用用户的语言回复
- 结构化输出使用 Markdown
- 代码块标注语言类型
- 涉及计算时展示完整过程`);

  return sections.join('\n\n---\n\n');
}
```

### MCP Server 动态注入

```typescript
function buildMcpServers(
  persona: Persona
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};

  for (const config of persona.mcpServers) {
    if (!config.isEnabled) continue;

    if (config.transport === 'stdio') {
      servers[config.name] = {
        command: config.command!,
        args: config.args as string[],
        env: resolveEnvVars(config.envVars),
      };
    } else if (config.transport === 'sse') {
      servers[config.name] = {
        type: 'sse',
        url: config.url!,
        headers: config.headers as Record<string, string>,
      };
    }
  }

  return servers;
}

// 也可以用 SDK 内建的 MCP 工具
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// 自定义内联 MCP 工具（无需外部进程）
const calculatorServer = createSdkMcpServer({
  name: 'calculator',
  tools: [
    tool(
      'compound_interest',
      '计算复利',
      { principal: z.number(), rate: z.number(), years: z.number() },
      async ({ principal, rate, years }) => {
        const result = principal * Math.pow(1 + rate / 100, years);
        return { content: [{ type: 'text', text: `结果: ${result.toFixed(2)}` }] };
      }
    ),
  ],
});
```

### SSE Streaming Route Handler

```typescript
// app/routes/api.chat.stream.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ActionFunctionArgs } from 'react-router';

export async function action({ request }: ActionFunctionArgs) {
  const { sessionId, message, personaSlug } = await request.json();

  // 1. 加载 Persona + Skills
  const persona = await getPersonaBySlug(personaSlug);
  const skills = await getActiveSkills(sessionId);
  const systemPrompt = assembleSystemPrompt(persona, skills);

  // 2. 获取 Agent session ID（如果是恢复会话）
  const session = await getSession(sessionId);
  const agentSessionId = session?.agentSessionId;

  // 3. 创建 SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const response = query({
        prompt: message,
        options: {
          model: persona.defaultModel,
          systemPrompt,
          resume: agentSessionId,
          allowedTools: persona.toolPermissions,
          mcpServers: buildMcpServers(persona),
          includePartialMessages: true,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns: 30,
          maxBudgetUsd: 5.0,
          settingSources: [],
          hooks: buildHooks(sessionId),
        },
      });

      await handleAgentStream(response, sessionId, (chunk) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
        );
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### Query 控制方法（运行时动态调整）

```typescript
// Agent SDK Query 对象提供的运行时控制
const response = query({ prompt, options });

// 中断当前执行
await response.interrupt();

// 运行时切换模型
await response.setModel('claude-opus-4-6');

// 调整 thinking tokens
await response.setMaxThinkingTokens(20000);

// 动态增减 MCP 服务器
await response.setMcpServers({
  'new-server': { command: 'npx', args: ['-y', 'new-mcp'] }
});

// 查询 MCP 服务器状态
const status = await response.mcpServerStatus();

// 获取支持的模型列表
const models = await response.supportedModels();

// 文件检查点（回滚文件变更）
await response.rewindFiles('message-uuid', { dryRun: false });
```

---

## Database Design (Neon + Drizzle ORM)

> 完整的 Schema 定义见 `drizzle-schema.ts`，SQL 版本见 `DATABASE_SCHEMA.sql`，设计文档见 `DATABASE_DESIGN.md`

### ER Diagram

```
users ──1:N──> sessions ──1:N──> messages ──1:N──> message_parts
  │                │                                     │
  │                ├── persona (M:1)                      ├── text/reasoning
  │                ├── session_skills (M:N)               ├── tool_call (JSONB)
  │                ├── sandboxes (1:N)                    ├── tool_result (JSONB)
  │                └── files (1:N)                        └── file references
  │
  ├──1:N──> usage_daily (日度聚合)
  └──1:N──> usage_events (事件明细)

personas ──M:N──> skills         (via persona_skills)
personas ──1:N──> mcp_server_configs
```

### 核心表（14 张）

| 表名 | 用途 | 行增长 |
|------|------|--------|
| `users` | 用户账户、认证、偏好 | 慢 |
| `personas` | AI 角色定义（system prompt、模型配置、沙盒配置） | 静态 |
| `skills` | 技能定义（prompt、工具需求） | 慢 |
| `persona_skills` | Persona-Skill 映射（default/optional） | 静态 |
| `sessions` | 会话（关联用户+Persona，含 system_prompt 快照） | 中 |
| `messages` | 消息（role、status、ordinal 排序、token 用量） | 快 |
| `message_parts` | 消息内容分片（text/tool_call/tool_result/file） | 快 |
| `session_skills` | 会话中激活的技能 | 中 |
| `sandboxes` | 沙盒生命周期（创建/运行/销毁） | 中 |
| `files` | 生成的文件/产物 | 中 |
| `mcp_server_configs` | 每个 Persona 的 MCP 服务器配置 | 静态 |
| `usage_daily` | 日度用量聚合（token/成本） | 慢 |
| `usage_events` | 事件级用量明细 | 快 |
| `user_api_keys` | 用户自定义 API Key | 慢 |

### 关键设计决策

1. **Message Parts 模式**（而非 JSONB blob）
   - 每条 message 包含多个有序 parts：text -> tool_call -> tool_result -> text
   - 流式写入时可增量 append，无需重写整个 JSONB
   - 查询性能比 JSONB 高 2000x（PostgreSQL 缺乏 JSONB 统计信息）

2. **Session 快照 System Prompt**
   - `system_prompt_snapshot` 存储在 session 上，Persona 修改不影响历史会话

3. **整数 Ordinal 排序**（而非 timestamp）
   - 确定性排序，支持消息插入（编辑/重新生成）

4. **去范式化 Session 统计**
   - `message_count`、`total_tokens`、`last_message_at` 直接存 session 表
   - 通过 trigger 更新，避免聚合查询

5. **ORM 选型：Drizzle > Prisma**
   - 零冷启动（7.4KB vs Prisma 2MB engine）
   - 原生 Neon HTTP 驱动
   - Edge Runtime 兼容
   - SQL-like API 精确控制查询

### Neon 配置

```env
# 连接池（应用查询用）
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/skillschat?sslmode=require

# 直连（DDL 迁移用）
DATABASE_URL_DIRECT=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech:5432/skillschat?sslmode=require
```

```typescript
// 两种 driver 按场景选用
// HTTP driver（大多数路由：单查询、最低延迟）
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });

// WebSocket driver（流式场景：多查询、需要事务）
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const dbPool = drizzle(pool, { schema });
```

### 流式消息写入流程

```
message 状态机: pending → streaming → complete | error | cancelled

1. 创建 message (status: 'streaming', ordinal: next)
2. 创建空 text part (content: '')
3. 流式过程中: UPDATE content = content || $chunk
4. 完成后: UPDATE status = 'complete', token 用量, 耗时
5. Session trigger: 自动更新 message_count, total_tokens, last_message_at
```

---

## Feature Specification

### P0 - MVP

| Feature | 描述 |
|---------|------|
| **Persona 选择** | 首页 Persona 卡片网格，点击进入对话 |
| **Chat 核心** | 流式对话、Markdown 渲染、代码高亮、消息操作 |
| **Skill 管理** | 侧边栏显示/切换 Skills，实时注入 prompt |
| **MCP 集成** | 按 Persona 自动加载 MCP servers |
| **沙盒执行** | E2B 代码执行 + 文件预览/下载 |
| **会话管理** | 会话列表、恢复、Agent SDK session resume |
| **用户认证** | Clerk 登录/注册 |

### P1 - Enhanced

| Feature | 描述 |
|---------|------|
| **Skill 市场** | 浏览/搜索所有可用 Skills |
| **Persona 自定义** | 基于已有 Persona 创建变体 |
| **文件管理** | 会话产物集中管理、导出 |
| **用量仪表板** | Token 用量、成本追踪 |

### P2 - Growth

| Feature | 描述 |
|---------|------|
| **Persona 商店** | 付费 Persona、创作者分成 |
| **协作分享** | 会话链接分享 |
| **Workflow** | 多 Skill 串联自动化 |

---

## Success Metrics

| 指标 | 目标 (MVP + 3m) |
|------|--------|
| **North Star: Weekly Active Sessions with Skill Usage** | 1,000+ |
| DAU | 500+ |
| Avg Session Duration | > 10 min |
| Persona Diversity (使用 2+ 不同 Persona 的用户占比) | > 40% |
| MCP Tool Call Rate (使用 MCP 工具的会话占比) | > 25% |
| Sandbox Usage Rate | > 30% |
| D7 Retention | > 40% |

---

## Milestones

### Phase 1 - MVP（6 weeks）

| Week | 目标 |
|------|------|
| W1-2 | React Router v7 项目搭建 + shadcn-admin 布局 + Neon DB + Drizzle schema + Agent SDK 基础集成 + SSE streaming |
| W3 | Persona 系统 + 6 个预制 Persona + System Prompt 组装 + MCP 注入 |
| W4 | Skill 系统 + 24 个核心 Skills + 侧边栏 UI + 动态加载 |
| W5 | E2B 沙盒集成 + 代码执行 + 文件预览下载 + Clerk 认证 |
| W6 | Bug 修复 + 性能优化 + 部署 + 内测 |

---

## Out of Scope (MVP)

- 多人协作 / 共享编辑
- 非 Claude 模型接入
- 移动端 App
- Skill UGC / 社区
- 离线功能
- 付费系统（MVP 免费）

---

## Deliverables（已交付文件）

| 文件 | 描述 |
|------|------|
| `PRD.md` | 本文档（产品需求） |
| `DATABASE_SCHEMA.sql` | 完整 SQL schema（14 张表 + 索引 + trigger + seed 数据） |
| `drizzle-schema.ts` | Drizzle ORM TypeScript schema（含 relations + type exports） |
| `db-client.ts` | 数据库客户端 + 常用查询函数 |
| `DATABASE_DESIGN.md` | 数据库设计决策文档 |

---

*Version: 2.0*
*Generated: 2026-02-08*
*Status: Draft - Pending Review*
