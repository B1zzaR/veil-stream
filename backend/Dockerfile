FROM golang:1.21-alpine AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY go.mod ./
RUN go mod download -x
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOFLAGS="-mod=mod" go build -ldflags="-w -s" -o /server .

FROM alpine:3.19
RUN apk add --no-cache ffmpeg ca-certificates tzdata
WORKDIR /app
COPY --from=builder /server ./server
RUN mkdir -p /media/uploads /media/thumbnails /media/logos /media/scenes
EXPOSE 8080
CMD ["./server"]
