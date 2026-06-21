# v3: P1 深度优化 + 单测补全 + 死代码清理

第三轮：聚焦 v2 审计中发现的并发 / 数据校验 / 边界问题。

## P1 修复（10 项）

| ID | 问题 | 修法 |
|----|------|------|
| **P1-1** | cancelTask 状态机并发 | 已在 v2 P0-C 修复 |
| **P1-2** | cache get/set 竞态（过期删覆盖新数据） | get 中过期前重读一次 + FileStorage.set rename 错误捕获 |
| **P1-3** | voiceProfile readAll 无 schema 校验 | 加 `profilesArraySchema.safeParse`，损坏文件备份到 `.corrupt.{ts}` 后用空数组启动 |
| **P1-4** | `x-user-id` header 缺 sanitize | 限制 64 字符 + 字符集 `[a-zA-Z0-9_-@.]` + trim，非法回退 `default` |
| **P1-5** | `expireAt=0` 语义不统一 | FileStorage / MemoryStorage / cache.service 统一：`expireAt && expireAt < now`（0 视为永不过期）|
| **P1-6** | mapVoiceForEngine 空 voice 兜底 | `!voice.trim()` 视为未传，返回 undefined |
| **P1-7** | runEdgeTTS retry 误伤非 edge 引擎 | OpenAI/Kokoro 直接调一次不重试，由各自内部处理 |
| **P1-8** | onClose 状态机翻回 | 已在 v2 P0-C finishTask 守卫修复 |
| **P1-9** | 补单测 | 新增 taskManager.test.ts（12 用例）+ voiceProfile.test.ts（5 用例）|
| **P1-10** | applyProfile 中间态污染 watch | `applyingProfile` 标志位 + nextTick 清理 |

## 死代码清理（3 处）

- 删除 `OPENAI_VOICE_PREFIXES`（声明未用）
- 删除 `listEnginesWithMeta()`（无 caller）
- 删除 `longStringDigitsToCn()`（内部 dead code）

## 测试统计

| Suite | 用例 |
|-------|------|
| normalize | 15 |
| dispatcher | 13 |
| taskManager | 12 |
| voiceProfile | 5 |
| chapters | (项目原有) |
| fileToken | (项目原有) |
| **合计** | **55/55 通过** |

## 文件清单

### 修改（6）
- `packages/backend/src/services/cache.service.ts` — get 中过期前重读
- `packages/backend/src/services/voiceProfile.service.ts` — readAll Zod 校验 + getOwner sanitize
- `packages/backend/src/storage/fileStorage.ts` — expireAt=0 永不过期
- `packages/backend/src/storage/memoryStorage.ts` — expireAt=0 永不过期
- `packages/backend/src/services/edge-tts.service.ts` — 非 edge 引擎不重试
- `packages/backend/src/tts/dispatcher.ts` — 空 voice 兜底 + 删死代码
- `packages/backend/src/services/normalize.service.ts` — 删 longStringDigitsToCn 死代码
- `packages/frontend/src/views/Generate.vue` — applyingProfile 标志位

### 新增（2）
- `packages/backend/tests/taskManager.test.ts` — 12 个 taskManager 用例
- `packages/backend/tests/voiceProfile.test.ts` — 5 个 voiceProfile 用例

## 验证

| 阶段 | 结果 |
|------|------|
| `tsc -p tsconfig.json` | ✅ 0 错误 |
| `npx jest` | ✅ **55/55 通过**（6 个 suite）|

🤖 Generated with [Claude Code](https://claude.com/claude-code)