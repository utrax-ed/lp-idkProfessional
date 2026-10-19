import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../lib/app.js";
import { createMetaSender, META_PIXEL_ID } from "../lib/meta-capi.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const realFetch = globalThis.fetch;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const ID = "idk-teste-0000000000000001";
const metaOk = () => ({ status: 200, body: { events_received: 1, fbtrace_id: "trace-ficticio" } });

const lead = (overrides = {}) => ({
  name: "Teste Automatizado IDK",
  email: " TESTE@IDK.EXAMPLE.INVALID ",
  whatsapp: "(11) 90000-0000",
  company: "Empresa Teste",
  cep: "01310-100",
  plan: "core",
  budget: "ate_de_3",
  segment: "juridico",
  submissionId: ID,
  meta: { event_id: ID, nicho: "advocacia", fbp: "fb.1.111.offline", fbc: "fb.1.111.clique" },
  ...overrides
});

const setup = async (t, { token = "TOKEN_FICTICIO_OFFLINE", testEventCode, hubspot = () => 200, meta = metaOk } = {}) => {
  const calls = { hubspot: [], meta: [] };
  const logs = [];
  t.mock.method(console, "log", (...args) => logs.push(args.join(" ")));
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith("http://127.0.0.1")) return realFetch(url, options);
    if (target.startsWith("https://api.hsforms.com/")) {
      calls.hubspot.push(JSON.parse(options.body));
      return new Response("", { status: await hubspot(calls.hubspot.length) });
    }
    if (target.startsWith("https://graph.facebook.com/")) {
      calls.meta.push({ url: target, headers: options.headers, body: JSON.parse(options.body) });
      const result = await meta(calls.meta.length);
      if (result.throws) throw result.throws;
      return new Response(JSON.stringify(result.body ?? {}), { status: result.status });
    }
    throw new Error(`fetch inesperado: ${target}`);
  };
  const sender = createMetaSender({ token, testEventCode, delays: [5, 5] });
  const pending = [];
  const server = createApp({ root, meta: { enabled: sender.enabled, send: (event) => pending.push(sender.send(event)) } }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = realFetch;
  });
  const settle = () => Promise.all(pending);
  const post = (body) => realFetch(`${base}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "IDK-Teste/1.0" },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
  return { calls, logs, settle, post, base };
};

test("cadastro de Advocacia chega ao HubSpot e gera Lead CAPI com o mesmo ID e dados normalizados", async (t) => {
  const env = await setup(t);
  const before = Math.floor(Date.now() / 1000);
  const response = await env.post(lead());
  assert.deepEqual(response, { status: 200, body: { success: true, eventId: ID } });
  assert.equal(env.calls.hubspot.length, 1);
  await env.settle();
  assert.equal(env.calls.meta.length, 1);
  const { url, headers, body } = env.calls.meta[0];
  assert.equal(url, `https://graph.facebook.com/v26.0/${META_PIXEL_ID}/events`);
  assert.equal(headers.Authorization, "Bearer TOKEN_FICTICIO_OFFLINE");
  assert.equal("test_event_code" in body, false);
  assert.equal("access_token" in body, false);
  const [event] = body.data;
  assert.equal(event.event_name, "Lead");
  assert.equal(event.event_id, ID);
  assert.equal(event.action_source, "website");
  assert.equal(event.event_source_url, "https://oferta.idkbrasil.com/adv/");
  assert.deepEqual(event.custom_data, { content_name: "Solicitação de proposta IDK Professionals", content_category: "advocacia" });
  assert.ok(event.event_time >= before && event.event_time <= Math.floor(Date.now() / 1000));
  assert.deepEqual(event.user_data.em, [sha("teste@idk.example.invalid")]);
  assert.deepEqual(event.user_data.ph, [sha("5511900000000")]);
  assert.equal(event.user_data.fbp, "fb.1.111.offline");
  assert.equal(event.user_data.fbc, "fb.1.111.clique");
  assert.equal(event.user_data.client_user_agent, "IDK-Teste/1.0");
  assert.equal(event.user_data.client_ip_address, "127.0.0.1");
});

test("Odontologia usa URL canônica e categoria próprias e não inventa cookies ausentes", async (t) => {
  const env = await setup(t);
  await env.post(lead({ segment: "odontologico", meta: { event_id: ID, nicho: "odontologia" } }));
  await env.settle();
  const [event] = env.calls.meta[0].body.data;
  assert.equal(event.event_source_url, "https://oferta.idkbrasil.com/odonto/");
  assert.equal(event.custom_data.content_category, "odontologia");
  assert.equal("fbp" in event.user_data, false);
  assert.equal("fbc" in event.user_data, false);
});

test("test_event_code entra no corpo apenas quando configurado no servidor", async (t) => {
  const env = await setup(t, { testEventCode: "TEST_OFFLINE" });
  await env.post(lead());
  await env.settle();
  assert.equal(env.calls.meta[0].body.test_event_code, "TEST_OFFLINE");
});

test("cadastro inválido não chega ao HubSpot e não gera Lead", async (t) => {
  const env = await setup(t);
  for (const invalido of [{ email: "invalido" }, { whatsapp: "123" }, { segment: "utrax" }, { cep: "" }]) {
    const response = await env.post(lead(invalido));
    assert.deepEqual(response, { status: 400, body: { success: false, error: "invalid_lead" } });
  }
  await env.settle();
  assert.equal(env.calls.hubspot.length, 0);
  assert.equal(env.calls.meta.length, 0);
});

test("falha do destino comercial devolve erro sem Lead e a nova tentativa reutiliza o ID", async (t) => {
  const env = await setup(t, { hubspot: (call) => (call === 1 ? 500 : 200) });
  assert.deepEqual(await env.post(lead()), { status: 502, body: { success: false, error: "hubspot_unavailable" } });
  await env.settle();
  assert.equal(env.calls.meta.length, 0);
  assert.deepEqual(await env.post(lead()), { status: 200, body: { success: true, eventId: ID } });
  await env.settle();
  assert.equal(env.calls.hubspot.length, 2);
  assert.equal(env.calls.meta.length, 1);
  assert.equal(env.calls.meta[0].body.data[0].event_id, ID);
});

test("Meta indisponível não afeta o cadastro e as novas tentativas mantêm o mesmo evento", async (t) => {
  const env = await setup(t, {
    meta: (call) => [
      { throws: new TypeError("fetch failed") },
      { status: 500, body: { error: { code: 2, is_transient: true, fbtrace_id: "trace-erro" } } },
      metaOk()
    ][call - 1]
  });
  assert.deepEqual(await env.post(lead()), { status: 200, body: { success: true, eventId: ID } });
  await env.settle();
  assert.equal(env.calls.meta.length, 3);
  const eventos = env.calls.meta.map((call) => call.body.data[0]);
  for (const evento of eventos) assert.deepEqual(evento, eventos[0]);
  assert.ok(env.logs.some((line) => line.includes("meta_capi enviado") && line.includes("tentativa=3")));
});

test("erro definitivo da Meta não gera nova tentativa e fica visível no log", async (t) => {
  const env = await setup(t, { meta: () => ({ status: 400, body: { error: { code: 100, error_subcode: 2804003, fbtrace_id: "trace-def" } } }) });
  await env.post(lead());
  await env.settle();
  assert.equal(env.calls.meta.length, 1);
  assert.ok(env.logs.some((line) => line.includes("falha definitiva") && line.includes("code=100") && line.includes("fbtrace_id=trace-def")));
});

test("erros temporários param após três tentativas e o evento é descartado", async (t) => {
  const env = await setup(t, { meta: () => ({ status: 503, body: {} }) });
  await env.post(lead());
  await env.settle();
  assert.equal(env.calls.meta.length, 3);
  assert.ok(env.logs.some((line) => line.includes("falha definitiva") && line.includes("tentativa=3")));
});

test("sem token, sem contexto de mensuração ou com nicho divergente o cadastro segue sem CAPI", async (t) => {
  await t.test("sem token", async (t2) => {
    const env = await setup(t2, { token: "" });
    assert.deepEqual(await env.post(lead()), { status: 200, body: { success: true, eventId: ID } });
    await env.settle();
    assert.equal(env.calls.hubspot.length, 1);
    assert.equal(env.calls.meta.length, 0);
  });
  await t.test("Pixel bloqueado", async (t2) => {
    const env = await setup(t2);
    assert.deepEqual(await env.post(lead({ meta: undefined })), { status: 200, body: { success: true, eventId: ID } });
    await env.settle();
    assert.equal(env.calls.hubspot.length, 1);
    assert.equal(env.calls.meta.length, 0);
  });
  await t.test("nicho divergente da LP", async (t2) => {
    const env = await setup(t2);
    await env.post(lead({ meta: { event_id: ID, nicho: "odontologia" } }));
    await env.settle();
    assert.equal(env.calls.meta.length, 0);
  });
});

test("sem ID do navegador o servidor gera um ID próprio e o usa no evento", async (t) => {
  const env = await setup(t);
  const response = await env.post(lead({ submissionId: undefined }));
  assert.match(response.body.eventId, /^[0-9a-f-]{36}$/);
  await env.settle();
  assert.equal(env.calls.meta[0].body.data[0].event_id, response.body.eventId);
});

test("logs do envio não expõem token, e-mail ou telefone", async (t) => {
  const env = await setup(t, { meta: (call) => (call === 1 ? { status: 500, body: { error: { code: 1 } } } : metaOk()) });
  await env.post(lead());
  await env.settle();
  const linhas = env.logs.filter((line) => line.startsWith("meta_capi"));
  assert.ok(linhas.length >= 2);
  for (const linha of linhas) {
    for (const segredo of ["TOKEN_FICTICIO_OFFLINE", "idk.example.invalid", "900000000", "Teste Automatizado"]) {
      assert.equal(linha.includes(segredo), false, linha);
    }
  }
});

test("rotas estáticas continuam servindo as duas LPs e a raiz", async (t) => {
  const env = await setup(t);
  for (const [path, segment] of [["/adv/", "juridico"], ["/odonto/", "odontologico"]]) {
    const html = await realFetch(`${env.base}${path}`).then((response) => response.text());
    assert.ok(html.includes(`name="segment" value="${segment}"`));
    assert.ok(html.includes('<script src="../assets/js/meta-pixel.js"></script>'));
  }
  const redirect = await realFetch(`${env.base}/adv`, { redirect: "manual" });
  assert.equal(redirect.status, 301);
  assert.equal((await realFetch(`${env.base}/`)).status, 200);
  assert.equal((await realFetch(`${env.base}/data/leads.json`)).status, 404);
  assert.equal((await realFetch(`${env.base}/lib/app.js`)).status, 404);
  assert.equal(existsSync(join(root, "data")), false);
});
