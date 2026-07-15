/* ==========================================================================
   UNCLE RATT — script.js
   Firebase-powered storefront + admin dashboard.

   SETUP (required before this site is live):
   1. Create a project at https://console.firebase.google.com
   2. Enable: Authentication (Email/Password), Firestore Database, Storage.
   3. In Authentication > Users, create yourself an admin account
      (this is the email/password you will log in with on the site).
   4. Paste your project's config into FIREBASE_CONFIG below.
   5. Firestore security rules (starting point — tighten as needed):

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /products/{id}   { allow read: if true; allow write: if request.auth != null; }
          match /categories/{id} { allow read: if true; allow write: if request.auth != null; }
          match /orders/{id}     { allow read: if request.auth != null; allow create: if true; allow update, delete: if request.auth != null; }
          match /settings/{id}   { allow read: if true; allow write: if request.auth != null; }
        }
      }

   6. Storage security rules:

      rules_version = '2';
      service firebase.storage {
        match /b/{bucket}/o {
          match /products/{allPaths=**} { allow read: if true; allow write: if request.auth != null; }
        }
      }

   Until FIREBASE_CONFIG is filled in, the storefront still renders (with an
   empty catalog) and the admin login will show a friendly error instead of
   crashing the page.
   ========================================================================== */

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const WHATSAPP_NUMBER = "254700000000"; // digits only, country code first

const DEFAULT_CATEGORIES = [
  { id: "whiskey", name: "Whiskey", icon: "🥃" },
  { id: "vodka", name: "Vodka", icon: "🧊" },
  { id: "gin", name: "Gin", icon: "🌿" },
  { id: "rum", name: "Rum", icon: "🏝️" },
  { id: "wine", name: "Wine", icon: "🍷" },
  { id: "champagne", name: "Champagne", icon: "🥂" },
  { id: "brandy", name: "Brandy", icon: "🔥" },
  { id: "cognac", name: "Cognac", icon: "🛢️" },
  { id: "tequila", name: "Tequila", icon: "🌵" },
  { id: "liqueurs", name: "Liqueurs", icon: "✨" },
  { id: "mixers", name: "Soft Drinks & Mixers", icon: "🥤" }
];

/* ---------------------------------------------------------------------- *
 * Firebase init (guarded — never throws even with placeholder config)
 * ---------------------------------------------------------------------- */
let fbApp = null, auth = null, db = null, storage = null, firebaseReady = false;
try {
  fbApp = firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
  firebaseReady = true;
} catch (err) {
  console.warn("Firebase not configured yet:", err.message);
}

/* ---------------------------------------------------------------------- *
 * State
 * ---------------------------------------------------------------------- */
const state = {
  products: [],
  categories: [],
  orders: [],
  cart: JSON.parse(localStorage.getItem("ur_cart") || "[]"),
  filters: { search: "", category: "all", price: "all", sort: "newest" },
  isAdmin: false,
  currentEditId: null,
  pendingImageFile: null
};

/* ---------------------------------------------------------------------- *
 * Small utilities
 * ---------------------------------------------------------------------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const fmtPrice = (n) => "KSh " + Number(n || 0).toLocaleString("en-KE");
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.style.borderColor = isError ? "var(--danger)" : "var(--gold-dim)";
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3200);
}

// Tracks which overlays are currently open, in open-order, so the most
// recently opened one is always visually on top and closes first (Escape
// key, or its own close button/backdrop) — this prevents modals getting
// stuck stacked behind one another.
const overlayStack = [];
function openOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = false;
  const idx = overlayStack.indexOf(id);
  if (idx > -1) overlayStack.splice(idx, 1);
  overlayStack.push(id);
  overlayStack.forEach((stackedId, i) => {
    document.getElementById(stackedId).style.zIndex = 800 + i;
  });
  document.body.style.overflow = "hidden";
}
function closeOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = true;
  el.style.zIndex = "";
  const idx = overlayStack.indexOf(id);
  if (idx > -1) overlayStack.splice(idx, 1);
  if (!overlayStack.length) document.body.style.overflow = "";
}
function closeTopOverlay() {
  if (overlayStack.length) closeOverlay(overlayStack[overlayStack.length - 1]);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTopOverlay(); });
$$("[data-close]").forEach((btn) => btn.addEventListener("click", () => closeOverlay(btn.dataset.close)));
$$(".modal-overlay").forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov) closeOverlay(ov.id); }));

/* ==========================================================================
   PRELOADER, NAV, SCROLL EFFECTS, MOBILE MENU, DARK MODE, BACK TO TOP
   ========================================================================== */
window.addEventListener("load", () => {
  setTimeout(() => $("#preloader").classList.add("done"), 400);
});

const siteNav = $("#siteNav");
window.addEventListener("scroll", () => {
  siteNav.classList.toggle("scrolled", window.scrollY > 40);
  $("#backToTop").classList.toggle("show", window.scrollY > 600);
  highlightActiveNav();
}, { passive: true });

function highlightActiveNav() {
  const sections = ["home", "products", "categories", "about", "contact"];
  let current = sections[0];
  for (const id of sections) {
    const sec = document.getElementById(id);
    if (sec && sec.getBoundingClientRect().top <= 120) current = id;
  }
  $$(".primary-links .nav-link").forEach((l) => {
    l.classList.toggle("active-link", l.getAttribute("href") === "#" + current);
  });
}

const hamburgerBtn = $("#hamburgerBtn"), mobileMenu = $("#mobileMenu");
hamburgerBtn.addEventListener("click", () => {
  const open = mobileMenu.classList.toggle("open");
  hamburgerBtn.setAttribute("aria-expanded", String(open));
});
$$("#mobileMenu .nav-link").forEach((l) => l.addEventListener("click", () => mobileMenu.classList.remove("open")));

$("#backToTop").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

const darkModeToggle = $("#darkModeToggle");
function applyStoredTheme() {
  if (localStorage.getItem("ur_theme") === "light") document.documentElement.classList.add("light-mode");
}
applyStoredTheme();
darkModeToggle.addEventListener("click", () => {
  const isLight = document.documentElement.classList.toggle("light-mode");
  localStorage.setItem("ur_theme", isLight ? "light" : "dark");
});

/* scroll reveal */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in-view"); revealObserver.unobserve(e.target); } });
}, { threshold: 0.12 });
function observeReveals(root = document) { $$(".reveal-up", root).forEach((el) => revealObserver.observe(el)); }
observeReveals();

$("#year").textContent = new Date().getFullYear();

/* ==========================================================================
   LEGAL MODAL
   ========================================================================== */
const LEGAL = {
  privacy: `<h4>Information We Collect</h4><p>We collect the details you provide when placing an order — name, phone number and delivery location — solely to fulfil that order.</p>
  <h4>How We Use It</h4><p>Your information is used to process orders, confirm delivery and respond to enquiries. We do not sell customer data.</p>
  <h4>Age Verification</h4><p>All customers must confirm they are of legal drinking age in their jurisdiction before completing a purchase.</p>
  <h4>Contact</h4><p>Questions about this policy can be sent to hello@uncleratt.com.</p>`,
  terms: `<h4>Orders</h4><p>All orders are subject to availability and confirmation of the order price. Bottle photography is representative; vintages and label designs may vary.</p>
  <h4>Age Restriction</h4><p>By ordering, you confirm you are of legal drinking age. We reserve the right to request ID on delivery.</p>
  <h4>Delivery</h4><p>Delivery times are estimates. Risk passes to the customer on receipt of goods.</p>
  <h4>Responsible Drinking</h4><p>Uncle Ratt encourages responsible consumption and does not sell to intoxicated persons or minors.</p>`
};
$("#privacyLink").addEventListener("click", (e) => { e.preventDefault(); $("#legalTitle").textContent = "Privacy Policy"; $("#legalBody").innerHTML = LEGAL.privacy; openOverlay("legalOverlay"); });
$("#termsLink").addEventListener("click", (e) => { e.preventDefault(); $("#legalTitle").textContent = "Terms & Conditions"; $("#legalBody").innerHTML = LEGAL.terms; openOverlay("legalOverlay"); });

/* ==========================================================================
   CATEGORIES — render grid, chips, selects
   ========================================================================== */
function getActiveCategories() {
  return state.categories.length ? state.categories : DEFAULT_CATEGORIES;
}

function renderCategories() {
  const cats = getActiveCategories();

  $("#categoryGrid").innerHTML = cats.map((c) => `
    <div class="category-card" data-cat="${c.name}">
      <div class="cat-icon">${c.icon || "🍾"}</div>
      <h3>${c.name}</h3>
      <span id="count-${slugify(c.name)}">0 bottles</span>
    </div>`).join("");

  $$(".category-card").forEach((card) => card.addEventListener("click", () => {
    state.filters.category = card.dataset.cat;
    $("#categoryFilter").value = card.dataset.cat;
    document.getElementById("products").scrollIntoView({ behavior: "smooth" });
    renderProducts();
    syncChips();
  }));

  $("#categoryFilter").innerHTML = `<option value="all">All Categories</option>` +
    cats.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");

  $("#chipRow").innerHTML = `<button class="chip active" data-cat="all">All</button>` +
    cats.map((c) => `<button class="chip" data-cat="${c.name}">${c.name}</button>`).join("");
  syncChips();

  const pfCategory = $("#pfCategory");
  if (pfCategory) pfCategory.innerHTML = cats.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");

  renderCategoryManageList();
  observeReveals();
}

function syncChips() {
  $$(".chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.cat === state.filters.category);
  });
}
$("#chipRow").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.filters.category = chip.dataset.cat;
  $("#categoryFilter").value = chip.dataset.cat;
  syncChips();
  renderProducts();
});

$$('a[data-cat-link]').forEach((a) => a.addEventListener("click", (e) => {
  e.preventDefault();
  state.filters.category = a.dataset.catLink;
  $("#categoryFilter").value = a.dataset.catLink;
  document.getElementById("products").scrollIntoView({ behavior: "smooth" });
  renderProducts();
  syncChips();
}));

function updateCategoryCounts() {
  getActiveCategories().forEach((c) => {
    const el = document.getElementById("count-" + slugify(c.name));
    if (el) el.textContent = state.products.filter((p) => p.category === c.name).length + " bottles";
  });
}

/* ==========================================================================
   PRODUCTS — Firestore listener, filtering, rendering
   ========================================================================== */
function listenProducts() {
  if (!firebaseReady) { $("#productsLoader").hidden = true; renderProducts(); return; }
  db.collection("products").orderBy("createdAt", "desc").onSnapshot((snap) => {
    state.products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("#productsLoader").hidden = true;
    renderProducts();
    renderFeatured();
    updateCategoryCounts();
    if (state.isAdmin) { renderAdminProducts(); renderStats(); }
  }, (err) => {
    console.error(err);
    $("#productsLoader").hidden = true;
    toast("Could not load products — check Firebase setup.", true);
  });
}

function applyFilters(list) {
  const f = state.filters;
  let out = list.filter((p) => {
    if (f.category !== "all" && p.category !== f.category) return false;
    if (f.search && !(`${p.name} ${p.category}`.toLowerCase().includes(f.search.toLowerCase()))) return false;
    if (f.price !== "all") {
      const [min, max] = f.price.split("-").map(Number);
      if (!(p.price >= min && p.price <= max)) return false;
    }
    return true;
  });
  switch (f.sort) {
    case "cheapest": out.sort((a, b) => a.price - b.price); break;
    case "expensive": out.sort((a, b) => b.price - a.price); break;
    case "popular": out.sort((a, b) => (b.sold || 0) - (a.sold || 0)); break;
    default: out.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }
  return out;
}

function productCard(p) {
  const stock = Number(p.stock || 0);
  const stockLabel = stock <= 0 ? '<span class="stock-pill stock-out">Out of stock</span>'
    : stock <= 5 ? `<span class="stock-pill stock-low">Only ${stock} left</span>`
    : '<span class="stock-pill stock-in">In stock</span>';
  const img = p.imageUrl
    ? `<img src="${p.imageUrl}" alt="${p.name}" loading="lazy">`
    : `<div class="no-img">🍾</div>`;
  return `
  <article class="product-card" data-id="${p.id}">
    <div class="product-media" data-open-product="${p.id}">
      ${p.featured ? '<span class="badge badge-featured">Featured</span>' : ""}
      ${stock <= 0 ? '<span class="badge badge-oos">Sold out</span>' : ""}
      ${img}
    </div>
    <div class="product-info">
      <span class="product-cat">${p.category || "Uncategorized"}</span>
      <h3 class="product-name">${p.name}</h3>
      <span class="product-meta">${p.size || ""}${p.size && p.abv ? " · " : ""}${p.abv ? p.abv + " ABV" : ""}</span>
      <div class="product-bottom">
        <span class="product-price">${fmtPrice(p.price)}</span>
        ${stockLabel}
      </div>
      <button class="add-cart-btn" data-add="${p.id}" ${stock <= 0 ? "disabled" : ""}>${stock <= 0 ? "Unavailable" : "Add to Cart"}</button>
    </div>
  </article>`;
}

function renderProducts() {
  const filtered = applyFilters(state.products);
  $("#productGrid").innerHTML = filtered.map(productCard).join("");
  $("#emptyState").hidden = filtered.length !== 0;
  bindProductCardEvents($("#productGrid"));
  observeReveals();
}

function renderFeatured() {
  const featured = state.products.filter((p) => p.featured).slice(0, 8);
  const wrap = $("#featuredGrid").closest(".featured-section");
  if (!featured.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  $("#featuredGrid").innerHTML = featured.map(productCard).join("");
  bindProductCardEvents($("#featuredGrid"));
  observeReveals();
}

function bindProductCardEvents(root) {
  $$("[data-open-product]", root).forEach((el) => el.addEventListener("click", () => openProductModal(el.dataset.openProduct)));
  $$("[data-add]", root).forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); addToCart(btn.dataset.add, 1); }));
}

$("#searchInput").addEventListener("input", (e) => { state.filters.search = e.target.value; renderProducts(); });
$("#categoryFilter").addEventListener("change", (e) => { state.filters.category = e.target.value; syncChips(); renderProducts(); });
$("#priceFilter").addEventListener("change", (e) => { state.filters.price = e.target.value; renderProducts(); });
$("#sortFilter").addEventListener("change", (e) => { state.filters.sort = e.target.value; renderProducts(); });

/* ---------------- product quick-view modal ---------------- */
function openProductModal(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const stock = Number(p.stock || 0);
  $("#productModalBody").innerHTML = `
    <div class="pm-gallery">${p.imageUrl ? `<img src="${p.imageUrl}" alt="${p.name}">` : `<div class="no-img" style="aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:3rem;">🍾</div>`}</div>
    <div class="pm-details">
      <span class="pm-cat">${p.category || ""}</span>
      <h2 class="pm-name">${p.name}</h2>
      <div class="pm-price">${fmtPrice(p.price)}</div>
      <div class="pm-specs">
        <div><span>Size</span><strong>${p.size || "—"}</strong></div>
        <div><span>ABV</span><strong>${p.abv || "—"}</strong></div>
        <div><span>Availability</span><strong>${stock > 0 ? stock + " in stock" : "Out of stock"}</strong></div>
      </div>
      <p class="pm-desc">${p.description || "A carefully selected bottle from the Uncle Ratt cellar."}</p>
      <div class="pm-qty">
        <button class="qty-btn" id="pmMinus">−</button>
        <span id="pmQty">1</span>
        <button class="qty-btn" id="pmPlus">+</button>
      </div>
      <button class="btn btn-gold btn-block" id="pmAddBtn" ${stock <= 0 ? "disabled" : ""}>${stock <= 0 ? "Unavailable" : "Add to Cart"}</button>
    </div>`;

  let qty = 1;
  const qtyEl = $("#pmQty");
  $("#pmMinus").addEventListener("click", () => { qty = Math.max(1, qty - 1); qtyEl.textContent = qty; });
  $("#pmPlus").addEventListener("click", () => { qty = Math.min(stock || 99, qty + 1); qtyEl.textContent = qty; });
  $("#pmAddBtn").addEventListener("click", () => addToCart(p.id, qty));

  const related = state.products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
  $("#relatedGrid").innerHTML = related.map(productCard).join("");
  bindProductCardEvents($("#relatedGrid"));

  openOverlay("productModalOverlay");
}

/* ==========================================================================
   CART
   ========================================================================== */
function saveCart() { localStorage.setItem("ur_cart", JSON.stringify(state.cart)); }

function addToCart(id, qty = 1) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const existing = state.cart.find((c) => c.id === id);
  const maxQty = Number(p.stock || 99);
  if (existing) existing.qty = Math.min(maxQty, existing.qty + qty);
  else state.cart.push({ id, name: p.name, price: p.price, imageUrl: p.imageUrl || "", qty: Math.min(maxQty, qty) });
  saveCart();
  renderCart();
  toast(`${p.name} added to cart`);
}

function renderCart() {
  $("#cartCount").textContent = state.cart.reduce((s, c) => s + c.qty, 0);
  const wrap = $("#cartItems");
  if (!state.cart.length) { wrap.innerHTML = `<p class="cart-empty">Your cart is empty.</p>`; $("#cartSubtotal").textContent = fmtPrice(0); return; }
  wrap.innerHTML = state.cart.map((c) => `
    <div class="cart-item" data-id="${c.id}">
      ${c.imageUrl ? `<img src="${c.imageUrl}" alt="${c.name}">` : `<div class="no-img" style="width:56px;height:72px;border-radius:8px;background:var(--panel-2);display:flex;align-items:center;justify-content:center;">🍾</div>`}
      <div class="cart-item-info">
        <h4>${c.name}</h4>
        <span>${fmtPrice(c.price)}</span>
        <div class="cart-qty-row">
          <button data-dec="${c.id}">−</button>
          <span>${c.qty}</span>
          <button data-inc="${c.id}">+</button>
        </div>
      </div>
      <button class="cart-remove" data-remove="${c.id}" aria-label="Remove">&times;</button>
    </div>`).join("");

  $$("[data-inc]", wrap).forEach((b) => b.addEventListener("click", () => changeQty(b.dataset.inc, 1)));
  $$("[data-dec]", wrap).forEach((b) => b.addEventListener("click", () => changeQty(b.dataset.dec, -1)));
  $$("[data-remove]", wrap).forEach((b) => b.addEventListener("click", () => { state.cart = state.cart.filter((c) => c.id !== b.dataset.remove); saveCart(); renderCart(); }));

  const subtotal = state.cart.reduce((s, c) => s + c.price * c.qty, 0);
  $("#cartSubtotal").textContent = fmtPrice(subtotal);
}

function changeQty(id, delta) {
  const item = state.cart.find((c) => c.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter((c) => c.id !== id);
  saveCart();
  renderCart();
}

const cartOverlay = $("#cartOverlay"), cartDrawer = $("#cartDrawer");
function openCart() { cartOverlay.hidden = false; cartDrawer.classList.add("open"); document.body.style.overflow = "hidden"; }
function closeCart() { cartDrawer.classList.remove("open"); setTimeout(() => { cartOverlay.hidden = true; document.body.style.overflow = ""; }, 300); }
$("#cartToggle").addEventListener("click", openCart);
$("#closeCart").addEventListener("click", closeCart);
cartOverlay.addEventListener("click", closeCart);

$("#checkoutBtn").addEventListener("click", async () => {
  if (!state.cart.length) { toast("Your cart is empty", true); return; }
  const name = prompt("Your name, for the order:");
  if (!name) return;
  const phone = prompt("Phone number for delivery confirmation:");
  if (!phone) return;

  const total = state.cart.reduce((s, c) => s + c.price * c.qty, 0);
  const lines = state.cart.map((c) => `• ${c.qty} × ${c.name} — ${fmtPrice(c.price * c.qty)}`).join("%0A");
  const msg = `Hello Uncle Ratt! I'd like to order:%0A%0A${lines}%0A%0A*Total: ${fmtPrice(total)}*%0A%0AName: ${name}%0APhone: ${phone}`;

  if (firebaseReady) {
    try {
      await db.collection("orders").add({
        customerName: name, phone,
        items: state.cart.map((c) => ({ id: c.id, name: c.name, price: c.price, qty: c.qty })),
        total, status: "pending",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) { console.warn("Order not saved to Firestore:", err.message); }
  }

  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, "_blank");
  state.cart = [];
  saveCart();
  renderCart();
  closeCart();
});

/* ==========================================================================
   PROMO BANNER (Firestore settings/banner)
   ========================================================================== */
function listenBanner() {
  if (!firebaseReady) return;
  db.collection("settings").doc("banner").onSnapshot((doc) => {
    const data = doc.data();
    if (data && data.active && data.text) {
      $("#promoText").textContent = data.text;
      $("#promoBanner").hidden = false;
    } else {
      $("#promoBanner").hidden = true;
    }
    $("#bannerText").value = data?.text || "";
    $("#bannerActive").checked = !!data?.active;
  }, () => {});
}
$("#promoClose").addEventListener("click", () => { $("#promoBanner").hidden = true; });

/* ==========================================================================
   ADMIN — AUTH
   ========================================================================== */
$("#adminLoginLink").addEventListener("click", (e) => { e.preventDefault(); openAdminEntry(); });
$("#adminLoginLinkMobile").addEventListener("click", (e) => { e.preventDefault(); mobileMenu.classList.remove("open"); openAdminEntry(); });

function openAdminEntry() {
  if (state.isAdmin) openOverlay("adminDashOverlay");
  else openOverlay("adminLoginOverlay");
}

$("#adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#adminLoginError");
  errEl.hidden = true;
  if (!firebaseReady) { errEl.textContent = "Firebase isn't configured yet — add your project keys in script.js."; errEl.hidden = false; return; }
  const email = $("#adminEmail").value.trim();
  const password = $("#adminPassword").value;
  try {
    await auth.signInWithEmailAndPassword(email, password);
    closeOverlay("adminLoginOverlay");
    $("#adminLoginForm").reset();
  } catch (err) {
    errEl.textContent = "Sign-in failed — check the email and password.";
    errEl.hidden = false;
  }
});

$("#adminLogoutBtn").addEventListener("click", () => { if (firebaseReady) auth.signOut(); closeOverlay("adminDashOverlay"); });

if (firebaseReady) {
  auth.onAuthStateChanged((user) => {
    state.isAdmin = !!user;
    if (user) {
      $("#adminUserEmail").textContent = user.email;
      openOverlay("adminDashOverlay");
      renderAdminProducts();
      renderOrders();
      renderStats();
      renderCategoryManageList();
    }
  });
}

/* ==========================================================================
   ADMIN — TABS
   ========================================================================== */
$$(".admin-tab").forEach((tab) => tab.addEventListener("click", () => {
  $$(".admin-tab").forEach((t) => t.classList.remove("active"));
  $$(".admin-panel").forEach((p) => p.classList.remove("active"));
  tab.classList.add("active");
  document.getElementById(tab.dataset.tab).classList.add("active");
}));

/* ==========================================================================
   ADMIN — PRODUCTS CRUD
   ========================================================================== */
function renderAdminProducts() {
  $("#adminProductRows").innerHTML = state.products.map((p) => `
    <tr data-id="${p.id}">
      <td>${p.imageUrl ? `<img src="${p.imageUrl}" alt="">` : "—"}</td>
      <td>${p.name}</td>
      <td>${p.category || ""}</td>
      <td>${fmtPrice(p.price)}</td>
      <td>${p.stock ?? 0}</td>
      <td><button class="mini-toggle ${p.featured ? "on" : ""}" data-toggle-featured="${p.id}" aria-label="Toggle featured"></button></td>
      <td class="row-actions">
        <button class="row-btn" data-edit="${p.id}">Edit</button>
        <button class="row-btn danger" data-delete="${p.id}">Delete</button>
      </td>
    </tr>`).join("");

  $$("[data-edit]").forEach((b) => b.addEventListener("click", () => openProductForm(b.dataset.edit)));
  $$("[data-delete]").forEach((b) => b.addEventListener("click", () => deleteProduct(b.dataset.delete)));
  $$("[data-toggle-featured]").forEach((b) => b.addEventListener("click", () => toggleFeatured(b.dataset.toggleFeatured)));
}

async function toggleFeatured(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  try { await db.collection("products").doc(id).update({ featured: !p.featured }); }
  catch (err) { toast("Could not update — sign in as admin.", true); }
}

$("#newProductBtn").addEventListener("click", () => openProductForm(null));

function openProductForm(id) {
  state.currentEditId = id;
  state.pendingImageFile = null;
  const p = id ? state.products.find((x) => x.id === id) : null;
  $("#pfTitle").textContent = p ? "Edit Product" : "Add Product";
  $("#pfId").value = id || "";
  $("#pfName").value = p?.name || "";
  $("#pfCategory").value = p?.category || getActiveCategories()[0]?.name || "";
  $("#pfPrice").value = p?.price ?? "";
  $("#pfSize").value = p?.size || "";
  $("#pfAbv").value = p?.abv || "";
  $("#pfStock").value = p?.stock ?? 0;
  $("#pfFeatured").checked = !!p?.featured;
  $("#pfDescription").value = p?.description || "";
  $("#pfError").hidden = true;
  $("#pfUploadProgress").textContent = "";
  const preview = $("#pfImagePreview");
  if (p?.imageUrl) { preview.src = p.imageUrl; preview.hidden = false; } else { preview.hidden = true; preview.src = ""; }
  $("#pfImageFile").value = "";
  openOverlay("productFormOverlay");
}

$("#pfImageFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.pendingImageFile = file;
  const preview = $("#pfImagePreview");
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
});

$("#productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#pfError");
  errEl.hidden = true;
  if (!firebaseReady) { errEl.textContent = "Firebase isn't configured — add your project keys in script.js."; errEl.hidden = false; return; }

  const submitBtn = $("#pfSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving...";

  const payload = {
    name: $("#pfName").value.trim(),
    category: $("#pfCategory").value,
    price: Number($("#pfPrice").value),
    size: $("#pfSize").value.trim(),
    abv: $("#pfAbv").value.trim(),
    stock: Number($("#pfStock").value),
    featured: $("#pfFeatured").checked,
    description: $("#pfDescription").value.trim()
  };

  try {
    let docId = state.currentEditId;
    if (!docId) {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      payload.sold = 0;
      const ref = await db.collection("products").add(payload);
      docId = ref.id;
    }

    if (state.pendingImageFile) {
      $("#pfUploadProgress").textContent = "Uploading image...";
      const path = `products/${docId}-${Date.now()}-${state.pendingImageFile.name}`;
      const ref = storage.ref().child(path);
      const task = ref.put(state.pendingImageFile);
      await new Promise((resolve, reject) => {
        task.on("state_changed", (snap) => {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          $("#pfUploadProgress").textContent = `Uploading image... ${pct}%`;
        }, reject, resolve);
      });
      const imageUrl = await task.snapshot.ref.getDownloadURL();
      payload.imageUrl = imageUrl;
      payload.imagePath = path;
    }

    await db.collection("products").doc(docId).set(payload, { merge: true });

    $("#pfUploadProgress").textContent = "";
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Product";
    closeOverlay("productFormOverlay");
    toast("Product saved");
  } catch (err) {
    console.error(err);
    errEl.textContent = "Could not save product. Make sure you're signed in and Firebase is configured.";
    errEl.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Product";
  }
});

async function deleteProduct(id) {
  if (!confirm("Delete this product? This cannot be undone.")) return;
  try {
    const p = state.products.find((x) => x.id === id);
    await db.collection("products").doc(id).delete();
    if (p?.imagePath) { try { await storage.ref().child(p.imagePath).delete(); } catch (e) {} }
    toast("Product deleted");
  } catch (err) { toast("Could not delete — sign in as admin.", true); }
}

/* ==========================================================================
   ADMIN — CATEGORIES
   ========================================================================== */
function listenCategories() {
  if (!firebaseReady) { renderCategories(); return; }
  db.collection("categories").orderBy("name").onSnapshot((snap) => {
    state.categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCategories();
  }, () => renderCategories());
}

function renderCategoryManageList() {
  const list = $("#categoryManageList");
  if (!list) return;
  const cats = getActiveCategories();
  list.innerHTML = cats.map((c) => `
    <li>
      <span>${c.icon || "🍾"} ${c.name}</span>
      ${c.id ? `<button class="row-btn danger" data-del-cat="${c.id}">Remove</button>` : `<span style="color:var(--dim-2);font-size:.72rem;">default</span>`}
    </li>`).join("");
  $$("[data-del-cat]", list).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Remove this category?")) return;
    try { await db.collection("categories").doc(b.dataset.delCat).delete(); toast("Category removed"); }
    catch (err) { toast("Could not remove category.", true); }
  }));
}

$("#newCategoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#newCategoryName").value.trim();
  if (!name || !firebaseReady) return;
  try {
    await db.collection("categories").add({ name, icon: "🍾" });
    $("#newCategoryName").value = "";
    toast("Category added");
  } catch (err) { toast("Could not add category — sign in as admin.", true); }
});

/* ==========================================================================
   ADMIN — BANNER
   ========================================================================== */
$("#bannerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!firebaseReady) return;
  try {
    await db.collection("settings").doc("banner").set({
      text: $("#bannerText").value.trim(),
      active: $("#bannerActive").checked
    });
    toast("Banner saved");
  } catch (err) { toast("Could not save banner — sign in as admin.", true); }
});

/* ==========================================================================
   ADMIN — ORDERS
   ========================================================================== */
function renderOrders() {
  if (!firebaseReady || !state.isAdmin) return;
  db.collection("orders").orderBy("createdAt", "desc").onSnapshot((snap) => {
    state.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("#ordersEmpty").hidden = state.orders.length !== 0;
    $("#adminOrderRows").innerHTML = state.orders.map((o) => `
      <tr>
        <td>#${o.id.slice(0, 6)}</td>
        <td>${o.customerName || "—"}<br><span style="color:var(--dim-2);font-size:.75rem;">${o.phone || ""}</span></td>
        <td>${(o.items || []).map((i) => `${i.qty}× ${i.name}`).join("<br>")}</td>
        <td>${fmtPrice(o.total)}</td>
        <td><button class="row-btn" data-cycle-status="${o.id}">${o.status || "pending"}</button></td>
        <td>${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString() : "—"}</td>
      </tr>`).join("");
    $$("[data-cycle-status]").forEach((b) => b.addEventListener("click", () => cycleOrderStatus(b.dataset.cycleStatus)));
    renderStats();
  }, () => {});
}

async function cycleOrderStatus(id) {
  const order = state.orders.find((o) => o.id === id);
  if (!order) return;
  const flow = ["pending", "confirmed", "delivered"];
  const next = flow[(flow.indexOf(order.status) + 1) % flow.length];
  try { await db.collection("orders").doc(id).update({ status: next }); }
  catch (err) { toast("Could not update order.", true); }
}

/* ==========================================================================
   ADMIN — STATS
   ========================================================================== */
function renderStats() {
  if (!state.isAdmin) return;
  const revenue = state.orders.reduce((s, o) => s + (o.total || 0), 0);
  $("#statRevenue").textContent = fmtPrice(revenue);
  $("#statOrders").textContent = state.orders.length;
  $("#statProducts").textContent = state.products.length;
  $("#statOOS").textContent = state.products.filter((p) => Number(p.stock || 0) <= 0).length;

  const soldMap = {};
  state.orders.forEach((o) => (o.items || []).forEach((i) => { soldMap[i.name] = (soldMap[i.name] || 0) + i.qty; }));
  const top = Object.entries(soldMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("#topSellersList").innerHTML = top.length
    ? top.map(([name, qty]) => `<li>${name} — ${qty} sold</li>`).join("")
    : `<li style="color:var(--dim-2);">No sales recorded yet.</li>`;
}

/* ==========================================================================
   INIT
   ========================================================================== */
renderCategories();
listenCategories();
listenProducts();
listenBanner();
renderCart();

if (!firebaseReady) {
  toast("Add your Firebase config in script.js to activate the store.", true);
}
