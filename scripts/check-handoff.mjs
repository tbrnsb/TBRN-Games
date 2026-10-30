#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

let changedFiles;

try {
  git(["rev-parse", "--verify", "HEAD^"]);
  changedFiles = git(["diff", "--name-only", "HEAD^", "HEAD"]);
} catch {
  changedFiles = git(["ls-tree", "--name-only", "-r", "HEAD"]);
}

const files = changedFiles
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replace(/\\/g, "/"));

if (!files.includes("HANDOFF.md")) {
  console.error("Push check failed: the latest commit must update HANDOFF.md.");
  process.exit(1);
}

console.log("Push check passed: the latest commit updates HANDOFF.md.");
