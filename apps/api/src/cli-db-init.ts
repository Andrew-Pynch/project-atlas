import { getAtlasDb } from "@atlas/db";

const db = getAtlasDb();
db.init();
console.log("project-atlas: database initialized");
