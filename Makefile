.PHONY: up down logs restart build ps shell-backend shell-frontend

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

restart:
	docker compose restart

build:
	docker compose build --no-cache

ps:
	docker compose ps

shell-backend:
	docker compose exec backend sh

shell-frontend:
	docker compose exec frontend sh

certbot:
	docker compose run --rm --entrypoint "\
	  certbot certonly --webroot -w /var/www/certbot \
	  --email $(EMAIL) -d $(DOMAIN) --agree-tos --no-eff-email" nginx
