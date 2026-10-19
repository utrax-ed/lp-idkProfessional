import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./lib/app.js";
import { createLeadStore } from "./lib/lead-store.js";
import { createMetaQueue } from "./lib/meta-capi.js";

const root = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;

const store = await createLeadStore(process.env.DATA_DIR || join(root, "data"));
const queue = createMetaQueue({
  store,
  token: process.env.META_CAPI_ACCESS_TOKEN,
  version: process.env.META_GRAPH_VERSION || "v26.0",
  testEventCode: process.env.META_TEST_EVENT_CODE
});

createApp({ root, store, queue }).listen(port, () => console.log(`LP IDK Professionals on port ${port}`));
queue.start();
