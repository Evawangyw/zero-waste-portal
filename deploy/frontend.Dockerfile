# 零废弃知识库 · 前端镜像（构建静态产物 + Nginx 托管）
# 构建上下文是仓库根：docker compose -f deploy/docker-compose.yml build

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/package.json
RUN npm install --workspace frontend --include-workspace-root
COPY frontend ./frontend
RUN npm run build --workspace frontend

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80