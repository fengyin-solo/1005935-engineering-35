FROM node:20-alpine
WORKDIR /srv/web
COPY package.json ./
RUN npm install
COPY . .
# 镜像构建阶段先跑消防器材规则自检（npm prebuild 钩子随后也执行完整 build）：
# 越限压力读数或超期器材会让这一步失败，镜像构建不出来，也就无法上线。
RUN npm run build
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
