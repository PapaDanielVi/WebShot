document.addEventListener('DOMContentLoaded', async () => {
  const metaFilename = document.getElementById('meta-filename');
  const metaDimensions = document.getElementById('meta-dimensions');
  const metaSize = document.getElementById('meta-size');

  const viewport = document.getElementById('viewport');
  const imageWrapper = document.getElementById('image-wrapper');
  const previewImg = document.getElementById('preview-image');

  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const btnZoom100 = document.getElementById('btn-zoom-100');
  const zoomLevel = document.getElementById('zoom-level');

  const btnCopy = document.getElementById('btn-copy');
  const copyBtnText = document.getElementById('copy-btn-text');
  const btnDownloadPng = document.getElementById('btn-download-png');
  const btnDownloadJpg = document.getElementById('btn-download-jpg');

  let currentDataUrl = null;
  let currentFilename = 'screenshot.png';
  let naturalW = 0;
  let naturalH = 0;
  let currentScale = 1;
  let isFitMode = true;

  // 1. Get screenshot ID from URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const screenshotId = urlParams.get('id');

  // 2. Fetch screenshot data
  let data = null;
  try {
    data = await chrome.runtime.sendMessage({
      action: 'get_screenshot_data',
      id: screenshotId
    });
  } catch (_) {
    // Service worker might be waking up; try storage fallback
  }

  if (!data && screenshotId) {
    const stored = await chrome.storage.local.get(screenshotId);
    data = stored[screenshotId];
  }

  if (!data) {
    const latest = await chrome.storage.local.get(['latestScreenshotId']);
    if (latest.latestScreenshotId) {
      const stored = await chrome.storage.local.get(latest.latestScreenshotId);
      data = stored[latest.latestScreenshotId];
    }
  }

  if (!data || !data.dataUrl) {
    metaFilename.textContent = 'No screenshot found.';
    return;
  }

  currentDataUrl = data.dataUrl;
  currentFilename = data.filename || 'screenshot.png';
  metaFilename.textContent = currentFilename;
  document.title = `${currentFilename} - WebShot`;

  // Estimate size
  const estBytes = Math.round((currentDataUrl.length * 3) / 4);
  if (estBytes > 1024 * 1024) {
    metaSize.textContent = `${(estBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    metaSize.textContent = `${Math.round(estBytes / 1024)} KB`;
  }

  // Load Image
  previewImg.src = currentDataUrl;
  previewImg.onload = () => {
    naturalW = previewImg.naturalWidth;
    naturalH = previewImg.naturalHeight;
    metaDimensions.textContent = `${naturalW} × ${naturalH} px`;

    applyFitZoom();
  };

  // ---------------------------------------------------------------------------
  // Zoom Handling
  // ---------------------------------------------------------------------------

  function applyFitZoom() {
    isFitMode = true;
    btnZoomFit.classList.add('active');
    btnZoom100.classList.remove('active');
    imageWrapper.classList.remove('zoomed-100');

    const availableWidth = viewport.clientWidth - 64;
    const availableHeight = viewport.clientHeight - 64;

    const scaleW = availableWidth / naturalW;
    const scaleH = availableHeight / naturalH;

    // Scale so it fits width, or min of both if smaller than viewport
    let fitScale = Math.min(scaleW, 1.0);
    if (naturalH * fitScale > availableHeight && naturalW <= availableWidth) {
      fitScale = Math.min(scaleH, 1.0);
    }

    currentScale = Math.max(fitScale, 0.1);
    renderZoom();
  }

  function apply100Zoom() {
    isFitMode = false;
    btnZoomFit.classList.remove('active');
    btnZoom100.classList.add('active');
    imageWrapper.classList.add('zoomed-100');

    currentScale = 1.0;
    renderZoom();
  }

  function renderZoom() {
    const targetW = Math.round(naturalW * currentScale);
    imageWrapper.style.width = `${targetW}px`;
    zoomLevel.textContent = `${Math.round(currentScale * 100)}%`;
  }

  function adjustZoom(delta) {
    isFitMode = false;
    btnZoomFit.classList.remove('active');
    btnZoom100.classList.remove('active');

    let newScale = currentScale + delta;
    if (newScale < 0.1) newScale = 0.1;
    if (newScale > 3.0) newScale = 3.0;

    currentScale = newScale;
    if (Math.abs(currentScale - 1.0) < 0.05) {
      currentScale = 1.0;
      btnZoom100.classList.add('active');
      imageWrapper.classList.add('zoomed-100');
    } else {
      imageWrapper.classList.remove('zoomed-100');
    }
    renderZoom();
  }

  btnZoomFit.addEventListener('click', applyFitZoom);
  btnZoom100.addEventListener('click', apply100Zoom);
  btnZoomIn.addEventListener('click', () => adjustZoom(0.15));
  btnZoomOut.addEventListener('click', () => adjustZoom(-0.15));

  imageWrapper.addEventListener('click', () => {
    if (isFitMode) {
      apply100Zoom();
    } else {
      applyFitZoom();
    }
  });

  window.addEventListener('resize', () => {
    if (isFitMode) {
      applyFitZoom();
    }
  });

  // ---------------------------------------------------------------------------
  // Export Actions
  // ---------------------------------------------------------------------------

  // Copy to clipboard
  btnCopy.addEventListener('click', async () => {
    try {
      copyBtnText.textContent = 'Copying...';
      const res = await fetch(currentDataUrl);
      const blob = await res.blob();

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);

      copyBtnText.textContent = 'Copied!';
      btnCopy.style.borderColor = '#10b981';
      btnCopy.style.color = '#34d399';

      setTimeout(() => {
        copyBtnText.textContent = 'Copy';
        btnCopy.style.borderColor = '';
        btnCopy.style.color = '';
      }, 2000);
    } catch (err) {
      copyBtnText.textContent = 'Failed';
      setTimeout(() => {
        copyBtnText.textContent = 'Copy';
      }, 2000);
    }
  });

  // Download PNG
  function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  btnDownloadPng.addEventListener('click', () => {
    triggerDownload(currentDataUrl, currentFilename);
  });

  // Download JPEG
  btnDownloadJpg.addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext('2d');

    // Fill white background for JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, naturalW, naturalH);
    ctx.drawImage(previewImg, 0, 0);

    const jpgUrl = canvas.toDataURL('image/jpeg', 0.92);
    const jpgFilename = currentFilename.replace(/\.png$/i, '.jpg');
    triggerDownload(jpgUrl, jpgFilename);
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      btnCopy.click();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      btnDownloadPng.click();
    } else if (e.key === '0') {
      applyFitZoom();
    } else if (e.key === '1') {
      apply100Zoom();
    } else if (e.key === '+' || e.key === '=') {
      adjustZoom(0.15);
    } else if (e.key === '-') {
      adjustZoom(-0.15);
    }
  });
});
