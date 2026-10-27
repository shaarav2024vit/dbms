/* =============================================================================
   EVENT & TICKET LEDGER — CLIENT SCRIPT (POSTGRESQL 16)
   BCSE302L - Database Systems | Refined Editorial Interface
   Authors: Kevin T John, Govind B Nair, Shaarav S
   ============================================================================= */

let currentEventCategories = [];
let inspectorOpen = false;
let selectedSeats = new Set();
let currentCategorySeatData = null;

/* -----------------------------------------------------------------------------
   THEME MANAGEMENT (Daylight / Midnight Mineral)
   ----------------------------------------------------------------------------- */
function initTheme() {
  const current = document.documentElement.getAttribute("data-theme") || localStorage.getItem("theme") || "light";
  applyTheme(current, false);
}

function applyTheme(theme, save = true) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  if (save) {
    try {
      localStorage.setItem("theme", theme);
    } catch (e) {}
  }

  const btnText = document.getElementById("themeToggleText");
  const btn = document.getElementById("themeToggleBtn");
  if (btnText) {
    btnText.innerText = theme === "dark" ? "Daylight" : "Midnight";
  }
  if (btn) {
    btn.setAttribute("title", theme === "dark" ? "Switch to Daylight theme" : "Switch to Midnight Mineral theme");
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to Daylight theme" : "Switch to Midnight Mineral theme");
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next, true);
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  checkHealth();
  loadCatalog();
  onUserChanged();

  // Load initial query preview for Query Console
  if (document.getElementById("querySelect")) {
    onQuerySelected();
  }
});

/* -----------------------------------------------------------------------------
   TOAST NOTIFICATIONS (Quiet, Muted)
   ----------------------------------------------------------------------------- */
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-tag">[${type.toUpperCase()}]</span>
    <div>${message}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 220);
  }, 3800);
}

/* -----------------------------------------------------------------------------
   TRANSACTION LOG & ENGINE TRACE (Slide-out Drawer)
   ----------------------------------------------------------------------------- */
function updateInspector(operation, sql, triggers, effect) {
  const opEl = document.getElementById("inspOperation");
  const sqlEl = document.getElementById("inspSql");
  const trgEl = document.getElementById("inspTriggers");
  const effEl = document.getElementById("inspEffect");

  if (opEl) opEl.innerText = operation;
  if (sqlEl) sqlEl.innerText = sql;
  if (trgEl) trgEl.innerText = triggers;
  if (effEl) effEl.innerText = effect;

  // Pulse the trace toggle button briefly to notify user without blocking view
  const traceBtn = document.querySelector(".btn-trace");
  if (traceBtn) {
    traceBtn.style.borderColor = "var(--accent)";
    traceBtn.style.color = "var(--accent)";
    setTimeout(() => {
      traceBtn.style.borderColor = "";
      traceBtn.style.color = "";
    }, 2000);
  }
}

function toggleInspector() {
  const drawer = document.getElementById("inspectorDrawer");
  const backdrop = document.getElementById("inspectorBackdrop");
  if (!drawer) return;

  inspectorOpen = !inspectorOpen;
  if (inspectorOpen) {
    drawer.classList.add("open");
    if (backdrop) backdrop.classList.add("active");
  } else {
    drawer.classList.remove("open");
    if (backdrop) backdrop.classList.remove("active");
  }
}

/* -----------------------------------------------------------------------------
   SYSTEM HEALTH & TELEMETRY
   ----------------------------------------------------------------------------- */
async function checkHealth() {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("dbStatusText");

  try {
    const res = await fetch("/api/health");
    const data = await res.json();

    if (data.connected) {
      if (dot) dot.style.background = "var(--status-ok)";
      if (text) text.innerText = "PostgreSQL 16 · Online";

      if (data.stats && !data.stats.error) {
        const bookCount = document.getElementById("metricBookings");
        const revCount = document.getElementById("metricRevenue");
        const cancelCount = document.getElementById("metricCancellations");

        if (bookCount) bookCount.innerText = data.stats.booking || "25";
        if (revCount) revCount.innerText = "₹" + Number(data.stats.total_revenue || 0).toLocaleString();
        if (cancelCount) cancelCount.innerText = data.stats.cancellation || "10";
      }
    } else {
      if (dot) dot.style.background = "var(--status-alert)";
      if (text) text.innerText = "PostgreSQL 16 · Offline (Port 5432)";
    }
  } catch (err) {
    if (dot) dot.style.background = "var(--status-pending)";
    if (text) text.innerText = "Connecting...";
  }
}

/* -----------------------------------------------------------------------------
   NAVIGATION & CONTEXT SWITCHING
   ----------------------------------------------------------------------------- */
function switchTab(tabId) {
  document.querySelectorAll(".section-pane").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(b => b.classList.remove("active"));

  const targetPane = document.getElementById(tabId);
  if (targetPane) {
    targetPane.classList.add("active");
  }

  // Update active state on nav links
  const links = document.querySelectorAll(".nav-link");
  links.forEach(link => {
    if (link.getAttribute("onclick") && link.getAttribute("onclick").includes(tabId)) {
      link.classList.add("active");
    }
  });

  if (tabId === 'catalogPane') loadCatalog();
  if (tabId === 'walletPane') loadUserWallet();
  if (tabId === 'organizerPane') loadOrganizerEvents();
  if (tabId === 'atlasPane') initAtlas();
  if (tabId === 'adminPane') loadAdminData();
  if (tabId === 'queriesPane') onQuerySelected();
}

function onUserChanged() {
  const select = document.getElementById("activeUserSelect");
  if (!select) return;

  const selectedOption = select.options[select.selectedIndex];
  const role = selectedOption.getAttribute("data-role");

  // Subtle contextual focus based on persona
  if (role === 'CUSTOMER') {
    loadUserWallet();
  } else if (role === 'ORGANIZER') {
    loadOrganizerEvents();
    // Switch to organizer pane if currently on customer wallet
    const activePane = document.querySelector(".section-pane.active");
    if (activePane && activePane.id === 'walletPane') {
      switchTab('organizerPane');
    }
  } else if (role === 'ADMIN') {
    loadAdminData();
    const activePane = document.querySelector(".section-pane.active");
    if (activePane && activePane.id === 'walletPane') {
      switchTab('adminPane');
    }
  }
}

/* -----------------------------------------------------------------------------
   MODAL DIALOG HELPERS
   ----------------------------------------------------------------------------- */
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove("active");
    document.body.style.overflow = "";
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-backdrop.active").forEach(m => m.classList.remove("active"));
    document.body.style.overflow = "";
    if (inspectorOpen) toggleInspector();
  }
});

/* -----------------------------------------------------------------------------
   PANE 01: EVENTS DIRECTORY (v_public_event_catalog)
   ----------------------------------------------------------------------------- */
async function loadCatalog() {
  const grid = document.getElementById("eventsGrid");
  if (!grid) return;

  try {
    const res = await fetch("/api/catalog");
    const data = await res.json();
    grid.innerHTML = "";

    if (!data.success || !data.events || data.events.length === 0) {
      grid.innerHTML = `
        <div class="state-message">
          No scheduled events found in database. Apply <code>02_seed_data.sql</code> to populate.
        </div>
      `;
      return;
    }

    data.events.forEach(evt => {
      const entry = document.createElement("div");
      entry.className = "event-entry";
      entry.innerHTML = `
        <div class="event-date-block">
          <span class="event-date-main">${evt.event_date}</span>
          <span class="event-time-sub">${evt.event_time}</span>
        </div>
        <div class="event-info">
          <div class="event-name">${evt.event_name}</div>
          <div class="event-meta-line">
            <span class="meta-venue">${evt.venue_name} · ${evt.location}</span>
            <span class="meta-sep">/</span>
            <span class="meta-organizer">Organizer: ${evt.organizer_name}</span>
          </div>
        </div>
        <div class="event-inventory">
          <div class="inventory-count">${evt.remaining_seats}</div>
          <div class="inventory-label">Seats Remaining</div>
        </div>
        <div class="event-action-block">
          <div class="event-price-block">
            <div class="price-sub">Starting Rate</div>
            <div class="price-val">₹${Number(evt.starting_price_inr).toFixed(2)}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="openBookModal(${evt.event_id}, '${evt.event_name.replace(/'/g, "\\'")}')">
            Reserve Seats →
          </button>
        </div>
      `;
      grid.appendChild(entry);
    });
  } catch (err) {
    grid.innerHTML = `
      <div class="state-message">
        Unable to connect to PostgreSQL 16 on localhost:5432. Start the database via <code>./run_db.sh start</code>.
      </div>
    `;
  }
}

/* -----------------------------------------------------------------------------
   BOOKING WORKFLOW & 2D SEATING BLUEPRINT
   ----------------------------------------------------------------------------- */
async function openBookModal(eventId, eventName) {
  document.getElementById("bookModalTitle").innerText = `Reserve: ${eventName}`;
  document.getElementById("bookEventId").value = eventId;
  document.getElementById("bookSeatsInput").value = "";
  selectedSeats.clear();
  updateSelectedSeatsSummary();

  try {
    const res = await fetch(`/api/events/${eventId}`);
    const data = await res.json();
    if (!data.success) {
      showToast(data.error, "error");
      return;
    }

    currentEventCategories = data.categories || [];
    const catSelect = document.getElementById("bookCategorySelect");
    catSelect.innerHTML = "";

    currentEventCategories.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.category_id;
      opt.dataset.price = cat.price;
      opt.dataset.available = cat.available_seats;
      opt.innerText = `${cat.category_name} (₹${Number(cat.price).toFixed(2)} · Available: ${cat.available_seats} / ${cat.total_seats})`;
      catSelect.appendChild(opt);
    });

    if (currentEventCategories.length > 0) {
      await onCategoryChanged();
    }
    openModal("bookModal");
  } catch (err) {
    showToast("Error retrieving category tiers", "error");
  }
}

async function onCategoryChanged() {
  selectedSeats.clear();
  document.getElementById("bookSeatsInput").value = "";
  updateBookingPricePreview();
  updateSelectedSeatsSummary();

  const catSelect = document.getElementById("bookCategorySelect");
  if (!catSelect || !catSelect.value) return;
  await loadCategorySeatGrid(catSelect.value);
}

async function loadCategorySeatGrid(categoryId) {
  const container = document.getElementById("visualSeatGrid");
  if (!container) return;
  container.innerHTML = '<div class="blueprint-loading">Loading seating coordinates...</div>';

  try {
    const res = await fetch(`/api/categories/${categoryId}/seats`);
    const data = await res.json();
    if (!data.success) {
      container.innerHTML = `<div class="blueprint-loading" style="color: var(--status-alert);">Failed to load seats: ${data.error}</div>`;
      return;
    }

    currentCategorySeatData = data.data;
    renderSeatGrid(currentCategorySeatData);
  } catch (err) {
    container.innerHTML = '<div class="blueprint-loading" style="color: var(--status-alert);">Error connecting to category seat service</div>';
  }
}

function renderSeatGrid(catData) {
  const container = document.getElementById("visualSeatGrid");
  if (!container) return;
  container.innerHTML = "";

  const bookedSet = new Set(catData.booked_seats || []);
  const totalSeats = catData.total_seats;

  const seatsPerRow = totalSeats <= 12 ? 4 : totalSeats <= 24 ? 6 : 8;
  const numRows = Math.min(Math.ceil(totalSeats / seatsPerRow), 6);
  const rowLetters = ["A", "B", "C", "D", "E", "F"];

  const gridSeats = [];
  let seatIdx = 1;

  for (let r = 0; r < numRows; r++) {
    const rowLetter = rowLetters[r];
    const rowSeats = [];
    for (let c = 1; c <= seatsPerRow; c++) {
      if (seatIdx > totalSeats && gridSeats.length >= 24) break;
      const seatCode = `${rowLetter}-${c < 10 ? '0' + c : c}`;
      rowSeats.push(seatCode);
      seatIdx++;
    }
    if (rowSeats.length > 0) {
      gridSeats.push({ row: rowLetter, seats: rowSeats });
    }
  }

  // Prepend seed-data custom booked seats (e.g. GC-101) so they remain visible as occupied
  const customBooked = (catData.booked_seats || []).filter(s => !s.match(/^[A-F]-\d{2}$/));
  if (customBooked.length > 0) {
    gridSeats.unshift({
      row: "VIP",
      seats: customBooked.slice(0, 8)
    });
  }

  gridSeats.forEach(rowData => {
    const rowEl = document.createElement("div");
    rowEl.className = "seat-row";

    const label = document.createElement("div");
    label.className = "seat-row-label";
    label.innerText = rowData.row;
    rowEl.appendChild(label);

    rowData.seats.forEach(seatCode => {
      const isBooked = bookedSet.has(seatCode);
      const isSelected = selectedSeats.has(seatCode);

      const seatBtn = document.createElement("button");
      seatBtn.type = "button";
      seatBtn.className = `seat-btn ${isBooked ? 'booked' : isSelected ? 'selected' : 'available'}`;
      seatBtn.innerText = seatCode.includes('-') ? seatCode.split('-')[1] : seatCode;
      seatBtn.dataset.seat = seatCode;
      seatBtn.title = isBooked ? `Seat ${seatCode} (Occupied · Blocked by UNIQUE constraint)` : `Seat ${seatCode} (Available for reservation)`;

      if (isBooked) {
        seatBtn.disabled = true;
      } else {
        seatBtn.onclick = () => toggleSeatSelection(seatCode);
      }

      rowEl.appendChild(seatBtn);
    });

    container.appendChild(rowEl);
  });

  updateSelectedSeatsSummary();
}

function toggleSeatSelection(seatCode) {
  if (selectedSeats.has(seatCode)) {
    selectedSeats.delete(seatCode);
  } else {
    selectedSeats.add(seatCode);
  }

  syncSeatsToInput();
  refreshSeatGridHighlights();
  updateBookingPricePreview();
  updateSelectedSeatsSummary();
}

function clearSeatSelection() {
  selectedSeats.clear();
  syncSeatsToInput();
  refreshSeatGridHighlights();
  updateBookingPricePreview();
  updateSelectedSeatsSummary();
}

function onSeatsInputChanged() {
  const raw = document.getElementById("bookSeatsInput").value;
  const seats = raw.split(",").map(s => s.trim().toUpperCase()).filter(s => s.length > 0);

  selectedSeats = new Set(seats);
  refreshSeatGridHighlights();
  updateBookingPricePreview();
  updateSelectedSeatsSummary();
}

function syncSeatsToInput() {
  const input = document.getElementById("bookSeatsInput");
  if (input) {
    input.value = Array.from(selectedSeats).join(", ");
  }
}

function refreshSeatGridHighlights() {
  const buttons = document.querySelectorAll("#visualSeatGrid .seat-btn");
  buttons.forEach(btn => {
    const seatCode = btn.dataset.seat;
    if (btn.classList.contains("booked")) return;
    if (selectedSeats.has(seatCode)) {
      btn.className = "seat-btn selected";
    } else {
      btn.className = "seat-btn available";
    }
  });
}

function updateSelectedSeatsSummary() {
  const summary = document.getElementById("selectedSeatsSummary");
  if (!summary) return;

  const count = selectedSeats.size;
  if (count === 0) {
    summary.innerHTML = '<span>Click coordinates above or edit below</span>';
  } else {
    summary.innerHTML = `<strong>Selected (${count}):</strong> <span style="font-family: var(--font-mono); color: var(--accent);">${Array.from(selectedSeats).join(", ")}</span>`;
  }
}

function updateBookingPricePreview() {
  const catSelect = document.getElementById("bookCategorySelect");
  if (!catSelect || catSelect.selectedIndex === -1) return;
  const opt = catSelect.options[catSelect.selectedIndex];
  if (!opt) return;

  const price = parseFloat(opt.dataset.price || 0);
  const seatsRaw = document.getElementById("bookSeatsInput").value;
  const seats = seatsRaw.split(",").map(s => s.trim()).filter(s => s.length > 0);

  const priceEl = document.getElementById("bookTierPrice");
  const totalEl = document.getElementById("bookTotalEstimate");

  if (priceEl) priceEl.innerText = `₹${price.toFixed(2)}`;
  if (totalEl) totalEl.innerText = `₹${(price * seats.length).toFixed(2)}`;
}

async function submitBooking(e) {
  e.preventDefault();
  const userId = document.getElementById("activeUserSelect").value;
  const categoryId = document.getElementById("bookCategorySelect").value;
  const seatsRaw = document.getElementById("bookSeatsInput").value;
  const seats = seatsRaw.split(",").map(s => s.trim()).filter(s => s.length > 0);

  if (seats.length === 0) {
    showToast("Please specify at least one seat coordinate", "error");
    return;
  }

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, category_id: categoryId, seats: seats })
    });
    const data = await res.json();

    if (data.success) {
      showToast(`Reservation #${data.booking_id} created in PENDING status`, "success");
      closeModal("bookModal");

      updateInspector(
        `Transaction 1: Atomic Booking (User #${userId})`,
        `CALL sp_book_tickets(${userId}, ${categoryId}, ARRAY${JSON.stringify(seats)}, NULL);`,
        "trg_ticket_validate (prices tickets), trg_ticket_inventory (decrements remaining_seats)",
        `Booking ID #${data.booking_id} created.\nNotices:\n${(data.notices || []).join('\n')}`
      );

      checkHealth();
      loadCatalog();
      loadUserWallet();

      setTimeout(() => {
        openPaymentModal(data.booking_id, document.getElementById("bookTotalEstimate").innerText);
      }, 500);
    } else {
      showToast(data.error, "error");
      updateInspector(
        "Booking Integrity Rejection",
        `CALL sp_book_tickets(${userId}, ${categoryId}, ARRAY${JSON.stringify(seats)}, NULL);`,
        "uq_category_seat (UNIQUE constraint) or trg_ticket_inventory",
        `PostgreSQL transaction rolled back:\n${data.error}`
      );
    }
  } catch (err) {
    showToast("Network error submitting reservation", "error");
  }
}

/* -----------------------------------------------------------------------------
   PANE 02: WALLET, PAYMENTS & REFUNDS
   ----------------------------------------------------------------------------- */
async function loadUserWallet() {
  const userId = document.getElementById("activeUserSelect").value;
  try {
    // 1. Load user bookings
    const bRes = await fetch(`/api/users/${userId}/bookings`);
    const bData = await bRes.json();
    const bTable = document.getElementById("userBookingsTableBody");
    if (bTable) bTable.innerHTML = "";

    if (bData.success && bData.bookings && bData.bookings.length > 0) {
      bData.bookings.forEach(b => {
        const tr = document.createElement("tr");
        let badgeClass = "badge-info";
        if (b.status === "CONFIRMED") badgeClass = "badge-success";
        if (b.status === "PENDING") badgeClass = "badge-pending";
        if (b.status === "CANCELLED") badgeClass = "badge-cancelled";

        let actionHtml = `<span style="color: var(--text-tertiary); font-size: 0.74rem;">—</span>`;
        if (b.status === "PENDING") {
          actionHtml = `
            <button class="btn btn-primary btn-xs" onclick="openPaymentModal(${b.booking_id}, '₹${Number(b.total_amount).toFixed(2)}')">
              Confirm & Pay →
            </button>
          `;
        } else if (b.status === "CONFIRMED" && !b.cancellation_status) {
          actionHtml = `
            <button class="btn btn-danger btn-xs" onclick="openCancelModal(${b.booking_id})">
              Cancel & Refund
            </button>
          `;
        } else if (b.cancellation_status) {
          actionHtml = `<span class="badge badge-cancelled">Refunded: ₹${Number(b.refund_amount || 0).toFixed(2)}</span>`;
        }

        tr.innerHTML = `
          <td><strong style="font-family: var(--font-mono); color: var(--text-primary);">#${b.booking_id}</strong></td>
          <td style="font-weight: 500; color: var(--text-primary);">${b.event_name}</td>
          <td style="font-family: var(--font-mono); font-size: 0.8rem;">${b.event_date}</td>
          <td>${b.venue_name}</td>
          <td style="text-align: right; font-family: var(--font-mono); font-weight: 600; color: var(--text-primary);">₹${Number(b.total_amount).toFixed(2)}</td>
          <td><span class="badge ${badgeClass}">${b.status}</span></td>
          <td style="text-align: right;">${actionHtml}</td>
        `;
        bTable.appendChild(tr);
      });
    } else if (bTable) {
      bTable.innerHTML = `<tr><td colspan="7" class="table-empty">No active bookings under this customer context.</td></tr>`;
    }

    // 2. Load digital tickets & render refined passes (No fake barcodes)
    const tRes = await fetch(`/api/users/${userId}/tickets`);
    const tData = await tRes.json();
    const tTable = document.getElementById("userTicketsTableBody");
    const stubsGallery = document.getElementById("ticketStubsGallery");

    if (tTable) tTable.innerHTML = "";
    if (stubsGallery) stubsGallery.innerHTML = "";

    if (tData.success && tData.tickets && tData.tickets.length > 0) {
      tData.tickets.forEach(t => {
        const isCancelled = t.ticket_status === 'CANCELLED';
        const stub = document.createElement("div");
        stub.className = "ticket-stub";
        stub.innerHTML = `
          <div class="stub-main">
            <div>
              <div class="stub-header">
                <span class="stub-tier">${t.tier} Tier</span>
                <span class="badge ${isCancelled ? 'badge-cancelled' : 'badge-success'}">${t.ticket_status}</span>
              </div>
              <div class="stub-event">${t.event_name}</div>
              <div class="stub-venue">${t.venue_name}</div>
            </div>
            <div class="stub-coords">
              <span class="stub-seat-label">Seat:</span>
              <span class="stub-seat-code">${t.seat_number}</span>
            </div>
          </div>
          <div class="stub-side">
            <div class="stub-id">#TKT-${String(t.ticket_id).padStart(4, '0')}</div>
            <div class="stub-ref-tag">BK-${t.booking_id}</div>
            <div class="stub-price">₹${Number(t.price).toFixed(2)}</div>
          </div>
        `;
        if (stubsGallery) stubsGallery.appendChild(stub);

        if (tTable) {
          const tr = document.createElement("tr");
          let tBadge = isCancelled ? 'badge-cancelled' : 'badge-success';
          tr.innerHTML = `
            <td style="font-family: var(--font-mono);">#${t.ticket_id}</td>
            <td style="font-family: var(--font-mono);">#${t.booking_id}</td>
            <td style="font-weight: 500;">${t.event_name}</td>
            <td>${t.venue_name}</td>
            <td><span style="font-family: var(--font-mono); color: var(--accent);">${t.tier}</span></td>
            <td><strong style="font-family: var(--font-mono); color: var(--text-primary);">${t.seat_number}</strong></td>
            <td style="text-align: right; font-family: var(--font-mono);">₹${Number(t.price).toFixed(2)}</td>
            <td><span class="badge ${tBadge}">${t.ticket_status}</span></td>
          `;
          tTable.appendChild(tr);
        }
      });
    } else {
      if (stubsGallery) {
        stubsGallery.innerHTML = `<div style="grid-column: 1 / -1; color: var(--text-tertiary); font-size: 0.82rem; padding: 2rem 0; text-align: center; font-style: italic;">No issued admission passes for this customer context.</div>`;
      }
      if (tTable) {
        tTable.innerHTML = `<tr><td colspan="8" class="table-empty">No issued tickets under current customer context.</td></tr>`;
      }
    }
  } catch (err) {
    showToast("Error retrieving wallet records", "error");
  }
}

function openPaymentModal(bookingId, amountStr) {
  const idEl = document.getElementById("payBookingId");
  if (idEl) idEl.value = bookingId;
  const refEl = document.getElementById("payBookingRef");
  if (refEl) refEl.innerText = `Order #${bookingId}`;
  const amtEl = document.getElementById("payAmountDisplay");
  if (amtEl) amtEl.innerText = amountStr;
  openModal("paymentModal");
}

async function submitPayment() {
  const bookingId = document.getElementById("payBookingId")?.value;
  const method = document.getElementById("payMethodSelect")?.value || "UPI";
  const simulateRadios = document.getElementsByName("paySimulate");
  let simulateSuccess = true;
  for (let r of simulateRadios) {
    if (r.checked) simulateSuccess = (r.value === "true");
  }

  if (!bookingId) {
    showToast("No active booking selected for payment", "error");
    return;
  }

  const btn = document.getElementById("confirmPaymentBtn");
  const origText = btn ? btn.innerText : "";
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Processing Payment...";
  }

  try {
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        booking_id: parseInt(bookingId, 10),
        payment_method: method,
        simulate_success: simulateSuccess
      })
    });
    const data = await res.json();

    if (data.success) {
      if (simulateSuccess) {
        showToast(`Payment verified. Reservation #${bookingId} is CONFIRMED`, "success");
        updateInspector(
          `Transaction 2: Payment Execution (Booking #${bookingId})`,
          `CALL sp_make_payment(${bookingId}, '${method}', TRUE);`,
          "trg_payment_confirm_booking (automatically transitions status PENDING → CONFIRMED)",
          `Payment verified. Ledger updated.\nNotices:\n${(data.notices || []).join('\n')}`
        );
      } else {
        showToast(`Payment declined. Logged attempt for Booking #${bookingId}`, "error");
        updateInspector(
          `Payment Retry Cycle (Booking #${bookingId})`,
          `CALL sp_make_payment(${bookingId}, '${method}', FALSE);`,
          "Payment table recorded attempt with status='FAILED'",
          "Booking remains in PENDING status. Customer can retry."
        );
      }

      closeModal("paymentModal");
      checkHealth();
      loadCatalog();
      loadUserWallet();
      if (document.getElementById("atlasPane")?.classList.contains("active")) {
        reloadAtlas();
      }
    } else {
      showToast(data.error || "Payment execution failed", "error");
    }
  } catch (err) {
    showToast("Error processing payment transaction", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = origText || "Confirm Payment (sp_make_payment)";
    }
  }
}

function openCancelModal(bookingId) {
  const idEl = document.getElementById("cancelBookingId");
  if (idEl) idEl.value = bookingId;
  const refEl = document.getElementById("cancelBookingRef");
  if (refEl) refEl.innerText = `Booking #${bookingId}`;
  const quoteEl = document.getElementById("cancelRefundQuote");
  if (quoteEl) quoteEl.innerText = "Calculating refund quote...";
  openModal("cancelModal");

  fetch(`/api/cancellations/quote/${bookingId}`)
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        if (quoteEl) quoteEl.innerText = `₹${Number(data.refund_amount).toFixed(2)}`;
        updateInspector(
          `Dynamic Refund Quote (Booking #${bookingId})`,
          `SELECT fn_calculate_refund(${bookingId});`,
          "Time-decay sliding refund policy",
          `Calculated refund quote: ₹${Number(data.refund_amount).toFixed(2)}`
        );
      } else {
        if (quoteEl) quoteEl.innerText = "Quote unavailable";
      }
    })
    .catch(() => {
      if (quoteEl) quoteEl.innerText = "Error calculating quote";
    });
}

async function submitCancellation() {
  const bookingId = document.getElementById("cancelBookingId")?.value;
  const reason = document.getElementById("cancelReasonInput")?.value || "Customer requested cancellation";

  if (!bookingId) {
    showToast("No active booking selected for cancellation", "error");
    return;
  }

  const btn = document.getElementById("confirmCancelBtn");
  const origText = btn ? btn.innerText : "";
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Processing Cancellation & Refund...";
  }

  try {
    const res = await fetch("/api/cancellations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: parseInt(bookingId, 10), reason: reason })
    });
    const data = await res.json();

    if (data.success) {
      showToast(`Reservation #${bookingId} cancelled and refund processed`, "success");
      closeModal("cancelModal");

      updateInspector(
        `Transaction 5: Booking Cancellation & Inventory Restoration`,
        `CALL sp_cancel_booking(${bookingId}, '${reason}');`,
        "fn_calculate_refund (computes refund), trg_ticket_inventory (restores available_seats)",
        `Tickets marked CANCELLED, Payments marked REFUNDED, Seats restored to inventory.\nNotices:\n${(data.notices || []).join('\n')}`
      );

      checkHealth();
      loadCatalog();
      loadUserWallet();
      if (document.getElementById("atlasPane")?.classList.contains("active")) {
        reloadAtlas();
      }
    } else {
      showToast(data.error || "Cancellation failed", "error");
    }
  } catch (err) {
    showToast("Cancellation transaction failed", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = origText || "Confirm Cancellation & Process Refund";
    }
  }
}

/* -----------------------------------------------------------------------------
   PANE 03: ORGANIZER PORTAL
   ----------------------------------------------------------------------------- */
async function loadOrganizerEvents() {
  const orgId = document.getElementById("activeUserSelect").value;
  const table = document.getElementById("organizerEventsTableBody");
  if (!table) return;

  try {
    const res = await fetch(`/api/organizers/${orgId}/events`);
    const data = await res.json();
    table.innerHTML = "";

    if (data.success && data.events && data.events.length > 0) {
      data.events.forEach(e => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="font-family: var(--font-mono);">#${e.event_id}</td>
          <td style="font-weight: 500; color: var(--text-primary);">${e.event_name}</td>
          <td style="font-family: var(--font-mono); font-size: 0.8rem;">${e.event_date}</td>
          <td>${e.venue_name} <span style="font-family: var(--font-mono); color: var(--text-tertiary); font-size: 0.76rem;">(Max: ${e.venue_capacity})</span></td>
          <td style="text-align: right; font-family: var(--font-mono);">${e.total_allocated_seats}</td>
          <td style="text-align: right; font-family: var(--font-mono); color: var(--status-ok); font-weight: 600;">${e.remaining_seats}</td>
          <td style="text-align: right; font-family: var(--font-mono); font-weight: 600; color: var(--accent);">${Number(e.occupancy_pct).toFixed(2)}%</td>
        `;
        table.appendChild(tr);
      });
    } else {
      table.innerHTML = `<tr><td colspan="7" class="table-empty">No events associated with this organizer. Select Priya Nair (#2) or Rohan Patel (#3).</td></tr>`;
    }
  } catch (err) {
    showToast("Failed to load organizer event metrics", "error");
  }
}

async function openAddCategoryModal() {
  const orgId = document.getElementById("activeUserSelect").value;
  try {
    const res = await fetch(`/api/organizers/${orgId}/events`);
    const data = await res.json();
    const sel = document.getElementById("newCatEventSelect");
    if (!sel) return;
    sel.innerHTML = "";

    if (data.success && data.events && data.events.length > 0) {
      data.events.forEach(e => {
        const opt = document.createElement("option");
        opt.value = e.event_id;
        opt.innerText = `${e.event_name} (${e.venue_name} · Capacity: ${e.venue_capacity})`;
        sel.appendChild(opt);
      });
      openModal("addCategoryModal");
    } else {
      showToast("Select an Organizer account with registered events first", "error");
    }
  } catch (err) {
    showToast("Error preparing category modal", "error");
  }
}

async function submitNewCategory(e) {
  e.preventDefault();
  const eventId = document.getElementById("newCatEventSelect").value;
  const name = document.getElementById("newCatName").value;
  const price = document.getElementById("newCatPrice").value;
  const seats = document.getElementById("newCatSeats").value;

  try {
    const res = await fetch("/api/organizers/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, category_name: name, price: price, total_seats: seats })
    });
    const data = await res.json();

    if (data.success) {
      showToast(`Category "${name}" added successfully`, "success");
      closeModal("addCategoryModal");
      updateInspector(
        `Add Seat Category (Event #${eventId})`,
        `INSERT INTO SEAT_CATEGORY (event_id, category_name, price, total_seats, available_seats) VALUES (${eventId}, '${name}', ${price}, ${seats}, ${seats});`,
        "trg_category_capacity (validated cumulative seats <= host venue capacity)",
        "Seating tier created without capacity constraint violation."
      );
      loadOrganizerEvents();
      loadCatalog();
    } else {
      showToast(data.error, "error");
      updateInspector(
        "Transaction 4: Venue Over-Allocation Blocked",
        `INSERT INTO SEAT_CATEGORY (event_id, category_name, price, total_seats, available_seats) VALUES (${eventId}, '${name}', ${price}, ${seats}, ${seats});`,
        "trg_category_capacity",
        `PostgreSQL Trigger Error Caught:\n${data.error}`
      );
    }
  } catch (err) {
    showToast("Error adding seat category", "error");
  }
}

/* -----------------------------------------------------------------------------
   PANE 04: ADMIN & BATCH CURSORS
   ----------------------------------------------------------------------------- */
async function loadAdminData() {
  const table = document.getElementById("customerSpendTableBody");
  if (!table) return;

  try {
    const res = await fetch("/api/admin/customer-spend");
    const data = await res.json();
    table.innerHTML = "";

    if (data.success && data.report && data.report.length > 0) {
      data.report.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="font-family: var(--font-mono);">#${r.user_id}</td>
          <td style="font-weight: 500; color: var(--text-primary);">${r.name}</td>
          <td style="font-family: var(--font-mono); font-size: 0.8rem;">${r.email}</td>
          <td style="font-family: var(--font-mono); font-size: 0.8rem;">${r.phone}</td>
          <td style="text-align: right; font-family: var(--font-mono);">${r.total_bookings}</td>
          <td style="text-align: right; font-family: var(--font-mono); font-weight: 600; color: var(--status-ok);">₹${Number(r.lifetime_spend).toFixed(2)}</td>
        `;
        table.appendChild(tr);
      });
    } else {
      table.innerHTML = `<tr><td colspan="6" class="table-empty">No spend data records available.</td></tr>`;
    }
  } catch (err) {
    showToast("Failed to retrieve spend analytics", "error");
  }
}

async function runAdminSettle() {
  try {
    const res = await fetch("/api/admin/settle-cancellations", { method: "POST" });
    const data = await res.json();

    if (data.success) {
      showToast("Cancellation settlement cursor job completed", "success");
      updateInspector(
        "Transaction 6: Bulk Settlement via Explicit Cursor",
        "CALL sp_settle_approved_cancellations();",
        "cur_requests CURSOR FOR ... FOR UPDATE OF c with WHERE CURRENT OF",
        `Settlement summary:\n${(data.notices || []).join('\n')}`
      );
      checkHealth();
      loadAdminData();
    } else {
      showToast(data.error, "error");
    }
  } catch (err) {
    showToast("Failed to run cancellation cursor job", "error");
  }
}

async function runAdminExpire() {
  try {
    const res = await fetch("/api/admin/expire-stale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 24 })
    });
    const data = await res.json();

    if (data.success) {
      showToast("Stale checkouts expired and inventory released", "success");
      updateInspector(
        "Transaction 7: Unpaid Checkouts Released via Parameterized Cursor",
        "CALL sp_expire_stale_bookings(INTERVAL '24 hours');",
        "cur_stale CURSOR (p_cutoff TIMESTAMP) FOR ...",
        `Expiration summary:\n${(data.notices || []).join('\n')}`
      );
      checkHealth();
    } else {
      showToast(data.error, "error");
    }
  } catch (err) {
    showToast("Failed to execute expiry cursor job", "error");
  }
}

/* -----------------------------------------------------------------------------
   PANE 05: ACADEMIC QUERY CONSOLE
   ----------------------------------------------------------------------------- */
function onQuerySelected() {
  const sel = document.getElementById("querySelect");
  if (!sel) return;
  const qId = sel.value;
  fetchQueryPreview(qId);
}

async function fetchQueryPreview(qId) {
  const sqlBox = document.getElementById("querySqlBox");
  if (!sqlBox) return;

  try {
    const res = await fetch(`/api/queries/${qId}`);
    const data = await res.json();
    if (data.success) {
      sqlBox.innerText = data.sql;
    }
  } catch (err) {}
}

async function executeSelectedQuery() {
  const sel = document.getElementById("querySelect");
  if (!sel) return;
  const qId = sel.value;

  try {
    const res = await fetch(`/api/queries/${qId}`);
    const data = await res.json();

    if (!data.success) {
      showToast(data.error, "error");
      return;
    }

    const sqlBox = document.getElementById("querySqlBox");
    const thead = document.getElementById("queryResultHead");
    const tbody = document.getElementById("queryResultBody");

    if (sqlBox) sqlBox.innerText = data.sql;
    if (thead) thead.innerHTML = "";
    if (tbody) tbody.innerHTML = "";

    if (!data.rows || data.rows.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td class="table-empty">Query executed cleanly. 0 rows returned.</td></tr>`;
      return;
    }

    const cols = Object.keys(data.rows[0]);
    const headerTr = document.createElement("tr");
    cols.forEach(col => {
      const th = document.createElement("th");
      th.innerText = col;
      headerTr.appendChild(th);
    });
    if (thead) thead.appendChild(headerTr);

    data.rows.forEach(r => {
      const tr = document.createElement("tr");
      cols.forEach(col => {
        const td = document.createElement("td");
        td.innerText = r[col] !== null ? r[col] : "NULL";
        if (typeof r[col] === 'number') {
          td.style.fontFamily = "var(--font-mono)";
        }
        tr.appendChild(td);
      });
      if (tbody) tbody.appendChild(tr);
    });

    updateInspector(
      `Academic SQL Execution: ${data.title}`,
      data.sql,
      "Direct PostgreSQL 16 Query Engine",
      `Query executed successfully. ${data.row_count} row(s) returned.`
    );

    showToast(`Query ${qId} executed: ${data.row_count} row(s) returned`, "success");
  } catch (err) {
    showToast("Error executing query statement", "error");
  }
}

/* =============================================================================
   THE RELATIONSHIP ATLAS (Navigable Spatial Field)
   ============================================================================= */

let currentAtlasData = null;
let currentAtlasSelectedNodeId = null;
let currentAtlasSelectedEdgeId = null;
let atlasEventsCatalog = [];
const atlasNodesMap = new Map();
const atlasEdgesMap = new Map();

async function initAtlas() {
  const select = document.getElementById("atlasEventSelect");
  if (!select) return;

  const previousValue = select.value;

  try {
    const res = await fetch("/api/catalog");
    const data = await res.json();
    if (!data.success || !data.events || data.events.length === 0) {
      const container = document.getElementById("atlasNodesLayer");
      if (container) {
        container.innerHTML = `<div class="state-message">No scheduled events found in database. Apply <code>02_seed_data.sql</code> to populate.</div>`;
      }
      return;
    }

    atlasEventsCatalog = data.events;
    select.innerHTML = "";
    atlasEventsCatalog.forEach(evt => {
      const opt = document.createElement("option");
      opt.value = evt.event_id;
      opt.innerText = `Event #${evt.event_id}: ${evt.event_name} (${evt.event_date})`;
      select.appendChild(opt);
    });

    if (previousValue && atlasEventsCatalog.some(e => String(e.event_id) === String(previousValue))) {
      select.value = previousValue;
    }

    const activeEventId = select.value || atlasEventsCatalog[0].event_id;
    await loadAtlasEvent(activeEventId);
  } catch (err) {
    const container = document.getElementById("atlasNodesLayer");
    if (container) {
      container.innerHTML = `<div class="state-message">PostgreSQL 16 is offline on port 5432. Start the database via <code>./start.sh</code>.</div>`;
    }
  }
}

function onAtlasEventSelected() {
  const select = document.getElementById("atlasEventSelect");
  if (!select || !select.value) return;
  loadAtlasEvent(select.value);
}

function reloadAtlas() {
  const select = document.getElementById("atlasEventSelect");
  if (!select || !select.value) {
    initAtlas();
  } else {
    loadAtlasEvent(select.value);
  }
}

function centerAtlasEvent() {
  const container = document.getElementById("atlasCanvasContainer");
  const eventEl = document.getElementById("node-event");
  if (!container || !eventEl) return;
  const containerWidth = container.clientWidth;
  const targetScrollLeft = eventEl.offsetLeft - (containerWidth / 2) + (eventEl.offsetWidth / 2);
  container.scrollTo({ left: Math.max(0, targetScrollLeft), top: 0, behavior: "smooth" });
  selectAtlasRecord("node-event");
}

async function loadAtlasEvent(eventId) {
  if (!eventId) return;
  const nodesLayer = document.getElementById("atlasNodesLayer");
  const svgLayer = document.getElementById("atlasSvg");
  if (!nodesLayer || !svgLayer) return;

  nodesLayer.innerHTML = `<div class="state-message">Querying relational topology for Event #${eventId}...</div>`;
  svgLayer.querySelectorAll(".atlas-edge, .atlas-edge-label").forEach(el => el.remove());
  atlasNodesMap.clear();
  atlasEdgesMap.clear();

  try {
    const res = await fetch(`/api/atlas/events/${eventId}`);
    const result = await res.json();

    if (!result.success || !result.data) {
      nodesLayer.innerHTML = `<div class="state-message">Failed to load relational data for Event #${eventId}: ${result.error || "Not found"}</div>`;
      return;
    }

    currentAtlasData = result.data;
    renderAtlas(currentAtlasData);
    selectAtlasRecord("node-event");
  } catch (err) {
    nodesLayer.innerHTML = `<div class="state-message">Error communicating with database backend.</div>`;
  }
}

function renderAtlas(data) {
  const nodesLayer = document.getElementById("atlasNodesLayer");
  const svgLayer = document.getElementById("atlasSvg");
  if (!nodesLayer || !svgLayer) return;

  nodesLayer.innerHTML = "";
  svgLayer.querySelectorAll(".atlas-edge, .atlas-edge-label").forEach(el => el.remove());
  atlasNodesMap.clear();
  atlasEdgesMap.clear();

  const nodes = [];
  const edges = [];

  // =========================================================================
  // 1. EVENT HUB (Top Tier: Infrastructure Authorities & Quota Tiers)
  // =========================================================================

  // Venue Node (Infrastructure parent, Left)
  const venueNode = {
    id: "node-venue",
    type: "VENUE",
    rawId: data.venue.venue_id,
    record: data.venue,
    x: 40,
    y: 40,
    width: 260,
    height: 95,
    tag: `VENUE · PK: ${data.venue.venue_id}`,
    title: data.venue.venue_name,
    sub: data.venue.location,
    metric: `Capacity: ${Number(data.venue.capacity).toLocaleString()} seats`,
    cls: "atlas-node-venue"
  };
  nodes.push(venueNode);

  // Organizer Node (Authority parent, Left)
  const orgNode = {
    id: "node-organizer",
    type: "ORGANIZER",
    rawId: data.organizer.user_id,
    record: data.organizer,
    x: 40,
    y: 165,
    width: 260,
    height: 95,
    tag: `USERS · PK: ${data.organizer.user_id} · ORGANIZER`,
    title: data.organizer.name,
    sub: data.organizer.email,
    metric: `Phone: ${data.organizer.phone}`,
    cls: "atlas-node-organizer"
  };
  nodes.push(orgNode);

  // Central Anchor: Event Node
  const eventNode = {
    id: "node-event",
    type: "EVENT",
    rawId: data.event.event_id,
    record: data.event,
    x: 390,
    y: 40,
    width: 340,
    height: 125,
    tag: `EVENT · PK: ${data.event.event_id}`,
    title: data.event.event_name,
    sub: `${data.event.event_date} · ${data.event.event_time}`,
    metric: `Occupancy: ${Number(data.event.occupancy_pct || 0).toFixed(1)}% · ${data.bookings.length} Booking(s)`,
    cls: "atlas-node-event"
  };
  nodes.push(eventNode);

  // Edge: Venue -> Event (Foreign Key constraint ON DELETE RESTRICT)
  edges.push({
    id: "edge-venue-event",
    from: venueNode.id,
    to: eventNode.id,
    fromPt: { x: venueNode.x + venueNode.width, y: venueNode.y + 45 },
    toPt: { x: eventNode.x, y: eventNode.y + 45 },
    label: "VENUE (RESTRICT)",
    constraint: "EVENT.venue_id → VENUE(venue_id)",
    onDelete: "ON DELETE RESTRICT",
    cardinality: "1:N (Venue has many Events)",
    desc: "Foreign key ensuring an event cannot exist without an active physical venue. Deleting a venue is blocked while events reference it.",
    sql: `ALTER TABLE EVENT ADD CONSTRAINT fk_event_venue
  FOREIGN KEY (venue_id) REFERENCES VENUE(venue_id) ON DELETE RESTRICT;`
  });

  // Edge: Organizer -> Event (Foreign Key constraint ON DELETE RESTRICT)
  edges.push({
    id: "edge-organizer-event",
    from: orgNode.id,
    to: eventNode.id,
    fromPt: { x: orgNode.x + orgNode.width, y: orgNode.y + 45 },
    toPt: { x: eventNode.x, y: eventNode.y + 90 },
    label: "ORGANIZER (RESTRICT)",
    constraint: "EVENT.organizer_id → USERS(user_id)",
    onDelete: "ON DELETE RESTRICT",
    cardinality: "1:N (User organizes many Events)",
    desc: "Foreign key ensuring an event is always registered under a verified organizer. Deleting an organizer is rejected while scheduled events are bound.",
    sql: `ALTER TABLE EVENT ADD CONSTRAINT fk_event_organizer
  FOREIGN KEY (organizer_id) REFERENCES USERS(user_id) ON DELETE RESTRICT;`
  });

  // Seat Categories (Downstream Quotas, Right)
  const catX = 820;
  data.categories.forEach((cat, idx) => {
    const cy = 40 + idx * 95;
    const catNode = {
      id: `node-cat-${cat.category_id}`,
      type: "SEAT_CATEGORY",
      rawId: cat.category_id,
      record: cat,
      x: catX,
      y: cy,
      width: 260,
      height: 80,
      tag: `SEAT_CATEGORY · PK: ${cat.category_id}`,
      title: cat.category_name,
      sub: `₹${Number(cat.price).toFixed(2)} / ticket`,
      metric: `Seats: ${cat.available_seats} / ${cat.total_seats} avail (${cat.booked_count} booked)`,
      cls: "atlas-node-category"
    };
    nodes.push(catNode);

    edges.push({
      id: `edge-event-cat-${cat.category_id}`,
      from: eventNode.id,
      to: catNode.id,
      fromPt: { x: eventNode.x + eventNode.width, y: eventNode.y + 35 + idx * 25 },
      toPt: { x: catNode.x, y: catNode.y + 40 },
      label: "1:N CASCADE",
      constraint: "SEAT_CATEGORY.event_id → EVENT(event_id)",
      onDelete: "ON DELETE CASCADE",
      cardinality: "1:N (Event has multiple pricing tiers)",
      desc: "Parent-child relationship. Deleting an event cascades to remove all associated seat tier quotas.",
      sql: `ALTER TABLE SEAT_CATEGORY ADD CONSTRAINT fk_category_event
  FOREIGN KEY (event_id) REFERENCES EVENT(event_id) ON DELETE CASCADE;`
    });
  });

  // =========================================================================
  // 2. DOWNSTREAM TRANSACTIONAL LEDGER (Bookings, Customers, Tickets, Payments)
  // =========================================================================

  if (data.bookings.length === 0) {
    const emptyNode = {
      id: "node-empty-bookings",
      type: "INFO",
      rawId: 0,
      record: { info: "No reservations found for this event." },
      x: 390,
      y: 330,
      width: 340,
      height: 85,
      tag: "DATABASE LEDGER · 0 ROWS",
      title: "No Bookings Recorded Yet",
      sub: "No customer reservations have been placed for this event in BOOKING.",
      metric: `SELECT * FROM BOOKING WHERE event_id = ${data.event.event_id};`,
      cls: "atlas-node-booking"
    };
    nodes.push(emptyNode);

    edges.push({
      id: "edge-event-empty-booking",
      from: eventNode.id,
      to: emptyNode.id,
      fromPt: { x: eventNode.x + eventNode.width / 2, y: eventNode.y + eventNode.height },
      toPt: { x: emptyNode.x + emptyNode.width / 2, y: emptyNode.y },
      label: "0 ROWS",
      constraint: "BOOKING.event_id (1:0..N)",
      onDelete: "CASCADE",
      cardinality: "1:0..N",
      desc: "Relational 1:N cardinality allows 0 to N booking records per event.",
      sql: `SELECT * FROM BOOKING WHERE event_id = ${data.event.event_id};`
    });
  } else {
    const clusterWidth = 360;
    const clusterGap = 40;
    const startX = 40;
    const startY = 340;

    data.bookings.forEach((bk, bIdx) => {
      const bx = startX + bIdx * (clusterWidth + clusterGap);

      // 1. Booking Node (Top of cluster)
      const bNode = {
        id: `node-booking-${bk.booking_id}`,
        type: "BOOKING",
        rawId: bk.booking_id,
        booking: bk,
        record: bk,
        x: bx,
        y: startY,
        width: clusterWidth,
        height: 95,
        tag: `BOOKING · PK: ${bk.booking_id} · ${bk.status}`,
        title: `Booking #${bk.booking_id}`,
        sub: `Customer: ${bk.customer_name} · ₹${Number(bk.total_amount).toFixed(2)}`,
        metric: `${bk.tickets.length} Ticket(s) · ${bk.booking_date.replace("T", " ")}`,
        cls: "atlas-node-booking"
      };
      nodes.push(bNode);

      // Event -> Booking fan-out edge
      const exitRatio = data.bookings.length > 1 ? (bIdx / (data.bookings.length - 1)) : 0.5;
      const eventExitX = eventNode.x + 30 + exitRatio * (eventNode.width - 60);

      edges.push({
        id: `edge-event-booking-${bk.booking_id}`,
        from: eventNode.id,
        to: bNode.id,
        fromPt: { x: eventExitX, y: eventNode.y + eventNode.height },
        toPt: { x: bNode.x + bNode.width / 2, y: bNode.y },
        label: `BOOKING #${bk.booking_id}`,
        constraint: "BOOKING.event_id → EVENT(event_id)",
        onDelete: "ON DELETE CASCADE",
        cardinality: "1:N (Event has many Bookings)",
        desc: "Each reservation belongs to a specific event. Removing an event cascades to delete related bookings.",
        sql: `ALTER TABLE BOOKING ADD CONSTRAINT fk_booking_event
  FOREIGN KEY (event_id) REFERENCES EVENT(event_id) ON DELETE CASCADE;`
      });

      // 2. Level 2 (y: 475): Customer (Left sub-card) & Payment (Right sub-card)
      const custY = startY + 135;
      const custNode = {
        id: `node-cust-${bk.booking_id}`,
        type: "CUSTOMER",
        rawId: bk.user_id,
        booking: bk,
        record: {
          user_id: bk.user_id,
          name: bk.customer_name,
          email: bk.customer_email,
          phone: bk.customer_phone,
          role: "CUSTOMER"
        },
        x: bx,
        y: custY,
        width: 172,
        height: 85,
        tag: `USERS · PK: ${bk.user_id}`,
        title: bk.customer_name,
        sub: bk.customer_email,
        metric: bk.customer_phone || "CUSTOMER",
        cls: "atlas-node-customer"
      };
      nodes.push(custNode);

      edges.push({
        id: `edge-booking-cust-${bk.booking_id}`,
        from: bNode.id,
        to: custNode.id,
        fromPt: { x: bNode.x + 86, y: bNode.y + bNode.height },
        toPt: { x: custNode.x + custNode.width / 2, y: custNode.y },
        label: "user_id",
        constraint: "BOOKING.user_id → USERS(user_id)",
        onDelete: "ON DELETE RESTRICT",
        cardinality: "N:1 (Customer places Bookings)",
        desc: "Foreign key linking reservation to the customer account. Registered customers with active bookings cannot be deleted.",
        sql: `ALTER TABLE BOOKING ADD CONSTRAINT fk_booking_user
  FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE RESTRICT;`
      });

      // Payment (Right sub-card)
      const pmt = bk.payments[0] || null;
      const paymentNode = {
        id: `node-payment-${bk.booking_id}`,
        type: "PAYMENT",
        rawId: pmt?.payment_id || 0,
        booking: bk,
        record: pmt,
        x: bx + 188,
        y: custY,
        width: 172,
        height: 85,
        tag: pmt ? `PAYMENT · PK: ${pmt.payment_id}` : "PAYMENT · 0 ROWS",
        title: pmt ? `₹${Number(pmt.amount_paid).toFixed(2)}` : "Pending Payment",
        sub: pmt ? `${pmt.payment_method} · ${pmt.status}` : "Awaiting execution",
        metric: pmt ? pmt.payment_date.replace("T", " ") : "UNPAID",
        cls: "atlas-node-payment"
      };
      nodes.push(paymentNode);

      edges.push({
        id: `edge-booking-payment-${bk.booking_id}`,
        from: bNode.id,
        to: paymentNode.id,
        fromPt: { x: bNode.x + 274, y: bNode.y + bNode.height },
        toPt: { x: paymentNode.x + paymentNode.width / 2, y: paymentNode.y },
        label: "1:N PAYMENT",
        constraint: "PAYMENT.booking_id → BOOKING(booking_id)",
        onDelete: "ON DELETE CASCADE",
        cardinality: "1:N (Booking may have multiple payment attempts)",
        desc: "Payment records associated with reservation order. Supports 1:N cardinality for handling gateway retries.",
        sql: `ALTER TABLE PAYMENT ADD CONSTRAINT fk_payment_booking
  FOREIGN KEY (booking_id) REFERENCES BOOKING(booking_id) ON DELETE CASCADE;`
      });

      // 3. Level 3 (y: 590): Tickets (Admission passes across categories)
      const ticketY = custY + 115;
      const seatsSummary = bk.tickets.map(t => `${t.seat_number} (${t.category_name})`).join(", ") || "No tickets generated";
      const ticketNode = {
        id: `node-ticket-${bk.booking_id}`,
        type: "TICKET",
        rawId: bk.tickets[0]?.ticket_id || 0,
        booking: bk,
        record: bk.tickets,
        x: bx,
        y: ticketY,
        width: clusterWidth,
        height: 85,
        tag: `TICKET · ${bk.tickets.length} PASS(ES) ALLOCATED`,
        title: `Seats: ${bk.tickets.map(t => t.seat_number).join(", ") || "None"}`,
        sub: seatsSummary,
        metric: `Status: ${bk.tickets[0]?.status || "VALID"} · UNIQUE(cat, seat)`,
        cls: "atlas-node-ticket"
      };
      nodes.push(ticketNode);

      edges.push({
        id: `edge-booking-ticket-${bk.booking_id}`,
        from: bNode.id,
        to: ticketNode.id,
        fromPt: { x: bNode.x + 180, y: bNode.y + bNode.height },
        toPt: { x: ticketNode.x + ticketNode.width / 2, y: ticketNode.y },
        label: "1:N TICKET",
        constraint: "TICKET.booking_id → BOOKING(booking_id)",
        onDelete: "ON DELETE CASCADE",
        cardinality: "1:N (Atomic admission tokens)",
        desc: "Individual seat allocation tokens created atomically by stored procedure sp_book_tickets().",
        sql: `ALTER TABLE TICKET ADD CONSTRAINT fk_ticket_booking
  FOREIGN KEY (booking_id) REFERENCES BOOKING(booking_id) ON DELETE CASCADE;`
      });

      // 4. Level 4 (y: 705): Cancellation (if cancelled)
      if (bk.cancellation) {
        const cancelY = ticketY + 115;
        const cn = bk.cancellation;
        const cancelNode = {
          id: `node-cancel-${bk.booking_id}`,
          type: "CANCELLATION",
          rawId: cn.cancel_id,
          booking: bk,
          record: cn,
          x: bx,
          y: cancelY,
          width: clusterWidth,
          height: 85,
          tag: `CANCELLATION · PK: ${cn.cancel_id}`,
          title: `Refund: ₹${Number(cn.refund_amount).toFixed(2)}`,
          sub: `Reason: ${cn.reason}`,
          metric: `Status: ${cn.status} · 1:0..1 UNIQUE(booking_id)`,
          cls: "atlas-node-cancellation"
        };
        nodes.push(cancelNode);

        edges.push({
          id: `edge-ticket-cancel-${bk.booking_id}`,
          from: ticketNode.id,
          to: cancelNode.id,
          fromPt: { x: ticketNode.x + ticketNode.width / 2, y: ticketNode.y + ticketNode.height },
          toPt: { x: cancelNode.x + cancelNode.width / 2, y: cancelNode.y },
          label: "1:0..1 REFUND",
          constraint: "CANCELLATION.booking_id → BOOKING(booking_id)",
          onDelete: "ON DELETE CASCADE",
          cardinality: "1:0..1 (Enforced by UNIQUE constraint)",
          desc: "Audit log of refunded orders. Enforces strict 1:0..1 cardinality via UNIQUE(booking_id).",
          sql: `ALTER TABLE CANCELLATION ADD CONSTRAINT uq_cancellation_booking
  UNIQUE (booking_id);`
        });
      }
    });
  }

  // Populate global maps
  nodes.forEach(n => atlasNodesMap.set(n.id, n));
  edges.forEach(e => atlasEdgesMap.set(e.id, e));

  // Determine dynamic canvas boundaries
  const maxRight = Math.max(...nodes.map(n => n.x + n.width)) + 60;
  const maxBottom = Math.max(...nodes.map(n => n.y + n.height)) + 60;
  const maxCanvasX = Math.max(1150, maxRight);
  const maxCanvasY = Math.max(760, maxBottom);

  svgLayer.setAttribute("width", `${maxCanvasX}`);
  svgLayer.setAttribute("height", `${maxCanvasY}`);
  svgLayer.style.width = `${maxCanvasX}px`;
  svgLayer.style.height = `${maxCanvasY}px`;
  nodesLayer.style.width = `${maxCanvasX}px`;
  nodesLayer.style.height = `${maxCanvasY}px`;

  // Draw SVG Edges
  edges.forEach(e => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = calculateSmoothPath(e.fromPt, e.toPt);
    path.setAttribute("d", d);
    path.setAttribute("class", "atlas-edge");
    path.setAttribute("id", e.id);
    path.setAttribute("data-from", e.from);
    path.setAttribute("data-to", e.to);
    path.setAttribute("marker-end", "url(#atlasArrow)");
    path.addEventListener("click", () => selectAtlasEdge(e.id));
    svgLayer.appendChild(path);

    const midX = (e.fromPt.x + e.toPt.x) / 2;
    const midY = (e.fromPt.y + e.toPt.y) / 2;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", midX);
    text.setAttribute("y", midY - 4);
    text.setAttribute("class", "atlas-edge-label");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("data-edge", e.id);
    text.textContent = e.label;
    text.addEventListener("click", () => selectAtlasEdge(e.id));
    svgLayer.appendChild(text);
  });

  // Render HTML Nodes
  nodes.forEach(n => {
    const el = document.createElement("div");
    el.className = `atlas-node ${n.cls}`;
    el.id = n.id;
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    el.style.width = `${n.width}px`;
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `${n.tag}: ${n.title}`);

    el.innerHTML = `
      <div class="atlas-node-tag">${n.tag}</div>
      <div class="atlas-node-title" title="${n.title}">${n.title}</div>
      <div class="atlas-node-sub" title="${n.sub}">${n.sub}</div>
      <div class="atlas-node-metric" title="${n.metric}">${n.metric}</div>
    `;

    el.addEventListener("click", () => {
      selectAtlasRecord(n.id);
    });
    el.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        selectAtlasRecord(n.id);
      }
    });

    nodesLayer.appendChild(el);
  });
}

function calculateSmoothPath(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    const cx1 = p1.x + dx * 0.5;
    const cy1 = p1.y;
    const cx2 = p1.x + dx * 0.5;
    const cy2 = p2.y;
    return `M ${p1.x} ${p1.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p2.x} ${p2.y}`;
  } else {
    const cx1 = p1.x;
    const cy1 = p1.y + dy * 0.5;
    const cx2 = p2.x;
    const cy2 = p1.y + dy * 0.5;
    return `M ${p1.x} ${p1.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p2.x} ${p2.y}`;
  }
}

function selectAtlasEdge(edgeId) {
  const edge = atlasEdgesMap.get(edgeId);
  if (!edge) return;

  currentAtlasSelectedEdgeId = edgeId;
  currentAtlasSelectedNodeId = null;

  // 1. Highlight clicked edge
  document.querySelectorAll(".atlas-edge").forEach(e => {
    e.classList.remove("active", "dimmed");
    if (e.id === edgeId) {
      e.classList.add("active");
      e.setAttribute("marker-end", "url(#atlasArrowActive)");
    } else {
      e.classList.add("dimmed");
      e.setAttribute("marker-end", "url(#atlasArrow)");
    }
  });

  // 2. Highlight only source and destination nodes
  const connectedNodes = new Set([edge.from, edge.to]);
  document.querySelectorAll(".atlas-node").forEach(n => {
    n.classList.remove("selected", "dimmed");
    if (connectedNodes.has(n.id)) {
      n.classList.add("selected");
    } else {
      n.classList.add("dimmed");
    }
  });

  // 3. Populate Inspector with Foreign Key / Constraint details
  const tagEl = document.getElementById("atlasEntityTag");
  const titleEl = document.getElementById("atlasRecordTitle");
  const pkEl = document.getElementById("atlasRecordPk");
  const descEl = document.getElementById("atlasRelDesc");
  const attrTbody = document.getElementById("atlasAttrTableBody");
  const linksEl = document.getElementById("atlasRelatedLinks");
  const sqlEl = document.getElementById("atlasSqlContent");

  attrTbody.innerHTML = "";
  linksEl.innerHTML = "";

  const fromNode = atlasNodesMap.get(edge.from);
  const toNode = atlasNodesMap.get(edge.to);

  tagEl.innerText = "FOREIGN KEY RELATIONSHIP";
  titleEl.innerText = edge.constraint;
  pkEl.innerText = `CARDINALITY: ${edge.cardinality} · ${edge.onDelete}`;
  descEl.innerText = edge.desc || "Relational foreign key integrity constraint enforced by PostgreSQL engine rules.";

  renderAttrRow(attrTbody, "Constraint", edge.constraint);
  renderAttrRow(attrTbody, "Source Entity", fromNode ? fromNode.tag : edge.from);
  renderAttrRow(attrTbody, "Target Entity", toNode ? toNode.tag : edge.to);
  renderAttrRow(attrTbody, "Cardinality", edge.cardinality);
  renderAttrRow(attrTbody, "On Delete Rule", edge.onDelete);

  if (fromNode) addRelatedChip(linksEl, `Source: ${fromNode.title}`, fromNode.id);
  if (toNode) addRelatedChip(linksEl, `Target: ${toNode.title}`, toNode.id);

  sqlEl.innerText = edge.sql || `-- Verification Query:
SELECT conname, confrelid::regclass AS target_table, conrelid::regclass AS source_table
FROM pg_constraint
WHERE conname = '${edge.constraint.split(' ')[0]}';`;
}

function selectAtlasRecord(nodeId) {
  const node = atlasNodesMap.get(nodeId);
  if (!node || !currentAtlasData) return;
  currentAtlasSelectedNodeId = nodeId;
  currentAtlasSelectedEdgeId = null;

  // 1. Highlight node
  document.querySelectorAll(".atlas-node").forEach(n => {
    n.classList.remove("selected", "dimmed");
    if (n.id === nodeId) {
      n.classList.add("selected");
    }
  });

  // 2. Active vs Dimmed edges
  const connectedNodeIds = new Set([nodeId]);
  document.querySelectorAll(".atlas-edge").forEach(edge => {
    edge.classList.remove("active", "dimmed");
    edge.setAttribute("marker-end", "url(#atlasArrow)");
    const fromId = edge.getAttribute("data-from");
    const toId = edge.getAttribute("data-to");

    if (fromId === nodeId || toId === nodeId) {
      edge.classList.add("active");
      edge.setAttribute("marker-end", "url(#atlasArrowActive)");
      connectedNodeIds.add(fromId);
      connectedNodeIds.add(toId);
    } else {
      edge.classList.add("dimmed");
    }
  });

  // Dim unrelated nodes
  document.querySelectorAll(".atlas-node").forEach(n => {
    if (!connectedNodeIds.has(n.id)) {
      n.classList.add("dimmed");
    }
  });

  // 3. Populate Atlas Inspector
  const tagEl = document.getElementById("atlasEntityTag");
  const titleEl = document.getElementById("atlasRecordTitle");
  const pkEl = document.getElementById("atlasRecordPk");
  const descEl = document.getElementById("atlasRelDesc");
  const attrTbody = document.getElementById("atlasAttrTableBody");
  const linksEl = document.getElementById("atlasRelatedLinks");
  const sqlEl = document.getElementById("atlasSqlContent");

  attrTbody.innerHTML = "";
  linksEl.innerHTML = "";

  const { type, record, booking } = node;

  if (type === "EVENT") {
    const e = record;
    tagEl.innerText = "TABLE: EVENT";
    titleEl.innerText = e.event_name;
    pkEl.innerText = `PRIMARY KEY: event_id = ${e.event_id}`;
    descEl.innerText = `Central Anchor Record. Bound to physical VENUE #${currentAtlasData.venue.venue_id} (RESTRICT) and organizer USERS #${currentAtlasData.organizer.user_id} (RESTRICT). Acts as 1:N parent to SEAT_CATEGORY and BOOKING.`;

    renderAttrRow(attrTbody, "event_id", e.event_id);
    renderAttrRow(attrTbody, "event_name", e.event_name);
    renderAttrRow(attrTbody, "event_date", e.event_date);
    renderAttrRow(attrTbody, "event_time", e.event_time);
    renderAttrRow(attrTbody, "venue_id (FK)", `${currentAtlasData.venue.venue_id} → ${currentAtlasData.venue.venue_name}`);
    renderAttrRow(attrTbody, "organizer_id (FK)", `${currentAtlasData.organizer.user_id} → ${currentAtlasData.organizer.name}`);
    renderAttrRow(attrTbody, "occupancy_pct", `${Number(e.occupancy_pct || 0).toFixed(2)}%`);
    renderAttrRow(attrTbody, "description", e.description || "—");

    addRelatedChip(linksEl, "Venue Record", "node-venue");
    addRelatedChip(linksEl, "Organizer Profile", "node-organizer");
    currentAtlasData.categories.forEach(c => {
      addRelatedChip(linksEl, `Tier: ${c.category_name}`, `node-cat-${c.category_id}`);
    });
    currentAtlasData.bookings.forEach(b => {
      addRelatedChip(linksEl, `Booking #${b.booking_id}`, `node-booking-${b.booking_id}`);
    });

    sqlEl.innerText = `SELECT e.*, v.venue_name, u.name AS organizer_name,
       fn_event_occupancy(e.event_id) AS occupancy_pct
FROM EVENT e
JOIN VENUE v ON e.venue_id = v.venue_id
JOIN USERS u ON e.organizer_id = u.user_id
WHERE e.event_id = ${e.event_id};`;

  } else if (type === "VENUE") {
    const v = record;
    tagEl.innerText = "TABLE: VENUE";
    titleEl.innerText = v.venue_name;
    pkEl.innerText = `PRIMARY KEY: venue_id = ${v.venue_id}`;
    descEl.innerText = `Physical Infrastructure. Parent to EVENT via fk_event_venue (ON DELETE RESTRICT). Enforces physical maximum capacity (${Number(v.capacity).toLocaleString()} seats).`;

    renderAttrRow(attrTbody, "venue_id", v.venue_id);
    renderAttrRow(attrTbody, "venue_name", v.venue_name);
    renderAttrRow(attrTbody, "location", v.location);
    renderAttrRow(attrTbody, "capacity", Number(v.capacity).toLocaleString());

    addRelatedChip(linksEl, "Anchor Event", "node-event");

    sqlEl.innerText = `SELECT * FROM VENUE WHERE venue_id = ${v.venue_id};
-- Enforced Constraint:
ALTER TABLE EVENT ADD CONSTRAINT fk_event_venue 
  FOREIGN KEY (venue_id) REFERENCES VENUE(venue_id) ON DELETE RESTRICT;`;

  } else if (type === "ORGANIZER" || type === "CUSTOMER") {
    const u = record;
    tagEl.innerText = `TABLE: USERS · ROLE: ${u.role}`;
    titleEl.innerText = u.name;
    pkEl.innerText = `PRIMARY KEY: user_id = ${u.user_id}`;
    descEl.innerText = (type === "ORGANIZER")
      ? `Event Principal. Organizes events via fk_event_organizer. Cannot be removed while hosting active events.`
      : `Customer Account. Originator of reservation orders via fk_booking_user. Bound to digital ticket wallet.`;

    renderAttrRow(attrTbody, "user_id", u.user_id);
    renderAttrRow(attrTbody, "name", u.name);
    renderAttrRow(attrTbody, "email", u.email);
    renderAttrRow(attrTbody, "phone", u.phone || "—");
    renderAttrRow(attrTbody, "role", u.role);

    if (type === "ORGANIZER") {
      addRelatedChip(linksEl, "Anchor Event", "node-event");
    } else if (booking) {
      addRelatedChip(linksEl, `Booking #${booking.booking_id}`, `node-booking-${booking.booking_id}`);
    }

    sqlEl.innerText = `SELECT user_id, name, email, phone, role 
FROM USERS 
WHERE user_id = ${u.user_id};`;

  } else if (type === "SEAT_CATEGORY") {
    const c = record;
    tagEl.innerText = "TABLE: SEAT_CATEGORY";
    titleEl.innerText = c.category_name;
    pkEl.innerText = `PRIMARY KEY: category_id = ${c.category_id}`;
    descEl.innerText = `Quota & Pricing Tier. Child of EVENT #${c.event_id} (ON DELETE CASCADE). Enforces UNIQUE(category_id, seat_number) for seat allocations.`;

    renderAttrRow(attrTbody, "category_id", c.category_id);
    renderAttrRow(attrTbody, "event_id (FK)", c.event_id);
    renderAttrRow(attrTbody, "category_name", c.category_name);
    renderAttrRow(attrTbody, "price", `₹${Number(c.price).toFixed(2)}`);
    renderAttrRow(attrTbody, "total_seats", c.total_seats);
    renderAttrRow(attrTbody, "available_seats", c.available_seats);
    renderAttrRow(attrTbody, "booked_count", c.booked_count);

    addRelatedChip(linksEl, "Anchor Event", "node-event");

    sqlEl.innerText = `SELECT * FROM SEAT_CATEGORY WHERE category_id = ${c.category_id};
-- Enforces concurrency isolation:
ALTER TABLE TICKET ADD CONSTRAINT uq_category_seat 
  UNIQUE (category_id, seat_number);`;

  } else if (type === "BOOKING") {
    const b = record;
    tagEl.innerText = `TABLE: BOOKING · ${b.status}`;
    titleEl.innerText = `Booking #${b.booking_id}`;
    pkEl.innerText = `PRIMARY KEY: booking_id = ${b.booking_id}`;
    descEl.innerText = `Customer Reservation Order. Foreign keys to EVENT #${b.event_id} and USERS #${b.user_id}. Cascades deletions to TICKET, PAYMENT, and CANCELLATION.`;

    renderAttrRow(attrTbody, "booking_id", b.booking_id);
    renderAttrRow(attrTbody, "event_id (FK)", b.event_id);
    renderAttrRow(attrTbody, "user_id (FK)", `${b.user_id} (${b.customer_name})`);
    renderAttrRow(attrTbody, "booking_date", b.booking_date.replace("T", " "));
    renderAttrRow(attrTbody, "total_amount", `₹${Number(b.total_amount).toFixed(2)}`);
    renderAttrRow(attrTbody, "status", b.status);

    addRelatedChip(linksEl, "Anchor Event", "node-event");
    addRelatedChip(linksEl, `Customer: ${b.customer_name}`, `node-cust-${b.booking_id}`);
    addRelatedChip(linksEl, `Tickets (${b.tickets.length})`, `node-ticket-${b.booking_id}`);
    addRelatedChip(linksEl, `Payment Record`, `node-payment-${b.booking_id}`);
    if (b.cancellation) {
      addRelatedChip(linksEl, `Cancellation Record`, `node-cancel-${b.booking_id}`);
    }

    // Direct operational triggers from the Atlas Inspector
    if (b.status === "PENDING") {
      addActionChip(linksEl, `Confirm & Pay #${b.booking_id}`, () => {
        openPaymentModal(b.booking_id, `₹${Number(b.total_amount).toFixed(2)}`);
      });
    } else if (b.status === "CONFIRMED" && !b.cancellation) {
      addActionChip(linksEl, `Cancel & Refund #${b.booking_id}`, () => {
        openCancelModal(b.booking_id);
      }, true);
    }

    sqlEl.innerText = `SELECT b.*, e.event_name, u.name AS customer_name
FROM BOOKING b
JOIN EVENT e ON b.event_id = e.event_id
JOIN USERS u ON b.user_id = u.user_id
WHERE b.booking_id = ${b.booking_id};`;

  } else if (type === "TICKET") {
    const tickets = Array.isArray(record) ? record : [record];
    const b = booking;
    tagEl.innerText = "TABLE: TICKET (1:N CHILD OF BOOKING)";
    titleEl.innerText = b ? `Tickets for Booking #${b.booking_id}` : "Ticket Tuples";
    pkEl.innerText = b ? `FOREIGN KEY: booking_id = ${b.booking_id}` : "TICKET";
    descEl.innerText = `Atomic Admission Passes. Generated via procedure sp_book_tickets(). Bound to SEAT_CATEGORY via category_id (RESTRICT) and BOOKING via booking_id (CASCADE).`;

    if (tickets.length === 0) {
      renderAttrRow(attrTbody, "tickets", "0 tuples generated");
    } else {
      tickets.forEach((t) => {
        renderAttrRow(attrTbody, `Ticket #${t.ticket_id}`, `Seat ${t.seat_number} · ${t.category_name} · ₹${Number(t.price).toFixed(2)} · [${t.status}]`);
      });
    }

    if (b) {
      addRelatedChip(linksEl, `Parent Booking #${b.booking_id}`, `node-booking-${b.booking_id}`);
      addRelatedChip(linksEl, `Customer: ${b.customer_name}`, `node-cust-${b.booking_id}`);
    }

    sqlEl.innerText = `SELECT t.ticket_id, t.booking_id, t.category_id, t.seat_number, t.price, t.status, sc.category_name
FROM TICKET t
JOIN SEAT_CATEGORY sc ON t.category_id = sc.category_id
WHERE t.booking_id = ${b ? b.booking_id : 0};`;

  } else if (type === "PAYMENT") {
    const pmt = record;
    const b = booking;
    tagEl.innerText = "TABLE: PAYMENT (1:N TRANSACTION)";
    titleEl.innerText = pmt ? `Payment #${pmt.payment_id}` : `Payment for Booking #${b?.booking_id}`;
    pkEl.innerText = pmt ? `PRIMARY KEY: payment_id = ${pmt.payment_id}` : `No payment rows`;
    descEl.innerText = `Financial Ledger Record. Supports 1:N cardinality per booking for retry attempts on payment gateway failures.`;

    if (pmt) {
      renderAttrRow(attrTbody, "payment_id", pmt.payment_id);
      renderAttrRow(attrTbody, "booking_id (FK)", pmt.booking_id);
      renderAttrRow(attrTbody, "payment_date", pmt.payment_date.replace("T", " "));
      renderAttrRow(attrTbody, "amount_paid", `₹${Number(pmt.amount_paid).toFixed(2)}`);
      renderAttrRow(attrTbody, "payment_method", pmt.payment_method);
      renderAttrRow(attrTbody, "status", pmt.status);
    } else {
      renderAttrRow(attrTbody, "status", "Awaiting Payment Execution (0 payment records)");
    }

    if (b) {
      addRelatedChip(linksEl, `Parent Booking #${b.booking_id}`, `node-booking-${b.booking_id}`);
    }

    sqlEl.innerText = `SELECT payment_id, booking_id, payment_date, amount_paid, payment_method, status
FROM PAYMENT
WHERE booking_id = ${b ? b.booking_id : 0};`;

  } else if (type === "CANCELLATION") {
    const c = record;
    const b = booking;
    tagEl.innerText = "TABLE: CANCELLATION (1:0..1 UNIQUE)";
    titleEl.innerText = `Cancellation #${c.cancel_id}`;
    pkEl.innerText = `PRIMARY KEY: cancel_id = ${c.cancel_id} · booking_id = ${c.booking_id}`;
    descEl.innerText = `Order Cancellation & Refund Ledger. Enforces strict 1:0..1 cardinality via UNIQUE(booking_id). Calculated by fn_calculate_refund_percentage().`;

    renderAttrRow(attrTbody, "cancel_id", c.cancel_id);
    renderAttrRow(attrTbody, "booking_id (FK)", c.booking_id);
    renderAttrRow(attrTbody, "cancel_date", c.cancel_date.replace("T", " "));
    renderAttrRow(attrTbody, "refund_amount", `₹${Number(c.refund_amount).toFixed(2)}`);
    renderAttrRow(attrTbody, "reason", c.reason);
    renderAttrRow(attrTbody, "status", c.status);

    if (b) {
      addRelatedChip(linksEl, `Parent Booking #${b.booking_id}`, `node-booking-${b.booking_id}`);
    }

    sqlEl.innerText = `SELECT cancel_id, booking_id, cancel_date, reason, refund_amount, status
FROM CANCELLATION
WHERE booking_id = ${c.booking_id};
-- 1:0..1 cardinality constraint:
ALTER TABLE CANCELLATION ADD CONSTRAINT uq_cancellation_booking UNIQUE(booking_id);`;

  } else if (type === "INFO") {
    tagEl.innerText = "INFORMATION";
    titleEl.innerText = node.title;
    pkEl.innerText = "DATABASE VIEW";
    descEl.innerText = node.sub;
    renderAttrRow(attrTbody, "Query", node.metric);
    sqlEl.innerText = node.metric;
  }
}

function renderAttrRow(tbody, key, val) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="atlas-attr-name">${key}</td>
    <td class="atlas-attr-val">${val !== null && val !== undefined ? val : "NULL"}</td>
  `;
  tbody.appendChild(tr);
}

function addRelatedChip(container, label, targetNodeId) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "atlas-link-chip";
  chip.innerHTML = `<span>→</span> <span>${label}</span>`;
  chip.addEventListener("click", () => {
    selectAtlasRecord(targetNodeId);
    const targetEl = document.getElementById(targetNodeId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      targetEl.focus();
    }
  });
  container.appendChild(chip);
}

function addActionChip(container, label, onClickFn, isDanger = false) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = isDanger ? "atlas-link-chip chip-danger" : "atlas-link-chip chip-action";
  chip.innerHTML = `<span>${isDanger ? "↺" : "💳"}</span> <span>${label}</span>`;
  chip.addEventListener("click", onClickFn);
  container.appendChild(chip);
}

function openTraceInDrawer() {
  const sqlEl = document.getElementById("atlasSqlContent");
  const entityTag = document.getElementById("atlasEntityTag")?.innerText || "RELATIONAL ENTITY";
  const title = document.getElementById("atlasRecordTitle")?.innerText || "RECORD";
  const drawer = document.getElementById("inspectorDrawer");
  const backdrop = document.getElementById("inspectorBackdrop");

  if (sqlEl) {
    updateInspector(
      `Relationship Atlas: ${entityTag} (${title})`,
      sqlEl.innerText,
      "PostgreSQL 16 Foreign Keys & Cardinality Constraints",
      "Relational integrity enforced by PostgreSQL 16 engine rules."
    );
    inspectorOpen = true;
    if (drawer) drawer.classList.add("open");
    if (backdrop) backdrop.classList.add("active");
  }
}


