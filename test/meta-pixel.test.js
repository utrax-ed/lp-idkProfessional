import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { META_PIXEL_ID } from "../lib/meta-capi.js";

const script = readFileSync(new URL("../assets/js/meta-pixel.js", import.meta.url), "utf8");

const browser = (url, { cookies = "" } = {}) => {
  const calls = [];
  const listeners = new Map();
  const inserted = [];
  const window = {};
  const document = {
    cookie: cookies,
    createElement: (tag) => ({ tag }),
    getElementsByTagName: () => [{ parentNode: { insertBefore: (element) => inserted.push(element) } }],
    addEventListener: (name, listener) => listeners.set(name, listener)
  };
  const context = vm.createContext({ window, document, location: new URL(url), URL, URLSearchParams, crypto: { randomUUID } });
  const run = () => vm.runInContext(script, context);
  run();
  if (window.fbq) {
    const queue = window.fbq.queue;
    calls.push(...queue.map((args) => [...args]));
    window.fbq = (...args) => calls.push(args);
  }
  return { window, calls, listeners, inserted, run };
};

const byEvent = (env, name) => env.calls.filter((args) => args[2] === name);

test("as duas LPs, com e sem barra final, inicializam só o Pixel próprio uma vez", () => {
  for (const [path, niche] of [["/adv", "advocacia"], ["/adv/", "advocacia"], ["/odonto", "odontologia"], ["/odonto/", "odontologia"]]) {
    const env = browser(`https://oferta.idkbrasil.com${path}`);
    assert.deepEqual(env.calls, [["init", META_PIXEL_ID], ["trackSingle", META_PIXEL_ID, "PageView"]]);
    assert.equal(env.inserted.length, 1);
    assert.equal(env.inserted[0].src, "https://connect.facebook.net/en_US/fbevents.js");
    assert.equal(env.window.IDKMeta.prepararCadastro().nicho, niche);
    env.run();
    assert.equal(env.calls.length, 2);
    assert.equal(env.inserted.length, 1);
  }
});

test("outras rotas e outros hosts não carregam o Pixel nem expõem helper", () => {
  for (const url of [
    "https://oferta.idkbrasil.com/",
    "https://oferta.idkbrasil.com/adv/outra/",
    "https://oferta.idkbrasil.com/contabilidade/",
    "https://outro.idkbrasil.com/adv/",
    "https://lp-idkprofessional-production.up.railway.app/adv/",
    "http://localhost:3000/odonto/"
  ]) {
    const env = browser(url);
    assert.equal(env.window.IDKMeta, undefined);
    assert.equal(env.window.fbq, undefined);
    assert.equal(env.inserted.length, 0);
    assert.equal(env.listeners.size, 0);
  }
});

test("metadados trazem nicho, cookies reais e URL canônica sem query", () => {
  const env = browser("https://oferta.idkbrasil.com/odonto/?utm_source=meta&fbclid=clique&email=nao-enviar", {
    cookies: "_fbp=fb.1.111.offline; _fbc=fb.1.111.clique"
  });
  const data = env.window.IDKMeta.prepararCadastro();
  assert.equal(data.nicho, "odontologia");
  assert.equal(data.event_source_url, "https://oferta.idkbrasil.com/odonto/");
  assert.equal(data.fbp, "fb.1.111.offline");
  assert.equal(data.fbc, "fb.1.111.clique");
  assert.equal(data.fbclid, "clique");
  assert.deepEqual({ ...data.utms }, { utm_source: "meta" });
  assert.match(data.event_id, /^[0-9a-f-]{36}$/);
});

test("Lead só dispara na confirmação, com eventID do servidor, e não repete na mesma página", () => {
  const env = browser("https://oferta.idkbrasil.com/adv/");
  env.window.IDKMeta.prepararCadastro();
  assert.equal(byEvent(env, "Lead").length, 0);
  env.window.IDKMeta.cadastroConfirmado("id-confirmado-servidor-0001");
  env.window.IDKMeta.cadastroConfirmado("id-confirmado-servidor-0001");
  env.window.IDKMeta.cadastroConfirmado("");
  env.window.IDKMeta.cadastroConfirmado(undefined);
  const leads = byEvent(env, "Lead");
  assert.equal(leads.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(leads[0])), [
    "trackSingle",
    META_PIXEL_ID,
    "Lead",
    { content_name: "Solicitação de proposta IDK Professionals", content_category: "advocacia" },
    { eventID: "id-confirmado-servidor-0001" }
  ]);
});

test("clique no WhatsApp das LPs gera um Contact e nenhum Lead", () => {
  const env = browser("https://oferta.idkbrasil.com/odonto/");
  const click = env.listeners.get("click");
  click({ target: { closest: () => ({ href: "https://api.whatsapp.com/send/?phone=5511936244933&text=Oi" }) } });
  click({ target: { closest: () => ({ href: "https://oferta.idkbrasil.com/odonto/#pacotes" }) } });
  click({ target: { closest: () => null } });
  const contacts = byEvent(env, "Contact");
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0][1], META_PIXEL_ID);
  assert.equal(contacts[0][3].content_category, "odontologia");
  assert.equal(byEvent(env, "Lead").length, 0);
});
