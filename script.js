const THEME_STORAGE_KEY = 'rs-theme-preference';
const STATUS_CHECK_TIMEOUT = 8000;
const STATUS_AUTO_REFRESH_INTERVAL = 30000;
const STATUS_TEXT = {
    checking: 'Memeriksa status…',
    online: 'Terhubung',
    offline: 'Tidak Dapat Diakses'
};
const STATUS_DETAIL_MESSAGES = {
    checking: 'Sedang memeriksa koneksi portal.',
    online: 'Portal merespons normal dan siap digunakan.',
    offline: 'Portal tidak merespons. Bisa karena pemeliharaan, firewall, atau gangguan koneksi.'
};
const ERAPOR_DEFAULT_YEAR = '2025/2026';
const ERAPOR_PORTAL_HINT = 'Klik untuk membuka portal pada tab baru, lalu masuk dengan akun yang sudah dibagikan.';
const copyFeedbackTimers = typeof WeakMap === 'function' ? new WeakMap() : null;
const ERAPOR_CONFIG = {
    '2025/2026': {
        serviceName: 'E-Rapor 2025',
        url: 'https://rapor.smkn1telagasari.web.id/',
        summary: 'Gunakan format E-Rapor 2025 untuk pelaporan kurikulum terbaru.',
        note: 'Portal terbuka di tab baru. Ini aplikasi E-Rapor 2025 untuk Kurikulum Merdeka; gunakan akun E-Rapor 2025 (akun baru). Akun lama tidak berlaku di versi ini.',
        highlight: true,
        allowOpaque: false
    },
    '2024/2025': {
        serviceName: 'E-Rapor SMK',
        url: 'https://erapor.smkn1telagasari.web.id/',
        summary: 'Gunakan portal E-Rapor SMK untuk pengolahan nilai tahun 2024/2025.',
        note: 'Portal terbuka di tab baru. Ini aplikasi E-Rapor SMK lama; gunakan akun E-Rapor SMK lama. Akun E-Rapor 2025 tidak berlaku untuk versi ini.',
        highlight: false,
        allowOpaque: false
    },
    '2023/2024': {
        serviceName: 'E-Rapor SMK',
        url: 'https://erapor.smkn1telagasari.web.id/',
        summary: 'Gunakan portal E-Rapor SMK untuk pelaporan tahun 2023/2024.',
        note: 'Portal terbuka di tab baru. Ini aplikasi E-Rapor SMK lama; gunakan akun E-Rapor SMK lama. Akun E-Rapor 2025 tidak berlaku untuk versi ini.',
        highlight: false,
        allowOpaque: false
    },
    '2022/2023': {
        serviceName: 'E-Rapor SMK',
        url: 'https://erapor.smkn1telagasari.web.id/',
        summary: 'Portal E-Rapor SMK mendukung arsip nilai tahun 2022/2023.',
        note: 'Portal terbuka di tab baru. Ini aplikasi E-Rapor SMK lama; gunakan akun E-Rapor SMK lama. Akun E-Rapor 2025 tidak berlaku untuk versi ini.',
        highlight: false,
        allowOpaque: false
    }
};
const serviceStatusCache = typeof Map === 'function' ? new Map() : null;
const serviceStatusStore = serviceStatusCache ? null : {};
const statusDetailStore = {};
let statusRefreshIntervalId = null;
const TOAST_MAX_COUNT = 3;
const TOAST_DEFAULT_DURATION = 9000;
const TOAST_PERSIST_DURATION = 17000;
const CONNECTIVITY_TOAST_INTERVAL = 45000;
const toastState = {
    stack: null,
    lockId: null,
    lockedToast: null,
    lockMeta: null,
    pendingOfflineCheckTimeout: null,
    dismissedLocks: new Set()
};
const STATUS_MONITOR_URL = 'https://kuma.smkn1telagasari.web.id/status/smkn1tls';

function resetToastSystemState(){
    if (toastState.dismissedLocks instanceof Set){
        toastState.dismissedLocks.clear();
    }
    if (toastState.pendingOfflineCheckTimeout){
        clearTimeout(toastState.pendingOfflineCheckTimeout);
        toastState.pendingOfflineCheckTimeout = null;
    }
    toastState.lockId = null;
    toastState.lockedToast = null;
    toastState.lockMeta = null;
    const stack = getToastStack();
    if (stack){
        Array.from(stack.children).forEach(child => dismissToast(child, true, true));
    }
    Object.keys(statusDetailStore).forEach(key => {
        const record = statusDetailStore[key];
        if (record){
            record.lastToastState = 'checking';
            record.lastToastAt = 0;
        }
    });
}

function getToastStack(){
    if (toastState.stack && document.contains(toastState.stack)){
        return toastState.stack;
    }
    toastState.stack = document.getElementById('toast-stack');
    return toastState.stack;
}

function dismissToast(node, immediate, suppressFollowup){
    if (!node) return;
    const timerId = node.dataset.toastTimer ? parseInt(node.dataset.toastTimer, 10) : NaN;
    if (!Number.isNaN(timerId)){
        clearTimeout(timerId);
    }
    const finalizeRemoval = () => {
        const lockAttr = node.dataset.lockId || '';
        const manualDismiss = node.dataset.manualDismiss === 'true';
        if (lockAttr && toastState.lockId === lockAttr && toastState.lockedToast === node){
            toastState.lockId = null;
            toastState.lockedToast = null;
            toastState.lockMeta = null;
            if (manualDismiss && toastState.dismissedLocks instanceof Set){
                toastState.dismissedLocks.add(lockAttr);
            }
            if (!manualDismiss && lockAttr === 'offline-status' && !suppressFollowup){
                if (toastState.pendingOfflineCheckTimeout){
                    clearTimeout(toastState.pendingOfflineCheckTimeout);
                }
                toastState.pendingOfflineCheckTimeout = window.setTimeout(() => {
                    toastState.pendingOfflineCheckTimeout = null;
                    evaluateServiceStatuses(true);
                }, 800);
            }
        }
        node.remove();
    };
    if (immediate){
        finalizeRemoval();
        return;
    }
    node.classList.remove('is-visible');
    node.addEventListener('transitionend', finalizeRemoval, { once: true });
    setTimeout(finalizeRemoval, 320);
}

function showToast(message, variant = 'warning', options){
    const stack = getToastStack();
    if (!stack || !message) return;
    const normalizedVariant = ['danger','warning','success','info'].includes(variant) ? variant : 'warning';
    const lockId = options && options.lockId ? String(options.lockId) : '';
    if (lockId && toastState.dismissedLocks instanceof Set && toastState.dismissedLocks.has(lockId)){
        return;
    }
    if (toastState.lockId && (!lockId || toastState.lockId !== lockId)){
        return;
    }
    if (lockId && toastState.lockId === lockId && toastState.lockedToast){
        dismissToast(toastState.lockedToast, true, true);
    }
    while (stack.children.length >= TOAST_MAX_COUNT){
        dismissToast(stack.firstElementChild, true);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${normalizedVariant}`;
    toast.setAttribute('role', 'status');
    if (lockId){
        toast.dataset.lockId = lockId;
    }

    const icon = document.createElement('i');
    const iconMap = {
        danger: 'fa-circle-xmark',
        warning: 'fa-triangle-exclamation',
        success: 'fa-circle-check',
        info: 'fa-circle-info'
    };
    icon.className = `toast-icon fas ${iconMap[normalizedVariant] || iconMap.warning}`;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('p');
    text.className = 'toast-message';
    const allowHtml = !!(options && options.allowHtml);
    if (allowHtml){
        text.innerHTML = message;
    } else {
        text.textContent = message;
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Tutup notifikasi');
    closeBtn.setAttribute('title', 'Tutup notifikasi');
    closeBtn.innerHTML = '<span aria-hidden="true">&times;</span>';

    closeBtn.addEventListener('click', () => {
        toast.dataset.manualDismiss = 'true';
        dismissToast(toast);
    });

    toast.append(icon, text, closeBtn);
    stack.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('is-visible');
    });

    const persistent = !!(options && options.persistent);
    const requestedDuration = options && typeof options.duration === 'number' ? options.duration : TOAST_DEFAULT_DURATION;
    const duration = persistent ? Math.max(5000, options && typeof options.persistentDuration === 'number' ? options.persistentDuration : TOAST_PERSIST_DURATION) : Math.max(2500, requestedDuration);
    const timerId = setTimeout(() => dismissToast(toast), duration);
    toast.dataset.toastTimer = String(timerId);

    if (persistent && lockId){
        toastState.lockId = lockId;
        toastState.lockedToast = toast;
        toastState.lockMeta = options && options.lockMeta ? options.lockMeta : null;
    }
}

function announcePortalUnavailable(actionId, fallbackLabel){
    const record = actionId ? getStatusDetailRecord(actionId) : null;
    const label = (record && (record.label || record.serviceName)) || fallbackLabel || 'Portal E-Rapor';
    const monitorLink = `<a href="${STATUS_MONITOR_URL}" target="_blank" rel="noopener">dasbor status</a>`;
    showToast(`${label} belum dapat diakses. Detail kondisi tersedia di ${monitorLink}.`, 'warning', { allowHtml: true });
}

function maybeAnnounceOfflineState(record){
    if (!record) return;
    if (record.state === 'offline'){
        if (toastState.dismissedLocks instanceof Set && toastState.dismissedLocks.has('offline-status')){
            return;
        }
        const now = Date.now();
        const lastState = record.lastToastState;
        const lastAt = record.lastToastAt || 0;
        const intervalPassed = now - lastAt > CONNECTIVITY_TOAST_INTERVAL;
        const offlineToastActive = toastState.lockId === 'offline-status';
        if (!offlineToastActive || lastState !== 'offline' || intervalPassed){
            const label = record.label || record.serviceName || 'Portal E-Rapor';
            const monitorLink = `<a href="${STATUS_MONITOR_URL}" target="_blank" rel="noopener">dasbor status</a>`;
            showToast(`${label} sementara tidak dapat dijangkau. Pantau pembaruan server melalui ${monitorLink}.`, 'danger', { allowHtml: true, persistent: true, lockId: 'offline-status' });
            record.lastToastState = 'offline';
            record.lastToastAt = now;
        }
    } else {
        if (toastState.pendingOfflineCheckTimeout){
            clearTimeout(toastState.pendingOfflineCheckTimeout);
            toastState.pendingOfflineCheckTimeout = null;
        }
        if (toastState.lockId === 'offline-status' && toastState.lockedToast){
            dismissToast(toastState.lockedToast, true, true);
        }
        record.lastToastState = record.state || 'checking';
    }
}

function applyThemePreference(theme){
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    const toggle = document.querySelector('.theme-toggle');
    if (toggle){
        const icon = toggle.querySelector('i');
        if (icon){
            icon.className = nextTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
        toggle.setAttribute('aria-label', nextTheme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
        toggle.setAttribute('title', nextTheme === 'dark' ? 'Mode terang' : 'Mode gelap');
    }
}

function resolveInitialTheme(){
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
}

applyThemePreference(resolveInitialTheme());

const modalFocusMap = new WeakMap();

function getFocusableElements(container){
    if (!container) return [];
    return Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && isElementVisible(el));
}

function isElementVisible(el){
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function applyModalFocus(modal, triggerEl, priorityFocusEl){
    if (!modal) return;
    const previous = triggerEl instanceof HTMLElement ? triggerEl : document.activeElement;
    const handler = function(e){
        if (e.key === 'Tab'){
            const focusables = getFocusableElements(modal);
            if (focusables.length === 0){
                e.preventDefault();
                modal.setAttribute('tabindex','-1');
                modal.focus();
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
            if (e.shiftKey){
                if (active === first || !modal.contains(active)){
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (active === last){
                    e.preventDefault();
                    first.focus();
                }
            }
        }
        if (e.key === 'Enter'){
            const active = document.activeElement;
            if (active && active.classList.contains('close-btn')){
                e.preventDefault();
                active.click();
            }
        }
    };

    modalFocusMap.set(modal, { previous, handler });
    modal.addEventListener('keydown', handler);

    const target = (priorityFocusEl && typeof priorityFocusEl.focus === 'function') ? priorityFocusEl : getFocusableElements(modal)[0];
    window.requestAnimationFrame(() => {
        if (target && typeof target.focus === 'function'){
            target.focus();
        } else {
            modal.setAttribute('tabindex','-1');
            modal.focus();
        }
    });
}

function releaseModalFocus(modal){
    const state = modalFocusMap.get(modal);
    if (!state) return;
    modal.removeEventListener('keydown', state.handler);
    const previous = state.previous;
    modalFocusMap.delete(modal);
    if (previous && typeof previous.focus === 'function' && document.contains(previous)){
        previous.focus();
    }
}

function openGenericModal(modal, triggerEl, focusTarget){
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    applyModalFocus(modal, triggerEl, focusTarget);
}

function closeGenericModal(modal){
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    const triggerId = modal.dataset ? modal.dataset.triggerElementId : undefined;
    if (triggerId){
        const triggerEl = document.getElementById(triggerId);
        if (triggerEl){
            triggerEl.setAttribute('aria-expanded', 'false');
        }
        modal.dataset.triggerElementId = '';
    }
    releaseModalFocus(modal);
    if (!document.querySelector('.modal.active')){
        document.body.style.overflow = '';
    }
}

document.addEventListener('DOMContentLoaded', function(){
    const toggle = document.querySelector('.theme-toggle');
    const initial = document.documentElement.getAttribute('data-theme') || resolveInitialTheme();
    applyThemePreference(initial);
    if (!toggle) return;
    toggle.addEventListener('click', function(){
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_STORAGE_KEY, next);
        applyThemePreference(next);
    });

    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (media){
        const listener = function(e){
            const stored = localStorage.getItem(THEME_STORAGE_KEY);
            if (stored === 'light' || stored === 'dark') return;
            applyThemePreference(e.matches ? 'dark' : 'light');
        };
        if (media.addEventListener) media.addEventListener('change', listener);
        else if (media.addListener) media.addListener(listener);
    }
});

// ===========================
// E-Rapor Modal Functionality
// ===========================
document.addEventListener('DOMContentLoaded', function() {
    const eraporBtn = document.getElementById('erapor-btn');
    const modal = document.getElementById('erapor-modal');
    const closeBtn = document.getElementById('close-modal');

    if (eraporBtn && modal){
        eraporBtn.addEventListener('click', function(e){
            e.preventDefault();
            const firstOption = modal.querySelector('.modal-option');
            openGenericModal(modal, eraporBtn, firstOption);
        });
    }

    if (closeBtn && modal){
        closeBtn.addEventListener('click', function(){
            closeGenericModal(modal);
        });
    }

    setupLoadingLinks();
    setupEraporSelector();
});

function setupLoadingLinks(){
    const overlay = document.getElementById('redirect-overlay');
    const links = Array.from(document.querySelectorAll('[data-loading-link]'));
    if (!overlay || links.length === 0) return;
    const messageEl = overlay.querySelector('[data-loading-message]');
    const hideOverlay = () => {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        if (!document.querySelector('.modal.active')){
            document.body.style.overflow = '';
        }
    };
    const showOverlay = (message) => {
        if (messageEl){
            messageEl.textContent = message;
        }
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    };
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay){
            hideOverlay();
        }
    });
    links.forEach(link => {
        link.addEventListener('click', function(event){
            if (this.classList.contains('is-disabled') || this.getAttribute('aria-disabled') === 'true'){
                event.preventDefault();
                announcePortalUnavailable(this.id || '', this.getAttribute('aria-label') || this.textContent?.trim());
                if (this.id){
                    showStatusDetailModal(this.id, this);
                }
                return;
            }
            const targetUrl = this.getAttribute('href');
            if (!targetUrl || targetUrl === '#') return;
            event.preventDefault();
            const message = this.getAttribute('data-loading-text') || 'Mengarahkan ke layanan…';
            const targetName = this.getAttribute('data-loading-target') || '_blank';
            showOverlay(message);
            const features = targetName === '_blank' ? 'noopener' : '';
            setTimeout(() => {
                try {
                    window.open(targetUrl, targetName, features);
                } catch(err){
                    console.warn('Gagal membuka tautan:', err);
                }
                setTimeout(hideOverlay, 700);
            }, 600);
        });
    });
}

function copyTextToClipboard(text){
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.top = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (successful){
                resolve();
            } else {
                reject(new Error('Copy command unsuccessful'));
            }
        } catch(err){
            reject(err);
        }
    });
}

function attachCopyHandler(button){
    if (!button || button.dataset.copyAttached === 'true') return;
    const labelSpan = button.querySelector('[data-copy-label]');
    const defaultLabel = button.getAttribute('data-copy-default') || 'Salin Link';
    const successLabel = button.getAttribute('data-copy-success') || 'Tautan disalin';
    const failLabel = button.getAttribute('data-copy-fail') || 'Salin manual';

    const resetState = () => {
        if (labelSpan){
            labelSpan.textContent = defaultLabel;
        }
        button.classList.remove('is-success', 'is-error', 'is-busy');
    };

    const scheduleReset = () => {
        const resetFn = () => {
            resetState();
        };
        if (copyFeedbackTimers){
            const existing = copyFeedbackTimers.get(button);
            if (existing) clearTimeout(existing);
            const timer = setTimeout(resetFn, 2000);
            copyFeedbackTimers.set(button, timer);
        } else {
            setTimeout(resetFn, 2000);
        }
    };

    button.addEventListener('click', () => {
        const url = button.getAttribute('data-copy-url');
        if (!url) return;
        button.classList.add('is-busy');
        copyTextToClipboard(url).then(() => {
            button.classList.remove('is-busy');
            button.classList.add('is-success');
            button.classList.remove('is-error');
            if (labelSpan){
                labelSpan.textContent = successLabel;
            }
            scheduleReset();
        }).catch(() => {
            button.classList.remove('is-busy');
            button.classList.add('is-error');
            button.classList.remove('is-success');
            if (labelSpan){
                labelSpan.textContent = failLabel;
            }
            scheduleReset();
        });
    });

    button.dataset.copyAttached = 'true';
}

function setupEraporSelector(){
    const yearSelect = document.getElementById('erapor-year');
    const semesterSelect = document.getElementById('erapor-semester');
    const resultCard = document.getElementById('erapor-result');
    const titleEl = document.getElementById('erapor-result-title');
    const statusEl = document.getElementById('erapor-result-status');
    const actionEl = document.getElementById('erapor-result-link');
    const noteEl = document.getElementById('erapor-result-note');
    const copyBtn = document.getElementById('erapor-copy-link');
    if (!yearSelect || !semesterSelect || !resultCard || !titleEl || !statusEl || !actionEl || !noteEl || !copyBtn) return;

    attachCopyHandler(copyBtn);

    const updateOutput = () => {
        const selectedYear = yearSelect.value || ERAPOR_DEFAULT_YEAR;
        const semesterValue = semesterSelect.value || 'ganjil';
        const config = ERAPOR_CONFIG[selectedYear] || ERAPOR_CONFIG[ERAPOR_DEFAULT_YEAR];
        const semesterLabel = semesterValue === 'genap' ? 'Semester Genap' : 'Semester Ganjil';
        const metaLabel = `${selectedYear} • ${semesterLabel}`;
        const actionLabel = 'Buka E-Rapor';

        resultCard.classList.toggle('is-current', !!config.highlight);
        titleEl.textContent = metaLabel;

        statusEl.setAttribute('data-status-url', config.url);
        statusEl.setAttribute('data-status-allow-opaque', config.allowOpaque === true ? 'true' : 'false');
        statusEl.setAttribute('data-status-action', actionEl.id || '');
        primeStatusDetailContext(actionEl.id || '', {
            serviceName: config.serviceName,
            summary: config.summary,
            note: config.note,
            url: config.url,
            label: metaLabel,
            year: selectedYear,
            semester: semesterLabel
        });
        setStatusIndicator(statusEl, 'checking');
        attachStatusDetailIndicator(statusEl, actionEl.id || '');

        actionEl.href = config.url;
        actionEl.setAttribute('data-loading-text', `Menghubungkan ke portal ${metaLabel}…`);
        actionEl.setAttribute('aria-label', `${actionLabel} ${metaLabel}`);
        actionEl.setAttribute('title', actionLabel);
        actionEl.dataset.originalTitle = actionLabel;
        actionEl.setAttribute('aria-expanded', 'false');
        const labelSpan = actionEl.querySelector('span');
        if (labelSpan){
            labelSpan.textContent = actionLabel;
        }

        copyBtn.setAttribute('data-copy-url', config.url);
        copyBtn.setAttribute('aria-label', `Salin link portal ${metaLabel}`);
        const copyLabelSpan = copyBtn.querySelector('[data-copy-label]');
        if (copyLabelSpan){
            copyLabelSpan.textContent = copyBtn.getAttribute('data-copy-default') || 'Salin Link';
        }
        copyBtn.classList.remove('is-success', 'is-error');
        copyBtn.classList.remove('is-busy');
        if (copyFeedbackTimers){
            const pending = copyFeedbackTimers.get(copyBtn);
            if (pending) clearTimeout(pending);
            copyFeedbackTimers.delete(copyBtn);
        }

        noteEl.textContent = config.note || ERAPOR_PORTAL_HINT;

        window.requestAnimationFrame(() => evaluateServiceStatuses(true));
    };

    const handleSelectionChange = () => {
        resetToastSystemState();
        updateOutput();
    };

    yearSelect.addEventListener('change', handleSelectionChange);
    semesterSelect.addEventListener('change', handleSelectionChange);
    updateOutput();
}

// ===========================
// Bottom Navigation & Sidebar Active State
// ===========================
document.addEventListener('DOMContentLoaded', function() {
    const actionables = document.querySelectorAll('[data-action]');

    actionables.forEach(el => {
        el.addEventListener('click', function(e) {
            const action = this.getAttribute('data-action');
            if (!action) return;
            if (action === 'home') {
                e.preventDefault();
                const home = document.getElementById('home');
                if (home) home.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            if (action === 'contact') {
                e.preventDefault();
                const m = document.getElementById('contact-modal');
                if (m) {
                    const firstField = document.getElementById('cf-name');
                    openGenericModal(m, this, firstField);
                }
                return;
            }
            if (action === 'about') {
                e.preventDefault();
                const m = document.getElementById('about-modal');
                if (m) openGenericModal(m, this);
                return;
            }
            if (action === 'search') {
                e.preventDefault();
                const m = document.getElementById('search-modal');
                if (m) {
                    const input = document.getElementById('search-input');
                    if (input) {
                        input.value = '';
                        renderSearch('');
                    }
                    openGenericModal(m, this, input);
                }
                return;
            }
            if (action === 'guide') {
                e.preventDefault();
                const m = document.getElementById('guide-modal');
                if (m) openGenericModal(m, this);
                return;
            }
        });
    });

    // Close buttons (generic, using data-close)
    document.querySelectorAll('.close-btn[data-close]').forEach(btn => {
        btn.addEventListener('click', function() {
            const targetId = this.getAttribute('data-close');
            const m = document.getElementById(targetId);
            if (m) closeGenericModal(m);
        });
    });

    // Close on overlay click for all modals
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', function(e) {
            if (e.target === m) closeGenericModal(m);
        });
    });

    // Escape key closes any open modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(m => closeGenericModal(m));
        }
    });

});

// ===========================
// App Card Click Handling
// ===========================
document.addEventListener('DOMContentLoaded', function() {
    const appCards = document.querySelectorAll('.app-card:not(#erapor-btn)');
    // No JS interception; allow default navigation. Add minimal press feedback only.
    appCards.forEach(card => {
        card.addEventListener('mousedown', function() {
            this.style.transform = 'scale(0.98)';
        });
        card.addEventListener('mouseup', function() {
            this.style.transform = '';
        });
        card.addEventListener('mouseleave', function() {
            this.style.transform = '';
        });
    });
});

// ===========================
// Modal Options Click Handling
// ===========================
document.addEventListener('DOMContentLoaded', function() {
    const modalOptions = document.querySelectorAll('.modal-option');

    modalOptions.forEach(option => {
        option.addEventListener('click', function() {
            const modal = document.getElementById('erapor-modal');
            if (modal) closeGenericModal(modal);
        });
    });
});

// ===========================
// Notification System (Optional)
// (Removed) Notification system to keep UI minimal and focused

// ===========================
// Smooth Scroll Enhancement
// ===========================
// Smooth scroll retained only for internal anchors (currently not used)

// ===========================
// Touch Feedback for Mobile
// ===========================
// Minimal touch feedback (keep it simple)
document.addEventListener('DOMContentLoaded', function() {
    const touchElements = document.querySelectorAll('.app-card, .nav-item, .modal-option, .quick-action');
    touchElements.forEach(element => {
        element.addEventListener('touchstart', function() { this.style.opacity = '0.85'; });
        ['touchend','touchcancel'].forEach(ev => element.addEventListener(ev, function() { this.style.opacity = ''; }));
    });
});

function setStatusIndicator(el, state){
    if (!el) return;
    const normalized = state === 'online' || state === 'offline' ? state : 'checking';
    el.classList.remove('status-online','status-offline','status-checking');
    el.classList.add(`status-${normalized}`);
    el.textContent = STATUS_TEXT[normalized] || STATUS_TEXT.checking;
    el.setAttribute('data-status-state', normalized);
    if (el.hasAttribute('data-status-detail')){
        const primary = STATUS_TEXT[normalized] || STATUS_TEXT.checking;
        const detail = STATUS_DETAIL_MESSAGES[normalized] || STATUS_DETAIL_MESSAGES.checking;
        el.setAttribute('aria-label', `${primary}. ${detail} Klik untuk detail status.`);
        el.setAttribute('title', 'Klik untuk melihat detail status layanan');
    }
    syncStatusActionState(el, normalized);
}

function primeStatusDetailContext(actionId, context){
    if (!actionId) return;
    const existing = statusDetailStore[actionId] || {};
    const isDifferentService = context && context.url && existing.url && existing.url !== context.url;
    const nextRecord = Object.assign({}, existing, context);
    if (!nextRecord.state || isDifferentService){
        nextRecord.state = 'checking';
    }
    if (isDifferentService){
        nextRecord.lastChecked = null;
        nextRecord.lastResultState = null;
        nextRecord.lastToastState = 'checking';
        nextRecord.lastToastAt = 0;
    }
    statusDetailStore[actionId] = nextRecord;
    renderStatusSnapshot(actionId);
}

function updateStatusDetailState(actionId, state){
    if (!actionId) return null;
    const record = statusDetailStore[actionId] || {};
    record.state = state;
    if (state !== 'checking'){
        const now = Date.now();
        record.lastChecked = now;
        record.lastResultState = state;
    }
    statusDetailStore[actionId] = record;
    return record;
}

function getStatusDetailRecord(actionId){
    if (!actionId) return null;
    return statusDetailStore[actionId] || null;
}

function formatStatusDetailTimestamp(timestamp){
    if (!timestamp) return '';
    try {
        return new Date(timestamp).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'medium' });
    } catch (err){
        try {
            return new Date(timestamp).toLocaleString();
        } catch (e){
            return `${timestamp}`;
        }
    }
}

function renderStatusDetailModal(actionId){
    const modal = document.getElementById('status-modal');
    if (!modal) return { modal: null, focusTarget: null };
    const record = getStatusDetailRecord(actionId) || {};
    const state = record.state === 'online' || record.state === 'offline' ? record.state : 'checking';
    const metaEl = document.getElementById('status-modal-meta');
    if (metaEl){
        const metaParts = [];
        if (record.serviceName) metaParts.push(record.serviceName);
        if (record.label) metaParts.push(record.label);
        metaEl.textContent = metaParts.length ? metaParts.join(' • ') : 'Portal E-Rapor';
    }
    const stateEl = document.getElementById('status-modal-state');
    if (stateEl){
        stateEl.classList.remove('is-online','is-offline','is-checking');
        stateEl.classList.add(`is-${state}`);
        const iconClass = state === 'online' ? 'fa-circle-check' : state === 'offline' ? 'fa-circle-xmark' : 'fa-arrows-rotate fa-spin';
        const label = STATUS_TEXT[state] || STATUS_TEXT.checking;
        stateEl.innerHTML = `<i class="fas ${iconClass}" aria-hidden="true"></i><span>${label}</span>`;
    }
    const descEl = document.getElementById('status-modal-description');
    if (descEl){
        descEl.textContent = record.summary || 'Portal ini digunakan untuk pelaporan nilai sesuai pilihan Anda.';
    }
    const noteEl = document.getElementById('status-modal-note');
    if (noteEl){
        noteEl.innerHTML = '';
        const infoPara = document.createElement('p');
        infoPara.textContent = STATUS_DETAIL_MESSAGES[state] || STATUS_DETAIL_MESSAGES.checking;
        noteEl.appendChild(infoPara);
        if (record.note){
            const notePara = document.createElement('p');
            notePara.textContent = record.note;
            noteEl.appendChild(notePara);
        }
    }
    const urlEl = document.getElementById('status-modal-url');
    if (urlEl){
        urlEl.innerHTML = '';
        const displayUrl = record.url || '';
        if (displayUrl){
            urlEl.append('Alamat portal: ');
            const span = document.createElement('span');
            span.textContent = displayUrl;
            urlEl.appendChild(span);
        } else {
            urlEl.textContent = 'Alamat portal belum tersedia.';
        }
    }
    const lastCheckedEl = document.getElementById('status-modal-last-checked');
    if (lastCheckedEl){
        lastCheckedEl.textContent = record.lastChecked ? formatStatusDetailTimestamp(record.lastChecked) : 'Belum ada data pengecekan.';
    }
    const lastResultEl = document.getElementById('status-modal-last-result');
    if (lastResultEl){
        if (record.lastResultState){
            const statusName = STATUS_TEXT[record.lastResultState] || record.lastResultState;
            const timestampText = record.lastChecked ? formatStatusDetailTimestamp(record.lastChecked) : '';
            lastResultEl.textContent = timestampText ? `Status terakhir yang tercatat: ${statusName} • ${timestampText}` : `Status terakhir yang tercatat: ${statusName}`;
        } else {
            lastResultEl.textContent = 'Belum ada riwayat status tersimpan.';
        }
    }
    const openLink = document.getElementById('status-modal-open-link');
    if (openLink){
        const href = record.url || '#';
        openLink.href = href;
        if (state === 'online' && href && href !== '#'){
            openLink.classList.remove('is-disabled');
            openLink.removeAttribute('aria-disabled');
            openLink.setAttribute('title', record.label ? `Buka ${record.label}` : 'Buka portal E-Rapor');
        } else {
            openLink.classList.add('is-disabled');
            openLink.setAttribute('aria-disabled', 'true');
            openLink.setAttribute('title', 'Portal belum dapat dibuka.');
        }
    }
    const refreshBtn = document.getElementById('status-modal-refresh');
    if (refreshBtn){
        refreshBtn.dataset.statusTarget = actionId || '';
    }
    modal.setAttribute('data-active-action', actionId || '');
    return {
        modal,
        focusTarget: openLink && !openLink.classList.contains('is-disabled') ? openLink : document.getElementById('status-modal-refresh')
    };
}

function renderStatusSnapshot(actionId){
    const container = document.getElementById('status-summary');
    if (!container) return;
    const badge = document.getElementById('summary-status-badge');
    const desc = document.getElementById('summary-status-desc');
    const meta = document.getElementById('summary-meta');
    const lastCheckedEl = document.getElementById('summary-last-checked');
    const lastResultEl = document.getElementById('summary-last-result');
    const autoRefreshEl = document.getElementById('summary-auto-refresh');
    const iconEl = document.getElementById('summary-status-icon');
    const record = actionId ? (getStatusDetailRecord(actionId) || {}) : {};
    const state = record.state === 'online' || record.state === 'offline' ? record.state : 'checking';

    container.dataset.statusState = state;

    if (badge){
        badge.classList.remove('status-online','status-offline','status-checking');
        badge.classList.add(`status-${state}`);
        badge.textContent = STATUS_TEXT[state] || STATUS_TEXT.checking;
    }
    if (desc){
        desc.textContent = STATUS_DETAIL_MESSAGES[state] || STATUS_DETAIL_MESSAGES.checking;
    }
    if (meta){
        meta.textContent = record.label || 'Pilih tahun ajaran untuk melihat detail portal.';
    }
    if (lastCheckedEl){
        lastCheckedEl.textContent = record.lastChecked ? formatStatusDetailTimestamp(record.lastChecked) : 'Menunggu hasil pertama';
    }
    if (lastResultEl){
        if (record.lastResultState){
            const statusName = STATUS_TEXT[record.lastResultState] || record.lastResultState;
            lastResultEl.textContent = `Riwayat terakhir: ${statusName}`;
        } else {
            lastResultEl.textContent = 'Status terakhir belum tersedia.';
        }
    }
    if (autoRefreshEl){
        const seconds = Math.max(1, Math.round(STATUS_AUTO_REFRESH_INTERVAL / 1000));
        autoRefreshEl.textContent = `${seconds} detik`;
    }
    if (iconEl){
        const iconMap = {
            online: 'fa-circle-check',
            offline: 'fa-triangle-exclamation',
            checking: 'fa-arrows-rotate'
        };
        const baseClass = iconMap[state] || iconMap.checking;
        iconEl.className = `fas ${baseClass}`;
        if (state === 'checking'){
            iconEl.classList.add('fa-spin');
        }
        const colorMap = {
            online: '#16a34a',
            offline: '#dc2626',
            checking: getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#1d4ed8'
        };
        const resolvedColor = colorMap[state] || colorMap.checking;
        iconEl.style.color = resolvedColor.trim();
    }
}

function showStatusDetailModal(actionId, triggerEl){
    const { modal, focusTarget } = renderStatusDetailModal(actionId);
    if (!modal) return;
    if (triggerEl instanceof HTMLElement && triggerEl.id){
        triggerEl.setAttribute('aria-expanded', 'true');
        modal.dataset.triggerElementId = triggerEl.id;
    }
    openGenericModal(modal, triggerEl, focusTarget || modal.querySelector('.status-modal-refresh'));
}

function attachStatusDetailIndicator(statusEl, actionId){
    if (!statusEl || !actionId) return;
    if (statusEl.dataset.statusDetailBound === 'true') return;
    const handler = (event) => {
        const isActivationKey = event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar' || event.key === 'Space';
        if (event.type === 'click' || (event.type === 'keydown' && isActivationKey)){
            event.preventDefault();
            showStatusDetailModal(actionId, statusEl);
        }
    };
    statusEl.addEventListener('click', handler);
    statusEl.addEventListener('keydown', handler);
    statusEl.dataset.statusDetailBound = 'true';
}

function updateActionAvailability(actionEl, isOnline){
    if (!actionEl) return;
    if (isOnline){
        actionEl.classList.remove('is-disabled');
        actionEl.removeAttribute('aria-disabled');
        actionEl.dataset.portalDisabled = 'false';
        const originalTitle = actionEl.dataset.originalTitle;
        if (originalTitle){
            actionEl.setAttribute('title', originalTitle);
        }
        actionEl.setAttribute('aria-expanded', 'false');
    } else {
        actionEl.classList.add('is-disabled');
        actionEl.setAttribute('aria-disabled', 'true');
        actionEl.dataset.portalDisabled = 'true';
        actionEl.setAttribute('title', 'Portal belum dapat diakses. Klik untuk melihat detail status.');
        actionEl.setAttribute('aria-expanded', 'false');
    }
}

function syncStatusActionState(statusEl, status){
    if (!statusEl) return;
    const targetId = statusEl.getAttribute('data-status-action');
    if (targetId){
        const target = document.getElementById(targetId);
        const record = updateStatusDetailState(targetId, status);
        if (target){
            const shouldEnable = status === 'online' || (status === 'checking' && record && record.lastResultState === 'online');
            updateActionAvailability(target, shouldEnable);
        }
        maybeAnnounceOfflineState(record);
        const statusModal = document.getElementById('status-modal');
        if (statusModal && statusModal.classList.contains('active') && statusModal.getAttribute('data-active-action') === targetId){
            renderStatusDetailModal(targetId);
        }
        renderStatusSnapshot(targetId);
    }
}

function createCacheBustedUrl(url){
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('_status', Date.now().toString());
        return parsed.toString();
    } catch (err){
        return url;
    }
}

function probeImage(src){
    return new Promise(resolve => {
        let settled = false;
        const timer = setTimeout(() => finalize(false), STATUS_CHECK_TIMEOUT);
        const img = new Image();
        if ('referrerPolicy' in img){
            img.referrerPolicy = 'no-referrer';
        }
        img.onload = () => finalize(true);
        img.onerror = () => finalize(false);
        function finalize(result){
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            img.onload = img.onerror = null;
            resolve(result);
        }
        try{
            img.src = src;
        } catch(err){
            finalize(false);
        }
    });
}

function probeByFetch(url, allowOpaque){
    return new Promise(resolve => {
        let completed = false;
        const controller = 'AbortController' in window ? new AbortController() : null;
        const timer = setTimeout(() => finalize(false), STATUS_CHECK_TIMEOUT);
        function finalize(result){
            if (completed) return;
            completed = true;
            clearTimeout(timer);
            resolve(result);
        }
        const target = createCacheBustedUrl(url);
        const options = { method: 'GET', mode: 'no-cors', cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' };
        if (controller){
            options.signal = controller.signal;
        }
        if (typeof fetch !== 'function'){
            finalize(false);
            return;
        }
        let fetchPromise;
        try {
            fetchPromise = fetch(target, options);
        } catch (err){
            finalize(false);
            return;
        }
        fetchPromise
            .then(response => {
                if (!response){
                    finalize(false);
                    return;
                }
                if (response.type === 'opaque' || response.type === 'opaqueredirect'){
                    finalize(!!allowOpaque);
                    return;
                }
                finalize(response.ok === true);
            })
            .catch(() => finalize(false));
    });
}

function buildProbeCandidates(serviceUrl, probeHint){
    const candidates = [];
    const pushUnique = (value) => {
        if (!value) return;
        if (!candidates.includes(value)) candidates.push(value);
    };
    if (probeHint){
        pushUnique(createCacheBustedUrl(probeHint));
    }
    try{
        const parsed = new URL(serviceUrl);
        const origin = `${parsed.protocol}//${parsed.host}`;
        pushUnique(createCacheBustedUrl(`${origin}/favicon.ico`));
        pushUnique(createCacheBustedUrl(`${origin}/apple-touch-icon.png`));
        if (parsed.pathname && parsed.pathname !== '/'){
            const trimmed = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
            if (trimmed){
                pushUnique(createCacheBustedUrl(`${origin}${trimmed}/favicon.ico`));
            }
        }
    } catch(err){
        pushUnique(createCacheBustedUrl(serviceUrl));
    }
    return candidates;
}

function probeService(url, probeHint, allowOpaque){
    const candidates = buildProbeCandidates(url, probeHint);
    return new Promise(resolve => {
        const fallback = () => {
            const fallbackTarget = probeHint || url;
            if (!fallbackTarget){
                resolve(false);
                return;
            }
            probeByFetch(fallbackTarget, allowOpaque).then(resolve);
        };
        if (!candidates.length){
            fallback();
            return;
        }
        const attempt = (index) => {
            if (index >= candidates.length){
                fallback();
                return;
            }
            probeImage(candidates[index]).then(result => {
                if (result){
                    resolve(true);
                    return;
                }
                attempt(index + 1);
            });
        };
        attempt(0);
    });
}

function requestServiceStatus(url, probeHint, allowOpaque, forceRefresh){
    const cacheKey = `${url}|${probeHint || ''}|${allowOpaque ? 'lenient' : 'strict'}`;
    if (serviceStatusCache){
        if (forceRefresh){
            serviceStatusCache.delete(cacheKey);
        }
        if (!serviceStatusCache.has(cacheKey)){
            serviceStatusCache.set(cacheKey, probeService(url, probeHint, allowOpaque));
        }
        return serviceStatusCache.get(cacheKey);
    }
    if (forceRefresh){
        delete serviceStatusStore[cacheKey];
    }
    if (!serviceStatusStore[cacheKey]){
        serviceStatusStore[cacheKey] = probeService(url, probeHint, allowOpaque);
    }
    return serviceStatusStore[cacheKey];
}

function evaluateServiceStatuses(forceRefresh){
    const statusElements = Array.from(document.querySelectorAll('[data-status-url]'));
    if (statusElements.length === 0) return;
    statusElements.forEach(el => {
        const url = el.getAttribute('data-status-url');
        const probeHint = el.getAttribute('data-status-probe');
        const allowOpaqueAttr = el.getAttribute('data-status-allow-opaque');
        const allowOpaque = allowOpaqueAttr === null ? true : allowOpaqueAttr === 'true';
        if (!url || url === '#'){
            setStatusIndicator(el, 'offline');
            return;
        }
        setStatusIndicator(el, 'checking');
        let finalized = false;
        const guardTimer = setTimeout(() => {
            if (finalized) return;
            finalized = true;
            setStatusIndicator(el, 'offline');
        }, STATUS_CHECK_TIMEOUT + 1500);
        const shouldForce = !!forceRefresh;
        requestServiceStatus(url, probeHint, allowOpaque, shouldForce)
            .then(isOnline => {
                if (finalized) return;
                finalized = true;
                clearTimeout(guardTimer);
                setStatusIndicator(el, isOnline ? 'online' : 'offline');
            })
            .catch(() => {
                if (finalized) return;
                finalized = true;
                clearTimeout(guardTimer);
                setStatusIndicator(el, 'offline');
            });
    });
}

document.addEventListener('DOMContentLoaded', function(){
    evaluateServiceStatuses(false);
    setTimeout(() => evaluateServiceStatuses(true), STATUS_CHECK_TIMEOUT + 2500);
    if (!statusRefreshIntervalId && typeof window.setInterval === 'function'){
        statusRefreshIntervalId = window.setInterval(() => evaluateServiceStatuses(true), STATUS_AUTO_REFRESH_INTERVAL);
    }
});

document.addEventListener('DOMContentLoaded', function(){
    const refreshBtn = document.getElementById('status-modal-refresh');
    if (!refreshBtn) return;
    refreshBtn.addEventListener('click', function(){
        const targetId = this.dataset.statusTarget || '';
        const statusEl = targetId ? document.querySelector(`[data-status-action="${targetId}"]`) : null;
        if (statusEl){
            setStatusIndicator(statusEl, 'checking');
        }
        renderStatusDetailModal(targetId);
        this.classList.add('is-busy');
        this.disabled = true;
        evaluateServiceStatuses(true);
        setTimeout(() => {
            this.classList.remove('is-busy');
            this.disabled = false;
        }, STATUS_CHECK_TIMEOUT + 300);
    });
});

window.addEventListener('focus', () => evaluateServiceStatuses(true));
document.addEventListener('visibilitychange', () => {
    if (!document.hidden){
        evaluateServiceStatuses(true);
    }
});

// ===========================
// Service Worker Registration (Optional - for PWA)
// ===========================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        // Uncomment when you have a service worker file
        // navigator.serviceWorker.register('/sw.js')
        //     .then(reg => console.log('Service Worker registered'))
        //     .catch(err => console.log('Service Worker registration failed'));
    });
}

// ===========================
// Dynamic Year Update (Optional)
// ===========================
// (Removed) Dynamic year and other non-essential demo scripts

// ===========================
// Sidebar Menu Items Functionality
// ===========================
// (Removed) Sidebar handlers

// ===========================
// Add Ripple Effect on Cards
// ===========================
// (Removed) Ripple effect and stat animations

// ===========================
// Dynamic Time Greeting
// ===========================
// (Removed) Greeting and stats demos

// ===========================
// Auto-update stats (demo)
// ===========================
// Removed stats demo block to keep script minimal

// ===========================
// Contact Form -> WhatsApp
// ===========================
document.addEventListener('DOMContentLoaded', function(){
    const form = document.getElementById('contact-form');
    if (!form) return;
    form.addEventListener('submit', function(e){
        e.preventDefault();
        const phone = (form.getAttribute('data-whatsapp') || '').replace(/\D/g,'');
        const name = document.getElementById('cf-name')?.value?.trim() || '';
        const msg = document.getElementById('cf-message')?.value?.trim() || '';
        if (!phone) return;
        const text = `Halo Admin SMKN 1 Telagasari,%0A%0ASaya ${encodeURIComponent(name)}.%0A${encodeURIComponent(msg)}%0A%0ATerkirim dari Ruang Sinergi.`;
        const url = `https://wa.me/${phone}?text=${text}`;
        window.open(url, '_blank', 'noopener');
        // Close modal after opening WhatsApp
        const m = document.getElementById('contact-modal');
        if (m) closeGenericModal(m);
        form.reset();
    });
});

// ===========================
// Search functionality
// ===========================
document.addEventListener('DOMContentLoaded', function(){
    const input = document.getElementById('search-input');
    if (input){
        input.addEventListener('input', function(){
            renderSearch(this.value);
        });
    }

    // Keyboard shortcut: '/'
    document.addEventListener('keydown', function(e){
        // Ignore if typing in input/textarea
        const active = document.activeElement;
        const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
        if (isTyping) return;
        if (e.key === '/'){
            e.preventDefault();
            const m = document.getElementById('search-modal');
            if (m){
                const opener = document.querySelector('[data-action="search"]');
                opener?.click();
            }
        }
    });
});

function renderSearch(query){
    const q = (query||'').toLowerCase().trim();
    const cards = Array.from(document.querySelectorAll('.app-grid .app-card'));
    const resultsEl = document.getElementById('search-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = '';
    const items = cards.map(card => {
        const title = card.querySelector('h3')?.textContent || '';
        const desc = card.querySelector('p')?.textContent || '';
        return {card, title, desc, href: card.getAttribute('href') || '#'};
    }).filter(it => q === '' || it.title.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q));

    if (items.length === 0){
        const empty = document.createElement('div');
        empty.className = 'search-empty';
        empty.textContent = 'Tidak ada hasil.';
        resultsEl.appendChild(empty);
        return;
    }

    items.forEach(it => {
        const a = document.createElement('a');
        a.className = 'search-item';
        a.href = it.href;
        a.target = cardTargetForHref(it.href);
        a.rel = 'noopener';
        a.innerHTML = `<i class="fas fa-arrow-up-right-from-square"></i><span><strong>${escapeHtml(it.title)}</strong> — ${escapeHtml(it.desc)}</span>`;
        // If this is the E-Rapor (no href), trigger modal
        if (it.href === '#'){
            a.addEventListener('click', function(e){
                e.preventDefault();
                document.querySelector('[id="erapor-btn"]').click();
            });
        }
        resultsEl.appendChild(a);
    });
}

function cardTargetForHref(href){
    // External links already open in new tab; keep consistent
    if (href && href.startsWith('http')) return '_blank';
    return '_self';
}

function escapeHtml(str){
    return (str||'').replace(/[&<>"]+/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
}

// ===========================
// Console Welcome Message
// ===========================
console.log('Ruang Sinergi SMKN 1 Telagasari');
