import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAtlasDb } from "@atlas/db";

const here = fileURLToPath(new URL(".", import.meta.url));
const defaultPath = resolve(here, "../../../../PROJECT_INDEX.json");
const indexPath = process.argv[2] ? resolve(process.argv[2]) : process.env.ATLAS_PROJECT_INDEX ?? defaultPath;

const db = getAtlasDb();
const result = db.importProjectsFromIndex(indexPath);

console.log(`project-atlas: imported=${result.imported} updated=${result.updated} from ${indexPath}`);
