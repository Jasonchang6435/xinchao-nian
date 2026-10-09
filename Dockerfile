# 仓库默认构建（Zeabur 自动探测用）：心潮服务。构建：docker build .
# OB 服务用 Dockerfile.ombre（模板或 ZBPACK_DOCKERFILE_PATH=Dockerfile.ombre）。
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
RUN apk add --no-cache su-exec
COPY xinchao/package.json ./
COPY xinchao/src ./src
COPY xinchao/configs ./configs
COPY deploy/zeabur/xinchao-entrypoint.sh /usr/local/bin/xinchao-entrypoint
RUN chmod 755 /usr/local/bin/xinchao-entrypoint \
    && mkdir -p /app/state && chown node:node /app/state
ENV NODE_ENV=production PORT=18110
EXPOSE 18110
VOLUME ["/app/state"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||18110)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/xinchao-entrypoint"]
CMD ["node", "src/server.js"]
