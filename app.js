/**
 * RECAP VAULT - Client Application Logic
 * Warehouse & Storage for AI Recaps with Supabase Cloud Integration
 */

document.addEventListener('DOMContentLoaded', () => {
  // ================= STATE =================
  let allRecaps = [];
  let filteredRecaps = [];
  let activeFilter = 'all';
  let searchQuery = '';
  let sortOrder = 'newest';
  let supabaseClient = null;
  let supabaseConfig = {
    supabase_url: '',
    supabase_key: '',
    auto_sync: false
  };

  // ================= DOM ELEMENTS =================
  // Header & Status
  const statusIndicator = document.getElementById('statusIndicator');
  const statusLabel = document.getElementById('statusLabel');
  const btnSyncCloud = document.getElementById('btnSyncCloud');
  const btnOpenSettings = document.getElementById('btnOpenSettings');

  // Stats Dashboard
  const statTotalClips = document.getElementById('statTotalClips');
  const statTotalCovers = document.getElementById('statTotalCovers');
  const statTotalSeries = document.getElementById('statTotalSeries');

  // Filter & Search Controls
  const searchInput = document.getElementById('searchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const filterPillsRow = document.getElementById('filterPillsRow');
  const countAll = document.getElementById('countAll');
  const sortSelect = document.getElementById('sortSelect');

  // Grid
  const inventoryGrid = document.getElementById('inventoryGrid');
  const loadingState = document.getElementById('loadingState');

  // Video Modal
  const videoModal = document.getElementById('videoModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const modalVideoPlayer = document.getElementById('modalVideoPlayer');
  const modalSeriesBadge = document.getElementById('modalSeriesBadge');
  const modalTitle = document.getElementById('modalTitle');
  const modalDuration = document.getElementById('modalDuration');
  const modalDate = document.getElementById('modalDate');
  const modalTitlesList = document.getElementById('modalTitlesList');
  const modalDescription = document.getElementById('modalDescription');
  const btnCopyModalDesc = document.getElementById('btnCopyModalDesc');
  const modalDownloadVideo = document.getElementById('modalDownloadVideo');
  const modalDownloadCover = document.getElementById('modalDownloadCover');

  // Supabase Settings Modal
  const settingsModal = document.getElementById('settingsModal');
  const settingsBackdrop = document.getElementById('settingsBackdrop');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const supabaseForm = document.getElementById('supabaseForm');
  const supabaseUrlInput = document.getElementById('supabaseUrlInput');
  const supabaseKeyInput = document.getElementById('supabaseKeyInput');
  const btnTestSupabase = document.getElementById('btnTestSupabase');
  const btnSaveSupabase = document.getElementById('btnSaveSupabase');
  const btnCopySql = document.getElementById('btnCopySql');
  const sqlCodeBlock = document.getElementById('sqlCodeBlock');

  // Toast
  const vaultToast = document.getElementById('vaultToast');
  const toastMessage = document.getElementById('toastMessage');
  let toastTimeout = null;

  // ================= TOAST NOTIFICATION =================
  function showToast(message, icon = 'fa-circle-check', duration = 3000) {
    if (!vaultToast) return;
    toastMessage.textContent = message;
    
    const iconEl = vaultToast.querySelector('.toast-icon');
    if (iconEl) {
      iconEl.className = `fa-solid ${icon} toast-icon`;
    }

    vaultToast.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      vaultToast.classList.remove('show');
    }, duration);
  }

  // ================= 1-CLICK CLIPBOARD COPY =================
  async function copyToClipboard(text, successMsg = 'คัดลอกข้อความสำเร็จ!') {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      showToast(successMsg, 'fa-copy');
    } catch (err) {
      console.error('Failed to copy: ', err);
      showToast('ไม่สามารถคัดลอกได้', 'fa-triangle-exclamation');
    }
  }

  // ================= SUPABASE CLIENT INITIALIZATION =================
  function initSupabase(url, key) {
    if (!url || !key || typeof window.supabase === 'undefined') {
      supabaseClient = null;
      updateStatusBadge(false);
      return false;
    }
    try {
      supabaseClient = window.supabase.createClient(url.trim(), key.trim());
      updateStatusBadge(true);
      return true;
    } catch (e) {
      console.error('Supabase init error:', e);
      supabaseClient = null;
      updateStatusBadge(false);
      return false;
    }
  }

  function updateStatusBadge(isConnected) {
    if (isConnected) {
      statusIndicator.classList.add('connected');
      statusLabel.textContent = 'SUPABASE CLOUD CONNECTED';
      statusLabel.style.color = '#00ff88';
    } else {
      statusIndicator.classList.remove('connected');
      statusLabel.textContent = 'LOCAL VAULT MODE';
      statusLabel.style.color = '#ffd23f';
    }
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const serverConfig = await res.json();
        const envUrlText = document.getElementById('envSupabaseUrlText');
        const envStatusBadge = document.getElementById('envStatusBadge');
        if (envUrlText) envUrlText.textContent = serverConfig.supabase_url || '(ยังไม่ได้ระบุใน .env)';
        
        if (envStatusBadge) {
          if (serverConfig.configured) {
            envStatusBadge.textContent = 'CONFIGURED IN .ENV';
            envStatusBadge.style.background = 'rgba(0, 255, 136, 0.2)';
            envStatusBadge.style.color = '#00ff88';
            updateStatusBadge(true);
          } else {
            envStatusBadge.textContent = 'NOT CONFIGURED';
            envStatusBadge.style.background = 'rgba(255, 210, 63, 0.2)';
            envStatusBadge.style.color = '#ffd23f';
            updateStatusBadge(false);
          }
        }
      } else {
        updateStatusBadge(false);
      }
    } catch (e) {
      console.warn('Could not load server config:', e);
      updateStatusBadge(false);
    }
  }

  async function loadRecapsData() {
    try {
      if (loadingState) loadingState.style.display = 'flex';

      let localData = [];
      let cloudData = [];

      // 1. Fetch from Local Server API
      try {
        const localRes = await fetch('/api/recaps');
        if (localRes.ok) {
          const json = await localRes.json();
          localData = json.data || [];
        }
      } catch (err) {
        console.warn('Local API /api/recaps not reachable:', err);
      }

      // 2. Fetch from Supabase Cloud if connected
      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient
            .from('recaps')
            .select('*')
            .order('created_at', { ascending: false });

          if (!error && data) {
            cloudData = data;
          }
        } catch (supabaseErr) {
          console.warn('Failed to query Supabase cloud table:', supabaseErr);
        }
      }

      // 3. Merge Local and Cloud Data (Local video/cover endpoints take priority for smooth local streaming)
      const dataMap = new Map();

      // First add cloud items
      cloudData.forEach(item => {
        dataMap.set(item.id, { ...item, source: 'cloud' });
      });

      // Merge local items (ensuring media paths are accessible via local streaming)
      localData.forEach(item => {
        if (dataMap.has(item.id)) {
          const existing = dataMap.get(item.id);
          dataMap.set(item.id, {
            ...existing,
            ...item,
            source: 'synced',
            local_video_url: item.local_video_url,
            local_thumbnail_url: item.local_thumbnail_url
          });
        } else {
          dataMap.set(item.id, { ...item, source: 'local' });
        }
      });

      allRecaps = Array.from(dataMap.values());

      updateStats();
      renderFilterPills();
      applyFilterAndSort();
    } catch (e) {
      console.error('Error loading vault recaps:', e);
      if (inventoryGrid) {
        inventoryGrid.innerHTML = `
          <div class="empty-vault-state">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 40px; color: #ff4757; margin-bottom: 12px;"></i>
            <h3>เกิดข้อผิดพลาดในการโหลดคลังข้อมูล</h3>
            <p>${e.message}</p>
          </div>
        `;
      }
    } finally {
      if (loadingState) loadingState.style.display = 'none';
    }
  }

  // ================= STATS UPDATE =================
  function updateStats() {
    const totalClips = allRecaps.length;
    const totalCovers = allRecaps.filter(r => r.thumbnail_file || r.local_thumbnail_url || r.thumbnail_url).length;
    const uniqueSeries = new Set(allRecaps.map(r => r.series).filter(Boolean)).size;

    if (statTotalClips) statTotalClips.textContent = totalClips;
    if (statTotalCovers) statTotalCovers.textContent = totalCovers;
    if (statTotalSeries) statTotalSeries.textContent = uniqueSeries || 1;
    if (countAll) countAll.textContent = totalClips;
  }

  // ================= DYNAMIC FILTER PILLS =================
  function renderFilterPills() {
    if (!filterPillsRow) return;
    const seriesSet = new Set(allRecaps.map(r => r.series).filter(Boolean));

    let html = `
      <button type="button" class="filter-pill ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">
        <i class="fa-solid fa-border-all"></i> ทั้งหมด (<span id="countAll">${allRecaps.length}</span>)
      </button>
    `;

    seriesSet.forEach(seriesName => {
      const count = allRecaps.filter(r => r.series === seriesName).length;
      const isActive = activeFilter === seriesName;
      let icon = 'fa-atom';
      if (seriesName.toLowerCase().includes('alien')) icon = 'fa-shield-halved';
      if (seriesName.toLowerCase().includes('classic')) icon = 'fa-clock-rotate-left';

      html += `
        <button type="button" class="filter-pill ${isActive ? 'active' : ''}" data-filter="${seriesName}">
          <i class="fa-solid ${icon}"></i> ${seriesName} (${count})
        </button>
      `;
    });

    filterPillsRow.innerHTML = html;

    // Attach click events
    filterPillsRow.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        filterPillsRow.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeFilter = pill.dataset.filter;
        applyFilterAndSort();
      });
    });
  }

  // ================= FILTER, SEARCH & SORT =================
  function applyFilterAndSort() {
    let result = [...allRecaps];

    // Filter by Series
    if (activeFilter !== 'all') {
      result = result.filter(item => item.series === activeFilter);
    }

    // Search Query (title, series, tags, description)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(item => {
        const titleMatch = (item.title || '').toLowerCase().includes(q);
        const seriesMatch = (item.series || '').toLowerCase().includes(q);
        const descMatch = (item.description || '').toLowerCase().includes(q);
        const titlesMatch = Array.isArray(item.titles) && item.titles.some(t => {
          return (t.title || t || '').toLowerCase().includes(q);
        });
        const tagsMatch = Array.isArray(item.tags) && item.tags.some(tag => {
          return tag.toLowerCase().includes(q);
        });
        return titleMatch || seriesMatch || descMatch || titlesMatch || tagsMatch;
      });
    }

    // Sort
    result.sort((a, b) => {
      const dateA = new Date(a.created_at || a.folder_name || 0).getTime();
      const dateB = new Date(b.created_at || b.folder_name || 0).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    filteredRecaps = result;
    renderGrid();
  }

  // ================= RENDER INVENTORY GRID =================
  function renderGrid() {
    if (!inventoryGrid) return;

    if (filteredRecaps.length === 0) {
      inventoryGrid.innerHTML = `
        <div class="empty-vault-state" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
          <i class="fa-solid fa-box-open" style="font-size: 48px; margin-bottom: 16px; color: var(--text-secondary);"></i>
          <h3 style="font-size: 20px; color: #fff; margin-bottom: 8px;">ยังไม่พบผลงานคลิปในหมวดหมู่นี้</h3>
          <p>ลองเปลี่ยนคำค้นหา หรือสร้างคลิปใหม่ด้วยคำสั่งพรอมต์ในแชทนี้ได้เลยครับ</p>
        </div>
      `;
      return;
    }

    inventoryGrid.innerHTML = filteredRecaps.map(item => createCardHtml(item)).join('');

    // Attach card event listeners
    filteredRecaps.forEach(item => {
      setupCardInteractions(item);
    });
  }

  function normalizeTitles(item) {
    const styleLabels = ['สไตล์ 1: Hook', 'สไตล์ 2: เนื้อเรื่อง', 'สไตล์ 3: สั้นกระชับ'];
    const rawTitles = Array.isArray(item.titles) && item.titles.length > 0 ? item.titles : [item.title || 'Ben 10 Recap'];
    return rawTitles.map((t, idx) => {
      if (typeof t === 'string') {
        return { style: styleLabels[idx] || `สไตล์ ${idx + 1}`, title: t };
      }
      return { style: t.style || styleLabels[idx] || `สไตล์ ${idx + 1}`, title: t.title || String(t) };
    });
  }

  function createCardHtml(item) {
    const thumbUrl = item.local_thumbnail_url || item.thumbnail_url || '/placeholder.jpg';
    const videoUrl = item.local_video_url || item.video_url || '#';
    const duration = item.duration || '0:45';
    const series = item.series || 'Omniverse';
    const titles = normalizeTitles(item);
    const mainTitle = item.title || titles[0].title;

    let cloudBadge = '';
    if (item.source === 'synced' || item.source === 'cloud') {
      cloudBadge = `<span class="card-floating-badge badge-top-left" style="background: rgba(0, 255, 136, 0.2);"><i class="fa-solid fa-cloud"></i> CLOUD</span>`;
    } else {
      cloudBadge = `<span class="card-floating-badge badge-top-left"><i class="fa-solid fa-folder"></i> ${item.folder_name || 'LOCAL'}</span>`;
    }

    return `
      <article class="vault-card" id="card-${item.id}" data-id="${item.id}">
        <!-- 9:16 Vertical Thumbnail Preview -->
        <div class="card-media-wrapper" data-action="open-modal" title="คลิกเพื่อรับชมวิดีโอ & ดูรายละเอียด">
          <img src="${thumbUrl}" alt="${mainTitle}" class="card-thumbnail-img" loading="lazy">
          ${cloudBadge}
          <span class="card-floating-badge badge-top-right">
            <i class="fa-regular fa-clock"></i> ${duration}
          </span>
          <div class="media-hover-overlay">
            <div class="btn-play-pulse">
              <i class="fa-solid fa-play"></i>
            </div>
            <span class="hover-play-label">เปิดรับชม</span>
          </div>
        </div>

        <!-- Compact Card Body -->
        <div class="card-content">
          <div class="card-meta-row">
            <span class="card-series-tag"><i class="fa-solid fa-tag"></i> ${series}</span>
          </div>

          <h3 class="card-main-title" title="${mainTitle}" data-action="open-modal">
            ${mainTitle}
          </h3>

          <!-- Sleek Compact Action Bar -->
          <div class="card-bottom-actions">
            <button type="button" class="btn-card-action btn-watch-card" data-action="open-modal" title="เปิดดูวิดีโอ & คัดลอกชื่อ 3 สไตล์">
              <i class="fa-solid fa-circle-play"></i> รับชม
            </button>
            <button type="button" class="btn-card-action btn-copy-card" data-action="copy-title" title="คัดลอกชื่อคลิปไวรัลทันที">
              <i class="fa-regular fa-copy"></i>
            </button>
            <button type="button" class="btn-card-action btn-del-card" data-action="delete" title="ลบคลิปนี้">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function setupCardInteractions(item) {
    const cardEl = document.getElementById(`card-${item.id}`);
    if (!cardEl) return;

    // 1. Open Video Modal on Click Media, Watch button, or Title
    cardEl.querySelectorAll('[data-action="open-modal"]').forEach(trigger => {
      trigger.addEventListener('click', () => openVideoModal(item));
    });

    // 2. Delete Button on Card
    cardEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteConfirm(item);
      });
    });

    // 3. Quick 1-Click Copy Best Title Button
    cardEl.querySelectorAll('[data-action="copy-title"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const titles = normalizeTitles(item);
        const titleToCopy = (titles[0] && titles[0].title) || item.title || '';
        copyToClipboard(titleToCopy, 'คัดลอกชื่อคลิปแล้ว!');
        
        // Visual checkmark feedback on button
        const origHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--neon-green);"></i>';
        setTimeout(() => {
          btn.innerHTML = origHtml;
        }, 1500);
      });
    });
  }

  // ================= VIDEO THEATER MODAL =================
  function openVideoModal(item) {
    if (!videoModal) return;

    const videoUrl = item.local_video_url || item.video_url || '';
    const thumbUrl = item.local_thumbnail_url || item.thumbnail_url || '';

    modalSeriesBadge.textContent = (item.series || 'OMNIVERSE').toUpperCase();
    modalTitle.textContent = item.title || 'Ben 10 Recap';
    modalDuration.textContent = item.duration || '45s';
    modalDate.textContent = item.created_at ? new Date(item.created_at).toLocaleDateString('th-TH') : (item.folder_name || '-');

    // Setup Video Player
    modalVideoPlayer.src = videoUrl;
    modalVideoPlayer.poster = thumbUrl;
    modalVideoPlayer.load();
    modalVideoPlayer.play().catch(e => console.log('Autoplay prevented by browser:', e));

    // Render Titles List with individual copy buttons
    const titles = normalizeTitles(item);

    modalTitlesList.innerHTML = titles.map((t, idx) => `
      <div class="modal-title-item">
        <div>
          <span style="font-size: 11px; color: var(--neon-cyan); display: block; font-weight: 600;">
            ${t.style}
          </span>
          <span class="m-title-text" id="mTitle-${idx}">${t.title}</span>
        </div>
        <button type="button" class="btn-copy-small" data-copy-idx="${idx}">
          <i class="fa-regular fa-copy"></i> ก็อปปี้
        </button>
      </div>
    `).join('');

    // Attach copy events for titles inside modal
    modalTitlesList.querySelectorAll('.btn-copy-small').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.copyIdx;
        const textEl = document.getElementById(`mTitle-${idx}`);
        if (textEl) {
          copyToClipboard(textEl.textContent, 'คัดลอกชื่อคลิปสำเร็จ!');
        }
      });
    });

    // Setup Description & Hashtags
    const descText = item.description || 'ไม่มีคำอธิบาย';
    modalDescription.textContent = descText;

    btnCopyModalDesc.onclick = () => {
      copyToClipboard(descText, 'คัดลอกคำอธิบายและแฮชแท็กแล้ว!');
    };

    // Download Links
    modalDownloadVideo.href = videoUrl;
    modalDownloadCover.href = thumbUrl;

    // Delete Button inside Modal
    const btnModalDeleteClip = document.getElementById('btnModalDeleteClip');
    if (btnModalDeleteClip) {
      btnModalDeleteClip.onclick = () => {
        openDeleteConfirm(item);
      };
    }

    // YouTube Schedule Button inside Modal
    const btnOpenYouTubeSchedule = document.getElementById('btnOpenYouTubeSchedule');
    if (btnOpenYouTubeSchedule) {
      btnOpenYouTubeSchedule.onclick = () => {
        openYouTubeScheduleModal(item);
      };
    }

    // Show Modal
    videoModal.classList.add('open');
    videoModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeVideoModal() {
    if (!videoModal) return;
    modalVideoPlayer.pause();
    modalVideoPlayer.removeAttribute('src');
    modalVideoPlayer.load();
    videoModal.classList.remove('open');
    videoModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeVideoModal);
  if (modalBackdrop) modalBackdrop.addEventListener('click', closeVideoModal);

  // ================= DELETE CONFIRMATION MODAL =================
  let pendingDeleteItem = null;
  const deleteConfirmModal = document.getElementById('deleteConfirmModal');
  const deleteConfirmBackdrop = document.getElementById('deleteConfirmBackdrop');
  const btnCloseDeleteModal = document.getElementById('btnCloseDeleteModal');
  const btnCancelDelete = document.getElementById('btnCancelDelete');
  const btnConfirmDelete = document.getElementById('btnConfirmDelete');
  const deleteConfirmTitleText = document.getElementById('deleteConfirmTitleText');

  function openDeleteConfirm(item) {
    pendingDeleteItem = item;
    if (deleteConfirmTitleText) {
      deleteConfirmTitleText.innerHTML = `คุณกำลังจะลบคลิป <strong style="color: #fff;">"${item.title}"</strong> ออกจากทั้งเครื่องและ Supabase อย่างถาวร`;
    }
    if (deleteConfirmModal) {
      deleteConfirmModal.classList.add('open');
      deleteConfirmModal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeDeleteConfirm() {
    pendingDeleteItem = null;
    if (deleteConfirmModal) {
      deleteConfirmModal.classList.remove('open');
      deleteConfirmModal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  }

  if (btnCloseDeleteModal) btnCloseDeleteModal.addEventListener('click', closeDeleteConfirm);
  if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteConfirm);
  if (deleteConfirmBackdrop) deleteConfirmBackdrop.addEventListener('click', closeDeleteConfirm);

  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener('click', async () => {
      if (!pendingDeleteItem) return;
      const itemToDelete = pendingDeleteItem;
      btnConfirmDelete.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> กำลังลบ...';
      btnConfirmDelete.disabled = true;

      try {
        const res = await fetch(`/api/recaps/${itemToDelete.id}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
          showToast(`ลบคลิป "${itemToDelete.title}" เรียบร้อยแล้ว`, 'fa-trash-can', 3500);
          closeDeleteConfirm();
          closeVideoModal();
          // Remove from local array
          allRecaps = allRecaps.filter(r => r.id !== itemToDelete.id);
          updateStats();
          renderFilterPills();
          applyFilterAndSort();
        } else {
          showToast(`เกิดข้อผิดพลาดในการลบ: ${result.error || 'ไม่สามารถลบได้'}`, 'fa-triangle-exclamation');
        }
      } catch (e) {
        console.error('Delete error:', e);
        showToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อลบคลิปได้', 'fa-triangle-exclamation');
      } finally {
        btnConfirmDelete.innerHTML = '<i class="fa-solid fa-trash-can"></i> ยืนยันลบคลิป';
        btnConfirmDelete.disabled = false;
      }
    });
  }

  // ================= SUPABASE SETTINGS MODAL =================
  function openSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.add('open');
    settingsModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.remove('open');
    settingsModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettingsModal);
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettingsModal);

  // Copy SQL Schema Code
  if (btnCopySql && sqlCodeBlock) {
    btnCopySql.addEventListener('click', () => {
      copyToClipboard(sqlCodeBlock.innerText, 'คัดลอกโค้ด SQL ตาราง Supabase เรียบร้อยแล้ว!');
    });
  }

  // Sync from Modal Button
  const btnSyncFromModal = document.getElementById('btnSyncFromModal');
  if (btnSyncFromModal) {
    btnSyncFromModal.addEventListener('click', async () => {
      btnSyncFromModal.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> กำลังซิงค์...';
      btnSyncFromModal.disabled = true;
      try {
        const res = await fetch('/api/sync', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
          showToast('ซิงค์ผลงานทั้งหมดขึ้น Supabase สำเร็จ!', 'fa-cloud-arrow-up');
          closeSettingsModal();
          await loadRecapsData();
        } else {
          showToast(`ผลการซิงค์: ${result.output || 'กรุณารัน SQL สร้างตารางก่อน'}`, 'fa-triangle-exclamation', 5000);
        }
      } catch (e) {
        showToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อซิงค์ได้', 'fa-triangle-exclamation');
      } finally {
        btnSyncFromModal.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> ซิงค์ไฟล์ & ข้อมูลขึ้น Supabase ทันที';
        btnSyncFromModal.disabled = false;
      }
    });
  }

  // Header "ซิงค์ Cloud" Button
  if (btnSyncCloud) {
    btnSyncCloud.addEventListener('click', async () => {
      btnSyncCloud.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>กำลังซิงค์...</span>';
      btnSyncCloud.disabled = true;

      try {
        const res = await fetch('/api/sync', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
          showToast('ซิงค์ผลงานคลิปทั้งหมดกับ Supabase สำเร็จ!', 'fa-cloud-arrow-up');
          await loadRecapsData();
        } else {
          showToast(`ผลการซิงค์: ${result.output || 'ตรวจสอบการตั้งค่า Supabase'}`, 'fa-triangle-exclamation');
        }
      } catch (err) {
        console.error('Sync failed:', err);
        showToast('ไม่สามารถซิงค์ได้ กรุณาตรวจสอบเซิร์ฟเวอร์', 'fa-triangle-exclamation');
      } finally {
        btnSyncCloud.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> <span>ซิงค์ Cloud</span>';
        btnSyncCloud.disabled = false;
      }
    });
  }

  // ================= YOUTUBE SCHEDULING MODAL =================
  let currentYtItem = null;
  const youtubeScheduleModal = document.getElementById('youtubeScheduleModal');
  const ytModalBackdrop = document.getElementById('ytModalBackdrop');
  const btnCloseYtModal = document.getElementById('btnCloseYtModal');
  const btnCancelYtModal = document.getElementById('btnCancelYtModal');
  const ytStatusBadge = document.getElementById('ytStatusBadge');
  const ytSecretUploadBox = document.getElementById('ytSecretUploadBox');
  const ytLoginActionBox = document.getElementById('ytLoginActionBox');
  const ytSecretFileInput = document.getElementById('ytSecretFileInput');
  const btnYtLogin = document.getElementById('btnYtLogin');
  const ytScheduleInput = document.getElementById('ytScheduleInput');
  const ytTitleInput = document.getElementById('ytTitleInput');
  const ytDescInput = document.getElementById('ytDescInput');
  const ytTitleStyleTabs = document.getElementById('ytTitleStyleTabs');
  const ytUploadResultMsg = document.getElementById('ytUploadResultMsg');
  const btnSubmitYtSchedule = document.getElementById('btnSubmitYtSchedule');

  function getISODateTimePreset(preset) {
    const now = new Date();
    if (preset === 'plus-1h') {
      return new Date(now.getTime() + 60 * 60 * 1000);
    }
    if (preset === 'plus-2h') {
      return new Date(now.getTime() + 2 * 60 * 60 * 1000);
    }
    if (preset === 'plus-3h') {
      return new Date(now.getTime() + 3 * 60 * 60 * 1000);
    }
    if (preset === 'today-18') {
      const d = new Date();
      d.setHours(18, 0, 0, 0);
      return d;
    }
    if (preset === 'today-20') {
      const d = new Date();
      d.setHours(20, 0, 0, 0);
      return d;
    }
    if (preset === 'tomorrow-12') {
      const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
      tomorrow.setHours(12, 0, 0, 0);
      return tomorrow;
    }
    if (preset === 'tomorrow-18') {
      const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
      tomorrow.setHours(18, 0, 0, 0);
      return tomorrow;
    }
    return null;
  }

  function formatDateTimeLocal(date) {
    if (!date) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }

  async function checkYouTubeStatus() {
    if (!ytStatusBadge) return;
    try {
      const res = await fetch('/api/youtube/status');
      const data = await res.json();

      if (data.authenticated) {
        ytStatusBadge.textContent = 'พร้อมใช้งาน (เชื่อมต่อสำเร็จแล้ว)';
        ytStatusBadge.style.color = 'var(--neon-green)';
        ytStatusBadge.style.borderColor = 'var(--neon-green)';
        ytStatusBadge.style.background = 'rgba(0, 255, 136, 0.15)';
        if (ytSecretUploadBox) ytSecretUploadBox.style.display = 'none';
        if (ytLoginActionBox) ytLoginActionBox.style.display = 'none';
      } else if (data.client_secret_exists) {
        ytStatusBadge.textContent = 'ต้องยืนยันสิทธิ์ Google ช่อง YouTube 1 ครั้ง';
        ytStatusBadge.style.color = 'var(--neon-gold)';
        ytStatusBadge.style.borderColor = 'var(--neon-gold)';
        ytStatusBadge.style.background = 'rgba(255, 210, 63, 0.15)';
        if (ytSecretUploadBox) ytSecretUploadBox.style.display = 'none';
        if (ytLoginActionBox) ytLoginActionBox.style.display = 'block';
      } else {
        ytStatusBadge.textContent = 'ยังไม่มี client_secret.json';
        ytStatusBadge.style.color = '#ff6b81';
        ytStatusBadge.style.borderColor = '#ff4757';
        ytStatusBadge.style.background = 'rgba(255, 71, 87, 0.15)';
        if (ytSecretUploadBox) ytSecretUploadBox.style.display = 'block';
        if (ytLoginActionBox) ytLoginActionBox.style.display = 'none';
      }
      return data;
    } catch (e) {
      console.error('Check YouTube status error:', e);
    }
  }

  function openYouTubeScheduleModal(item) {
    currentYtItem = item;
    if (!youtubeScheduleModal) return;

    if (ytUploadResultMsg) {
      ytUploadResultMsg.style.display = 'none';
      ytUploadResultMsg.textContent = '';
    }

    // Default: วันล่าสุดเสมอ + ถัดไปอีก 1 ชั่วโมง (เช่น 20:30 -> 21:30)
    const defaultDate = new Date(Date.now() + 60 * 60 * 1000);
    if (ytScheduleInput) {
      ytScheduleInput.value = formatDateTimeLocal(defaultDate);
    }

    const titles = normalizeTitles(item);
    const mainTitle = (titles[0] && titles[0].title) || item.title || '';
    if (ytTitleInput) ytTitleInput.value = mainTitle;

    if (ytTitleStyleTabs) {
      ytTitleStyleTabs.innerHTML = titles.map((t, idx) => `
        <button type="button" class="btn-title-tab ${idx === 0 ? 'active' : ''}" data-idx="${idx}" style="font-size: 10px; padding: 2px 7px; border-radius: 4px;">
          ${t.style || `สไตล์ ${idx + 1}`}
        </button>
      `).join('');

      ytTitleStyleTabs.querySelectorAll('.btn-title-tab').forEach(b => {
        b.addEventListener('click', () => {
          ytTitleStyleTabs.querySelectorAll('.btn-title-tab').forEach(btn => btn.classList.remove('active'));
          b.classList.add('active');
          const idx = parseInt(b.dataset.idx, 10);
          if (titles[idx]) ytTitleInput.value = titles[idx].title;
        });
      });
    }

    if (ytDescInput) {
      ytDescInput.value = item.description || '';
    }

    youtubeScheduleModal.classList.add('open');
    youtubeScheduleModal.setAttribute('aria-hidden', 'false');

    checkYouTubeStatus();
  }

  function closeYouTubeScheduleModal() {
    if (!youtubeScheduleModal) return;
    youtubeScheduleModal.classList.remove('open');
    youtubeScheduleModal.setAttribute('aria-hidden', 'true');
  }

  if (btnCloseYtModal) btnCloseYtModal.addEventListener('click', closeYouTubeScheduleModal);
  if (btnCancelYtModal) btnCancelYtModal.addEventListener('click', closeYouTubeScheduleModal);
  if (ytModalBackdrop) ytModalBackdrop.addEventListener('click', closeYouTubeScheduleModal);

  // Preset buttons
  document.querySelectorAll('.btn-yt-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const hours = btn.dataset.hours;
      if (hours === '0') {
        if (ytScheduleInput) ytScheduleInput.value = '';
        showToast('เลือกโหมด: เผยแพร่ทันที (Public)');
      } else if (preset) {
        const dt = getISODateTimePreset(preset);
        if (dt && ytScheduleInput) {
          ytScheduleInput.value = formatDateTimeLocal(dt);
          showToast(`ตั้งเวลา: ${btn.textContent.trim()}`);
        }
      }
    });
  });

  // Secret file upload
  if (ytSecretFileInput) {
    ytSecretFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = await fetch('/api/youtube/upload-secret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: text
        });
        const d = await res.json();
        if (d.success) {
          showToast('บันทึก client_secret.json สำเร็จแล้ว!');
          checkYouTubeStatus();
        } else {
          alert(d.error || 'ไฟล์ไม่ถูกต้อง');
        }
      } catch (err) {
        alert('เกิดข้อผิดพลาดในการอัปโหลด: ' + err.message);
      }
    });
  }

  // Google OAuth Login Trigger
  if (btnYtLogin) {
    btnYtLogin.addEventListener('click', async () => {
      btnYtLogin.disabled = true;
      btnYtLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเปิดหน้าต่างยืนยันสิทธิ์ Google...';
      try {
        const res = await fetch('/api/youtube/auth', { method: 'POST' });
        const d = await res.json();
        if (d.success) {
          showToast('ยืนยันสิทธิ์ YouTube สำเร็จแล้ว!');
          checkYouTubeStatus();
        } else {
          alert('เข้าสู่ระบบไม่สำเร็จ: ' + (d.error || 'กรุณาลองใหม่อีกครั้ง'));
        }
      } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
      } finally {
        btnYtLogin.disabled = false;
        btnYtLogin.innerHTML = '<i class="fa-brands fa-google"></i> ล็อกอินเข้าสู่ระบบช่อง YouTube (คลิกครั้งเดียว)';
      }
    });
  }

  // Submit Schedule Button
  if (btnSubmitYtSchedule) {
    btnSubmitYtSchedule.addEventListener('click', async () => {
      if (!currentYtItem) return;

      const scheduleVal = ytScheduleInput ? ytScheduleInput.value : '';
      let isoSchedule = null;
      if (scheduleVal) {
        isoSchedule = new Date(scheduleVal).toISOString();
      }

      const payload = {
        clip_id: currentYtItem.id,
        title: ytTitleInput ? ytTitleInput.value.trim() : currentYtItem.title,
        description: ytDescInput ? ytDescInput.value.trim() : currentYtItem.description,
        schedule_time: isoSchedule
      };

      btnSubmitYtSchedule.disabled = true;
      btnSubmitYtSchedule.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังอัปโหลด & ตั้งเวลา...';
      if (ytUploadResultMsg) {
        ytUploadResultMsg.style.display = 'block';
        ytUploadResultMsg.style.background = 'rgba(0, 212, 255, 0.15)';
        ytUploadResultMsg.style.border = '1px solid var(--border-cyan)';
        ytUploadResultMsg.style.color = '#fff';
        ytUploadResultMsg.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> กำลังอัปโหลดไฟล์วิดีโอ Full HD และรูปปกขึ้น YouTube... กรุณารอสักครู่';
      }

      try {
        const res = await fetch('/api/youtube/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const d = await res.json();

        if (d.success) {
          if (ytUploadResultMsg) {
            ytUploadResultMsg.style.background = 'rgba(0, 255, 136, 0.15)';
            ytUploadResultMsg.style.border = '1px solid var(--border-glow)';
            ytUploadResultMsg.style.color = 'var(--neon-green)';
            ytUploadResultMsg.innerHTML = `
              <strong><i class="fa-solid fa-circle-check"></i> สำเร็จ!</strong><br>
              ${d.message || 'ตั้งเวลาโพสต์เรียบร้อยแล้ว'}<br>
              <a href="${d.video_url}" target="_blank" style="color: #fff; text-decoration: underline; font-weight: 700; margin-top: 6px; display: inline-block;">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> ดูวิดีโอบน YouTube: ${d.video_url}
              </a>
            `;
          }
          showToast('ตั้งเวลาโพสต์สำเร็จแล้ว!');
        } else {
          if (ytUploadResultMsg) {
            ytUploadResultMsg.style.background = 'rgba(255, 71, 87, 0.15)';
            ytUploadResultMsg.style.border = '1px solid rgba(255, 71, 87, 0.4)';
            ytUploadResultMsg.style.color = '#ff6b81';
            ytUploadResultMsg.innerHTML = `<strong><i class="fa-solid fa-triangle-exclamation"></i> ไม่สำเร็จ:</strong> ${d.message || d.error || 'โปรดตรวจสอบการเชื่อมต่อ'}`;
          }
        }
      } catch (err) {
        if (ytUploadResultMsg) {
          ytUploadResultMsg.style.background = 'rgba(255, 71, 87, 0.15)';
          ytUploadResultMsg.style.border = '1px solid rgba(255, 71, 87, 0.4)';
          ytUploadResultMsg.style.color = '#ff6b81';
          ytUploadResultMsg.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + err.message;
        }
      } finally {
        btnSubmitYtSchedule.disabled = false;
        btnSubmitYtSchedule.innerHTML = '<i class="fa-brands fa-youtube"></i> <span>ยืนยันตั้งเวลาโพสต์คลิป</span>';
      }
    });
  }

  // ================= SEARCH & SORT LISTENERS =================
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (btnClearSearch) {
        btnClearSearch.style.display = searchQuery ? 'block' : 'none';
      }
      applyFilterAndSort();
    });
  }

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.style.display = 'none';
      applyFilterAndSort();
      searchInput.focus();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      sortOrder = e.target.value;
      applyFilterAndSort();
    });
  }

  // Keyboard shortcut: Escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (videoModal && videoModal.classList.contains('open')) {
        closeVideoModal();
      }
      if (settingsModal && settingsModal.classList.contains('open')) {
        closeSettingsModal();
      }
      if (deleteConfirmModal && deleteConfirmModal.classList.contains('open')) {
        closeDeleteConfirm();
      }
      if (youtubeScheduleModal && youtubeScheduleModal.classList.contains('open')) {
        closeYouTubeScheduleModal();
      }
    }
  });

  // ================= INITIALIZE =================
  loadConfig().then(() => {
    loadRecapsData();
  });
});
