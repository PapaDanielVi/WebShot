document.addEventListener('DOMContentLoaded', async () => {
  const mainView = document.getElementById('main-view');
  const progressView = document.getElementById('progress-view');

  const btnFullPage = document.getElementById('btn-full-page');
  const btnSelectArea = document.getElementById('btn-select-area');
  const btnVisibleArea = document.getElementById('btn-visible-area');
  const chkAutoDownload = document.getElementById('chk-auto-download');
  const statusBox = document.getElementById('status-box');

  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressStatusText = document.getElementById('progress-status-text');
  const progressSliceCount = document.getElementById('progress-slice-count');
  const progressPercent = document.getElementById('progress-percent');
  const btnCancelCapture = document.getElementById('btn-cancel-capture');

  // Load preferences
  const settings = await chrome.storage.local.get(['autoDownload']);
  chkAutoDownload.checked = Boolean(settings.autoDownload);

  chkAutoDownload.addEventListener('change', async () => {
    await chrome.storage.local.set({ autoDownload: chkAutoDownload.checked });
  });

  function showError(msg) {
    statusBox.textContent = msg;
    statusBox.classList.remove('hidden');
  }

  function clearError() {
    statusBox.textContent = '';
    statusBox.classList.add('hidden');
  }

  function showProgressView() {
    clearError();
    mainView.classList.add('hidden');
    progressView.classList.remove('hidden');
  }

  function showMainView() {
    progressView.classList.add('hidden');
    mainView.classList.remove('hidden');
    progressBarFill.style.width = '0%';
    progressSliceCount.textContent = 'Slice 0 of 0';
    progressPercent.textContent = '0%';
    progressStatusText.textContent = 'Preparing webpage...';
  }

  // Listen for progress updates from background service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'capture_progress') {
      showProgressView();
      progressStatusText.textContent = 'Scrolling and capturing...';
      progressSliceCount.textContent = `Slice ${message.current} of ${message.total}`;
      progressPercent.textContent = `${message.percent}%`;
      progressBarFill.style.width = `${message.percent}%`;
    }
  });

  // Check if capture is already in progress (e.g. user re-opened popup)
  try {
    const status = await chrome.runtime.sendMessage({ action: 'get_active_capture_status' });
    if (status && status.inProgress) {
      showProgressView();
      progressSliceCount.textContent = `Slice ${status.current} of ${status.total}`;
      progressPercent.textContent = `${status.percent}%`;
      progressBarFill.style.width = `${status.percent}%`;
    }
  } catch (_) {
    // Ignore if background not ready
  }

  // Cancel capture button
  btnCancelCapture.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'cancel_capture' });
    } catch (_) {}
    showMainView();
  });

  // 1. Full Page
  btnFullPage.addEventListener('click', async () => {
    try {
      showProgressView();
      const response = await chrome.runtime.sendMessage({ action: 'start_full_page' });

      if (!response || !response.success) {
        showMainView();
        if (response && response.error && response.error !== 'Capture cancelled.') {
          showError(response.error);
        }
        return;
      }

      window.close();
    } catch (err) {
      showMainView();
      showError(err.message || 'Error initiating full page capture.');
    }
  });

  // 2. Select Area
  btnSelectArea.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'start_area_selection' });
      if (response && !response.success) {
        showError(response.error || 'Failed to start area selection.');
        return;
      }
      window.close();
    } catch (err) {
      showError(err.message || 'Error starting area selection.');
    }
  });

  // 3. Visible Area
  btnVisibleArea.addEventListener('click', async () => {
    try {
      btnVisibleArea.disabled = true;
      btnVisibleArea.style.opacity = '0.6';

      const response = await chrome.runtime.sendMessage({ action: 'capture_visible' });
      if (response && !response.success) {
        showError(response.error || 'Failed to capture visible screen.');
        btnVisibleArea.disabled = false;
        btnVisibleArea.style.opacity = '1';
        return;
      }

      window.close();
    } catch (err) {
      showError(err.message || 'Error capturing visible screen.');
      btnVisibleArea.disabled = false;
      btnVisibleArea.style.opacity = '1';
    }
  });
});
