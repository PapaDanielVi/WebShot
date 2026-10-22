# WebShot

A Google Chrome extension built on Manifest V3 for capturing full-page scrolling screenshots, cropped rectangular selections, and visible browser viewports.

Author: Daniel ([github.com/PapaDanielVi](https://github.com/PapaDanielVi))

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Manual Installation](#manual-installation)
- [Usage Guide](#usage-guide)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Project Architecture](#project-architecture)
- [Build and Development](#build-and-development)
- [Chrome Web Store Publishing](#chrome-web-store-publishing)

## Features

- Full-page capture: Measures document dimensions, steps through scroll increments, temporarily disables smooth scrolling, suppresses sticky headers and scrollbars, and stitches the slices into one continuous high-resolution image using an `OffscreenCanvas`.
- Selected area capture: Injects a crop overlay inside a Shadow DOM so the target website styles cannot interfere. Displays real-time pixel dimensions while dragging.
- Visible viewport capture: Instant capture of the visible screen area without scrolling.
- Zero DOM pollution during capture: Progress is reported inside the extension popup and on the Chrome toolbar badge. No floating cards or overlays are injected onto the webpage during full-page capture, preventing the extension from capturing itself.
- High-DPI and Retina display support: Uses `window.devicePixelRatio` across cropping and stitching coordinates to preserve native pixel resolution.
- Preview and export workspace: Displays the captured image with fit-to-window and 1:1 scale modes, direct copy to clipboard via the Clipboard API, and PNG or JPEG downloads.
- Optional auto-download: Toggle setting in the popup to automatically save screenshots to your Downloads directory.

## How It Works

### Full-Page Capture

Capturing an entire webpage requires handling several browser rendering behaviors:

1. Coordinate measurement: The content script queries `scrollHeight`, `offsetHeight`, and `clientHeight` across both `document.documentElement` and `document.body` to find the true document height.
2. Style stabilization: Injects temporary CSS to force `scroll-behavior: auto !important` and hide scrollbars. This guarantees programmatic scroll calls jump immediately without animation lag and prevents scrollbars from showing up in the output.
3. Sticky element suppression: Elements with `position: fixed` or `position: sticky` appear in their natural position on slice 0. From slice 1 onward, their visibility is temporarily set to `hidden` to stop them from duplicating across every captured tile.
4. Canvas stitching: The service worker receives raw slice images, loads them into `ImageBitmap` objects, and paints them onto an `OffscreenCanvas` at exact vertical offsets before converting to PNG.
5. Restoration: Restores original scroll positions, removes injected style rules, and restores visibility on all sticky elements once capture completes or cancels.

### Selected Area Capture

1. When triggered from the popup, the content script attaches an isolated Shadow DOM container to `document.documentElement`.
2. A semi-transparent backdrop with crosshair cursor tracks `mousedown`, `mousemove`, and `mouseup` events.
3. Box shadows around the selection rectangle create a cutout preview with a live dimension badge.
4. On release, the overlay element is removed from the DOM immediately. After two animation frames to ensure screen repaint, the background worker captures the viewport and crops to the selection coordinates multiplied by the device pixel ratio.

## Manual Installation

To install WebShot manually in developer mode:

1. Clone or download this repository to your local machine:
   ```bash
   git clone https://github.com/PapaDanielVi/WebShot.git
   cd WebShot
   ```

2. Open Google Chrome and go to:
   ```
   chrome://extensions
   ```

3. Enable Developer mode using the toggle in the top-right corner.

4. Click the Load unpacked button in the top-left toolbar.

5. Select the cloned repository directory (for example, `~/Documents/chrome_extentions/website_screen_shot` or relative `./WebShot`).

6. WebShot will appear in your extensions list. Pin it to your Chrome toolbar for quick access.

## Usage Guide

1. Open any webpage you want to capture.
2. Click the WebShot icon in your Chrome toolbar.
3. Select your capture mode:
   - Full Page: Automatically scrolls down the page and opens the full composite image in the preview tab.
   - Select Area: Darkens the screen. Click and drag over the area you want to capture, then release.
   - Visible Screen: Captures what is visible in your browser window right now.
4. The capture opens in the preview tab where you can inspect, zoom, copy, or download it.

## Keyboard Shortcuts

### Selection Mode (on webpage)

| Key | Action |
| --- | --- |
| `ESC` | Cancel selection and remove overlay |
| Right-click | Cancel selection |

### Preview Workspace (in viewer tab)

| Shortcut | Action |
| --- | --- |
| `Cmd + C` / `Ctrl + C` | Copy screenshot directly to system clipboard as PNG |
| `Cmd + S` / `Ctrl + S` | Download screenshot as PNG |
| `0` | Fit image to window dimensions |
| `1` | Zoom image to 100% (1:1 actual pixel size) |
| `+` or `=` | Zoom in by 15% |
| `-` | Zoom out by 15% |
| Click image | Toggle between Fit and 100% zoom |

## Project Architecture

```
website_screen_shot/
├── manifest.json              # Manifest V3 extension configuration
├── background.js              # Background service worker (capture, crop, stitch)
├── Makefile                   # Build automation, linting, packaging
├── content/
│   ├── content.js             # Content script (scrolling, measurements, area selection)
│   └── content.css            # Content script styles
├── popup/
│   ├── popup.html             # Action popup interface
│   ├── popup.css              # Action popup dark theme styles
│   └── popup.js               # Popup event handling and progress tracking
├── viewer/
│   ├── viewer.html            # Screenshot preview workspace
│   ├── viewer.css             # Viewer layout, toolbar, and dark canvas styles
│   └── viewer.js              # Zooming, clipboard API copying, PNG/JPEG export
├── icons/
│   ├── icon.svg               # Vector master icon
│   ├── icon16.png             # Toolbar icon (16x16)
│   ├── icon32.png             # Retina toolbar icon (32x32)
│   ├── icon48.png             # Extension management icon (48x48)
│   └── icon128.png            # Chrome Web Store icon (128x128)
└── scripts/
    └── generate_icons.py      # Standalone icon generator script
```

## Build and Development

A `Makefile` is included for common maintenance and packaging tasks.

```bash
# View all available targets
make help

# Regenerate all PNG and SVG icons
make icons

# Validate manifest.json and run Node syntax checks across all JS files
make lint

# Run icon generation and validation checks for local testing
make dev

# Build a clean distribution zip archive in dist/website_screen_shot-v1.0.0.zip
make build

# Remove build artifacts and temporary files
make clean
```

The build target automatically runs `icons` and `lint` before packaging, and excludes development files like `.git`, `Makefile`, and `.DS_Store`.

## Chrome Web Store Publishing

To publish the extension on the Chrome Web Store:

1. Package the zip file:
   ```bash
   make build
   ```
   The archive will be created at `dist/website_screen_shot-v1.0.0.zip`.

2. Log in to the [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole).

3. Click New Item and upload the generated zip file.

4. Fill in the store listing details:
   - Title: WebShot - Full Page & Area Screenshot
   - Summary: Capture full page scrolling screenshots, selected areas, or visible screens.
   - Category: Productivity or Photos.
   - Upload `icons/icon128.png` as the store icon.
   - Upload at least one 1280x800 or 640x400 screenshot of the extension in action.

5. Complete the Privacy tab:
   - Single purpose: Capture full page, selected area, or visible screen screenshots of web pages.
   - Justify permissions:
     - `activeTab`: Used to capture screen images and measure page height on user request.
     - `scripting`: Injects content scripts to coordinate scrolling and crop selections.
     - `downloads`: Saves screenshot files to disk when triggered by the user.
     - `storage` / `unlimitedStorage`: Caches captured image data for the preview tab and saves user preferences.
     - `<all_urls>`: Allows capture functionality across web pages when triggered.
   - Declare that you do not collect, sell, or transfer user data.

6. Submit for review.
