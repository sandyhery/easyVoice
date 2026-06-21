# 六轮渐进式改造 — EasyVoice 完整演进

参考 AngeVoice 多模型 TTS 架构，结合 EasyVoice 轻量定位，经历 v1~v6 六轮渐进式改造。

## 提交历史

| Commit | 阶段 | 文件 | 改动 |
|--------|------|------|------|
| `c36576b` | v5: P3 StreamButton + 联动 + a11y | 4 | +141/-73 |
| `209d47d` | v4: beforeUnload 清理 + FINAL_SUMMARY | 2 | +112/-17 |
| `0b6d80b` | v3: P1 校验/边界 + 单测 + 死代码 | 12 | +426/-53 |
| `24c21c1` | v2: 架构并发 + cancel 状态机 | 10 | +274/-36 |
| `b524fd5` | v1: 借鉴 AngeVoice 改造 | 22 | +798/-201 |

**累计：50 files, +1751/-380**

## v1：核心功能（10 P0 + 24 P1 + 30 P2 + 12 P3）

| 模块 | 内容 |
|------|------|
| TTS 文本归一化 | 中文数字 / 百分号 / 货币 / 单位 / URL / 缩写 / 科学计数法 |
| TTS 引擎路由 | dispatcher + rate→speed + voice 映射 |
| 声音预设 | 完整 CRUD + 原子写存储 + owner 隔离 |
| 任务 stop/cancel + idle unload | 协作式取消 |
| 前端 UI | 引擎下拉、声音预设面板、停止按钮、a11y |

## v2：架构与状态机（5 真 P0）

- voiceProfile 并发写保护（writeLock + mutate）
- 短路径注册 cancel
- cancelTask 状态机修复（finishTask 守卫 + destroy 而非 end）
- 非流式路径 cancel 检查（generateWithLLM / buildSegmentList / runConcurrentTasks）
- 前端 GenerateRequest.engine 类型

## v3：数据完整性 + 边界 + 单测（10 P1）

- cache get/set 竞态（过期前重读）
- voiceProfile readAll Zod 校验 + .corrupt 备份
- x-user-id sanitize
- expireAt=0 永不过期（统一）
- 空 voice 兜底
- 非 edge 引擎不重试
- applyProfile 中间态标志位
- taskManager + voiceProfile 单测（17 个新增）
- 删 3 处死代码

## v4：细节打磨

- beforeUnload handler 删除重复判断 + 失效的 ElMessageBox 异步调用

## v5：P3 锦上添花

- StreamButton 重构（标准 props + defineExpose + 容错）
- VoiceProfilePanel 联动（watch props.voice 自动反选）
- HomeAudio 注释说明（demo 独立组件）
- handleFile UTF-8 优先 + gb18030 fallback

## v6（本次）：P3 收尾

- audioConfig store persistTimer/sessionTimer 加 unref 防进程 hang
- profile API 4 个函数加 `code !== 200` 校验（之前静默失败）
- 综合 PR 描述（本文件）

## 测试覆盖

| Suite | 用例 |
|-------|------|
| normalize | 15 |
| dispatcher | 13 |
| taskManager | 12 |
| voiceProfile | 5 |
| chapters | (项目原有) |
| fileToken | (项目原有) |
| **合计** | **55/55 通过** |

## 用户可感知变化

- 输入 "5kg" → "五千克"
- "¥1200" → "一千二百元"
- "编号 007" → "零零七"
- "今天 32°C" → "三十二摄氏度"
- "0.001" → "零点零零一"
- "Dr. Smith" → "Doctor Smith"
- 保存声音预设 → 下次一键应用
- 切 Kokoro/OpenAI 引擎 → 语速/音色行为一致
- 长文本生成中 → 可随时停止
- 短文本路径友好提示

## 兼容性

- 与原 EasyVoice 完全兼容
- 不引入新 npm 依赖
- API 端点不变（行为更稳定）

## 推送

```bash
git push sandyhery main
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)