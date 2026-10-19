import { createHash } from "node:crypto";

export const META_PIXEL_ID = "4419205235001105";
const META_NICHES = {
  odontologico: { niche: "odontologia", url: "https://oferta.idkbrasil.com/odonto/" },
  juridico: { niche: "advocacia", url: "https://oferta.idkbrasil.com/adv/" }
};
const MINUTE = 60 * 1000;
const RETRY_DELAYS = [1, 5, 30, 120, 720, 1440].map((minutes) => minutes * MINUTE);
const MAX_EVENT_AGE = 7 * 24 * 60 * MINUTE - 60 * MINUTE;
const RETENTION = 7 * 24 * 60 * MINUTE;
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

export const createMetaQueue = ({ store, token, version = "v26.0", testEventCode, now = Date.now }) => {
  const config = { token, version, testEventCode };
  let chain = Promise.resolve();

  const deliver = async (record) => {
    const job = record.meta;
    const attempts = job.attempts + 1;
    try {
      const fbtraceId = await sendToMeta(job.event, config);
      record.meta = { status: "sent", attempts, sentAt: new Date(now()).toISOString(), fbtraceId };
      console.log(`meta_capi enviado id=${record.id} tentativa=${attempts} fbtrace_id=${fbtraceId ?? "-"}`);
    } catch (error) {
      const retryAt = now() + (RETRY_DELAYS[attempts - 1] ?? Infinity);
      const retry = error.transient === true && retryAt < Date.parse(record.acceptedAt) + MAX_EVENT_AGE;
      record.meta = retry
        ? { ...job, attempts, nextAttemptAt: retryAt, error: error.summary }
        : { status: "failed", attempts, error: error.summary ?? error.name };
      console.error(`meta_capi ${retry ? "reenvio agendado" : "falha definitiva"} id=${record.id} tentativa=${attempts} ${error.summary ?? error.name}`);
    }
    await store.set(record);
  };

  const processDue = async () => {
    for (const record of store.values()) {
      if (record.meta?.status === "pending") {
        if (token && record.meta.nextAttemptAt <= now()) await deliver(record);
      } else if (Date.parse(record.acceptedAt) < now() - RETENTION) {
        await store.delete(record.id);
      }
    }
  };

  const run = () => (chain = chain.then(processDue).catch((error) => console.error(`meta_capi fila: ${error.name}`)));

  return {
    enabled: Boolean(token),
    run,
    accept: async ({ event, ...record }) => {
      await store.set({ ...record, meta: event ? { status: "pending", attempts: 0, nextAttemptAt: 0, event } : null });
      if (!event) return;
      console.log(`meta_capi enfileirado id=${record.id}`);
      run();
    },
    start: (interval = 30000) => {
      if (!token) console.log("meta_capi desativada: META_CAPI_ACCESS_TOKEN ausente");
      run();
      return setInterval(run, interval).unref();
    }
  };
};
