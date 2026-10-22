.POSIX:
.PHONY: all help icons lint build clean dev

NAME        := website_screen_shot
VERSION     := $(shell python3 -c 'import json; print(json.load(open("manifest.json"))["version"])' 2>/dev/null || echo "1.0.0")
DIST_DIR    := dist
ZIP_NAME    := $(NAME)-v$(VERSION).zip
ZIP_PATH    := $(DIST_DIR)/$(ZIP_NAME)

JS_FILES    := background.js content/content.js popup/popup.js viewer/viewer.js
ICON_SCRIPT := scripts/generate_icons.py

all: icons lint build

help:
	@echo "WebShot Makefile commands:"
	@echo "  make icons   - Regenerate all anti-aliased PNG and SVG icons"
	@echo "  make lint    - Validate manifest.json and run JS syntax checks"
	@echo "  make build   - Package extension into $(ZIP_PATH) for distribution"
	@echo "  make clean   - Remove build artifacts and $(DIST_DIR)/"
	@echo "  make dev     - Run icons and lint without packaging"

icons:
	@echo "Generating extension icons..."
	@python3 $(ICON_SCRIPT)

lint:
	@echo "Validating manifest.json..."
	@python3 -m json.tool manifest.json > /dev/null
	@echo "Checking JavaScript syntax..."
	@node -c $(JS_FILES)
	@echo "All lint and syntax checks passed."

build: icons lint
	@echo "Packaging $(ZIP_NAME)..."
	@mkdir -p $(DIST_DIR)
	@rm -f $(ZIP_PATH)
	@zip -r $(ZIP_PATH) \
		manifest.json \
		background.js \
		content/ \
		popup/ \
		viewer/ \
		icons/ \
		-x "*.DS_Store" "*__pycache__*"
	@echo "Build complete: $(ZIP_PATH)"
	@ls -lh $(ZIP_PATH)

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(DIST_DIR)
	@find . -name ".DS_Store" -delete 2>/dev/null || true
	@find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "Clean completed."

dev: icons lint
	@echo "Ready for unpacked extension loading in chrome://extensions."
