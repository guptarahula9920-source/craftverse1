// Renders an order from the API, grouped by vendor sub-order (used by success.html and orders.html)
const statusClass = (s) => String(s).toLowerCase().replace(/\s+/g, "-");
const SUB_STATUS = { unfulfilled: "Awaiting payment", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };

function orderDetail(o) {
  const t = o.totals;
  const itemRow = (i) => `<div class="mini">${thumb(i, "xs")}<div>${i.slug ? `<a href="product.html?id=${esc(i.slug)}"><b>${esc(i.name)}</b></a>` : `<b>${esc(i.name)}</b>`}<small class="muted">${i.size ? "Size " + esc(i.size) + " · " : ""}Qty ${i.qty} × ${money(i.price)}</small></div><span>${money(i.price * i.qty)}</span></div>`;
  const s = o.shipping || {};
  return `
  <div class="order-detail">
    <div class="od-items">
      ${o.split.map((sub) => `
        <div class="od-vendor">
          <div><span>🏪 <a class="link" href="brand.html?id=${esc(sub.vendor.slug)}">${esc(sub.vendor.name)}</a></span><span class="status ${statusClass(SUB_STATUS[sub.status])}">${SUB_STATUS[sub.status]}</span></div>
          ${sub.trackingNumber ? `<small class="muted">🚚 ${esc(sub.carrier || "Courier")} · Tracking <b>${esc(sub.trackingNumber)}</b></small>` : ""}
          ${sub.items.map(itemRow).join("")}
        </div>`).join("")}
      <div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      ${t.discount ? `<div class="sum-row good"><span>Discount (${esc(t.coupon)})</span><span>−${money(t.discount)}</span></div>` : ""}
      <div class="sum-row"><span>Shipping</span><span>${t.shipping ? money(t.shipping) : "FREE"}</span></div>
      <div class="sum-row"><span>GST</span><span>${money(t.tax)}</span></div>
      ${t.codFee ? `<div class="sum-row"><span>COD fee</span><span>${money(t.codFee)}</span></div>` : ""}
      <div class="sum-row total"><span>${o.paymentMethod === "cod" ? "Pay on Delivery" : o.paymentStatus === "paid" ? "Total Paid" : "Total"}</span><span>${money(t.total)}</span></div>
    </div>
    <div class="od-info">
      <div><h4>Status</h4><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></div>
      <div><h4>Placed</h4><p>${new Date(o.date).toLocaleString("en-IN")}</p></div>
      <div><h4>Ship to</h4><p>${esc(s.fullName)}<br/>${esc(s.address)}<br/>${esc(s.city)}, ${esc(s.state)} ${esc(s.zip)}<br/>${esc(s.country)} · ${esc(s.phone)}</p></div>
      <div><h4>Contact</h4><p>${esc(o.customer.email)}</p></div>
      ${o.giftNote ? `<div><h4>🎁 Gift note</h4><p>${esc(o.giftNote)}</p></div>` : ""}
      <div><h4>Payment</h4><p>${esc(o.payment)}</p></div>
      ${o.split.length > 1 ? `<p class="muted hint">This order ships in ${o.split.length} packages, one from each artisan studio.</p>` : ""}
    </div>
  </div>`;
}
