FROM golang:1.23 AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/miraeopus-api ./cmd/miraeopus-api

FROM node:24-bookworm-slim AS ai
WORKDIR /app/ai/runtime
COPY ai/runtime/package.json ai/runtime/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY ai/ /app/ai/

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /out/miraeopus-api /miraeopus-api
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=ai /app/ai /app/ai
ENV MANGORTS_AI_ROOT=/app/ai
USER node
EXPOSE 8080
ENTRYPOINT ["/miraeopus-api"]
