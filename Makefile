.PHONY: build check fix install lint test

install:
	npm ci

lint:
	npm run format:check
	npm run typecheck

fix:
	npm run format

test:
	npm test

build:
	npm run build

check: lint test build
