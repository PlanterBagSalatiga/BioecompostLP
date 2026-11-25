(() => {
  "use strict";

  const config = window.bioEcompostConfig ?? {};
  const variant = "80_liter";
  const channels = ["shopee", "whatsapp"];
  const channelLabel = { shopee: "Shopee", whatsapp: "WhatsApp" };
  const rupiah = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  });
  const sessionKey = "bio-ecompost:session:v1";
  const sessionTimeout = 30 * 60 * 1000;
  const query = new URLSearchParams(location.search);
  const cleanToken = (value) => /^[\p{L}\p{N}_.~-]{1,80}$/u.test(value ?? "") ? value : undefined;
  const incomingTraffic = Object.fromEntries(Object.entries({
    traffic_source: cleanToken(query.get("utm_source")),
    traffic_medium: cleanToken(query.get("utm_medium")),
    campaign_id: cleanToken(query.get("utm_id") ?? query.get("utm_campaign")),
    campaign_content: cleanToken(query.get("utm_content"))
  }).filter(([, value]) => value));
  let session;

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(sessionKey));
    } catch {
      return null;
    }
  }

  function saveSession(value) {
    session = value;
    try {
      localStorage.setItem(sessionKey, JSON.stringify(value));
    } catch {
      // Pencatatan selama tab terbuka tetap tersedia.
    }
  }

  function track(event, params = {}) {
    try {
      const now = Date.now();
      const saved = readSession() ?? session;
      const active = saved?.id && now - saved.lastActive < sessionTimeout;
      const newSession = !active;
      const traffic = { ...(active ? saved.traffic : {}), ...incomingTraffic };
      const current = {
        id: active ? saved.id : (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)),
        traffic,
        lastActive: now,
        clicked: active ? saved.clicked ?? [] : []
      };
      const base = {
        product_id: "bio_ecompost",
        variant,
        page_version: config.pageVersion ?? "v1",
        experiment_variant: config.experimentVariant ?? "control",
        lp_session_id: current.id,
        traffic_source: current.traffic.traffic_source ?? "(direct)",
        ...traffic
      };
      const layer = window.dataLayer ??= [];
      if (newSession) layer.push({ ...base, event: "lp_session_start" });
      if (event === "cta_click") {
        params.first_channel_click_in_session = !current.clicked.includes(params.channel);
        params.first_cta_click_in_session = current.clicked.length === 0;
        if (params.first_channel_click_in_session) current.clicked.push(params.channel);
      }
      saveSession(current);
      layer.push({ ...base, ...params, event });
    } catch {
      // Tautan tetap menggunakan navigasi bawaan browser.
    }
  }

  track("lp_view");
  if (/^GTM-[A-Z0-9]+$/.test(config.gtmContainer ?? "")) {
    window.dataLayer?.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const loader = document.createElement("script");
    loader.async = true;
    loader.src = `https://www.googletagmanager.com/gtm.js?id=${config.gtmContainer}`;
    document.head.append(loader);
  }

  const ctas = [...document.querySelectorAll("[data-channel][data-placement]")];
  const offer = document.querySelector("[data-offer]");
  const priceNodes = [...document.querySelectorAll("[data-price]")];
  const priceNotes = [...document.querySelectorAll("[data-price-note]")];
  const promoNotes = [...document.querySelectorAll("[data-promo-note]")];
  const countdowns = [...document.querySelectorAll("[data-countdown]")];
  const priceValid = (value) => Number.isSafeInteger(value) && value > 0;
  const timestamp = (value) => typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? Date.parse(value) : NaN;

  function promoPeriod(promo) {
    if (promo?.approved !== true || promo.variant !== variant || !channels.includes(promo.channel)
      || !priceValid(promo.price) || !cleanToken(promo.id) || typeof promo.terms !== "string" || !promo.terms.trim()) return null;
    const start = timestamp(promo.startsAt);
    const end = promo.endsAt == null ? Infinity : timestamp(promo.endsAt);
    return Number.isFinite(start) && end > start ? { start, end } : null;
  }

  const promo = config.promotion;
  const period = promoPeriod(promo);
  const currentPromo = (now) => period && now >= period.start && now < period.end ? promo : null;
  let updateTimer;
  let renderedQuote;

  function updateQuote() {
    clearTimeout(updateTimer);
    const now = Date.now();
    const active = currentPromo(now);
    const prices = Object.fromEntries(channels.map((channel) => {
      const price = config.regularPrices?.[channel];
      return [channel, active?.channel === channel ? active.price : price];
    }));
    const available = channels.filter((channel) => priceValid(prices[channel]));
    const promoId = active?.id ?? null;
    const renderKey = JSON.stringify({ promoId, prices });
    if (renderedQuote !== renderKey) {
      renderedQuote = renderKey;
      const labels = available.map((channel) => `${channelLabel[channel]} ${rupiah.format(prices[channel])}`);
      const missing = channels.filter((channel) => !priceValid(prices[channel])).map((channel) => channelLabel[channel]);
      for (const node of priceNodes) node.textContent = labels.join(" · ") || "Cek harga di Shopee";
      for (const node of priceNotes) {
        node.hidden = !labels.length || !missing.length;
        node.textContent = node.hidden ? "" : `Untuk harga ${missing.join(" dan ")}, cek langsung di kanal pembelian.`;
      }
      for (const node of promoNotes) {
        node.hidden = !active;
        node.textContent = active ? `Promo ${channelLabel[active.channel]}. ${active.terms}` : "";
      }
    }
    const remaining = active && Number.isFinite(period?.end) ? period.end - now : 0;
    for (const node of countdowns) {
      node.hidden = remaining <= 0;
      const seconds = Math.ceil(remaining / 1000);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor(seconds / 60) % 60;
      node.textContent = node.hidden ? "" : `Berakhir dalam ${hours}j ${minutes}m ${seconds % 60}d`;
    }
    if (remaining > 0) updateTimer = setTimeout(updateQuote, Math.min(1000, remaining));
    else if (period && now < period.start) updateTimer = setTimeout(updateQuote, Math.min(period.start - now, 2147483647));
  }

  updateQuote();
  window.addEventListener("pageshow", updateQuote);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateQuote();
  });

  for (const cta of ctas) {
    cta.addEventListener("click", () => track("cta_click", { channel: cta.dataset.channel, placement: cta.dataset.placement }));
    cta.addEventListener("auxclick", (event) => {
      if (event.button === 1) track("cta_click", { channel: cta.dataset.channel, placement: cta.dataset.placement });
    });
  }

  for (const faq of document.querySelectorAll("[data-faq]")) {
    faq.addEventListener("toggle", () => {
      if (faq.open) track("faq_expand", { faq_id: faq.dataset.faq });
    });
  }
  for (const link of document.querySelectorAll("[data-guide-link]")) {
    link.addEventListener("click", () => track("guide_view", { content_id: "kompos_80l" }));
  }

  if ("IntersectionObserver" in window) {
    const impressionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
        const target = entry.target;
        track("cta_impression", { channel: target.dataset.channel, placement: target.dataset.placement });
        impressionObserver.unobserve(target);
      }
    }, { threshold: 0.5 });
    for (const cta of ctas) impressionObserver.observe(cta);
    const offerObserver = new IntersectionObserver(([entry], observer) => {
      if (!entry.isIntersecting) return;
      track("offer_view", { promo_id: currentPromo(Date.now())?.id ?? null });
      observer.disconnect();
    }, { rootMargin: "0px 0px -70px 0px" });
    offerObserver.observe(offer.querySelector(".price-block"));
  }

  const sticky = document.querySelector(".sticky");
  const heroActions = document.querySelector("#hero-actions");
  const mobile = matchMedia("(max-width: 720px)");
  const lowerCtas = ctas.filter((cta) => ["offer", "final_cta"].includes(cta.dataset.placement));
  let stickyFrame = 0;

  function refreshSticky() {
    stickyFrame = 0;
    const pastHero = mobile.matches && heroActions.getBoundingClientRect().bottom <= 0;
    document.body.classList.toggle("sticky-ready", pastHero);
    const safeBottom = window.innerHeight - (sticky.offsetHeight || 66);
    const coversCta = pastHero && lowerCtas.some((cta) => {
      const rect = cta.getBoundingClientRect();
      return rect.bottom > safeBottom && rect.top < window.innerHeight;
    });
    sticky.hidden = !pastHero || coversCta;
  }

  function requestStickyUpdate() {
    if (!stickyFrame) stickyFrame = requestAnimationFrame(refreshSticky);
  }

  window.addEventListener("scroll", requestStickyUpdate, { passive: true });
  window.addEventListener("resize", requestStickyUpdate);
  window.addEventListener("pageshow", requestStickyUpdate);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(requestStickyUpdate);
    observer.observe(document.querySelector("main"));
  }
  refreshSticky();
})();
