import express from "express";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;
const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN;
const metaToken = process.env.META_CAPI_ACCESS_TOKEN;
const metaGraphVersion = process.env.META_GRAPH_VERSION || "v26.0";
const metaTestEventCode = process.env.META_TEST_EVENT_CODE;

const PORTAL_ID = "51344730";
const FORM_ID = "bd873321-1e22-4cf4-a460-41062f08d841";
const ORIGEM_LEAD = "lp-idk-professionals";
const SEGMENTS = { odontologico: "Odontológico", juridico: "Jurídico" };
const META_PIXEL_ID = "4419205235001105";
const META_NICHES = {
  odontologico: { niche: "odontologia", url: "https://oferta.idkbrasil.com/odonto/" },
  juridico: { niche: "advocacia", url: "https://oferta.idkbrasil.com/adv/" }
};
const META_RETRIES = 4;
const PLANS = ["start", "core", "premium"];
const BUDGETS = ["ate_de_3", "entre_3_e_5", "entre_5_e_10", "acima_de_10"];

const text = (value) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
const digits = (value) => String(value ?? "").replace(/\D/g, "");

const parseLead = (body) => {
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const phone = digits(body.whatsapp);
  const cep = digits(body.cep);
  const company = text(body.company);
  const { plan, segment, budget } = body;
  const valid = name
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/.test(phone)
    && cep.length === 8
    && company
    && PLANS.includes(plan)
    && Object.hasOwn(SEGMENTS, segment)
    && BUDGETS.includes(budget);
  if (!valid) return null;
  const [firstname, lastname = ""] = name.split(/ (.*)/);
  return {
    firstname,
    lastname,
    email,
    phone: `+55${phone}`,
    company,
    cep: `${cep.slice(0, 5)}-${cep.slice(5)}`,
    plan,
    segment,
    budget
  };
};

const toHubspotFields = (lead) => [
  ["0-1", "firstname", lead.firstname],
  ["0-1", "lastname", lead.lastname],
  ["0-1", "email", lead.email],
  ["0-1", "phone", lead.phone],
  ["0-1", "origem_lead", ORIGEM_LEAD],
  ["0-1", "origem_detalhada", SEGMENTS[lead.segment]],
  ["0-2", "name", lead.company],
  ["0-2", "phone", lead.phone],
  ["0-2", "segmento", lead.segment],
  ["0-2", "zip", lead.cep],
  ["0-2", "plano_idk_professionals_de_interesse", lead.plan],
  ["0-2", "orcamento_mensal_de_midia", lead.budget]
]
  .filter(([, , value]) => value)
  .map(([objectTypeId, name, value]) => ({ objectTypeId, name, value }));

const toHubspotContext = (body, ip) => {
  const context = { pageUri: text(body.pageUri), pageName: text(body.pageName) };
  if (/^[0-9a-f]{32}$/i.test(body.hutk ?? "")) context.hutk = body.hutk;
  const ipv4 = ip?.replace(/^::ffff:/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4 ?? "")) context.ipAddress = ipv4;
  return context;
};

const submitToHubspot = async (fields, context) => {
  const response = await fetch(`https://api.hsforms.com/submissions/v3/integration/submit/${PORTAL_ID}/${FORM_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, context })
  });
  if (!response.ok) throw new Error(`HubSpot form ${response.status}: ${await response.text()}`);
};

const updateContactPhone = async (lead, attempt = 1) => {
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(lead.email)}?idProperty=email`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${hubspotToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { phone: lead.phone } })
  });
  if (response.status === 404 && attempt < 5) {
    setTimeout(() => updateContactPhone(lead, attempt + 1).catch(console.error), attempt * 5000);
    return;
  }
  if (!response.ok) throw new Error(`HubSpot contact ${response.status}: ${await response.text()}`);
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isMetaCookie = (value) => typeof value === "string" && /^fb\.[\w.-]{1,500}$/.test(value);

const toMetaLead = (lead, meta, ip, userAgent) => {
  if (typeof meta?.event_id !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(meta.event_id) || !userAgent) return null;
  const { niche, url } = META_NICHES[lead.segment];
  const userData = {
    em: [sha256(lead.email)],
    ph: [sha256(digits(lead.phone))],
    client_user_agent: userAgent
  };
  if (ip) userData.client_ip_address = ip;
  if (isMetaCookie(meta.fbp)) userData.fbp = meta.fbp;
  if (isMetaCookie(meta.fbc)) userData.fbc = meta.fbc;
  return {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_id: meta.event_id,
    action_source: "website",
    event_source_url: url,
    user_data: userData,
    custom_data: { content_name: "Solicitação de proposta IDK Professionals", content_category: niche }
  };
};

const submitToMeta = async (event) => {
  const payload = { data: [event] };
  if (metaTestEventCode) payload.test_event_code = metaTestEventCode;
  const response = await fetch(`https://graph.facebook.com/${metaGraphVersion}/${META_PIXEL_ID}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${metaToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.events_received !== 1) {
    throw new Error(`Meta CAPI ${result.error?.code ?? response.status}: ${result.error?.message ?? "evento não confirmado"}`);
  }
};

const sendLeadToMeta = (event, attempt = 1) => submitToMeta(event)
  .then(() => console.log(`Lead enviado à Meta: ${event.event_id} | nicho: ${event.custom_data.content_category}`))
  .catch((error) => {
    if (attempt >= META_RETRIES) return console.error(error);
    setTimeout(() => sendLeadToMeta(event, attempt + 1), attempt * 10000);
  });

const app = express();
app.set("trust proxy", true);

app.post("/api/leads", express.json({ limit: "10kb" }), async (req, res) => {
  const body = req.body ?? {};
  const lead = parseLead(body);
  if (!lead) return res.status(400).json({ success: false, error: "invalid_lead" });
  try {
    await submitToHubspot(toHubspotFields(lead), toHubspotContext(body, req.ip));
  } catch (error) {
    console.error(error);
    return res.status(502).json({ success: false, error: "hubspot_unavailable" });
  }
  console.log(`Lead enviado ao HubSpot: ${lead.email} | empresa: ${lead.company} | contato: ${lead.firstname} ${lead.lastname}`);
  if (hubspotToken) setTimeout(() => updateContactPhone(lead).catch(console.error), 5000);
  const metaLead = toMetaLead(lead, body.meta, req.ip?.replace(/^::ffff:/, ""), req.get("user-agent"));
  if (metaLead && metaToken) sendLeadToMeta(metaLead);
  res.json({ success: true, eventId: metaLead?.event_id });
});

app.use("/assets", express.static(join(root, "assets")));
app.use("/odonto", express.static(join(root, "odonto")));
app.use("/adv", express.static(join(root, "adv")));
app.get("/", (req, res) => res.sendFile(join(root, "index.html")));

app.listen(port, () => console.log(`LP IDK Professionals on port ${port}`));
