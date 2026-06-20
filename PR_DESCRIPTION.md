# EasyVoice 借鉴 AngeVoice 改造 + 深度优化

参考 [AngeVoice](https://github.com/ang77712829/AngeVoice) 的多模型 TTS 架构，
结合本项目（轻量、Node.js、Edge-TTS）特点，做了四批渐进式改造。

## 总览

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 文本归一化 | 原始文本直接喂 TTS | 中文数字/百分号/货币/单位/URL/缩写/科学计数法全自动转中文 |
| 引擎路由 | 只支持 Edge-TTS | 可插拔 dispatcher，schema 加 `engine` 字段，自动 voice 映射 + rate→speed |
| 声音预设 | 无 | 完整 CRUD + 原子写存储 + owner 隔离 |
| 任务控制 | 无 cancel 能力 | 协作式 cancel + idle unload + 流式响应头暴露 taskId |
| 前端 UI | 基础 | 引擎下拉 + 声音预设面板（带删除）+ 停止按钮 + 跨语种回填 + a11y |
| 单测 | 0 | 15 个 normalize 用例 |
| 端到端 smoke | 0 | 52 项验证 |

## 文件清单

### 新增（7）
- `packages/backend/src/services/normalize.service.ts` — 文本归一化
- `packages/backend/src/tts/dispatcher.ts` — 引擎路由
- `packages/backend/src/services/voiceProfile.service.ts` — 声音预设 CRUD
- `packages/backend/tests/normalize.test.ts` — 15 个单测
- `packages/backend/jest.config.js` — jest 配置
- `packages/frontend/src/components/VoiceProfilePanel.vue` — 预设 UI 组件
- (MCP 文档由 README 覆盖)

### 修改（18）
- 后端核心：`schema/generate.ts`、`services/text.service.ts`、`services/edge-tts.service.ts`、`services/tts.stream.service.ts`、`services/audioCache.service.ts`、`services/cache.service.ts`、`controllers/tts.controller.ts`、`controllers/stream.controller.ts`、`controllers/concurrency.controller.ts`、`routes/tts.route.ts`、`utils/taskManager.ts`、`app.ts`、`storage/fileStorage.ts`、`storage/memoryStorage.ts`
- 引擎：`tts/types.ts`、`tts/engines/{edge,kokoro,openai}Tts.ts`
- 前端：`views/Generate.vue`、`components/HomeAudio.vue`、`api/tts.ts`
- 文档：`README.md`

## Commit 拆分

| Commit | 范围 | 数量 |
|--------|------|------|
| `feat: TTS 文本归一化 + 引擎路由 + 声音预设 + 任务控制 + UI` | 改造 P0 | 10 项 |
| `refactor: 协作式取消 + normalize 边界 + 存储并发` | 优化 P1 | 24 项 |
| `refactor: cancel 资源管理 + 存储安全 + normalize 性能 + engines` | 优化 P2 | 30 项 |
| `refactor: 细节打磨 + a11y + 一致性` | 优化 P3 | 12 项 |

## 关键架构决策

1. **复用 pluginManager**：项目已有 `tts/engines/{edge,kokoro,openai}.ts` + `pluginManager`，
   改造只补 `dispatcher.ts` 把 engine 字段串起来，不重写架构
2. **normalize 0 依赖**：纯函数中文数字转换（手写 `intToCn` + `bigIntToCn`），
   与 Edge-TTS / 未来本地模型都兼容，无 NLP 模型部署成本
3. **协作式 cancel**：`task.cancelled` 标志 + 流式循环检查点，不硬中断，
   checkpoint 保留可 resume，onEnd 不会把状态翻回 completed
4. **Voice Profile 复用 CacheService**：单文件 + 原子 rename 写（write tmp → rename），
   消除了 FileStorage 每文件一份 + INDEX_KEY 的双重失同步风险
5. **跨引擎兼容**：dispatcher 统一处理 `rate→speed` + `voice` 映射，
   用户在任何引擎下都得到一致的语速/音色行为

## 验证

| 阶段 | 命令 | 结果 |
|------|------|------|
| 编译 | `tsc -p tsconfig.json` | ✅ 0 错误 |
| 单测 | `npx jest tests/normalize.test.ts` | ✅ 15/15 通过 |
| 端到端 smoke | 内存 HTTP（沙箱禁 listen） | ✅ 52/52 通过 |

## 用户可感知的变化

- 数字 5kg → 听到"五千克"（不是"KG"）
- ¥1200 → 听到"一千二百元"
- 编号 007 → 听到"零零七"（不是"七"）
- 今天 32°C → 听到"今天三十二摄氏度"
- 0.001 → 听到"零点零零一"（保号）
- Dr. Smith → 听到"Doctor Smith"
- 保存一个声音预设 → 下次一键应用
- 切到 Kokoro/OpenAI 引擎 → 语速/音色行为一致（不再静默丢参数）
- 长文本生成中 → 可随时停止

## 兼容性

- 与现有 Edge-TTS API 完全兼容（不传 engine 字段走原路径）
- 不引入新依赖（除已存在的 vue、axios、element-plus、zod、winston 等）
- 后端端口、配置、环境变量不变

## 已知未做（按 P3 完成后）

- 真实浏览器 E2E（沙箱无法启动完整 dev server）
- HomeAudio 与 audioConfig store 联动（产品意图未明）
- 多租户权限（项目单机/内网定位，仅预留 ownerId 字段）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
