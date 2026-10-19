import { createHash } from "node:crypto";

export const META_PIXEL_ID = "4419205235001105";
const META_NICHES = {
  odontologico: { niche: "odontologia", url: "https://oferta.idkbrasil.com/odonto/" },
  juridico: { niche: "advocacia", url: "https://oferta.idkbrasil.com/adv/" }
};
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isMetaCookie = (value) => typeof value === "string" && /^fb\.[\w.-]{1,500}$/.test(value);

export const toMetaLead = ({ id, lead, meta, acceptedAt, ip, userAgent }) => {
  const target = META_NICHES[lead.segment];
  if (!target || meta?.nicho !== target.niche || !userAgent) return null;
  const userData = {
    em: [sha256(lead.email)],
    ph: [sha256(lead.phone.replace(/\D/g, ""))],
    client_user_agent: userAgent
  };
  if (ip) userData.client_ip_address = ip;
  if (isMetaCookie(meta.fbp)) userData.fbp = meta.fbp;
  if (isMetaCookie(meta.fbc)) userData.fbc = meta.fbc;
  return {
    event_name: "Lead",
    event_time: Math.floor(acceptedAt.getTime() / 1000),
    event_id: id,
    action_source: "website",
    event_source_url: target.url,
    user_data: userData,
    custom_data: { content_name: "Solicitação de proposta IDK Professionals", content_category: target.niche }
  };
};

const failure = (transient, summary) => Object.assign(new Error(`Meta CAPI ${summary}`), { transient, summary });

const sendToMeta = async (event, { token, version, testEventCode }) => {
  const payload = { data: [event] };
  if (testEventCode) payload.test_event_code = testEventCode;
  let response;
  try {
    response = await fetch(`https://graph.facebook.com/${version}/${META_PIXEL_ID}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    throw failure(true, `rede=${error.name}`);
  }
  const result = await response.json().catch(() => ({}));
  if (response.ok && result.events_received === 1) return result.fbtrace_id;
  const { code, error_subcode: subcode, is_transient: isTransient, fbtrace_id: trace } = result.error ?? {};
  const transient = isTransient === true || response.status === 429 || response.status >= 500 || TRANSIENT_CODES.has(code);
  throw failure(transient, `http=${response.status} code=${code ?? "-"} subcode=${subcode ?? "-"} fbtrace_id=${trace ?? "-"}`);
};

export const createMetaSender = ({ token, version = "v26.0", testEventCode, delays = [1000, 5000] }) => {
  const config = { token, version, testEventCode };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const send = async (event, attempt = 1) => {
    try {
      const fbtraceId = await sendToMeta(event, config);
      console.log(`meta_capi enviado id=${event.event_id} tentativa=${attempt} fbtrace_id=${fbtraceId ?? "-"}`);
    } catch (error) {
      const delay = error.transient === true ? delays[attempt - 1] : undefined;
      console.error(`meta_capi ${delay === undefined ? "falha definitiva" : "nova tentativa"} id=${event.event_id} tentativa=${attempt} ${error.summary ?? error.name}`);
      if (delay === undefined) return;
      await wait(delay);
      return send(event, attempt + 1);
    }
  };

  if (!token) console.log("meta_capi desativada: META_CAPI_ACCESS_TOKEN ausente");
  return { enabled: Boolean(token), send };
};
