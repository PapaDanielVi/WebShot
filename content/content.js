(() => {
  if (window.__webshot_initialized) {
    return;
  }
  window.__webshot_initialized = true;

  let originalScrollX = 0;
  let originalScrollY = 0;
  let hiddenStickyElements = [];
  let isSelectionActive = false;

  // Listen for messages from background or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'ping':
        sendResponse({ pong: true });
        return false;

      case 'start_area_selection':
        startAreaSelection();
        sendResponse({ started: true });
        return false;

      case 'prepare_full_page':
        handlePrepareFullPage().then(sendResponse);
        return true;

      case 'scroll_to_step':
        handleScrollToStep(message.y, message.index, message.total).then(sendResponse);
        return true;

      case 'cleanup_full_page':
        cleanupFullPage();
        sendResponse({ cleaned: true });
        return false;

      default:
        return false;
    }
  });

  // ---------------------------------------------------------------------------
  // Area Selection Logic
  // ---------------------------------------------------------------------------

  function startAreaSelection() {
    if (isSelectionActive) return;
    isSelectionActive = true;

    // Create a container host with Shadow DOM to prevent host page style conflicts
    const host = document.createElement('div');
    host.id = '__webshot_selection_host';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        cursor: crosshair;
        user-select: none;
        background: rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }
      .instruction-pill {
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(17, 24, 39, 0.92);
        color: #f3f4f6;
        padding: 8px 18px;
        border-radius: 9999px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        pointer-events: none;
        z-index: 2147483647;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }
      .selection-rect {
        position: absolute;
        border: 2px dashed #3b82f6;
        background: rgba(59, 130, 246, 0.12);
        box-shadow: 0 0 0 99999px rgba(0, 0, 0, 0.45);
        pointer-events: none;
        display: none;
      }
      .dimension-badge {
        position: absolute;
        bottom: -28px;
        right: 0;
        background: #1e40af;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 4px;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      }
    `;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';

    const pill = document.createElement('div');
    pill.className = 'instruction-pill';
    pill.textContent = 'Click and drag to select an area. Press ESC to cancel.';

    const rectEl = document.createElement('div');
    rectEl.className = 'selection-rect';

    const badge = document.createElement('div');
    badge.className = 'dimension-badge';
    rectEl.appendChild(badge);

    backdrop.appendChild(pill);
    backdrop.appendChild(rectEl);
    shadow.appendChild(style);
    shadow.appendChild(backdrop);
    document.documentElement.appendChild(host);

    let startX = 0;
    let startY = 0;
    let isDragging = false;

    function cleanup() {
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
      window.removeEventListener('keydown', onKeyDown, true);
      isSelectionActive = false;
    }

    function onMouseDown(e) {
      if (e.button !== 0) {
        // Right click or middle click cancels
        cleanup();
        return;
      }
      startX = e.clientX;
      startY = e.clientY;
      isDragging = true;
      rectEl.style.display = 'block';
      updateRect(startX, startY, 0, 0);
    }

    function onMouseMove(e) {
      if (!isDragging) return;
      const curX = e.clientX;
      const curY = e.clientY;

      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      updateRect(left, top, width, height);
    }

    function updateRect(left, top, width, height) {
      rectEl.style.left = `${left}px`;
      rectEl.style.top = `${top}px`;
      rectEl.style.width = `${width}px`;
      rectEl.style.height = `${height}px`;

      const dpr = window.devicePixelRatio || 1;
      const pxW = Math.round(width * dpr);
      const pxH = Math.round(height * dpr);
      badge.textContent = `${pxW} × ${pxH} px`;

      // Keep badge inside screen if selection reaches the bottom
      if (top + height + 32 > window.innerHeight) {
        badge.style.bottom = 'auto';
        badge.style.top = '4px';
      } else {
        badge.style.bottom = '-28px';
        badge.style.top = 'auto';
      }
    }

    function onMouseUp(e) {
      if (!isDragging) return;
      isDragging = false;

      const curX = e.clientX;
      const curY = e.clientY;

      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      // Check minimum dimensions
      if (width < 8 || height < 8) {
        cleanup();
        return;
      }

      // Remove the overlay before triggering screenshot
      cleanup();

      // Wait two animation frames to ensure screen is repainted clean
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          chrome.runtime.sendMessage({
            action: 'crop_visible_area',
            rect: {
              x,
              y,
              width,
              height,
              dpr: window.devicePixelRatio || 1
            }
          });
        });
      });
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
      }
    }

    backdrop.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
  }

  // ---------------------------------------------------------------------------
  // Full Page Capture Logic (No in-page DOM overlays)
  // ---------------------------------------------------------------------------

  async function handlePrepareFullPage() {
    originalScrollX = window.scrollX;
    originalScrollY = window.scrollY;
    hiddenStickyElements = [];

    // Inject temporary styles to disable smooth scrolling and hide scrollbars
    let style = document.getElementById('__webshot_capture_style');
    if (!style) {
      style = document.createElement('style');
      style.id = '__webshot_capture_style';
      style.textContent = `
        * {
          scroll-behavior: auto !important;
        }
        ::-webkit-scrollbar {
          display: none !important;
        }
        html {
          scrollbar-width: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Scroll to top
    window.scrollTo(0, 0);

    // Give the page 150ms to settle after scrolling to top
    await new Promise((r) => setTimeout(r, 150));

    const doc = document.documentElement;
    const body = document.body || {};

    const totalWidth = Math.max(
      doc.scrollWidth || 0,
      body.scrollWidth || 0,
      doc.offsetWidth || 0,
      body.offsetWidth || 0,
      doc.clientWidth || 0,
      window.innerWidth
    );

    const totalHeight = Math.max(
      doc.scrollHeight || 0,
      body.scrollHeight || 0,
      doc.offsetHeight || 0,
      body.offsetHeight || 0,
      doc.clientHeight || 0,
      window.innerHeight
    );

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    return {
      totalWidth,
      totalHeight,
      viewportWidth,
      viewportHeight,
      dpr
    };
  }

  async function handleScrollToStep(y, index, total) {
    // Hide fixed and sticky elements starting from step 1 so they don't repeat
    if (index > 0 && hiddenStickyElements.length === 0) {
      hideStickyAndFixed();
    }

    window.scrollTo(0, y);

    // Wait 250ms for repainting, lazy-loaded images, and layout settling
    await new Promise((r) => setTimeout(r, 250));

    return { ready: true };
  }

  function hideStickyAndFixed() {
    const candidates = document.querySelectorAll(
      'header, nav, aside, div, section, [class*="header"], [class*="nav"], [class*="sticky"], [class*="fixed"]'
    );
    for (const el of candidates) {
      if (el.id && el.id.startsWith('__webshot_')) continue;
      const pos = window.getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        hiddenStickyElements.push({
          el,
          origVisibility: el.style.visibility
        });
        el.style.visibility = 'hidden';
      }
    }
  }

  function restoreStickyAndFixed() {
    for (const item of hiddenStickyElements) {
      try {
        item.el.style.visibility = item.origVisibility;
      } catch (_) {
        // Element might have been detached
      }
    }
    hiddenStickyElements = [];
  }

  function cleanupFullPage() {
    restoreStickyAndFixed();

    const style = document.getElementById('__webshot_capture_style');
    if (style) {
      style.remove();
    }

    window.scrollTo(originalScrollX, originalScrollY);
  }
})();
