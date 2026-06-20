# syntax=docker/dockerfile:1.6
# 使用更精简的基础镜像并添加版本标签
FROM node:20-alpine3.19 AS builder

# 设置工作目录
WORKDIR /app

# 启用 corepack（pnpm）
RUN corepack enable

# 复制包管理文件
COPY package.json tsconfig.json ./

# 安装所有依赖（devDependencies 用于构建）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY src/ ./src/

# 构建项目
RUN pnpm run build

# =====================================================
# 生产镜像
# =====================================================
FROM node:20-alpine3.19 AS production

WORKDIR /app

# 安装 ffmpeg（音频拼接依赖），并验证安装成功
RUN apk add --no-cache ffmpeg curl \
    && ffmpeg -version >/dev/null \
    && curl --version >/dev/null

# 启用 corepack
RUN corepack enable

# 仅复制运行时所需文件
COPY package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public  ./public

# 仅安装生产依赖；显式 prune 移除 devDeps（pnpm install --prod 不会自动 prune）
RUN pnpm install --prod --frozen-lockfile \
    && pnpm prune --prod

ENV NODE_ENV=production
EXPOSE 3000

# 使用非 root 用户运行
USER node

# 启动命令
CMD ["pnpm", "start"]

# 健康检查：路由实际挂在 /api/health
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl --fail http://localhost:3000/api/health || exit 1
