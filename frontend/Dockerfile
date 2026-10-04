FROM node:20-alpine
WORKDIR /srv/web
COPY package.json ./
RUN npm install
COPY . .
# 镜像构建时先跑消防台账自检：越限压力与超期器材在本地、容器里都得过同一道规则门禁。
RUN npm run selfcheck
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
