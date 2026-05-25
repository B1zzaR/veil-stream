FROM golang:1.21-alpine AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY go.mod ./
RUN go mod download -x
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOFLAGS="-mod=mod" go build -ldflags="-w -s" -o /server .

FROM alpine:3.19
RUN apk add --no-cache ffmpeg ca-certificates tzdata curl && \
    curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" \
         -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
COPY --from=builder /server ./server
RUN mkdir -p /media/uploads /media/thumbnails /media/logos /media/scenes
EXPOSE 8080
CMD ["./server"]
