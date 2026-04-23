const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const outputPath = path.join(rootDir, "frontend", "src", "lib", "contract-config.js");

function getPreferredDeployment() {
  const deploymentsDir = path.join(rootDir, "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    return null;
  }

  const preferredNetworks = ["local", "testnet", "mainnet"];
  for (const networkName of preferredNetworks) {
    const candidate = path.join(deploymentsDir, `${networkName}.json`);
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    }
  }

  return null;
}

const deployment = getPreferredDeployment();

const fileContents = `export const experimentXConfig = ${JSON.stringify(
  {
    contractName: "ExperimentX",
    fallbackContractId: deployment?.contractId || "",
    fallbackNetwork: deployment?.network || "testnet",
    generatedAt: deployment?.deployedAt || "",
    limits: {
      allowedDurations: [7, 14, 30],
      minTitleLength: 3,
      maxTitleLength: 48
    }
  },
  null,
  2
)};\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, fileContents);

console.log(`Frontend contract config written to ${outputPath}`);
