// Background Service Worker for WebShot

const inMemoryScreenshots = new Map();
const activeCaptures = new Map();

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'capture_visible':
      handleCaptureVisible().then(sendResponse);
      return true;

    case 'start_area_selection':
      handleStartAreaSelection().then(sendResponse);
      return true;

    case 'crop_visible_area':
      handleCropVisibleArea(sender.tab, message.rect).then(sendResponse);
      return true;

    case 'start_full_page':
      handleStartFullPage().then(sendResponse);
      return true;

    case 'cancel_capture':
      handleCancelCapture(sender.tab).then(sendResponse);
      return true;

    case 'get_active_capture_status':
      handleGetActiveCaptureStatus().then(sendResponse);
      return true;

    case 'get_screenshot_data':
      handleGetScreenshotData(message.id).then(sendResponse);
      return true;

    default:
      return false;
  }
});

// -----------------------------------------------------------------------------
// Tab Utilities
// -----------------------------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('No active tab found.');
  }
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.includes('chrome.google.com/webstore')) {
    throw new Error('Chrome extension cannot capture internal browser pages.');
  }
  return tab;
}

async function ensureContentScriptInjected(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (res?.pong) return;
  } catch (_) {
    // Content script not present, inject programmatically
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/content.js']
  });

  // Brief delay to allow listener registration
  await new Promise((r) => setTimeout(r, 100));
}

function getSanitizedDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  } catch (_) {
    return 'website';
  }
}

// -----------------------------------------------------------------------------
// Capture Handlers
// -----------------------------------------------------------------------------

async function handleCancelCapture(senderTab) {
  let targetTabId = senderTab?.id;
  if (!targetTabId) {
    const activeTab = await getActiveTab().catch(() => null);
    targetTabId = activeTab?.id;
  }

  if (targetTabId && activeCaptures.has(targetTabId)) {
    const state = activeCaptures.get(targetTabId);
    state.cancelled = true;
    try {
      await chrome.action.setBadgeText({ text: '', tabId: targetTabId });
    } catch (_) {}
  }
  return { cancelled: true };
}

async function handleGetActiveCaptureStatus() {
  const tab = await getActiveTab().catch(() => null);
  if (tab && activeCaptures.has(tab.id)) {
    const state = activeCaptures.get(tab.id);
    return {
      inProgress: !state.cancelled,
      current: state.current,
      total: state.total,
      percent: state.percent
    };
  }
  return { inProgress: false };
}

async function handleCaptureVisible() {
  try {
    const tab = await getActiveTab();
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const filename = `screenshot-${getSanitizedDomain(tab.url)}-${Date.now()}.png`;

    await processAndPresentScreenshot({
      dataUrl,
      sourceUrl: tab.url,
      pageTitle: tab.title || 'Screenshot',
      filename,
      type: 'visible'
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleStartAreaSelection() {
  try {
    const tab = await getActiveTab();
    await ensureContentScriptInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, { action: 'start_area_selection' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleCropVisibleArea(tab, rect) {
  try {
    const activeTab = tab || (await getActiveTab());
    const rawDataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'png' });

    const croppedDataUrl = await cropImage(rawDataUrl, rect);
    const filename = `area-${getSanitizedDomain(activeTab.url)}-${Date.now()}.png`;

    await processAndPresentScreenshot({
      dataUrl: croppedDataUrl,
      sourceUrl: activeTab.url,
      pageTitle: activeTab.title || 'Area Selection',
      filename,
      type: 'area'
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleStartFullPage() {
  let tabId = null;
  try {
    const tab = await getActiveTab();
    tabId = tab.id;

    activeCaptures.set(tabId, {
      cancelled: false,
      current: 0,
      total: 0,
      percent: 0
    });

    await ensureContentScriptInjected(tabId);

    // Prepare tab (hides scrollbars, disables smooth scroll, scrolls to top)
    const metrics = await chrome.tabs.sendMessage(tabId, { action: 'prepare_full_page' });
    if (!metrics) {
      throw new Error('Failed to retrieve page dimensions.');
    }

    const { totalHeight, viewportWidth, viewportHeight, dpr } = metrics;

    // Calculate scroll steps
    const steps = [];
    let currentY = 0;
    while (currentY < totalHeight) {
      steps.push(currentY);
      if (currentY + viewportHeight >= totalHeight) {
        break;
      }
      currentY += viewportHeight;
      if (currentY + viewportHeight > totalHeight && currentY < totalHeight) {
        steps.push(totalHeight - viewportHeight);
        break;
      }
    }

    // Limit maximum slices to prevent memory exhaustion on endless scrolling feeds
    const maxSlices = 40;
    const effectiveSteps = steps.slice(0, maxSlices);

    // Update status and badge
    activeCaptures.set(tabId, {
      cancelled: false,
      current: 0,
      total: effectiveSteps.length,
      percent: 0
    });

    try {
      await chrome.action.setBadgeText({ text: '0%', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#2563eb', tabId });
    } catch (_) {}

    const slices = [];
    for (let i = 0; i < effectiveSteps.length; i++) {
      if (activeCaptures.get(tabId)?.cancelled) {
        await chrome.tabs.sendMessage(tabId, { action: 'cleanup_full_page' });
        activeCaptures.delete(tabId);
        try {
          await chrome.action.setBadgeText({ text: '', tabId });
        } catch (_) {}
        return { success: false, error: 'Capture cancelled.' };
      }

      const percent = Math.round(((i + 1) / effectiveSteps.length) * 100);
      activeCaptures.set(tabId, {
        cancelled: false,
        current: i + 1,
        total: effectiveSteps.length,
        percent
      });

      // Update toolbar icon badge and broadcast to popup
      try {
        await chrome.action.setBadgeText({ text: `${percent}%`, tabId });
      } catch (_) {}

      chrome.runtime.sendMessage({
        action: 'capture_progress',
        current: i + 1,
        total: effectiveSteps.length,
        percent
      }).catch(() => {});

      await chrome.tabs.sendMessage(tabId, {
        action: 'scroll_to_step',
        y: effectiveSteps[i],
        index: i,
        total: effectiveSteps.length
      });

      // Settle time for rendering
      await new Promise((r) => setTimeout(r, 120));

      const sliceDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      slices.push({
        y: effectiveSteps[i],
        dataUrl: sliceDataUrl
      });
    }

    // Restore page state
    await chrome.tabs.sendMessage(tabId, { action: 'cleanup_full_page' });
    activeCaptures.delete(tabId);
    try {
      await chrome.action.setBadgeText({ text: '', tabId });
    } catch (_) {}

    // Stitch images into single canvas
    const stitchedDataUrl = await stitchSlices(slices, totalHeight, viewportWidth, dpr);
    const filename = `fullpage-${getSanitizedDomain(tab.url)}-${Date.now()}.png`;

    await processAndPresentScreenshot({
      dataUrl: stitchedDataUrl,
      sourceUrl: tab.url,
      pageTitle: tab.title || 'Full Page Screenshot',
      filename,
      type: 'fullpage'
    });

    return { success: true };
  } catch (err) {
    if (tabId) {
      activeCaptures.delete(tabId);
      try {
        await chrome.action.setBadgeText({ text: '', tabId });
      } catch (_) {}
      try {
        await chrome.tabs.sendMessage(tabId, { action: 'cleanup_full_page' });
      } catch (_) {}
    }
    return { success: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------
// Image Processing (OffscreenCanvas)
// -----------------------------------------------------------------------------

async function cropImage(dataUrl, rect) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);

  const sx = Math.max(0, Math.round(rect.x * rect.dpr));
  const sy = Math.max(0, Math.round(rect.y * rect.dpr));
  const sw = Math.min(bmp.width - sx, Math.round(rect.width * rect.dpr));
  const sh = Math.min(bmp.height - sy, Math.round(rect.height * rect.dpr));

  if (sw <= 0 || sh <= 0) {
    bmp.close();
    throw new Error('Invalid crop dimensions.');
  }

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(croppedBlob);
}

async function stitchSlices(slices, totalHeight, viewportWidth, dpr) {
  if (slices.length === 1) {
    return slices[0].dataUrl;
  }

  const targetWidth = Math.round(viewportWidth * dpr);
  // Cap height to 32768 to prevent exceeding browser canvas limits
  const targetHeight = Math.min(Math.round(totalHeight * dpr), 32768);

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');

  for (const slice of slices) {
    const res = await fetch(slice.dataUrl);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const dy = Math.round(slice.y * dpr);

    ctx.drawImage(bmp, 0, dy);
    bmp.close();
  }

  const stitchedBlob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(stitchedBlob);
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

// -----------------------------------------------------------------------------
// Delivery and Storage
// -----------------------------------------------------------------------------

async function processAndPresentScreenshot(screenshotItem) {
  const id = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  screenshotItem.id = id;
  screenshotItem.createdAt = Date.now();

  inMemoryScreenshots.set(id, screenshotItem);

  // Keep max 10 in memory
  if (inMemoryScreenshots.size > 10) {
    const oldestKey = inMemoryScreenshots.keys().next().value;
    inMemoryScreenshots.delete(oldestKey);
  }

  // Persist to storage for tab reload persistence
  await chrome.storage.local.set({
    [id]: screenshotItem,
    latestScreenshotId: id
  });

  // Check user preference for auto download
  const settings = await chrome.storage.local.get(['autoDownload']);
  if (settings.autoDownload) {
    await chrome.downloads.download({
      url: screenshotItem.dataUrl,
      filename: screenshotItem.filename,
      saveAs: false
    });
  }

  // Open viewer tab
  const viewerUrl = chrome.runtime.getURL(`viewer/viewer.html?id=${id}`);
  await chrome.tabs.create({ url: viewerUrl });
}

async function handleGetScreenshotData(id) {
  if (id && inMemoryScreenshots.has(id)) {
    return inMemoryScreenshots.get(id);
  }
  const lookup = id ? [id] : ['latestScreenshotId'];
  const data = await chrome.storage.local.get(lookup);
  if (id && data[id]) {
    return data[id];
  }
  if (!id && data.latestScreenshotId) {
    const latest = await chrome.storage.local.get(data.latestScreenshotId);
    return latest[data.latestScreenshotId] || null;
  }
  return null;
}
