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
    [...text].forEach((c) => {
      if (!/\d/.test(c)) {
        const plain = make("span", "", c);
        plain.setAttribute("aria-hidden", "true");
        return el.append(plain);
      }
      const digit = make("span", "digit");
      digit.setAttribute("aria-hidden", "true");
      const stack = make("span", "digit__stack");
      for (let n = 0; n < 20; n++) stack.append(make("span", "", String(n % 10)));
      digit.append(stack);
      el.append(digit);
      stacks.push({ stack, target: 10 + Number(c) });
    });
    return () => stacks.forEach(({ stack, target }, i) => stack.animate(
      [{ transform: "translateY(0)" }, { transform: `translateY(-${target}em)` }],
      { duration: 1500 + i * 250, easing: "cubic-bezier(.2, .7, .1, 1)", fill: "forwards" }
    ));
  };

  document.querySelectorAll("[data-marquee]").forEach((marquee) => {
    if (reduceMotion) return;
    const group = marquee.querySelector(".marquee__group");
    const clone = group.cloneNode(true);
    clone.setAttribute("aria-hidden", "true");
    group.after(clone);
  });

  const form = document.querySelector(".lead-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.classList.add("was-validated");
    if (!form.checkValidity()) return form.reportValidity();
    form.classList.add("is-sent");
    form.querySelector("button[type=submit] span").textContent = "Recebemos seus dados";
  });

  const header = document.querySelector(".site-header");
  const onScroll = () => header.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

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
