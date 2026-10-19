import express from "express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { toMetaLead } from "./meta-capi.js";

const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN;

const PORTAL_ID = "51344730";
const FORM_ID = "bd873321-1e22-4cf4-a460-41062f08d841";
const ORIGEM_LEAD = "lp-idk-professionals";
const SEGMENTS = { odontologico: "Odontológico", juridico: "Jurídico" };
const PLANS = ["start", "core", "premium"];
const BUDGETS = ["ate_de_3", "entre_3_e_5", "entre_5_e_10", "acima_de_10"];
const SUBMISSION_ID = /^[a-zA-Z0-9_-]{16,128}$/;

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

export const createApp = ({ root, store, queue }) => {
  const inflight = new Map();

  const register = async (id, lead, body, req) => {
    const acceptedAt = new Date();
    const event = queue.enabled && toMetaLead({
      id,
      lead,
      meta: body.meta,
      acceptedAt,
      ip: req.ip?.replace(/^::ffff:/, ""),
      userAgent: req.get("user-agent")
    });
    await queue.accept({ id, segment: lead.segment, acceptedAt: acceptedAt.toISOString(), event });
  };

  const acceptLead = async (id, lead, body, req) => {
    await submitToHubspot(toHubspotFields(lead), toHubspotContext(body, req.ip));
    console.log(`Lead enviado ao HubSpot: ${lead.email} | empresa: ${lead.company} | contato: ${lead.firstname} ${lead.lastname}`);
    if (hubspotToken) setTimeout(() => updateContactPhone(lead).catch(console.error), 5000);
    await register(id, lead, body, req).catch((error) => console.error(`lead_registro falhou id=${id}: ${error.name}`));
  };

  const app = express();
  app.set("trust proxy", true);

  app.post("/api/leads", express.json({ limit: "10kb" }), async (req, res) => {
    const body = req.body ?? {};
    const lead = parseLead(body);
    if (!lead) return res.status(400).json({ success: false, error: "invalid_lead" });
    const id = typeof body.submissionId === "string" && SUBMISSION_ID.test(body.submissionId) ? body.submissionId : randomUUID();
    if (!store.get(id) && !inflight.has(id)) {
      inflight.set(id, acceptLead(id, lead, body, req).finally(() => inflight.delete(id)));
    }
    try {
      await inflight.get(id);
    } catch (error) {
      console.error(error);
      return res.status(502).json({ success: false, error: "hubspot_unavailable" });
    }
    res.json({ success: true, eventId: id });
  });

  app.use("/assets", express.static(join(root, "assets")));
  app.use("/odonto", express.static(join(root, "odonto")));
  app.use("/adv", express.static(join(root, "adv")));
  app.get("/", (req, res) => res.sendFile(join(root, "index.html")));

  return app;
};
