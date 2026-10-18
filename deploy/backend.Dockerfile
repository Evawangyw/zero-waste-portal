# 零废弃知识库 · 自建后端镜像（多阶段）
# 构建上下文是仓库根：docker compose -f deploy/docker-compose.yml build

FROM node:22-alpine AS base
WORKDIR /app

# ---- deps：编译需要 typescript、prisma、@types/node，这些在 devDependencies 里 ----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
# 云服务器没有 GPU。跳过 CUDA 附加库，否则安装脚本会去 NuGet 下载并因跳转失败。
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm config set registry https://registry.npmmirror.com \
 && npm install --workspace backend --include-workspace-root --include=dev

# ---- build：编译 TS + 生成 Prisma Client ----
FROM deps AS build
COPY backend ./backend
RUN npm run prisma:generate --workspace backend \
 && npm run build --workspace backend \
 && mkdir -p backend/node_modules

# ---- runtime：只带运行期文件 ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/package.json ./backend/package.json
RUN mkdir -p /app/backend/data
EXPOSE 4000
CMD ["node", "backend/dist/index.js"]