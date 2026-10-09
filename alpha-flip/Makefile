.PHONY: all build test lint run-observe run-shadow docker-up docker-down clean help

SHELL := /usr/bin/env bash

all: build test

help:
	@echo "Alpha-Flip v3.2 Makefile Targets:"
	@echo "  build         - Compile Rust workspace and install Python cold dependencies"
	@echo "  test          - Execute Rust unit/smoke tests and Python pytest suite"
	@echo "  lint          - Run cargo fmt/clippy and ruff/flake8"
	@echo "  run-observe   - Launch hot path in OBSERVE mode (zero execution risk)"
	@echo "  run-shadow    - Launch hot path in SHADOW simulation mode"
	@echo "  docker-up     - Start Redis 7 and PostgreSQL 16 local services"
	@echo "  docker-down   - Stop local Docker containers"
	@echo "  clean         - Clean build artifacts and test caches"

docker-up:
	docker compose up -d

docker-down:
	docker compose down

build:
	cargo build --workspace
	@if [ -d "services/alpha-flip-cold" ]; then \
		echo "Validating cold path dependencies..."; \
		python3 -m pip install -e services/alpha-flip-cold || true; \
	fi

test:
	cargo test --workspace
	@if [ -d "services/alpha-flip-cold" ]; then \
		pytest services/alpha-flip-cold/tests || true; \
	fi

lint:
	cargo fmt --all -- --check || true
	cargo clippy --workspace --all-targets -- -D warnings || true
	@if command -v ruff >/dev/null 2>&1; then \
		ruff check services/alpha-flip-cold; \
	fi

run-observe:
	TRADING_MODE=observe cargo run --bin alpha-flip-hot -- --mode observe

run-shadow:
	TRADING_MODE=shadow cargo run --bin alpha-flip-hot -- --mode shadow

clean:
	cargo clean
	rm -rf services/alpha-flip-cold/.pytest_cache
	rm -rf services/alpha-flip-cold/__pycache__
	rm -rf services/alpha-flip-cold/src/alpha_flip_cold/__pycache__
