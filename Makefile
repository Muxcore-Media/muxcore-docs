.PHONY: build clean serve sync-wiki

build:
	./build.sh

clean:
	rm -rf dist

# Optional: copy ../core.wiki into ./wiki (legacy GitHub wiki checkout)
sync-wiki:
	@test -f ../core.wiki/Home.md || (echo "missing ../core.wiki"; exit 1)
	mkdir -p wiki
	cp ../core.wiki/*.md wiki/
	@echo "synced wiki/ from ../core.wiki (review before commit)"

serve: build
	@echo "Serving dist/ on http://127.0.0.1:8080"
	@npx --yes serve dist -l 8080
