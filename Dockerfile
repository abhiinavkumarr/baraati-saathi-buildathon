# Baraati Saathi on Cloud Run.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
# AlloyDB Auth Proxy: used when ALLOYDB_INSTANCE_URI is set (see start.sh).
ADD --chmod=755 https://storage.googleapis.com/alloydb-auth-proxy/v1.18.0/alloydb-auth-proxy.linux.amd64 /usr/local/bin/alloydb-auth-proxy
COPY --from=build /app /app
RUN chmod +x /app/start.sh
EXPOSE 8080
CMD ["/app/start.sh"]
