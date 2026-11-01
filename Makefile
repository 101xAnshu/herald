SHELL := /bin/bash
COMPOSE := docker compose
TEST_ENV := DATABASE_URL=postgresql://herald:herald@localhost:5434/herald_test REDIS_URL=redis://localhost:6380 KAFKA_BROKERS=localhost:9093 SMTP_URL=smtp://localhost:1026 PORT=3100

.PHONY: deps up down demo migrate seed seed-load reset test test-integration test-e2e lint typecheck build bench bench-http scenario scenario-timeout scenario-kill scenario-failover drill-db site verify

deps:
	pnpm install

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

demo: deps
	@test -f .env || cp .env.example .env
	$(COMPOSE) up -d postgres redis kafka mailpit
	@until $(COMPOSE) exec -T postgres pg_isready -U herald -d herald >/dev/null 2>&1; do sleep 2; done
	pnpm --filter @herald/db exec prisma migrate deploy
	pnpm --filter @herald/db prisma:seed
	pnpm build
	$(COMPOSE) up -d --build api worker worker-delivery
	./scripts/wait-for.sh http://localhost:3000/health/ready 180
	pnpm herald init --demo
	@echo ""
	@echo "API      http://localhost:3000"
	@echo "Docs     http://localhost:3000/docs"
	@echo "Metrics  http://localhost:3000/metrics"
	@echo "Mailpit  http://localhost:8025"
	@echo "Next     pnpm herald doctor && pnpm herald demo"

migrate:
	pnpm --filter @herald/db exec prisma migrate deploy

seed:
	SEED_SCALE=small pnpm --filter @herald/db prisma:seed

seed-load:
	SEED_SCALE=load pnpm --filter @herald/db prisma:seed

reset:
	pnpm herald reset

test:
	pnpm test

test-integration: build
	./scripts/test-integration.sh

test-e2e:
	pnpm test:e2e

lint:
	pnpm lint

typecheck:
	pnpm typecheck

build:
	pnpm build

bench:
	pnpm bench

bench-http:
	pnpm bench:http

scenario:
	@if ! curl -fsS http://localhost:3000/health/ready >/dev/null 2>&1; then $(MAKE) demo; fi
	$(COMPOSE) up -d worker worker-delivery
	pnpm scenario:timeout
	pnpm scenario:kill

scenario-timeout:
	@if ! curl -fsS http://localhost:3000/health/ready >/dev/null 2>&1; then $(MAKE) demo; fi
	$(COMPOSE) up -d worker worker-delivery
	pnpm scenario:timeout

scenario-kill:
	@if ! curl -fsS http://localhost:3000/health/ready >/dev/null 2>&1; then $(MAKE) demo; fi
	pnpm scenario:kill

scenario-failover:
	$(MAKE) drill-db

drill-db:
	pnpm drill:db

site:
	python3 -m http.server 8080 --directory site

verify: build lint typecheck test test-e2e
