// Shared frontend: API client, app state (user, cart, wishlist), header/footer, UI helpers.
// Every page loads this, then runs its own code inside page(async () => { ... }).
const API = "/api/v1";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = (n) => "₹" + (+n || 0).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d, opts = { day: "numeric", month: "short", year: "numeric" }) => new Date(d).toLocaleDateString("en-IN", opts);
const qs = (obj) => { const u = new URLSearchParams(); Object.entries(obj).forEach(([k, v]) => [].concat(v).forEach((x) => x !== "" && x != null && x !== false && u.append(k, x))); const s = u.toString(); return s ? "?" + s : ""; };
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- API ----------
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data?.error?.details;
    err.notApi = !data?.error; // response didn't come from the CraftVerse API (e.g. a static file server)
    throw err;
  }
  return data;
}

// The site must be served by the CraftVerse server (it hosts both the pages and the API).
// If it was opened another way (VS Code Live Server, double-clicking the HTML file, …), find the real server.
const API_PORT = 5173;
async function findAppServer() {
  const host = location.protocol === "file:" ? "localhost" : location.hostname || "localhost";
  const origin = `http://${host}:${API_PORT}`;
  if (origin === location.origin) return null;
  try { await fetch(origin + "/api/v1/health", { mode: "no-cors", cache: "no-store" }); return origin; }
  catch { return null; }
}

// ---------- App state ----------
const App = { meta: { categories: [], config: {}, couponHints: [] }, user: null, cart: { items: [], groups: [], count: 0, totals: {} }, wish: new Set() };
const catName = (id) => (App.meta.categories.find((c) => c.id === id) || { name: id }).name;
const cfg = () => App.meta.config;

const ready = (async () => {
  // First call establishes the guest session cookie, so the parallel calls below share it
  App.user = (await api("/auth/me")).user;
  const [meta, cart, wish] = await Promise.all([api("/meta"), api("/cart"), api("/wishlist")]);
  App.meta = meta;
  App.cart = cart;
  App.wish = new Set(wish.ids);
  renderHeader(document.body.dataset.page);
  renderFooter();
})();

/** Run page code after the app has booted; show a friendly error if the API is down. */
function page(fn) {
  return ready.then(fn).catch(async (e) => {
    console.error(e);
    const main = $("main") || document.body;
    const noBackend = e.notApi || e instanceof TypeError; // wrong server, or no server at all
    if (noBackend) {
      const origin = await findAppServer();
      if (origin) {
        // Same page, served by the real app server
        location.replace(origin + "/" + (location.pathname.split("/").pop() || "index.html") + location.search + location.hash);
        return;
      }
      main.innerHTML = `<div class="empty"><div class="empty-icon">🔌</div><h3>The CraftVerse server isn't running</h3>
        <p class="muted">This site needs its backend for products, cart and checkout. ${location.port === "5500" || location.protocol === "file:" ? "Live Server and opening the HTML file directly only serve the pages, not the API." : ""}</p>
        <p class="muted small">Open a terminal in the <code>server</code> folder and run <code>npm install</code> (first time only) and then <code>npm start</code>.<br/>Then open <a class="link" href="http://localhost:${API_PORT}">http://localhost:${API_PORT}</a>.</p>
        <button class="btn" onclick="location.reload()">Try again</button></div>`;
      return;
    }
    main.innerHTML = `<div class="empty"><div class="empty-icon">🧶</div><h3>We couldn't load this page</h3><p class="muted">${esc(e.message)}</p>
      <button class="btn" onclick="location.reload()">Try again</button></div>`;
  });
}

const Auth = {
  async login(email, password) { const r = await api("/auth/login", { method: "POST", body: { email, password } }); App.user = r.user; return r.user; },
  async register(name, email, password) { const r = await api("/auth/register", { method: "POST", body: { name, email, password } }); App.user = r.user; return r.user; },
  async logout() { await api("/auth/logout", { method: "POST" }); App.user = null; },
  requireLogin(next = location.pathname.split("/").pop() + location.search) {
    if (App.user) return true;
    location.href = "login.html?next=" + encodeURIComponent(next);
    return false;
  },
};

// ---------- Cart (server-side) ----------
const Cart = {
  set(view) {
    App.cart = view;
    updateBadges();
    (view.warnings || []).forEach((w) => toast(w, true));
    document.dispatchEvent(new CustomEvent("cart:change"));
    return view;
  },
  async run(promise, okMsg) {
    try { const v = this.set(await promise); if (okMsg) toast(okMsg); return v; }
    catch (e) { toast(e.message, true); return null; }
  },
  load(paymentMethod) { return this.run(api("/cart" + qs({ paymentMethod }))); },
  add(productId, quantity = 1, size = null, name = "Item") { return this.run(api("/cart/items", { method: "POST", body: { productId, quantity, size } }), `✔ ${name}${size ? ` (${size})` : ""} added to bag`); },
  setQty(itemId, quantity) { return this.run(api(`/cart/items/${itemId}`, { method: "PATCH", body: { quantity } })); },
  remove(itemId) { return this.run(api(`/cart/items/${itemId}`, { method: "DELETE" }), "Removed from bag"); },
  clear() { return this.run(api("/cart", { method: "DELETE" })); },
  applyCoupon(code) { return this.run(api("/cart/coupon", { method: "POST", body: { code } }), `Coupon ${code.toUpperCase()} applied`); },
  removeCoupon() { return this.run(api("/cart/coupon", { method: "DELETE" }), "Coupon removed"); },
};

// ---------- Wishlist (server-side; works for guests, merged on login) ----------
const Wishlist = {
  has: (id) => App.wish.has(id),
  async toggle(id) {
    const on = !App.wish.has(id);
    try {
      await api(`/wishlist/${id}`, { method: on ? "POST" : "DELETE" });
      on ? App.wish.add(id) : App.wish.delete(id);
      toast(on ? "♥ Saved to wishlist" : "Removed from wishlist");
      updateBadges();
    } catch (e) { toast(e.message, true); }
    return App.wish.has(id);
  },
};

// ---------- Header / footer / toast ----------
function renderHeader(active) {
  const el = $("#site-header");
  if (!el) return;
  const user = App.user;
  const links = [["index.html", "Home", "home"], ["shop.html", "Shop", "shop"], ["brands.html", "Brands", "brands"], ["workshops.html", "Workshops", "workshops"], ["sell.html", "Sell", "sell"]];
  const extra = user?.role === "admin" ? [["admin.html", "Admin", "admin"]] : user?.vendor?.status === "approved" ? [["dashboard.html", "Dashboard", "dashboard"]] : [];
  el.className = "nav";
  el.innerHTML = `
    <a href="index.html" class="logo"><span class="logo-mark">✿</span>Craft<span>Verse</span></a>
    <nav id="menu">${[...links, ...extra].map(([h, t, k]) => `<a href="${h}" class="${k === active ? "active" : ""}">${t}</a>`).join("")}</nav>
    <form class="nav-search" action="shop.html"><input type="search" name="q" placeholder="Search crafts, brands…" aria-label="Search" /></form>
    <div class="nav-icons">
      <a href="wishlist.html" class="icon-btn ${active === "wishlist" ? "active" : ""}" aria-label="Wishlist" title="Wishlist">♡<span id="wishCount" class="count"></span></a>
      <a href="${user ? "orders.html" : "login.html"}" class="icon-btn ${active === "account" || active === "orders" ? "active" : ""}" title="${user ? "My account" : "Login / Sign up"}" aria-label="Account">👤${user ? `<small class="hi">${esc(user.name.split(" ")[0])}</small>` : ""}</a>
      <a href="cart.html" class="icon-btn ${active === "cart" ? "active" : ""}" aria-label="Bag" title="Bag">🛍<span id="cartCount" class="count"></span></a>
    </div>
    <button class="burger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>`;
  $("#burger").addEventListener("click", () => $("#menu").classList.toggle("open"));
  updateBadges();
}

function renderFooter() {
  const el = $("#site-footer");
  if (!el) return;
  const user = App.user;
  el.innerHTML = `
    <div class="foot-grid">
      <div><a href="index.html" class="logo"><span class="logo-mark">✿</span>Craft<span>Verse</span></a>
        <p class="muted">A marketplace and directory for India's artisans and craft brands. Buy straight from the people who make it.</p>
        <div class="socials"><a href="#" aria-label="Instagram">📸</a><a href="#" aria-label="Facebook">📘</a><a href="#" aria-label="YouTube">▶️</a><a href="#" aria-label="Pinterest">📌</a></div></div>
      <div><h4>Shop</h4>${App.meta.categories.map((c) => `<a href="shop.html?cat=${c.id}">${esc(c.name)}</a>`).join("")}</div>
      <div><h4>Marketplace</h4><a href="brands.html">All Brands</a><a href="workshops.html">Workshops</a><a href="sell.html">Sell on CraftVerse</a><a href="dashboard.html">Vendor Dashboard</a>
        ${user ? `<a href="#" id="logoutLink">Log out (${esc(user.name.split(" ")[0])})</a>` : `<a href="login.html">Login / Sign up</a>`}</div>
      <div><h4>Help</h4><a href="orders.html">Track Order</a><a href="policies.html#shipping">Shipping Policy</a><a href="policies.html#refund">Refunds & Cancellation</a><a href="policies.html#terms">Terms & Conditions</a><a href="policies.html#privacy">Privacy Policy</a></div>
    </div>
    <div class="pay-strip">🔒 Secure payments: UPI · Cards · Netbanking · Wallets · COD${cfg().paymentMode === "mock" ? " · <b>Test mode: no real money is charged</b>" : ""}</div>
    <p class="copy">© 2026 CraftVerse Marketplace. Handmade in India.</p>`;
  $("#logoutLink")?.addEventListener("click", async (e) => { e.preventDefault(); await Auth.logout(); toast("Logged out"); setTimeout(() => (location.href = "index.html"), 400); });
}

function updateBadges() {
  [["#cartCount", App.cart.count], ["#wishCount", App.wish.size]].forEach(([sel, n]) => {
    const b = $(sel);
    if (!b) return;
    b.textContent = n;
    b.style.display = n ? "grid" : "none";
    b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
  });
}

function toast(msg, isError = false) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2800);
}

/** Human label for an input (from its <label for>), used in error summaries. */
const fieldLabel = (el) => ($(`label[for="${el.id}"]`)?.textContent || el.placeholder || el.id).replace(/\s*\*\s*$/, "").replace(/\(.*?\)/g, "").trim();

/** Scroll the first invalid field into view (below the fixed header), focus it and summarise what's wrong. */
function reportInvalid(els) {
  if (!els.length) return false;
  els[0].scrollIntoView({ behavior: "smooth", block: "center" });
  els[0].focus({ preventScroll: true });
  const names = [...new Set(els.map(fieldLabel))];
  toast(`Please check: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`, true);
  return true;
}

/** Show server-side validation errors next to inputs. map: apiField -> inputId */
function showFieldErrors(details = {}, map = {}) {
  const els = [];
  for (const [field, msg] of Object.entries(details || {})) {
    const el = $("#" + (map[field] || field));
    if (!el) continue;
    el.classList.add("invalid");
    const err = el.parentElement.querySelector(".err") || el.closest(".field")?.querySelector(".err");
    if (err) err.textContent = msg;
    els.push(el);
  }
  return reportInvalid(els);
}

// As soon as the user edits a highlighted field, clear its error so they can see it's been fixed
["input", "change"].forEach((type) => document.addEventListener(type, (e) => {
  const el = e.target;
  if (!el.classList?.contains("invalid") && !(el.type === "checkbox")) return;
  el.classList.remove("invalid");
  const err = el.parentElement?.querySelector(".err") || el.closest(".field")?.querySelector(".err");
  if (err) err.textContent = "";
  if (el.type === "checkbox" && el.checked) el.closest("fieldset, form")?.querySelectorAll(".err[id]").forEach((x) => x.id.toLowerCase().includes(el.id.toLowerCase()) && (x.textContent = ""));
}));
function clearFieldErrors(root = document) {
  $$(".invalid", root).forEach((el) => el.classList.remove("invalid"));
  $$(".err", root).forEach((el) => (el.textContent = ""));
}

// ---------- Shared UI pieces ----------
const PRODUCT_IMAGES = {
  "madhubani-tree": "assets/madhubani-tree-of-life.png",
  "madhubani-fish": "assets/madhubani-fish-silk.png",
  "pichwai-lotus": "assets/pichwai-lotus.png",
  "pichwai-cow": "assets/pichwai-cow.png",
  "dhokra-horse": "assets/dhokra-horse.png",
  "kutch-stole": "assets/kutch-stole.png",
  "kutch-cushion": "assets/kutch-cushion.png",
  "jamdani-saree": "assets/jamdani-saree.png",
  "khadi-kurta": "assets/khadi-kurta.png",
  "khurja-mugs": "assets/khurja-mugs.png",
  "khurja-planter": "assets/khurja-planter.png",
  "khurja-platter": "assets/khurja-platter.png",
  "silver-jhumka": "assets/silver-jhumka.png",
  "silver-bangle": "assets/silver-bangle.png",
  "papier-box": "assets/papier-box.png",
  "papier-lamp": "assets/papier-lamp.png",
  "dhokra-diya": "assets/dhokra-diya.png",
  "dhokra-pendant": "assets/dhokra-pendant.png",
  "channa-stacker": "assets/rainbow-ring-stacker-crochet.png",
  "channa-dolls": "assets/channapatna-family-dolls.png",
};
function thumb(p, size = "") {
  const image = p.image || PRODUCT_IMAGES[p.slug];
  return `<div class="thumb ${size}" style="--c1:${esc(p.c1 || "#d9b26a")};--c2:${esc(p.c2 || "#8a5a22")}">${image ? `<img src="${esc(image)}" alt="" loading="lazy" />` : `<span>${esc(p.icon || p.logo || "🎁")}</span>`}</div>`;
}
function stars(r) {
  const full = Math.round(r || 0);
  return `<span class="stars" aria-label="${r || 0} out of 5">${"★".repeat(full)}${"☆".repeat(5 - full)}</span>`;
}
const verifiedBadge = (v) => (v.verified ? `<span class="verified" title="Verified artisan brand">✔ Verified</span>` : "");

function productCard(p) {
  const v = p.vendor || {};
  const out = p.stock <= 0;
  const wished = Wishlist.has(p.id);
  return `
  <article class="pcard ${out ? "out" : ""}">
    <a href="product.html?id=${esc(p.slug)}" class="pcard-img">${thumb(p)}${out ? `<span class="pbadge sold">SOLD OUT</span>` : p.badge ? `<span class="pbadge">${esc(p.badge)}</span>` : ""}</a>
    <button class="wish ${wished ? "on" : ""}" data-wish="${p.id}" aria-label="${wished ? "Remove from" : "Add to"} wishlist">${wished ? "♥" : "♡"}</button>
    <div class="pcard-body">
      <a href="brand.html?id=${esc(v.slug)}" class="pvendor">${esc(v.name)}</a>
      <a href="product.html?id=${esc(p.slug)}"><h3>${esc(p.name)}</h3></a>
      <div class="rating">${stars(p.rating)} <small>(${p.reviews || 0})</small></div>
      <div class="pcard-foot">
        <div class="price-row"><b>${money(p.price)}</b>${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ""}</div>
        ${out ? `<span class="muted small">Out of stock</span>` : p.sizes ? `<a href="product.html?id=${esc(p.slug)}" class="btn btn-sm">Options</a>` : `<button class="btn btn-sm" data-add="${p.id}" data-name="${esc(p.name)}">Add</button>`}
      </div>
    </div>
  </article>`;
}

function vendorCard(v) {
  const n = v.productCount || 0;
  return `
  <a href="brand.html?id=${esc(v.slug)}" class="vcard">
    <div class="vcard-banner" style="--c1:${esc(v.c1)};--c2:${esc(v.c2)}"></div>
    <div class="vcard-logo" style="--c1:${esc(v.c1)};--c2:${esc(v.c2)}">${esc(v.logo)}</div>
    <div class="vcard-body">
      <h3>${esc(v.name)} ${v.verified ? `<span class="tick" title="Verified">✔</span>` : ""}</h3>
      <p class="muted small">📍 ${esc(v.city)}, ${esc(v.state)}</p>
      <p class="vcard-tag">${esc(v.tagline)}</p>
      <div class="vcard-meta"><span class="chip">${esc(catName(v.craft))}</span><span>${stars(v.rating)}</span><span class="muted small">${n} item${n === 1 ? "" : "s"}</span></div>
    </div>
  </a>`;
}

function workshopCard(w) {
  const d = new Date(w.date);
  const action = w.booked ? `<span class="status delivered">✓ Booked</span>`
    : `<button class="btn btn-sm" data-book="${w.id}" data-title="${esc(w.title)}" ${w.seatsLeft ? "" : "disabled"}>${w.seatsLeft ? "Book seat" : "Full"}</button>`;
  return `
  <article class="wcard">
    <div class="wdate" style="--c1:${esc(w.c1)};--c2:${esc(w.c2)}"><b>${d.getDate()}</b><span>${d.toLocaleString("en-IN", { month: "short" })}</span><i>${esc(w.icon)}</i></div>
    <div class="wbody">
      <span class="chip ${w.mode === "Online" ? "online" : ""}">${w.mode === "Online" ? "🖥 Online" : "📍 " + esc(w.city)}</span>
      <h3>${esc(w.title)}</h3>
      <p class="muted small">by <a href="brand.html?id=${esc(w.vendor.slug)}" class="link">${esc(w.vendor.name)}</a> · ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · ${esc(w.duration)}</p>
      <p class="wdesc">${esc(w.desc)}</p>
      <div class="wfoot"><b>${w.price ? money(w.price) : "Free"}</b><span class="muted small">${w.seatsLeft} seat${w.seatsLeft === 1 ? "" : "s"} left</span>${action}</div>
    </div>
  </article>`;
}

// ---------- Global delegated handlers ----------
// App forms (no action attribute) are handled by JS; never let them fall back to a native
// page reload, e.g. if the user submits before the page script has finished booting.
document.addEventListener("submit", (e) => { if (!e.target.hasAttribute("action")) e.preventDefault(); }, true);

document.addEventListener("click", async (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    add.disabled = true;
    await Cart.add(add.dataset.add, 1, null, add.dataset.name);
    add.disabled = false;
  }

  const wish = e.target.closest("[data-wish]");
  if (wish) {
    e.preventDefault();
    const on = await Wishlist.toggle(wish.dataset.wish);
    $$(`[data-wish="${wish.dataset.wish}"]`).forEach((b) => { b.classList.toggle("on", on); b.textContent = on ? "♥" : "♡"; });
    document.dispatchEvent(new CustomEvent("wishlist:change"));
  }

  const book = e.target.closest("[data-book]");
  if (book) {
    if (!App.user) { toast("Please log in to book a workshop", true); setTimeout(() => Auth.requireLogin(), 800); return; }
    book.disabled = true;
    try {
      await api(`/workshops/${book.dataset.book}/book`, { method: "POST" });
      toast(`🎉 Seat booked: ${book.dataset.title}`);
      document.dispatchEvent(new CustomEvent("bookings:change"));
    } catch (err) { toast(err.message, true); book.disabled = false; }
  }

  if (e.target.closest("#menu a")) $("#menu")?.classList.remove("open");
});
