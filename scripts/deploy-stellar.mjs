import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const network = process.env.STELLAR_NETWORK || "testnet";
const sourceAccount = process.env.STELLAR_ACCOUNT;
const alias = process.env.STELLAR_CONTRACT_ALIAS || "experiment_x";
const wasmPath = path.join(
  rootDir,
  "target",
  "wasm32v1-none",
  "release",
  "experiment_x.wasm"
);

if (!sourceAccount) {
  console.error("Missing STELLAR_ACCOUNT in .env. Use a Stellar CLI identity like `alice`.");
  process.exit(1);
}

if (!fs.existsSync(wasmPath)) {
  console.error("Contract wasm not found. Run `npm run contract:build` first.");
  process.exit(1);
}

const args = [
  "contract",
  "deploy",
  "--wasm",
  wasmPath,
  "--source-account",
  sourceAccount,
  "--network",
  network,
  "--alias",
  alias
];

const output = execFileSync("stellar", args, {
  cwd: rootDir,
  encoding: "utf8"
}).trim();

const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const contractId = lines[lines.length - 1];

if (!contractId.startsWith("C")) {
  console.error(output);
  throw new Error("Could not parse contract id from Stellar CLI output.");
}

const deploymentsDir = path.join(rootDir, "deployments");
fs.mkdirSync(deploymentsDir, { recursive: true });

const deploymentRecord = {
  contractName: "ExperimentX",
  contractId,
  network,
  sourceAccount,
  alias,
  deployedAt: new Date().toISOString()
};

fs.writeFileSync(
  path.join(deploymentsDir, `${network}.json`),
  JSON.stringify(deploymentRecord, null, 2)
);

console.log(`ExperimentX deployed to ${contractId} on ${network}`);
