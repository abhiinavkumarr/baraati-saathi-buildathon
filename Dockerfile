# Baraati Saathi on Cloud Run.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
# `npm install`, not `npm ci`: the lock file was generated on Windows and lacks
# the Linux-only optional binaries the bundler needs.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
# Root CAs: the AlloyDB Auth Proxy (Go) verifies Google's TLS certificates.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
# AlloyDB Auth Proxy: used when ALLOYDB_INSTANCE_URI is set (see start.sh).
ADD https://storage.googleapis.com/alloydb-auth-proxy/v1.18.0/alloydb-auth-proxy.linux.amd64 /usr/local/bin/alloydb-auth-proxy
COPY --from=build /app /app
RUN chmod +x /usr/local/bin/alloydb-auth-proxy /app/start.sh
EXPOSE 8080
CMD ["/app/start.sh"]
