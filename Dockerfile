# Build from repository root; no bundled OB or bridge files enter this image.
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
RUN apk add --no-cache su-exec
COPY xinchao/package.json ./
COPY xinchao/src ./src
COPY xinchao/configs ./configs
COPY xinchao/scripts ./scripts
RUN mkdir -p /app/state && chown -R node:node /app && chmod +x /app/scripts/docker-entrypoint.sh
ENV NODE_ENV=production PORT=18110
EXPOSE 18110
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||18110)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
