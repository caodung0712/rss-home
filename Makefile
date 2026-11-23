.PHONY: up down restart logs ps pull backup restore test

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

pull:
	docker compose pull && docker compose up -d

backup:
	bash scripts/backup.sh

restore:
	@test -n "$(FILE)" || (echo "Cách dùng: make restore FILE=/duong/dan/file.sql.gz" && exit 1)
	bash scripts/restore.sh "$(FILE)"

test:
	python3 -m unittest discover -s apify-bridge/tests -v
