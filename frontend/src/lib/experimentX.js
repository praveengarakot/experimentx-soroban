import {
  getAddress,
  getNetworkDetails,
  isConnected,
  setAllowed,
  signTransaction
} from "@stellar/freighter-api";
import { experimentXConfig } from "./contract-config.js";

export const EXPERIMENT_STATUS = {
  active: 0,
  succeeded: 1,
  failed: 2
};

const networkLabels = {
  "Public Global Stellar Network ; September 2015": "Stellar Mainnet",
  "Test SDF Network ; September 2015": "Stellar Testnet",
  standalone: "Stellar Local"
};

const eventLabels = {
  profile_saved: "Profile saved",
  experiment_created: "Experiment launched",
  compliance_logged: "Daily check-in logged",
  experiment_succeeded: "Experiment succeeded",
  experiment_failed: "Experiment failed"
};

export const configuredContractId =
  import.meta.env.VITE_CONTRACT_ID || experimentXConfig.fallbackContractId || "";
export const configuredNetworkPassphrase =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
export const configuredRpcUrl =
  import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
export const contractLimits = experimentXConfig.limits;

let stellarSdkPromise;

async function loadStellarSdk() {
  if (!stellarSdkPromise) {
    stellarSdkPromise = import("@stellar/stellar-sdk");
  }

  return stellarSdkPromise;
}

function normalizeDashboard(dashboard) {
  return {
    displayName: dashboard.display_name,
    activeExperiments: Number(dashboard.active_experiments),
    completedExperiments: Number(dashboard.completed_experiments),
    successfulExperiments: Number(dashboard.successful_experiments),
    failedExperiments: Number(dashboard.failed_experiments),
    totalExperiments: Number(dashboard.total_experiments),
    totalCheckIns: Number(dashboard.total_check_ins),
    currentStreak: Number(dashboard.current_streak),
    createdAt: Number(dashboard.created_at)
  };
}

function normalizeGlobalStats(stats) {
  return {
    experimenterCount: Number(stats.experimenter_count || 0),
    totalExperiments: Number(stats.total_experiments || 0),
    activeExperiments: Number(stats.active_experiments || 0),
    completedExperiments: Number(stats.completed_experiments || 0),
    successfulExperiments: Number(stats.successful_experiments || 0),
    failedExperiments: Number(stats.failed_experiments || 0),
    totalCheckIns: Number(stats.total_check_ins || 0),
    latestActivityAt: Number(stats.latest_activity_at || 0)
  };
}

function normalizeExperiment(index, experiment) {
  const durationDays = Number(experiment.duration_days || 0);
  const startDay = Number(experiment.start_day || 0);
  const compliantDays = Number(experiment.compliant_days || 0);
  const missedDays = Number(experiment.missed_days || 0);

  return {
    id: Number(experiment.id ?? index),
    title: experiment.title,
    durationDays,
    startDay,
    endDay: startDay + durationDays - 1,
    lastCheckInDay: Number(experiment.last_check_in_day || 0),
    compliantDays,
    missedDays,
    checkInCount: Number(experiment.check_in_count || 0),
    status: Number(experiment.status || 0),
    completedAt: Number(experiment.completed_at || 0),
    complianceRate: durationDays ? Math.round((compliantDays / durationDays) * 100) : 0
  };
}

function normalizeLog(index, log) {
  return {
    id: `${index}-${log.timestamp}`,
    experimentId: Number(log.experiment_id),
    dayNumber: Number(log.day_number),
    compliant: Number(log.compliant) === 1,
    timestamp: Number(log.timestamp),
    streakAfterLog: Number(log.streak_after_log)
  };
}

async function buildClient(account = "") {
  if (!hasContractConfig()) {
    throw new Error(
      "No ExperimentX contract ID is configured yet. Deploy the Soroban contract, then run `npm run export:frontend`."
    );
  }

  const { contract: StellarContract } = await loadStellarSdk();

  return StellarContract.Client.from({
    contractId: configuredContractId,
    rpcUrl: configuredRpcUrl,
    networkPassphrase: configuredNetworkPassphrase,
    publicKey: account || undefined,
    signTransaction
  });
}

async function buildRpcServer() {
  const { rpc } = await loadStellarSdk();
  return new rpc.Server(configuredRpcUrl);
}

function serializeEventValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeEventValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeEventValue(entry)])
    );
  }

  return value;
}

async function scValToDisplay(value) {
  const { scValToNative } = await loadStellarSdk();
  return serializeEventValue(scValToNative(value));
}

function eventSummary(topics, payload) {
  const headline = topics[0] || "contract_event";
  const label = eventLabels[headline] || headline.replaceAll("_", " ");

  if (!payload || typeof payload !== "object") {
    return label;
  }

  if (payload.display_name) {
    return `${label}: ${payload.display_name}`;
  }

  if (payload.title) {
    return `${label}: ${payload.title}`;
  }

  if (payload.experiment_id !== undefined) {
    if (payload.compliant === true || Number(payload.compliant) === 1) {
      return `${label}: experiment #${payload.experiment_id} marked compliant`;
    }

    if (payload.compliant === false || Number(payload.compliant) === 0) {
      return `${label}: experiment #${payload.experiment_id} marked missed`;
    }

    return `${label}: experiment #${payload.experiment_id}`;
  }

  return label;
}

async function normalizeEvent(event) {
  const topics = await Promise.all(
    (event.topic || []).map(async (entry) => {
      const value = await scValToDisplay(entry);
      return typeof value === "string" ? value : JSON.stringify(value);
    })
  );
  const payload = await scValToDisplay(event.value);

  return {
    id: event.id,
    txHash: event.txHash,
    ledger: Number(event.ledger),
    closedAt: event.ledgerClosedAt,
    topics,
    summary: eventSummary(topics, payload),
    payload
  };
}

async function getWalletSnapshot() {
  const [addressResult, networkResult] = await Promise.all([getAddress(), getNetworkDetails()]);

  if (addressResult.error) {
    throw new Error(addressResult.error.message);
  }

  if (networkResult.error) {
    throw new Error(networkResult.error.message);
  }

  return {
    account: addressResult.address,
    network: networkResult.network,
    networkPassphrase: networkResult.networkPassphrase,
    rpcUrl: networkResult.sorobanRpcUrl || configuredRpcUrl
  };
}

export function hasContractConfig() {
  return Boolean(configuredContractId);
}

export function getNetworkLabel(networkPassphrase) {
  return networkLabels[networkPassphrase] || "Custom Stellar Network";
}

export function shortAddress(value = "") {
  if (!value) {
    return "Not connected";
  }

  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

export function formatDayCount(days) {
  const value = Number(days || 0);
  return `${value} day${value === 1 ? "" : "s"}`;
}

export function formatPercent(value) {
  const percent = Number(value || 0);
  return `${Math.max(0, Math.min(100, percent))}%`;
}

export function statusLabel(status) {
  if (status === EXPERIMENT_STATUS.succeeded) {
    return "Succeeded";
  }

  if (status === EXPERIMENT_STATUS.failed) {
    return "Failed";
  }

  return "Active";
}

export function formatDate(unixSeconds) {
  if (!unixSeconds) {
    return "No check-ins logged yet";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(Number(unixSeconds) * 1000));
}

export function formatDateTime(value) {
  if (!value) {
    return "No activity yet";
  }

  const source =
    typeof value === "string" && value.includes("T")
      ? new Date(value)
      : new Date(Number(value) * 1000);

  if (Number.isNaN(source.getTime())) {
    return "No activity yet";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(source);
}

export function getExplorerLink(networkPassphrase, hash) {
  if (!hash) {
    return "";
  }

  if (networkPassphrase === "Test SDF Network ; September 2015") {
    return `https://stellar.expert/explorer/testnet/tx/${hash}`;
  }

  if (networkPassphrase === "Public Global Stellar Network ; September 2015") {
    return `https://stellar.expert/explorer/public/tx/${hash}`;
  }

  return "";
}

export function getContractExplorerLink(networkPassphrase, contractId) {
  if (!contractId) {
    return "";
  }

  if (networkPassphrase === "Test SDF Network ; September 2015") {
    return `https://lab.stellar.org/r/testnet/contract/${contractId}`;
  }

  if (networkPassphrase === "Public Global Stellar Network ; September 2015") {
    return `https://lab.stellar.org/r/mainnet/contract/${contractId}`;
  }

  return "";
}

export function parseError(error) {
  const candidates = [
    error?.message,
    error?.error?.message,
    error?.response?.data?.detail,
    error?.toString?.()
  ].filter(Boolean);

  return candidates[0] || "Something unexpected happened.";
}

export async function discoverWalletState() {
  const connection = await isConnected();
  if (connection.error || !connection.isConnected) {
    return {
      account: "",
      network: "",
      networkPassphrase: "",
      rpcUrl: configuredRpcUrl
    };
  }

  return getWalletSnapshot();
}

export async function connectWallet() {
  const permission = await setAllowed();
  if (permission.error) {
    throw new Error(permission.error.message);
  }

  if (!permission.isAllowed) {
    throw new Error("Freighter did not grant access to this app.");
  }

  return getWalletSnapshot();
}

export async function readDashboard(account) {
  const client = await buildClient();
  const hasProfileTx = await client.has_profile({ experimenter: account });

  if (!hasProfileTx.result) {
    return null;
  }

  const dashboardTx = await client.get_dashboard({ experimenter: account });
  return normalizeDashboard(dashboardTx.result);
}

export async function readGlobalStats() {
  const client = await buildClient();
  const statsTx = await client.get_global_stats();
  return normalizeGlobalStats(statsTx.result);
}

export async function readExperiments(account) {
  const client = await buildClient();
  const countTx = await client.get_experiment_count({ experimenter: account });
  const count = Number(countTx.result || 0);

  if (!count) {
    return [];
  }

  const indexes = Array.from({ length: count }, (_, idx) => count - idx - 1);
  const experimentResults = await Promise.all(
    indexes.map(async (index) => {
      const experimentTx = await client.get_experiment({ experimenter: account, index });
      return normalizeExperiment(index, experimentTx.result);
    })
  );

  return experimentResults;
}

export async function readRecentLogs(account, limit = 5) {
  const events = await readContractEvents(30);
  return events
    .filter(
      (event) =>
        event.topics[0] === "compliance_logged" &&
        event.topics.some((topic) => topic === account)
    )
    .slice(0, limit)
    .map((event, index) =>
      normalizeLog(index, {
        experiment_id: event.topics[2] || event.payload?.experiment_id || 0,
        day_number: event.payload?.day_number || 0,
        compliant: event.payload?.compliant || 0,
        timestamp: Math.floor(new Date(event.closedAt).getTime() / 1000),
        streak_after_log: event.payload?.current_streak || 0
      })
    );
}

export async function readContractEvents(limit = 6) {
  if (!hasContractConfig()) {
    return [];
  }

  const server = await buildRpcServer();
  const latestLedger = await server.getLatestLedger();
  const latestSequence = Number(latestLedger.sequence || 0);
  const startLedger = Math.max(latestSequence - 5_000, 1);

  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [configuredContractId]
      }
    ],
    limit
  });

  return Promise.all(response.events.slice().reverse().map(normalizeEvent));
}

async function submitTransaction(assembledTx) {
  const sentTx = await assembledTx.signAndSend();
  return {
    hash: sentTx.sendTransactionResponse?.hash || sentTx.getTransactionResponse?.txHash || "",
    result: sentTx.result
  };
}

export async function saveProfile(account, displayName) {
  const client = await buildClient(account);
  const tx = await client.save_profile({
    experimenter: account,
    display_name: displayName
  });

  return submitTransaction(tx);
}

export async function createExperiment(account, title, durationDays) {
  const client = await buildClient(account);
  const tx = await client.create_experiment({
    experimenter: account,
    title,
    duration_days: Number(durationDays)
  });

  return submitTransaction(tx);
}

export async function logCompliance(account, experimentId, compliant) {
  const client = await buildClient(account);
  const tx = await client.log_compliance({
    experimenter: account,
    experiment_id: Number(experimentId),
    compliant: compliant ? 1 : 0
  });

  return submitTransaction(tx);
}

export async function finalizeExperiment(account, experimentId) {
  const client = await buildClient(account);
  const tx = await client.finalize_experiment({
    experimenter: account,
    experiment_id: Number(experimentId)
  });

  return submitTransaction(tx);
}

export function disconnectWallet() {
  return {
    account: "",
    network: "",
    networkPassphrase: "",
    rpcUrl: configuredRpcUrl,
    isConnecting: false,
    error: ""
  };
}

export async function fetchXlmBalance(account) {
  if (!account) return "0.00";
  try {
    const { Horizon } = await loadStellarSdk();
    const server = new Horizon.Server("https://horizon-testnet.stellar.org");
    const acct = await server.loadAccount(account);
    const native = acct.balances.find((b) => b.asset_type === "native");
    if (!native) return "0.00";
    return parseFloat(native.balance).toFixed(2);
  } catch (error) {
    console.error("fetchXlmBalance error:", error);
    return "0.00";
  }
}

export async function sendXlmTransaction(account, destination, amount) {
  const { Horizon, TransactionBuilder, Operation, Asset, Networks } = await loadStellarSdk();
  const server = new Horizon.Server("https://horizon-testnet.stellar.org");
  const sourceAccount = await server.loadAccount(account);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: String(amount)
      })
    )
    .setTimeout(30)
    .build();

  const signedTxResponse = await signTransaction(tx.toXDR(), {
    network: "TESTNET",
    networkPassphrase: Networks.TESTNET
  });
  
  if (signedTxResponse.error) {
      throw new Error(signedTxResponse.error);
  }

  const { TransactionBuilder: TB2 } = await loadStellarSdk();
  const assembledTx = TB2.fromXDR(signedTxResponse, Networks.TESTNET);

  const sentTx = await server.submitTransaction(assembledTx);
  return {
    hash: sentTx.hash,
    result: sentTx
  };
}
