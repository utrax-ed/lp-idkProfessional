import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const load = async (file) => {
  try {
    return Object.entries(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    console.error(`lead_store leitura falhou: ${error.code ?? error.name}`);
    await rename(file, `${file}.invalido-${Date.now()}`).catch(() => {});
    return [];
  }
};

export const createLeadStore = async (dir) => {
  const file = join(dir, "leads.json");
  await mkdir(dir, { recursive: true }).catch((error) => console.error(`lead_store diretório indisponível: ${error.code}`));
  const records = new Map(await load(file));
  let writing = Promise.resolve();

  const flush = () => {
    const snapshot = JSON.stringify(Object.fromEntries(records));
    writing = writing.then(async () => {
      await writeFile(`${file}.tmp`, snapshot);
      await rename(`${file}.tmp`, file);
    }).catch((error) => console.error(`lead_store gravação falhou: ${error.code ?? error.name}`));
    return writing;
  };

  return {
    get: (id) => records.get(id),
    values: () => [...records.values()],
    set: (record) => {
      records.set(record.id, record);
      return flush();
    },
    delete: (id) => {
      records.delete(id);
      return flush();
    }
  };
};
