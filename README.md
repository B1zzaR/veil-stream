# Veil Stream

Лёгкая самохостируемая платформа для автоматических 24/7 YouTube Live трансляций аниме, сериалов и плейлистов.

## Быстрый старт

```bash
git clone <repo>
cd veil-stream
cp .env.example .env
# Отредактируйте .env — установите пароли и JWT_SECRET
nano .env
docker compose up -d --build
```

Откройте `http://YOUR_SERVER_IP` в браузере.

## Стек

| Компонент | Технология |
|-----------|-----------|
| Frontend  | Next.js 14, TypeScript, Tailwind CSS |
| Backend   | Go, Fiber v2 |
| База данных | PostgreSQL 15 |
| Очередь   | Redis 7 |
| Стриминг  | FFmpeg (libx264, без GPU) |
| Прокси    | Nginx |
| Деплой    | Docker Compose |

## Команды

```bash
make up        # Запустить всё
make down      # Остановить
make logs      # Смотреть логи
make restart   # Перезапустить
make build     # Пересобрать образы
make ps        # Статус контейнеров
```

## Возможности

- **Трансляции** — создать, запустить, остановить, перезапустить
- **Медиатека** — загрузка drag&drop, превью, метаданные
- **Очередь** — drag&drop сортировка, повтор, случайный порядок
- **Stream Copy** — H.264+AAC видео не перекодируются (минимум CPU)
- **Авторестарт** — автоматическое восстановление после сбоев
- **Оверлей** — логотип, текст-водяной знак
- **Сцены** — "Скоро начнём", "Пауза", "Офлайн"
- **Дашборд** — статус, CPU, RAM, битрейт в реальном времени
- **HTTPS** — поддержка Let's Encrypt

## Требования к серверу

- 2 vCPU, 2 GB RAM (и выше)
- Linux (Ubuntu 20.04+, Debian 11+)
- Docker + Docker Compose v2

## Настройка HTTPS

```bash
# Установите DOMAIN в .env
make certbot EMAIL=you@example.com DOMAIN=stream.example.com
# Раскомментируйте HTTPS блок в nginx/nginx.conf
make restart
```

## Оптимизация CPU

- Пресет `ultrafast` — минимальная нагрузка, чуть хуже качество
- Пресет `veryfast` — рекомендуется (баланс CPU/качество)
- Для H.264+AAC видео автоматически включается stream copy (0 перекодирования)
- Битрейт 2500–3000 кбит/с достаточен для 720p аниме

## Архитектура

```
nginx (80/443)
  ├── /          → frontend:3000 (Next.js)
  ├── /api/*     → backend:8080 (Go + Fiber)
  └── /ws        → backend:8080 (WebSocket)

backend
  ├── REST API   (JWT-аутентификация)
  ├── WebSocket  (статус в реальном времени)
  └── FFmpeg     (менеджер процессов стриминга)
```
