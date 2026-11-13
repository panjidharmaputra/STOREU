// ═══════════════════════════════════════════════════════════
//  STOREU — Core Application Logic
// ═══════════════════════════════════════════════════════════

// Safety net: if the lucide CDN fails/slow, provide a no-op shim immediately
// so unguarded lucide.createIcons() calls can't break page logic.
// The real lucide UMD build overwrites window.lucide when it loads.
if (typeof window !== 'undefined' && !window.lucide) {
    window.lucide = { createIcons: function () {} };
}

const API = {
    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        let user = AppState.user;
        if (!user) {
            try {
                user = JSON.parse(localStorage.getItem('storeu_user') || 'null');
                if (user) AppState.user = user;
            } catch (e) { }
        }
        if (user && user.id) {
            headers['x-user-id'] = String(user.id);
            headers['x-user-role'] = String(user.role || (user.id == 1 ? 'admin' : 'user'));
        }
        return headers;
    },
    async request(url, options = {}) {
        try {
            const headers = { ...this.getHeaders(), ...options.headers };
            const res = await fetch(url, {
                headers,
                credentials: 'include',
                ...options
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Request failed');
            return data;
        } catch (err) {
            throw err;
        }
    },
    get: (url) => API.request(url),
    post: (url, body) => API.request(url, { method: 'POST', body: JSON.stringify(body) }),
    put: (url, body) => API.request(url, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (url) => API.request(url, { method: 'DELETE' })
};

// ── State ──
const AppState = {
    user: null,
    cartCount: 0
};

// ── Client-Side Cart Store (Resilient to Serverless Cold Starts) ──
const CartStore = {
    STORAGE_KEY: 'storeu_local_cart',
    getItems() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    },
    saveItems(items) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(items));
        } catch (e) {}
        AppState.cartCount = this.getCount();
        updateCartBadge();
        window.dispatchEvent(new CustomEvent('storeu_cart_updated', { detail: items }));
    },
    addItem(product, quantity = 1) {
        const items = this.getItems();
        const pid = parseInt(product.id || product.product_id, 10);
        const existing = items.find(i => (i.product_id || i.id) === pid);
        if (existing) {
            existing.quantity = (existing.quantity || 1) + quantity;
        } else {
            let actualPrice = product.price || 0;
            if (product.discount_percentage && product.discount_percentage > 0) {
                actualPrice = product.price - (product.price * product.discount_percentage / 100);
            }
            items.push({
                id: product.cart_id || pid,
                product_id: pid,
                name: product.name || ('Item #' + pid),
                price: product.price || 0,
                actual_price: actualPrice,
                image_url: product.image_url || '',
                category: product.category || 'game',
                seller_id: product.seller_id || 1,
                stock: product.stock || 100,
                discount_percentage: product.discount_percentage || 0,
                quantity: quantity
            });
        }
        this.saveItems(items);
    },
    updateQty(productId, qty) {
        let items = this.getItems();
        const pid = parseInt(productId, 10);
        if (qty <= 0) {
            items = items.filter(i => (i.product_id || i.id) !== pid && i.id !== pid);
        } else {
            const item = items.find(i => (i.product_id || i.id) === pid || i.id === pid);
            if (item) item.quantity = qty;
        }
        this.saveItems(items);
    },
    removeItem(productId) {
        const pid = parseInt(productId, 10);
        const items = this.getItems().filter(i => (i.product_id || i.id) !== pid && i.id !== pid);
        this.saveItems(items);
    },
    clear() {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (e) {}
        AppState.cartCount = 0;
        updateCartBadge();
        window.dispatchEvent(new CustomEvent('storeu_cart_updated', { detail: [] }));
    },
    getCount() {
        return this.getItems().reduce((sum, i) => sum + (i.quantity || 1), 0);
    }
};

// ── Client-Side Chat Cache (Instant Tab-to-Tab Synchronization) ──
const ChatCache = {
    STORAGE_KEY: 'storeu_chat_cache',
    getAll() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    },
    saveAll(msgs) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(msgs));
            localStorage.setItem('storeu_chat_last_update', String(Date.now()));
        } catch (e) {}
        window.dispatchEvent(new CustomEvent('storeu_chat_message', { detail: msgs }));
    },
    addMessage(msg) {
        if (!msg) return;
        const all = this.getAll();
        const exists = all.some(m => 
            (m.id && msg.id && m.id === msg.id) ||
            (m.sender_id === msg.sender_id && m.receiver_id === msg.receiver_id && m.message === msg.message && Math.abs(new Date(m.created_at || Date.now()) - new Date(msg.created_at || Date.now())) < 5000)
        );
        if (!exists) {
            all.push({
                ...msg,
                id: msg.id || ('local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
                created_at: msg.created_at || new Date().toISOString()
            });
            this.saveAll(all);
        }
    },
    saveMessage(msg) {
        if (!msg) return;
        this.addMessage(msg);
    },
    mergeMessages(serverMessages = []) {
        const localMsgs = this.getAll();
        const map = new Map();
        for (const m of (serverMessages || [])) {
            if (m && m.id) map.set(String(m.id), m);
        }
        for (const m of localMsgs) {
            const key = String(m.id || (m.sender_id + '_' + m.receiver_id + '_' + m.message));
            if (!map.has(key)) {
                map.set(key, m);
            }
        }
        const combined = Array.from(map.values());
        combined.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        return combined;
    },
    getMessagesBetween(userA, userB) {
        const a = parseInt(userA, 10), b = parseInt(userB, 10);
        return this.getAll().filter(m => 
            (m.sender_id == a && m.receiver_id == b) || 
            (m.sender_id == b && m.receiver_id == a) ||
            (b === 1 && m.receiver_id == 1 && m.sender_id == a) ||
            (a === 1 && m.receiver_id == 1 && m.sender_id == b)
        );
    }
};

// ── Client-Side Review Store (Resilient to Serverless Cold Starts) ──
const ReviewStore = {
    STORAGE_KEY: 'storeu_user_reviews',
    getReviews() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    },
    saveReview(review) {
        const list = this.getReviews();
        const exists = list.some(r => r.order_id == review.order_id && r.product_id == review.product_id);
        if (!exists) {
            list.push({
                ...review,
                created_at: review.created_at || new Date().toISOString()
            });
            try {
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
            } catch (e) {}
        }
    },
    hasReviewed(orderId, productId) {
        return this.getReviews().some(r => r.order_id == orderId && r.product_id == productId);
    },
    getByProduct(productId) {
        return this.getReviews().filter(r => r.product_id == productId);
    }
};

// ── Toast Notifications ──
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-stack');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-stack';
        container.id = 'toast-stack';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }

    const icons = {
        success: '<i data-lucide="check-circle-2" style="width:18px;height:18px;color:#34d399"></i>',
        error: '<i data-lucide="x-circle" style="width:18px;height:18px;color:#f87171"></i>',
        info: '<i data-lucide="info" style="width:18px;height:18px;color:#818cf8"></i>',
        warning: '<i data-lucide="alert-triangle" style="width:18px;height:18px;color:#fbbf24"></i>'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
        <span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span>
        <span style="flex:1">${message}</span>
        <button class="toast-close" aria-label="Tutup notifikasi" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.9rem">✕</button>
    `;
    toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    // Matching sound (optional, off by default)
    if (window.StoreuSound) {
        if (type === 'success') StoreuSound.play('success');
        else if (type === 'error') StoreuSound.play('error');
    }

    setTimeout(() => dismissToast(toast), 3600);
}

function dismissToast(toast) {
    if (!toast || !toast.isConnected) return;
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 320);
}

// ── Format Currency ──
function formatRupiah(amount) {
    return 'Rp ' + new Intl.NumberFormat('id-ID').format(amount);
}

// ── Category Icons ──
function getCategoryIcon(cat) {
    const icons = { game: '<i data-lucide="store"></i>', film: '<i data-lucide="clapperboard"></i>', music: '<i data-lucide="music"></i>', ebook: '<i data-lucide="book"></i>' };
    return icons[cat] || '<i data-lucide="box"></i>';
}

// ── Navbar ──
function initNavbar() {
    // Scroll effect & Scroll Spy
    window.addEventListener('scroll', () => {
        const navbar = document.querySelector('.navbar');
        if (navbar) {
            navbar.classList.toggle('scrolled', window.scrollY > 20);
        }

        // Scroll Spy
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
        if (navLinks.length > 0 && window.location.pathname === '/') {
            let current = '/';
            if (window.scrollY > 200) {
                sections.forEach(section => {
                    const sectionTop = section.offsetTop;
                    if (window.scrollY >= (sectionTop - 150)) {
                        current = '#' + section.getAttribute('id');
                    }
                });
            }
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === current) {
                    link.classList.add('active');
                }
            });
        }
    });

    // Mobile toggle
    const mobileToggle = document.querySelector('.mobile-toggle');
    const navMenu = document.querySelector('.navbar-nav');
    if (mobileToggle && navMenu) {
        mobileToggle.addEventListener('click', () => {
            navMenu.classList.toggle('show');
        });
    }

    // User dropdown
    const userAvatar = document.querySelector('.user-avatar');
    const dropdown = document.querySelector('.dropdown-menu');
    if (userAvatar && dropdown) {
        userAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('show');
        });
        document.addEventListener('click', () => {
            dropdown.classList.remove('show');
        });
    }
}

// ── Update Nav UI ──
function updateNavUI() {
    const navActions = document.querySelector('.nav-actions');
    if (!navActions) return;

    if (AppState.user) {
        const initial = AppState.user.username.charAt(0).toUpperCase();
        navActions.innerHTML = `
            <a href="/cart.html" class="btn btn-secondary btn-icon cart-badge" id="cart-nav-btn">
                <i data-lucide="shopping-cart"></i>
                <span class="badge-count" id="cart-count" style="display:${AppState.cartCount > 0 ? 'flex' : 'none'}">${AppState.cartCount}</span>
            </a>
            <div class="user-dropdown">
                <div class="user-avatar" id="user-avatar-btn">${initial}</div>
                <div class="dropdown-menu" id="user-dropdown">
                    <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:6px;">
                        <div style="font-weight:600;color:var(--text-primary)">${AppState.user.username}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted)">${AppState.user.role === 'admin' ? '<i data-lucide="crown" style="width:14px;height:14px"></i> Admin' : '<i data-lucide="user" style="width:14px;height:14px"></i> User'}</div>
                    </div>
                    ${AppState.user.role === 'admin' ? '<a href="/admin/dashboard.html"><i data-lucide="layout-dashboard" style="width:16px;height:16px"></i> Admin Dashboard</a>' : ''}
                    ${AppState.user.role === 'seller' ? '<a href="/seller/index.html"><i data-lucide="store" style="width:16px;height:16px"></i> Seller Dashboard</a>' : ''}
                    <a href="/orders.html"><i data-lucide="package" style="width:16px;height:16px"></i> Pesanan Saya</a>
                    <div class="dropdown-divider"></div>
                    <button onclick="logout()"><i data-lucide="log-out" style="width:16px;height:16px"></i> Logout</button>
                </div>
            </div>
        `;

        if (window.lucide) {
            lucide.createIcons();
        }

        // Reinitialize dropdown
        const avatar = document.getElementById('user-avatar-btn');
        const dropdown = document.getElementById('user-dropdown');
        if (avatar && dropdown) {
            avatar.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('show');
            });
            document.addEventListener('click', () => {
                dropdown.classList.remove('show');
            });
        }
    } else {
        navActions.innerHTML = `
            <a href="/login.html" class="btn btn-secondary btn-sm">Login</a>
            <a href="/register.html" class="btn btn-primary btn-sm">Register</a>
        `;
    }
}

// ── Auth Check ──
async function checkAuth() {
    try {
        const cached = JSON.parse(localStorage.getItem('storeu_user') || 'null');
        if (cached) {
            AppState.user = cached;
            updateNavUI();
        }
    } catch (e) { }

    try {
        const data = await API.get('/api/auth/me');
        if (data.user) {
            AppState.user = data.user;
            localStorage.setItem('storeu_user', JSON.stringify(data.user));
        }

        // Get cart count
        try {
            const cartData = await API.get('/api/cart/count');
            AppState.cartCount = cartData.count || 0;
        } catch (e) { /* ignore */ }

        updateNavUI();
    } catch (err) {
        if (!AppState.user) {
            localStorage.removeItem('storeu_user');
            AppState.user = null;
            updateNavUI();
        }
    }
}

// ── Logout ──
async function logout() {
    try {
        await API.post('/api/auth/logout');
    } catch (e) { }

    try {
        localStorage.removeItem('storeu_user');
        sessionStorage.removeItem('storeu_checkout_data');
        sessionStorage.removeItem('storeu_checkout_items');
        if (typeof CartStore !== 'undefined') CartStore.clear();
        AppState.user = null;
        AppState.cartCount = 0;
    } catch (err) { console.error(err); }

    // Redirect to login to force navigation
    window.location.href = '/login.html';
}

// ── Add to Cart ──
async function addToCart(productId, btn) {
    if (!AppState.user) {
        showToast('Login dulu untuk menambahkan ke keranjang', 'warning');
        window.location.href = '/login.html';
        return;
    }

    try {
        let prod = null;
        if (window.catalogProducts && Array.isArray(window.catalogProducts)) {
            prod = window.catalogProducts.find(p => p.id == productId);
        }
        if (!prod) {
            try {
                const res = await API.get(`/api/products/${productId}`);
                prod = res.product || res;
            } catch (e) {}
        }

        if (prod) {
            CartStore.addItem(prod, 1);
        } else {
            CartStore.addItem({ id: productId, name: 'Produk #' + productId, price: 0 }, 1);
        }

        // Background server sync
        API.post('/api/cart', { product_id: productId }).catch(() => {});
        API.post('/api/cart/sync', { items: CartStore.getItems() }).catch(() => {});

        AppState.cartCount = CartStore.getCount();
        updateCartBadge(true);
        if (window.StoreuSound) StoreuSound.play('add');
        showToast('Berhasil ditambahkan ke keranjang', 'success');

        // Button feedback: morph to check, then revert
        const target = btn || document.querySelector(`[data-add="${productId}"]`);
        if (target && target.classList.contains('p-add')) {
            const original = target.innerHTML;
            target.classList.add('added');
            target.innerHTML = '<i data-lucide="check"></i>';
            if (window.lucide) lucide.createIcons();
            setTimeout(() => {
                target.classList.remove('added');
                target.innerHTML = original;
                if (window.lucide) lucide.createIcons();
            }, 1400);
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function updateCartBadge(pulse) {
    const badge = document.getElementById('cart-count');
    if (badge) {
        const count = CartStore.getCount();
        AppState.cartCount = count;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
        if (pulse && count > 0) {
            badge.classList.remove('badge-pop');
            void badge.offsetWidth; // restart animation
            badge.classList.add('badge-pop');
        }
    }
}

// ── Scroll Animations ──
function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.animate-in').forEach(el => observer.observe(el));
}

// ── Product Card HTML ──
// Escape untuk atribut HTML
function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── Badge rules — 100% dari data asli, tanpa klaim palsu ──
function productBadges(product) {
    const badges = { left: [], right: [] };
    const cat = product.category || 'other';
    const catLabel = { game: 'Game', film: 'Film', music: 'Musik', ebook: 'eBook' }[cat] || cat;
    badges.left.push('<span class="p-tag p-tag-cat ' + cat + '">' + catLabel + '</span>');
    const rating = Number(product.rating) || 0;
    if (rating > 0) {
        badges.right.push('<span class="p-tag p-tag-rating"><i data-lucide="star" style="width:12px;height:12px;fill:#fbbf24;color:#fbbf24"></i> ' + rating.toFixed(1) + '</span>');
    }
    if (product.discount_percentage > 0) {
        badges.left.push('<span class="p-tag p-tag-disc">-' + product.discount_percentage + '%</span>');
    }
    if (product.featured) {
        badges.left.push('<span class="p-tag p-tag-flag"><i data-lucide="flame"></i> Unggulan</span>');
    } else if (rating >= 4.8) {
        badges.left.push('<span class="p-tag p-tag-top">Top Rated</span>');
    }
    if (product.created_at) {
        const ageDays = (Date.now() - new Date(product.created_at).getTime()) / 86400000;
        if (ageDays >= 0 && ageDays <= 30) badges.left.push('<span class="p-tag p-tag-new">Baru</span>');
    }
    return badges;
}

function priceHtml(product) {
    const price = Number(product.price) || 0;
    const disc = Number(product.discount_percentage) || 0;
    if (disc > 0) {
        const finalPrice = Math.round(price - (price * disc / 100));
        return '<div class="p-price"><span class="p-price-old">' + formatRupiah(price) + '</span>' +
               '<span class="p-price-now">' + formatRupiah(finalPrice) + '</span></div>';
    }
    return '<div class="p-price"><span class="p-price-now no-disc">' + formatRupiah(price) + '</span></div>';
}

// ── Product Card v2 ──
function renderProductCard(product) {
    const badges = productBadges(product);
    const name = escAttr(product.name);
    const detailUrl = '/product.html?id=' + product.id;
    const media = product.image_url
        ? '<img src="' + escAttr(product.image_url) + '" alt="' + name + '" loading="lazy" onerror="this.remove();">'
        : '<div class="p-img-fallback" aria-hidden="true">' + getCategoryIcon(product.category) + '</div>';
    const dev = escAttr(product.developer || product.platform || '');

    return '' +
    '<article class="p-card" data-product-id="' + product.id + '" data-category="' + escAttr(product.category) + '">' +
        '<a class="p-card-media" href="' + detailUrl + '" aria-label="Lihat detail ' + name + '">' +
            media +
            '<span class="p-badges"><span class="p-badges-left">' + badges.left.join('') + '</span>' +
            '<span class="p-badges-right">' + badges.right.join('') + '</span></span>' +
            '<span class="p-quick" role="button" tabindex="0" data-quickview="' + product.id + '" ' +
                'onclick="event.preventDefault();event.stopPropagation();openQuickView(' + product.id + ')" ' +
                'onkeydown="if(event.key===\'Enter\'){event.preventDefault();openQuickView(' + product.id + ')}" ' +
                'aria-label="Pratinjau cepat ' + name + '">' +
                '<i data-lucide="eye"></i> Quick view</span>' +
        '</a>' +
        '<div class="p-card-body">' +
            '<h3 class="p-name"><a href="' + detailUrl + '">' + escAttr(product.name) + '</a></h3>' +
            (dev ? '<p class="p-dev">' + dev + '</p>' : '') +
            '<div class="p-foot">' + priceHtml(product) +
                '<button class="p-add" data-add="' + product.id + '" onclick="event.stopPropagation();addToCart(' + product.id + ', this)" ' +
                    'aria-label="Tambah ' + name + ' ke keranjang"><i data-lucide="shopping-cart"></i></button>' +
            '</div>' +
        '</div>' +
    '</article>';
}

// ── Quick View modal (data asli dari API) ──
async function openQuickView(productId) {
    if (window.StoreuSound) StoreuSound.play('click');
    let product = null;
    try {
        if (window.catalogProducts && Array.isArray(window.catalogProducts)) {
            product = window.catalogProducts.find(p => p.id == productId);
        }
        if (!product) {
            const res = await API.get('/api/products/' + productId);
            product = res.product || res;
        }
    } catch (e) { showToast('Gagal memuat pratinjau', 'error'); return; }
    if (!product) return;

    closeQuickView();
    const name = escAttr(product.name);
    const overlay = document.createElement('div');
    overlay.className = 'qv-overlay';
    overlay.id = 'qv-overlay';
    overlay.innerHTML =
        '<div class="qv-modal" role="dialog" aria-modal="true" aria-label="Pratinjau ' + name + '">' +
            '<button class="qv-close" aria-label="Tutup pratinjau">✕</button>' +
            '<div class="qv-media">' +
                (product.image_url ? '<img src="' + escAttr(product.image_url) + '" alt="' + name + '">' : '<div class="p-img-fallback">' + getCategoryIcon(product.category) + '</div>') +
            '</div>' +
            '<div class="qv-body">' +
                '<h3>' + escAttr(product.name) + '</h3>' +
                '<p class="qv-dev">' + escAttr(product.developer || product.platform || '') + '</p>' +
                '<p class="qv-desc">' + escAttr((product.description || '').slice(0, 220)) + (product.description && product.description.length > 220 ? '…' : '') + '</p>' +
                '<div class="qv-foot">' + priceHtml(product) +
                    '<div style="display:flex;gap:10px">' +
                        '<button class="btn btn-primary" onclick="addToCart(' + product.id + ', this);">' +
                            '<i data-lucide="shopping-cart" style="width:16px;height:16px"></i> Keranjang</button>' +
                        '<a class="btn btn-ghost" href="/product.html?id=' + product.id + '">Detail</a>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    if (window.lucide) lucide.createIcons();
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeQuickView(); });
    overlay.querySelector('.qv-close').addEventListener('click', closeQuickView);
    document.addEventListener('keydown', qvEscHandler);
    const closeBtn = overlay.querySelector('.qv-close');
    if (closeBtn) closeBtn.focus();
}
function qvEscHandler(e) { if (e.key === 'Escape') closeQuickView(); }
function closeQuickView() {
    const overlay = document.getElementById('qv-overlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', qvEscHandler);
}
// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    checkAuth();
    initScrollAnimations();

    // Dynamically load chat widget if not already present
    if (!document.getElementById('nex-chat-widget-script')) {
        const chatScript = document.createElement('script');
        chatScript.id = 'nex-chat-widget-script';
        chatScript.src = '/js/chat-widget.js';
        chatScript.defer = true;
        document.body.appendChild(chatScript);
    }
});
