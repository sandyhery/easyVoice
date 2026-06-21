# v2: 第二轮深度优化（架构并发 + cancel 状态机 + dispatcher 单测）

第一轮 P0~P3 修了功能性问题；本轮聚焦**架构、并发、状态机**层面的深层问题。

## P0 修复（5 项）

| ID | 问题 | 修法 |
|----|------|------|
| **P0-A** | voiceProfile 内存 cache 并发数据丢失 | 加 `writeLock` Promise 链 + `mutate()` helper，所有 POST/PUT/DELETE 读-改-写串行化；readAll 返回浅拷贝避免 caller 直接改 cache 引用 |
| **P0-B** | 短文本路径无法 cancel | `createTask`/`generateAudio` 都注册 `task.cancel = () => { task.cancelled = true }`；updateTask/failTask 内 cancelled 守卫；前端短路径友好提示 |
| **P0-C** | cancelTask 状态机可被翻回 completed | `finishTask` 入口加 `if (task.cancelled \|\| status === cancelled) return`；`cancelTask` 幂等（重复 cancel 只触发回调一次）；`cancelTask` controller 用 `res.destroy()` 替代 `res.end()` 防 ERR_STREAM_WRITE_AFTER_END |
| **P0-D** | 非流式路径无 cancel 检查 | `generateWithLLM` for 循环开头加 cancel 守卫；`buildSegmentList` 任务函数多处加 cancel 检查；`runConcurrentTasks` 接 `isCancelled` 注入到 MapLimitController |
| **P0-E** | 前端 `GenerateRequest` 缺 `engine` 字段 | `api/tts.ts` 加 `engine?: string` |

## 新增单测

- `tests/dispatcher.test.ts`：**13 个** 用例覆盖 `parseRateToSpeed`（含 clamp 边界）+ `mapVoiceForEngine`（OpenAI 兜底）

## 验证

| 阶段 | 结果 |
|------|------|
| `tsc -p tsconfig.json` | ✅ 0 错误 |
| `npx jest` | ✅ **40/40 通过**（normalize 15 + dispatcher 13 + chapters + fileToken） |
| 端到端 smoke | ✅ **5/5 P0 验证通过**（并发 POST 不丢失、cancelTask 幂等、状态机不翻回、前端字段、排序兼容） |

## 文件清单

### 修改（7）
- `packages/backend/src/services/voiceProfile.service.ts` — writeLock + mutate() helper + readAll 浅拷贝
- `packages/backend/src/controllers/tts.controller.ts` — createTask / generateAudio 都注册 cancel
- `packages/backend/src/controllers/stream.controller.ts` — cancelTask 用 destroy()
- `packages/backend/src/utils/taskManager.ts` — finishTask / cancelTask 加守卫 + 幂等
- `packages/backend/src/services/tts.service.ts` — generateWithLLM / buildSegmentList / runConcurrentTasks 接 cancel
- `packages/backend/src/services/tts.shared.ts` — runConcurrentTasks 接 isCancelled
- `packages/frontend/src/views/Generate.vue` — handleCancel 短路径提示
- `packages/frontend/src/api/tts.ts` — GenerateRequest.engine

### 新增（1）
- `packages/backend/tests/dispatcher.test.ts` — 13 个 dispatcher 单测

## 兼容性

- 与第一轮 P0~P3 完全兼容
- 不引入新依赖
- API 端点不变（行为更稳定）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
