FROM golang:1.25 AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/miraeopus-api ./cmd/miraeopus-api

FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=build /out/miraeopus-api /miraeopus-api
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/miraeopus-api"]
