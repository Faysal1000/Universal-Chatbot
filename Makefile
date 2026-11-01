# Platform shortcuts. Every target reads its secrets from platform.env.
COMPOSE := docker compose --env-file platform.env

.PHONY: help up up-gpu down logs ps test

help: ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-8s %s\n", $$1, $$2}'

up: ## Build and start the whole platform
	$(COMPOSE) up --build -d --wait

up-gpu: ## Like up, with the model servers on NVIDIA GPUs
	$(COMPOSE) -f docker-compose.yml -f docker-compose.gpu.yml up --build -d --wait

down: ## Stop the platform (data volumes are kept)
	$(COMPOSE) down

logs: ## Follow logs of every service
	$(COMPOSE) logs -f --tail 100

ps: ## Show container status
	$(COMPOSE) ps

test: ## Lint, typecheck and test the TypeScript services
	cd services/rag && npm run lint && npm run typecheck && npm test
	cd services/admin-console && npm run check
	cd services/frontend-chat-interface && npm run check
	cd services/chat-widget && npm run check
