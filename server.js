import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./lib/app.js";
import { createMetaSender } from "./lib/meta-capi.js";

const root = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;

const meta = createMetaSender({
  token: process.env.META_CAPI_ACCESS_TOKEN,
  version: process.env.META_GRAPH_VERSION || "v26.0",
  testEventCode: process.env.META_TEST_EVENT_CODE
});

createApp({ root, meta }).listen(port, () => console.log(`LP IDK Professionals on port ${port}`));
