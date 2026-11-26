(() => {
  if (window.__webshot_initialized) {
    return;
  }
  window.__webshot_initialized = true;

  let originalScrollX = 0;
  let originalScrollY = 0;
  let hiddenStickyElements = [];
  let isSelectionActive = false;
  let activeSelectedElement = null;

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

      case 'start_element_selection':
        startElementSelection();
        sendResponse({ started: true });
        return false;

      case 'prepare_element_capture':
        handlePrepareElementCapture().then(sendResponse);
        return true;

      case 'scroll_element_step':
        handleScrollElementStep(message.x, message.y, message.index).then(sendResponse);
        return true;

      case 'cleanup_element_capture':
        cleanupElementCapture();
        sendResponse({ cleaned: true });
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
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
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
  // Element Selection (Inspect Element Style) Logic
  // ---------------------------------------------------------------------------

  function getDeepElementFromPoint(x, y, ignoredHost) {
    let el = document.elementFromPoint(x, y);
    while (el && el !== ignoredHost && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    if (!el || el === ignoredHost || (ignoredHost && ignoredHost.contains(el))) {
      return null;
    }
    return el;
  }

  function getElementDescriptor(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : 'element';
    const id = el.id ? `#${el.id}` : '';
    const classes = el.classList && el.classList.length > 0
      ? '.' + Array.from(el.classList).slice(0, 3).join('.')
      : '';
    return { tag, id, classes };
  }

  function isElementFixed(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      try {
        const pos = window.getComputedStyle(node).position;
        if (pos === 'fixed') {
          return true;
        }
      } catch (_) {
        break;
      }
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    return false;
  }

  function startElementSelection() {
    if (isSelectionActive) return;
    isSelectionActive = true;
    activeSelectedElement = null;

    const host = document.createElement('div');
    host.id = '__webshot_element_host';
    host.style.pointerEvents = 'none';
    const shadow = host.attachShadow({ mode: 'open' });

    const cursorStyle = document.createElement('style');
    cursorStyle.id = '__webshot_element_cursor';
    cursorStyle.textContent = '* { cursor: crosshair !important; }';
    document.head.appendChild(cursorStyle);

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        pointer-events: none;
      }
      .overlay-root {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
      }
      .instruction-pill {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.94);
        color: #f8fafc;
        padding: 8px 16px;
        border-radius: 9999px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        pointer-events: none;
        z-index: 2147483647;
        border: 1px solid rgba(255, 255, 255, 0.16);
        white-space: nowrap;
      }
      .highlight-box {
        position: fixed;
        pointer-events: none;
        display: none;
        border: 2px solid #3b82f6;
        background: rgba(59, 130, 246, 0.18);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.75);
        border-radius: 2px;
        box-sizing: border-box;
        transition: top 0.04s ease-out, left 0.04s ease-out, width 0.04s ease-out, height 0.04s ease-out;
      }
      .element-tooltip {
        position: fixed;
        pointer-events: none;
        display: none;
        align-items: center;
        gap: 6px;
        background: rgba(15, 23, 42, 0.96);
        color: #e2e8f0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        line-height: 1;
        padding: 5px 8px;
        border-radius: 5px;
        border: 1px solid rgba(96, 165, 250, 0.45);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        white-space: nowrap;
        max-width: 380px;
        z-index: 2147483647;
      }
      .tag-name {
        color: #c084fc;
        font-weight: 700;
      }
      .selector-meta {
        color: #60a5fa;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
      }
      .dim-sep {
        color: #475569;
      }
      .dim-text {
        color: #94a3b8;
        font-weight: 600;
      }
    `;

    const overlayRoot = document.createElement('div');
    overlayRoot.className = 'overlay-root';

    const pill = document.createElement('div');
    pill.className = 'instruction-pill';
    pill.textContent = 'Hover any component and click to capture. Use Up/Down for parent/child, ESC to cancel.';

    const highlightBox = document.createElement('div');
    highlightBox.className = 'highlight-box';

    const tooltip = document.createElement('div');
    tooltip.className = 'element-tooltip';

    const tagSpan = document.createElement('span');
    tagSpan.className = 'tag-name';

    const metaSpan = document.createElement('span');
    metaSpan.className = 'selector-meta';

    const sepSpan = document.createElement('span');
    sepSpan.className = 'dim-sep';
    sepSpan.textContent = '|';

    const dimSpan = document.createElement('span');
    dimSpan.className = 'dim-text';

    tooltip.appendChild(tagSpan);
    tooltip.appendChild(metaSpan);
    tooltip.appendChild(sepSpan);
    tooltip.appendChild(dimSpan);

    overlayRoot.appendChild(pill);
    overlayRoot.appendChild(highlightBox);
    overlayRoot.appendChild(tooltip);
    shadow.appendChild(style);
    shadow.appendChild(overlayRoot);
    document.documentElement.appendChild(host);

    let hoveredElement = null;
    let childHistory = [];
    let lastMouseX = -1;
    let lastMouseY = -1;

    function updateHighlight(el) {
      if (!el || !el.isConnected) {
        highlightBox.style.display = 'none';
        tooltip.style.display = 'none';
        return;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        highlightBox.style.display = 'none';
        tooltip.style.display = 'none';
        return;
      }

      highlightBox.style.display = 'block';
      highlightBox.style.left = `${rect.left}px`;
      highlightBox.style.top = `${rect.top}px`;
      highlightBox.style.width = `${rect.width}px`;
      highlightBox.style.height = `${rect.height}px`;

      const { tag, id, classes } = getElementDescriptor(el);
      tagSpan.textContent = tag;
      metaSpan.textContent = `${id}${classes}`;
      metaSpan.style.display = id || classes ? 'inline' : 'none';
      dimSpan.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;

      tooltip.style.display = 'flex';
      const tipRect = tooltip.getBoundingClientRect();
      const tipWidth = tipRect.width || 180;
      const tipHeight = tipRect.height || 24;

      const left = Math.max(8, Math.min(rect.left, window.innerWidth - tipWidth - 8));
      let top = rect.top - tipHeight - 8;
      if (top < 8) {
        if (rect.bottom + tipHeight + 8 <= window.innerHeight) {
          top = rect.bottom + 8;
        } else {
          top = Math.max(8, rect.top + 8);
        }
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function cleanup() {
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
      if (cursorStyle && cursorStyle.parentNode) {
        cursorStyle.parentNode.removeChild(cursorStyle);
      }
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize, true);
      isSelectionActive = false;
    }

    function captureCurrentElement() {
      const target = hoveredElement;
      cleanup();

      if (!target || !target.isConnected) {
        return;
      }

      const rect = target.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const tag = target.tagName ? target.tagName.toLowerCase() : 'element';
      const isFixed = isElementFixed(target);
      const inViewport =
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth;

      if (isFixed || inViewport) {
        const x = Math.max(0, rect.left);
        const y = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const width = right - x;
        const height = bottom - y;

        if (width < 2 || height < 2) {
          return;
        }

        // Wait two animation frames so overlay removal is fully repainted
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            chrome.runtime.sendMessage({
              action: 'capture_selected_element',
              mode: 'viewport',
              tag,
              rect: { x, y, width, height, dpr }
            });
          });
        });
        return;
      }

      activeSelectedElement = target;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          chrome.runtime.sendMessage({
            action: 'capture_selected_element',
            mode: 'scroll',
            tag
          });
        });
      });
    }

    function onMouseMove(e) {
      // Avoid resetting keyboard navigation on tiny sub-pixel mouse jitter
      if (Math.abs(e.clientX - lastMouseX) < 2 && Math.abs(e.clientY - lastMouseY) < 2) {
        return;
      }
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      // Move instruction pill away from top edge when inspecting headers/navbars
      if (e.clientY < 80) {
        pill.style.top = 'auto';
        pill.style.bottom = '20px';
      } else {
        pill.style.top = '20px';
        pill.style.bottom = 'auto';
      }

      const el = getDeepElementFromPoint(e.clientX, e.clientY, host);
      if (el && el !== hoveredElement) {
        hoveredElement = el;
        childHistory = [];
        updateHighlight(hoveredElement);
      }
    }

    function onMouseDown(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.button === 1) {
        cleanup();
      }
    }

    function onMouseUp(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.button !== 0) return;
      captureCurrentElement();
    }

    function onContextMenu(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      cleanup();
    }

    function onScrollOrResize() {
      if (hoveredElement) {
        updateHighlight(hoveredElement);
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        return;
      }

      if (e.key === 'Enter' && hoveredElement) {
        e.preventDefault();
        e.stopPropagation();
        captureCurrentElement();
        return;
      }

      if (e.key === 'ArrowUp' && hoveredElement) {
        e.preventDefault();
        e.stopPropagation();
        const parent =
          hoveredElement.parentElement ||
          (hoveredElement.getRootNode && hoveredElement.getRootNode().host) ||
          null;
        if (parent && parent !== document.documentElement) {
          childHistory.push(hoveredElement);
          hoveredElement = parent;
          updateHighlight(hoveredElement);
        }
        return;
      }

      if (e.key === 'ArrowDown' && hoveredElement) {
        e.preventDefault();
        e.stopPropagation();
        if (childHistory.length > 0) {
          hoveredElement = childHistory.pop();
          updateHighlight(hoveredElement);
        } else {
          for (const child of hoveredElement.children) {
            const r = child.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              hoveredElement = child;
              updateHighlight(hoveredElement);
              break;
            }
          }
        }
      }
    }

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize, true);
  }

  async function handlePrepareElementCapture() {
    if (!activeSelectedElement || !activeSelectedElement.isConnected) {
      return null;
    }

    originalScrollX = window.scrollX;
    originalScrollY = window.scrollY;
    hiddenStickyElements = [];

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

    await new Promise((r) => setTimeout(r, 100));

    const rect = activeSelectedElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      elemDocX: Math.max(0, rect.left + window.scrollX),
      elemDocY: Math.max(0, rect.top + window.scrollY),
      elemWidth: rect.width,
      elemHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1
    };
  }

  async function handleScrollElementStep(x, y, index) {
    if (index === 0 && hiddenStickyElements.length === 0) {
      hideStickyAndFixed(activeSelectedElement);
    }

    window.scrollTo(x, y);
    await new Promise((r) => setTimeout(r, 220));

    if (!activeSelectedElement || !activeSelectedElement.isConnected) {
      return null;
    }

    const rect = activeSelectedElement.getBoundingClientRect();
    return {
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }

  function cleanupElementCapture() {
    cleanupFullPage();
    activeSelectedElement = null;
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

  function hideStickyAndFixed(excludeEl = null) {
    const candidates = document.querySelectorAll(
      'header, nav, aside, footer, div, section, [class*="header"], [class*="nav"], [class*="sticky"], [class*="fixed"]'
    );
    for (const el of candidates) {
      if (el.id && el.id.startsWith('__webshot_')) continue;
      if (excludeEl && (el === excludeEl || el.contains(excludeEl) || excludeEl.contains(el))) {
        continue;
      }
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
