#!/usr/bin/env node
// Fail fast on an old Node instead of letting the server crash with a syntax
// error. Plain .mjs with no imports so it runs on any Node version.
const REQUIRED_MAJOR = 26;
const major = Number.parseInt(process.versions.node.split(".")[0], 10);

if (!Number.isFinite(major) || major < REQUIRED_MAJOR) {
  console.error(
    `TBRN Games needs Node.js ${REQUIRED_MAJOR} or newer. You are running v${process.versions.node}. ` +
      `Install Node ${REQUIRED_MAJOR} from https://nodejs.org/ and run npm start again.`,
  );
  process.exit(1);
}
