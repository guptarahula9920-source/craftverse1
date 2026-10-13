// Homepage
page(async () => {
  const [brands, featured, workshops, stories] = await Promise.all([
    api("/vendors?verified=1&sort=rating"),
    api("/products?featured=1&limit=8"),
    api("/workshops?upcoming=1&limit=3"),
    api("/stories"),
  ]);

  $("#brandCount").textContent = brands.total;

  $("#cats").innerHTML = App.meta.categories.map((c) =>
    `<a class="cat" href="shop.html?cat=${c.id}"><i style="--c1:${c.c1};--c2:${c.c2}">${c.icon}</i><span>${esc(c.name)}<small>${c.count} item${c.count === 1 ? "" : "s"}</small></span></a>`).join("");
  $("#featuredBrands").innerHTML = brands.items.slice(0, 4).map(vendorCard).join("");
  $("#featured").innerHTML = featured.items.map(productCard).join("");

  const renderWorkshops = async (list) => { $("#workshops").innerHTML = (list || (await api("/workshops?upcoming=1&limit=3")).items).map(workshopCard).join(""); };
  renderWorkshops(workshops.items);
  document.addEventListener("bookings:change", () => renderWorkshops());

  $("#stories").innerHTML = stories.items.map((s) => `
    <a class="story reveal" href="brand.html?id=${esc(s.vendor.slug)}">${thumb({ icon: s.icon, c1: s.vendor.c1, c2: s.vendor.c2 })}
      <div class="sbody"><span class="pvendor">${esc(s.vendor.name)}</span><h3>${esc(s.title)}</h3><p class="muted">${esc(s.excerpt)}</p><span class="link">Read story →</span></div></a>`).join("");

  // Scroll reveal
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: 0.1 });
  $$(".reveal").forEach((el) => io.observe(el));
});

// Count-up stats
$$("[data-count]").forEach((el) => {
  const end = +el.dataset.count;
  const start = performance.now();
  (function tick(now) {
    const t = Math.min((now - start) / 1600, 1);
    el.textContent = Math.floor(end * (1 - Math.pow(1 - t, 3))).toLocaleString("en-IN") + (t === 1 && end >= 1000 ? "+" : "");
    if (t < 1) requestAnimationFrame(tick);
  })(start);
});

// Newsletter
$("#joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/newsletter", { method: "POST", body: { email: e.target.querySelector("input").value } });
    e.target.reset();
    toast("Thanks for subscribing! 🌸");
  } catch (err) { toast(err.message, true); }
});
