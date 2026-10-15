(() => {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ease = "cubic-bezier(.2, .8, .2, 1)";
  const players = new Map();

  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  const splitText = (node, chars) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) return splitText(child, chars);
      if (child.nodeType !== Node.TEXT_NODE) return;
      const fragment = document.createDocumentFragment();
      child.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) return fragment.append(" ");
        const word = make("span", "split-word");
        word.setAttribute("aria-hidden", "true");
        [...part].forEach((letter) => {
          const char = make("span", "split-char", letter);
          word.append(char);
          chars.push(char);
        });
        fragment.append(word);
      });
      child.replaceWith(fragment);
    });
  };

  const setupSplit = (el) => {
    el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
    const chars = [];
    splitText(el, chars);
    const step = Math.min(22, 1100 / chars.length);
    return () => chars.forEach((char, i) => char.animate(
      [
        { opacity: 0, transform: "translateY(.35em)", filter: "blur(4px)" },
        { opacity: 1, transform: "none", filter: "blur(0)" }
      ],
      { duration: 650, delay: i * step, easing: ease, fill: "both" }
    ));
  };

  const setupCounter = (el) => {
    const text = el.textContent.trim();
    el.setAttribute("aria-label", text);
    el.textContent = "";
    const stacks = [];
    const cells = 20;
    [...text].forEach((c) => {
      const digit = make("span", "digit");
      digit.setAttribute("aria-hidden", "true");
      el.append(digit);
      if (!/\d/.test(c)) return digit.append(c);
      const stack = make("span", "digit__stack");
      for (let n = 0; n < cells; n++) stack.append(make("span", "", String(n % 10)));
      digit.append(stack);
      stacks.push({ stack, target: 10 + Number(c) });
    });
    return () => stacks.forEach(({ stack, target }, i) => stack.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(-${(target * 100) / cells}%)` }],
      { duration: 1500 + i * 250, easing: "cubic-bezier(.2, .7, .1, 1)", fill: "forwards" }
    ));
  };

  const form = document.querySelector(".lead-form");
  const submit = form.querySelector("button[type=submit]");
  const status = form.querySelector(".lead-form__status");
  const hubspotCookie = () => document.cookie.match(/(?:^|;\s*)hubspotutk=([^;]+)/)?.[1];

  const sendToHubspot = () => {
    const { hsPortal, hsForm } = form.dataset;
    const fields = [...new FormData(form)]
      .filter(([, value]) => String(value).trim())
      .map(([field, value]) => {
        const [objectTypeId, name] = field.split("/");
        return { objectTypeId, name, value: String(value).trim() };
      });
    const context = { pageUri: location.href, pageName: document.title };
    const hutk = hubspotCookie();
    if (hutk) context.hutk = hutk;
    return fetch(`https://api.hsforms.com/submissions/v3/integration/submit/${hsPortal}/${hsForm}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields, context })
    }).then((response) => {
      if (!response.ok) throw new Error(response.status);
    });
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.classList.add("was-validated");
    if (!form.checkValidity()) return form.reportValidity();
    submit.disabled = true;
    status.textContent = "";
    sendToHubspot()
      .then(() => {
        form.classList.add("is-sent");
        submit.querySelector("span").textContent = "Recebemos seus dados";
      })
      .catch(() => {
        submit.disabled = false;
        status.textContent = "Não foi possível enviar agora. Tente novamente ou fale conosco pelo WhatsApp.";
      });
  });

  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const toggle = nav.querySelector(".nav__toggle");
  const menu = nav.querySelector(".nav__menu");
  const setMenu = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("is-open", open);
  };
  toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  menu.addEventListener("click", (event) => { if (event.target.closest("a")) setMenu(false); });

  document.querySelectorAll("[data-carousel]").forEach((carousel) => {
    const track = carousel.querySelector(".carousel__track");
    const [prev, next] = carousel.querySelectorAll(".carousel__button");
    const step = () => track.querySelector("li").offsetWidth;
    const update = () => {
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    };
    prev.addEventListener("click", () => track.scrollBy({ left: -step() }));
    next.addEventListener("click", () => track.scrollBy({ left: step() }));
    track.addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();

    let drag = null;
    track.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse") return;
      drag = { x: event.clientX, left: track.scrollLeft };
      track.classList.add("is-dragging");
      track.setPointerCapture(event.pointerId);
    });
    track.addEventListener("pointermove", (event) => {
      if (drag) track.scrollLeft = drag.left - (event.clientX - drag.x);
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      track.classList.remove("is-dragging");
    };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
  });

  const targets = document.querySelectorAll("[data-split], [data-count], [data-reveal], [data-stagger]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  document.querySelectorAll("[data-split]").forEach((el) => players.set(el, setupSplit(el)));
  document.querySelectorAll("[data-count]").forEach((el) => players.set(el, setupCounter(el)));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      entry.target.classList.add("is-visible");
      players.get(entry.target)?.();
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });

  targets.forEach((el) => observer.observe(el));
})();
