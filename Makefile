.PHONY: build clean serve sync-wiki

build:
	./build.sh

clean:
	rm -rf dist

# Push ./wiki into a core.wiki checkout (wiki/ is the source of truth).
# Usage: make sync-wiki [CORE_WIKI=../core.wiki]; drift check: scripts/sync-core-wiki.sh --check <path>
CORE_WIKI ?= ../core.wiki
sync-wiki:
	./scripts/sync-core-wiki.sh $(CORE_WIKI)

serve: build
	@echo "Serving dist/ on http://127.0.0.1:8080"
	@npx --yes serve dist -l 8080
