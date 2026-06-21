import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WatchWalletChanges } from "@stellar/freighter-api";
import {
  EXPERIMENT_STATUS,
  configuredContractId,
  configuredNetworkPassphrase,
  configuredRpcUrl,
  connectWallet,
  contractLimits,
  createExperiment,
  disconnectWallet,
  discoverWalletState,
  fetchXlmBalance,
  finalizeExperiment,
  formatDate,
  formatDateTime,
  formatDayCount,
  formatPercent,
  getContractExplorerLink,
  getExplorerLink,
  getNetworkLabel,
  hasContractConfig,
  logCompliance,
  parseError,
  readContractEvents,
  readDashboard,
  readExperiments,
  readGlobalStats,
  readRecentLogs,
  saveProfile,
  sendXlmTransaction,
  shortAddress,
  statusLabel
} from "./lib/experimentX";

const DAY_IN_SECONDS = 86_400;

const emptyWallet = {
  account: "",
  network: "",
  networkPassphrase: "",
  rpcUrl: "",
  isConnecting: false,
  error: ""
};

const emptyTx = {
  status: "idle",
  message: "",
  hash: ""
};

const emptyCollection = [];

function BrandMark() {
  return (
    <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="45" fill="none" stroke="#222b3c" strokeWidth="2" />
      <circle cx="50" cy="50" r="35" fill="none" stroke="#00f0ff" strokeWidth="1" strokeDasharray="10, 5" />
      <circle cx="50" cy="50" r="15" fill="#00f0ff" filter="blur(2px)">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="50" cy="50" r="8" fill="#00f0ff" />
      <path d="M50 5 L50 15 M95 50 L85 50 M50 95 L50 85 M5 50 L15 50" stroke="#00f0ff" strokeWidth="2" />
    </svg>
  );
}

function Panel({ eyebrow, title, body, children }) {
  return (
    <section className="cyber-panel p-6 flex flex-col h-full justify-between">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="font-label-caps text-label-caps text-primary-fixed">{eyebrow}</span>
          <h2 className="font-headline-md text-headline-md uppercase tracking-tight text-primary">{title}</h2>
        </div>
        {body ? <p className="text-on-surface-variant font-body-md text-body-md mb-4">{body}</p> : null}
      </div>
      <div>
        {children}
      </div>
    </section>
  );
}

function MetricCard({ label, value, note, loading = false }) {
  return (
    <article className="cyber-panel p-4 flex flex-col justify-between min-h-[7rem]">
      <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{label}</span>
      <div className={loading ? "skeleton w-16 h-6 mt-2" : "font-data-lg text-data-lg text-primary-fixed mt-2"}>
        {loading ? "" : value}
      </div>
      <span className="text-[10px] text-surface-variant font-body-md mt-1">{loading ? "" : note}</span>
    </article>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="cyber-panel p-4 space-y-2" key={index}>
          <span className="skeleton w-1/2 h-4" />
          <span className="skeleton w-3/4 h-3" />
          <span className="skeleton w-1/4 h-3" />
        </div>
      ))}
    </div>
  );
}

function ActivityTicker({ active = false }) {
  return (
    <span className={`ticker flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant ${active ? "ticker-live" : ""}`}>
      <span className={`w-2 h-2 rounded-full ${active ? "bg-primary-fixed animate-pulse" : "bg-surface-variant"}`} />
      {active ? "Polling live" : "Idle"}
    </span>
  );
}

function progressPercent(experiment, todayDay) {
  const elapsed = Math.max(0, Math.min(todayDay - experiment.startDay + 1, experiment.durationDays));
  return Math.max(
    0,
    Math.min(100, Math.round((elapsed / Math.max(experiment.durationDays, 1)) * 100))
  );
}

function successRateFromDashboard(dashboard) {
  if (!dashboard?.completedExperiments) {
    return 0;
  }

  return Math.round((dashboard.successfulExperiments / dashboard.completedExperiments) * 100);
}

export default function App() {
  const queryClient = useQueryClient();
  const [wallet, setWallet] = useState(emptyWallet);
  const [txState, setTxState] = useState(emptyTx);
  const [profileForm, setProfileForm] = useState({ displayName: "" });
  const [experimentForm, setExperimentForm] = useState({
    title: "",
    durationDays: String(contractLimits.allowedDurations?.[1] || 14)
  });
  const [complianceForm, setComplianceForm] = useState({
    experimentId: "",
    compliant: "true"
  });
  const [sendXlmForm, setSendXlmForm] = useState({
    destination: "",
    amount: ""
  });

  useEffect(() => {
    let isMounted = true;
    let watcher = null;

    async function syncWallet() {
      try {
        const nextState = await discoverWalletState();
        if (!isMounted) {
          return;
        }

        setWallet((current) => ({
          ...current,
          ...nextState,
          isConnecting: false,
          error: ""
        }));
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setWallet((current) => ({
          ...current,
          isConnecting: false,
          error: parseError(error)
        }));
      }
    }

    syncWallet();

    if (typeof window !== "undefined") {
      watcher = new WatchWalletChanges(3000);
      watcher.watch(() => {
        setTxState(emptyTx);
        syncWallet();
      });
    }

    return () => {
      isMounted = false;
      watcher?.stop?.();
    };
  }, []);

  const wrongNetwork =
    Boolean(wallet.networkPassphrase) && wallet.networkPassphrase !== configuredNetworkPassphrase;
  const contractReady = hasContractConfig();
  const readyForReads = Boolean(wallet.account) && contractReady && !wrongNetwork;
  const contractExplorerLink = getContractExplorerLink(
    configuredNetworkPassphrase,
    configuredContractId
  );

  const globalStatsQuery = useQuery({
    queryKey: ["global-stats", configuredContractId],
    queryFn: () => readGlobalStats(),
    enabled: contractReady,
    refetchInterval: 20_000
  });

  const contractEventsQuery = useQuery({
    queryKey: ["contract-events", configuredContractId],
    queryFn: () => readContractEvents(8),
    enabled: contractReady,
    refetchInterval: 15_000
  });

  const balanceQuery = useQuery({
    queryKey: ["xlm-balance", wallet.account, wallet.networkPassphrase],
    queryFn: () => fetchXlmBalance(wallet.account),
    enabled: Boolean(wallet.account) && !wrongNetwork,
    refetchInterval: 15_000
  });

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", wallet.account, wallet.networkPassphrase],
    queryFn: () => readDashboard(wallet.account),
    enabled: readyForReads,
    refetchInterval: 20_000
  });

  const experimentsQuery = useQuery({
    queryKey: ["experiments", wallet.account, wallet.networkPassphrase],
    queryFn: () => readExperiments(wallet.account),
    enabled: readyForReads,
    refetchInterval: 20_000
  });

  const logsQuery = useQuery({
    queryKey: ["logs", wallet.account, wallet.networkPassphrase],
    queryFn: () => readRecentLogs(wallet.account, 6),
    enabled: readyForReads,
    refetchInterval: 20_000
  });

  useEffect(() => {
    if (!dashboardQuery.data) {
      return;
    }

    setProfileForm((current) => ({
      displayName: current.displayName || dashboardQuery.data.displayName
    }));
  }, [dashboardQuery.data]);

  const dashboard = dashboardQuery.data;
  const globalStats = globalStatsQuery.data;
  const experiments = experimentsQuery.data || emptyCollection;
  const logs = logsQuery.data || emptyCollection;
  const todayDay = Math.floor(Date.now() / 1000 / DAY_IN_SECONDS);

  const activeExperiments = useMemo(
    () => experiments.filter((experiment) => experiment.status === EXPERIMENT_STATUS.active),
    [experiments]
  );
  const completedExperiments = useMemo(
    () => experiments.filter((experiment) => experiment.status !== EXPERIMENT_STATUS.active),
    [experiments]
  );
  const experimentTitleById = useMemo(
    () => Object.fromEntries(experiments.map((experiment) => [experiment.id, experiment.title])),
    [experiments]
  );

  useEffect(() => {
    if (!activeExperiments.length) {
      return;
    }

    setComplianceForm((current) => {
      const exists = activeExperiments.some(
        (experiment) => String(experiment.id) === String(current.experimentId)
      );

      if (exists) {
        return current;
      }

      return {
        ...current,
        experimentId: String(activeExperiments[0].id)
      };
    });
  }, [activeExperiments]);

  const selectedExperiment = useMemo(
    () =>
      activeExperiments.find(
        (experiment) => String(experiment.id) === String(complianceForm.experimentId)
      ) || null,
    [activeExperiments, complianceForm.experimentId]
  );

  const successRate = successRateFromDashboard(dashboard);

  async function runLedgerAction(action, pendingMessage, successMessage) {
    if (!wallet.account) {
      throw new Error("Connect Freighter before sending a transaction.");
    }

    if (wrongNetwork) {
      throw new Error(`Switch Freighter to ${getNetworkLabel(configuredNetworkPassphrase)}.`);
    }

    setTxState({
      status: "pending",
      message: pendingMessage,
      hash: ""
    });

    try {
      const result = await action();

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", wallet.account] }),
        queryClient.invalidateQueries({ queryKey: ["experiments", wallet.account] }),
        queryClient.invalidateQueries({ queryKey: ["logs", wallet.account] }),
        queryClient.invalidateQueries({ queryKey: ["global-stats", configuredContractId] }),
        queryClient.invalidateQueries({ queryKey: ["contract-events", configuredContractId] })
      ]);

      setTxState({
        status: "success",
        message: successMessage,
        hash: result.hash
      });
    } catch (error) {
      setTxState({
        status: "error",
        message: parseError(error),
        hash: ""
      });
      throw error;
    }
  }

  const saveProfileMutation = useMutation({
    mutationFn: ({ displayName }) =>
      runLedgerAction(
        () => saveProfile(wallet.account, displayName),
        "Saving your ExperimentX profile on Stellar...",
        "Experimenter profile saved on Soroban."
      )
  });

  const createExperimentMutation = useMutation({
    mutationFn: ({ title, durationDays }) =>
      runLedgerAction(
        () => createExperiment(wallet.account, title, durationDays),
        "Launching your new experiment on Stellar...",
        "Experiment launched."
      )
  });

  const logComplianceMutation = useMutation({
    mutationFn: ({ experimentId, compliant }) =>
      runLedgerAction(
        () => logCompliance(wallet.account, experimentId, compliant),
        "Writing your daily compliance check-in...",
        "Daily compliance logged."
      )
  });

  const finalizeExperimentMutation = useMutation({
    mutationFn: ({ experimentId }) =>
      runLedgerAction(
        () => finalizeExperiment(wallet.account, experimentId),
        "Finalizing experiment results on-chain...",
        "Experiment result finalized."
      )
  });

  const sendXlmMutation = useMutation({
    mutationFn: ({ destination, amount }) =>
      runLedgerAction(
        () => sendXlmTransaction(wallet.account, destination, amount),
        "Sending XLM transaction on Stellar...",
        "XLM transaction sent successfully."
      )
  });

  const anyMutationPending =
    saveProfileMutation.isPending ||
    createExperimentMutation.isPending ||
    logComplianceMutation.isPending ||
    finalizeExperimentMutation.isPending ||
    sendXlmMutation.isPending;

  async function handleConnectWallet() {
    setWallet((current) => ({
      ...current,
      isConnecting: true,
      error: ""
    }));

    try {
      const nextState = await connectWallet();
      setWallet({
        ...emptyWallet,
        ...nextState,
        isConnecting: false
      });
    } catch (error) {
      setWallet((current) => ({
        ...current,
        isConnecting: false,
        error: parseError(error)
      }));
    }
  }

  function handleDisconnectWallet() {
    setWallet(disconnectWallet());
    queryClient.clear();
  }

  function handleSendXlmSubmit(event) {
    event.preventDefault();
    const destination = sendXlmForm.destination.trim();
    const amount = sendXlmForm.amount.trim();

    if (!destination || !amount) {
      setTxState({
        status: "error",
        message: "Destination address and amount are required.",
        hash: ""
      });
      return;
    }

    sendXlmMutation.mutate({ destination, amount });
  }

  function handleProfileSubmit(event) {
    event.preventDefault();
    const displayName = profileForm.displayName.trim();

    if (displayName.length < 3 || displayName.length > 32) {
      setTxState({
        status: "error",
        message: "Display names must stay between 3 and 32 characters.",
        hash: ""
      });
      return;
    }

    saveProfileMutation.mutate({ displayName });
  }

  function handleExperimentSubmit(event) {
    event.preventDefault();

    const title = experimentForm.title.trim();
    const durationDays = Number(experimentForm.durationDays);
    const allowedDurations = contractLimits.allowedDurations || [7, 14, 30];

    if (title.length < 3 || title.length > 48) {
      setTxState({
        status: "error",
        message: "Experiment titles must stay between 3 and 48 characters.",
        hash: ""
      });
      return;
    }

    if (!allowedDurations.includes(durationDays)) {
      setTxState({
        status: "error",
        message: "Choose a supported experiment duration: 7, 14, or 30 days.",
        hash: ""
      });
      return;
    }

    createExperimentMutation.mutate({ title, durationDays });
    setExperimentForm((current) => ({ ...current, title: "" }));
  }

  function handleComplianceSubmit(event) {
    event.preventDefault();

    if (!selectedExperiment) {
      setTxState({
        status: "error",
        message: "Pick an active experiment before logging your daily result.",
        hash: ""
      });
      return;
    }

    logComplianceMutation.mutate({
      experimentId: Number(complianceForm.experimentId),
      compliant: complianceForm.compliant === "true"
    });
  }

  function handleFinalizeExperiment(experimentId) {
    finalizeExperimentMutation.mutate({ experimentId });
  }

  const txExplorerLink = getExplorerLink(wallet.networkPassphrase, txState.hash);

  return (
    <div className="font-body-md text-on-background min-h-screen">
      {/* TopNavBar */}
      <header className="fixed top-0 left-0 w-full z-50 bg-surface/80 backdrop-blur-md border-b border-outline-variant h-16 flex justify-between items-center px-margin-desktop">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <span className="font-headline-md text-headline-md text-primary tracking-wider">ExperimentX</span>
          </div>
          <div className="hidden md:flex gap-6 ml-10">
            <a className="font-label-caps text-label-caps text-primary-fixed border-b-2 border-primary-fixed pb-1" href="#dashboard">Dashboard</a>
            <a className="font-label-caps text-label-caps text-on-surface-variant hover:text-primary-fixed transition-colors" href="#active">Active Runs</a>
            <a className="font-label-caps text-label-caps text-on-surface-variant hover:text-primary-fixed transition-colors" href="#outcomes">Outcomes</a>
            <a className="font-label-caps text-label-caps text-on-surface-variant hover:text-primary-fixed transition-colors" href="#events">Live Feed</a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-surface-variant px-3 py-1 rounded">
            <span className="w-2 h-2 rounded-full bg-primary-fixed animate-pulse"></span>
            <span className="font-data-sm text-data-sm text-primary-fixed">
              {wallet.networkPassphrase ? getNetworkLabel(wallet.networkPassphrase) : "Awaiting Wallet"}
            </span>
          </div>
          {wallet.account && !wrongNetwork ? (
            <div className="flex items-center gap-2 bg-surface-container-high border border-outline-variant px-3 py-1 rounded">
              <span className="material-symbols-outlined text-sm">account_balance_wallet</span>
              <span className="font-data-sm text-data-sm">
                {balanceQuery.data ? `${balanceQuery.data} XLM` : "Loading..."}
              </span>
            </div>
          ) : null}
          {wallet.account ? (
            <button
              className="bg-error-container text-on-error-container font-label-caps text-label-caps px-4 py-2 hover:opacity-80 active:scale-95 transition-all"
              onClick={handleDisconnectWallet}
            >
              Disconnect
            </button>
          ) : (
            <button
              className="bg-primary-container text-on-primary-fixed font-label-caps text-label-caps px-4 py-2 hover:opacity-80 active:scale-95 transition-all"
              onClick={handleConnectWallet}
              disabled={wallet.isConnecting}
            >
              {wallet.isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      <main className="pt-24 pb-12 px-margin-desktop max-w-[1400px] mx-auto">
        {/* Hero Section */}
        <section className="mb-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 border-l-4 border-primary-fixed pl-6">
            <div>
              <h1 className="font-headline-lg text-headline-lg text-primary tracking-[0.15em] mb-1">EXPERIMENTX</h1>
              <p className="font-label-caps text-label-caps text-on-surface-variant tracking-widest">[ON-CHAIN SELF-EXPERIMENT STUDIO]</p>
              <p className="max-w-xl mt-4 text-on-surface-variant font-body-md text-body-md">
                Calm, verifiable behavior tracking on Stellar. Deploy fixed-duration challenges, log daily check-ins, and publish cryptographic proof.
              </p>
            </div>
            <div className="mt-6 md:mt-0 flex gap-8">
              <div className="flex flex-col">
                <span className="font-label-caps text-label-caps text-on-surface-variant">EXPERIMENTERS</span>
                <span className="font-data-lg text-data-lg text-primary-fixed">
                  {globalStats ? String(globalStats.experimenterCount) : "0"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-label-caps text-label-caps text-on-surface-variant">CHECK-INS</span>
                <span className="font-data-lg text-data-lg text-primary-fixed">
                  {globalStats ? String(globalStats.totalCheckIns) : "0"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-label-caps text-label-caps text-on-surface-variant">SUCCESS RATE</span>
                <span className="font-data-lg text-data-lg text-primary-fixed">
                  {formatPercent(successRate)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Live Status Banner */}
        <section className="cyber-panel p-4 mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <span className="font-label-caps text-label-caps text-primary-fixed block mb-1">Live Status</span>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {wallet.error ||
                (wrongNetwork
                  ? `Connected to ${getNetworkLabel(wallet.networkPassphrase)}. Switch Freighter to ${getNetworkLabel(configuredNetworkPassphrase)}.`
                  : txState.message ||
                    (contractReady
                      ? "ExperimentX is ready to read public contract activity and write new on-chain experiment actions."
                      : "Redeploy the ExperimentX Soroban contract and export the refreshed frontend config before using the app."))}
            </p>
          </div>
          {txExplorerLink ? (
            <a
              className="bg-surface-bright border border-primary-fixed/30 text-primary-fixed font-label-caps text-label-caps px-4 py-2 hover:bg-primary-fixed hover:text-on-primary transition-all text-xs"
              href={txExplorerLink}
              target="_blank"
              rel="noreferrer"
            >
              View Transaction
            </a>
          ) : null}
        </section>

        {/* Deployment Runway (If not ready) */}
        {!contractReady ? (
          <section className="cyber-panel p-6 mb-8 border-error/40 bg-error-container/5">
            <div className="flex items-center gap-2 mb-4">
              <span className="font-label-caps text-label-caps text-error">00</span>
              <h2 className="font-headline-md text-headline-md uppercase tracking-tight text-error">Redeploy Contract</h2>
            </div>
            <p className="text-on-surface-variant font-body-md text-body-md mb-4">
              The ABI or deployed configuration changed. Use Stellar CLI to re-compile, deploy, and export frontend configurations.
            </p>
            <div className="bg-[#0a0c10] p-4 font-data-sm text-data-sm text-primary-fixed border border-outline-variant space-y-2">
              <p><code>stellar keys generate alice --network testnet --fund</code></p>
              <p><code>npm run contract:build</code></p>
              <p><code>npm run contract:deploy</code></p>
              <p><code>npm run export:frontend</code></p>
            </div>
          </section>
        ) : null}

        {/* Core Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
          {/* Left Column (Forms & Actions) */}
          <div className="lg:col-span-5 space-y-gutter">
            {/* Panel [01] REGISTER IDENTITY */}
            <div className="cyber-panel p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="font-label-caps text-label-caps text-primary-fixed">01</span>
                <h2 className="font-headline-md text-headline-md uppercase tracking-tight text-primary">Register Identity</h2>
              </div>
              <form className="space-y-4" onSubmit={handleProfileSubmit}>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant mb-1 block">Bio-Identity Alias</label>
                  <input
                    className="w-full bg-transparent border-0 border-b border-outline-variant focus:border-primary-fixed focus:ring-0 text-primary-fixed placeholder:text-surface-variant font-data-sm text-data-sm py-2"
                    placeholder="e.g. Calm Architect"
                    type="text"
                    maxLength="32"
                    required
                    value={profileForm.displayName}
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, displayName: event.target.value }))
                    }
                  />
                </div>
                <button
                  className="w-full bg-surface-bright border border-primary-fixed/30 text-primary-fixed font-label-caps text-label-caps py-3 hover:bg-primary-fixed hover:text-on-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={anyMutationPending || !wallet.account || !contractReady}
                >
                  {saveProfileMutation.isPending ? "Saving..." : "Save Profile"}
                </button>
              </form>
            </div>

            {/* Panel [02] LAUNCH EXPERIMENT */}
            <div className="cyber-panel p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="font-label-caps text-label-caps text-primary-fixed">02</span>
                <h2 className="font-headline-md text-headline-md uppercase tracking-tight text-primary">Launch Experiment</h2>
              </div>
              <form className="space-y-6" onSubmit={handleExperimentSubmit}>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant mb-1 block">Protocol Title</label>
                  <input
                    className="w-full bg-transparent border-0 border-b border-outline-variant focus:border-primary-fixed focus:ring-0 text-primary-fixed placeholder:text-surface-variant font-data-sm text-data-sm py-2"
                    placeholder="e.g. No Social Media"
                    type="text"
                    maxLength="48"
                    required
                    value={experimentForm.title}
                    onChange={(event) =>
                      setExperimentForm((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant mb-3 block">Duration</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[7, 14, 30].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setExperimentForm((current) => ({ ...current, durationDays: String(days) }))}
                        className={`py-2 border font-label-caps text-label-caps transition-colors ${
                          Number(experimentForm.durationDays) === days
                            ? "border-primary-fixed text-primary-fixed bg-primary-fixed/5"
                            : "border-outline-variant text-on-surface-variant hover:border-primary-fixed"
                        }`}
                      >
                        {days} Days
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  className="w-full bg-secondary-container text-on-secondary font-label-caps text-label-caps py-3 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={anyMutationPending || !wallet.account || !dashboard || !contractReady}
                >
                  {createExperimentMutation.isPending ? "Launching..." : "Deploy to Ledger"}
                </button>
              </form>
            </div>

            {/* Panel: Send XLM */}
            <div className="cyber-panel p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="font-label-caps text-label-caps text-primary-fixed">05</span>
                <h2 className="font-headline-md text-headline-md uppercase tracking-tight text-primary">Send XLM</h2>
              </div>
              <form className="space-y-4" onSubmit={handleSendXlmSubmit}>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant mb-1 block">Destination Address</label>
                  <input
                    className="w-full bg-transparent border-0 border-b border-outline-variant focus:border-primary-fixed focus:ring-0 text-primary-fixed placeholder:text-surface-variant font-data-sm text-data-sm py-2"
                    placeholder="G..."
                    type="text"
                    required
                    value={sendXlmForm.destination}
                    onChange={(event) =>
                      setSendXlmForm((current) => ({ ...current, destination: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant mb-1 block">Amount (XLM)</label>
                  <input
                    className="w-full bg-transparent border-0 border-b border-outline-variant focus:border-primary-fixed focus:ring-0 text-primary-fixed placeholder:text-surface-variant font-data-sm text-data-sm py-2"
                    placeholder="10.5"
                    type="number"
                    min="0.0000001"
                    step="any"
                    required
                    value={sendXlmForm.amount}
                    onChange={(event) =>
                      setSendXlmForm((current) => ({ ...current, amount: event.target.value }))
                    }
                  />
                </div>
                <button
                  className="w-full bg-surface-bright border border-primary-fixed/30 text-primary-fixed font-label-caps text-label-caps py-3 hover:bg-primary-fixed hover:text-on-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={anyMutationPending || !wallet.account || wrongNetwork}
                >
                  {sendXlmMutation.isPending ? "Sending..." : "Send XLM"}
                </button>
              </form>
            </div>
          </div>

          {/* Right Column (Dashboard status, HUD, terminal feed) */}
          <div className="lg:col-span-7 space-y-gutter">
            {/* Panel [03] ACTIVE HUD */}
            <div className="cyber-panel p-8 glow-cyan border-primary-fixed/40">
              {activeExperiments.length ? (
                <div>
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-label-caps text-label-caps text-primary-fixed">03</span>
                        <span className="bg-primary-fixed/10 text-primary-fixed font-label-caps text-label-caps px-2 py-0.5 border border-primary-fixed/20">LIVE_PROTOCOL</span>
                      </div>
                      <h2 className="font-headline-lg text-headline-lg tracking-tight text-primary">{activeExperiments[0].title}</h2>
                    </div>
                    <div className="flex items-center gap-2 text-[#00ff9d]">
                      <span className="material-symbols-outlined fill" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                      <span className="font-label-caps text-label-caps">Streak: {activeExperiments[0].currentStreak} Days</span>
                    </div>
                  </div>

                  <div className="mb-8">
                    <div className="flex justify-between font-label-caps text-label-caps text-on-surface-variant mb-2">
                      <span>Phase: Day {Math.max(1, Math.min(todayDay - activeExperiments[0].startDay + 1, activeExperiments[0].durationDays))} / {activeExperiments[0].durationDays}</span>
                      <span>{formatPercent(progressPercent(activeExperiments[0], todayDay))} Complete</span>
                    </div>
                    <div className="h-1 w-full bg-surface-variant">
                      <div
                        className="h-full bg-primary-fixed shadow-[0_0_8px_rgba(125,244,255,0.6)]"
                        style={{ width: `${progressPercent(activeExperiments[0], todayDay)}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button
                      className="flex items-center justify-center gap-3 bg-[#002e1c] border border-[#00ff9d]/30 text-[#00ff9d] font-label-caps text-label-caps py-4 hover:bg-[#00ff9d] hover:text-[#002e1c] transition-all disabled:opacity-50"
                      onClick={() => {
                        logComplianceMutation.mutate({
                          experimentId: activeExperiments[0].id,
                          compliant: true
                        });
                      }}
                      disabled={anyMutationPending || !wallet.account || !contractReady}
                    >
                      <span className="material-symbols-outlined">check_circle</span>
                      Log Compliant
                    </button>
                    <button
                      className="flex items-center justify-center gap-3 bg-[#3a0003] border border-error/30 text-error font-label-caps text-label-caps py-4 hover:bg-error hover:text-[#3a0003] transition-all disabled:opacity-50"
                      onClick={() => {
                        logComplianceMutation.mutate({
                          experimentId: activeExperiments[0].id,
                          compliant: false
                        });
                      }}
                      disabled={anyMutationPending || !wallet.account || !contractReady}
                    >
                      <span className="material-symbols-outlined">cancel</span>
                      Log Missed
                    </button>
                  </div>

                  {todayDay > activeExperiments[0].endDay ? (
                    <div className="mt-4">
                      <button
                        className="w-full bg-[#0566d9] text-on-secondary-container font-label-caps text-label-caps py-3 hover:opacity-90 transition-all"
                        onClick={() => handleFinalizeExperiment(activeExperiments[0].id)}
                        disabled={anyMutationPending}
                      >
                        {finalizeExperimentMutation.isPending ? "Finalizing..." : "Finalize Protocol (Claim Badge)"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="font-label-caps text-label-caps text-primary-fixed">03</span>
                    <h2 className="font-headline-md text-headline-md uppercase tracking-tight text-primary">Active HUD</h2>
                  </div>
                  <p className="text-on-surface-variant font-body-md text-body-md">
                    {dashboard
                      ? "No active experiment protocol is running on this identity. Create a title above and deploy it to get started."
                      : "Save your profile first to initialize your dashboard HUD."}
                  </p>
                </div>
              )}
            </div>

            {/* Panel [04] LIVE EVENT MONITOR (Terminal console) */}
            <div id="events" className="cyber-panel border-outline-variant/30 flex flex-col h-[300px]">
              <div className="px-6 py-3 border-b border-outline-variant flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="font-label-caps text-label-caps text-primary-fixed">04</span>
                  <span className="font-label-caps text-label-caps">Live Event Monitor</span>
                </div>
                <div className="flex gap-2">
                  <ActivityTicker active={contractEventsQuery.isFetching} />
                </div>
              </div>
              <div className="flex-1 bg-[#0a0c10] p-6 font-data-sm text-data-sm terminal-scroll overflow-y-auto">
                <div className="space-y-1 opacity-80">
                  {contractEventsQuery.isLoading ? (
                    <p className="text-surface-variant">Connecting and fetching events from Soroban RPC...</p>
                  ) : contractEventsQuery.data?.length ? (
                    contractEventsQuery.data.map((entry) => (
                      <p className="text-on-surface-variant" key={entry.id}>
                        <span className="text-surface-variant mr-2">[{new Date(Number(entry.closedAt) * 1000).toLocaleTimeString("en-GB", { hour12: false })}]</span>
                        <span className="text-primary-fixed mr-2">{entry.topics[0]?.replaceAll("_", " ")}</span>
                        {entry.summary}
                        {entry.txHash ? (
                          <a
                            href={getExplorerLink(configuredNetworkPassphrase, entry.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary-fixed-dim italic ml-2 hover:underline"
                          >
                            ({entry.txHash.slice(0, 8)}...)
                          </a>
                        ) : null}
                      </p>
                    ))
                  ) : (
                    <p className="text-surface-variant">No recent contract events are available in the current RPC retention window.</p>
                  )}
                  <div className="flex items-center">
                    <span className="text-surface-variant mr-2">[{new Date().toLocaleTimeString("en-GB", { hour12: false })}]</span>
                    <span className="w-2 h-4 bg-primary-fixed cursor-blink"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <section id="dashboard" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-gutter mt-12">
          <MetricCard
            label="Active experiments"
            value={dashboard ? String(dashboard.activeExperiments) : "0"}
            note={dashboard ? "Live runs in progress" : "Awaiting profile"}
            loading={dashboardQuery.isLoading}
          />
          <MetricCard
            label="Completed results"
            value={dashboard ? String(dashboard.completedExperiments) : "0"}
            note={dashboard ? "Finished runs with outcome" : "Awaiting completions"}
            loading={dashboardQuery.isLoading}
          />
          <MetricCard
            label="Compliance streak"
            value={dashboard ? formatDayCount(dashboard.currentStreak) : "0 days"}
            note={dashboard ? "Consecutive checked-in days" : "Build daily streaks"}
            loading={dashboardQuery.isLoading}
          />
          <MetricCard
            label="Success rate"
            value={formatPercent(successRate)}
            note={dashboard ? `${dashboard.successfulExperiments} successful runs` : "Runs completed successfully"}
            loading={dashboardQuery.isLoading}
          />
          <MetricCard
            label="Public experimenters"
            value={globalStats ? String(globalStats.experimenterCount) : "0"}
            note={contractReady ? "Accounts registered" : "Awaiting contract"}
            loading={globalStatsQuery.isLoading}
          />
          <MetricCard
            label="Network check-ins"
            value={globalStats ? String(globalStats.totalCheckIns) : "0"}
            note={globalStats ? `${globalStats.totalExperiments} protocols deployed` : "Global activities"}
            loading={globalStatsQuery.isLoading}
          />
        </section>

        {/* Bottom Workspace Lists */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-gutter mt-12">
          {/* Active Runs Panel */}
          <div id="active">
            <Panel eyebrow="Active runs" title="Protocols in Motion" body="Track details, check-in intervals, and final outcome checkpoints.">
              {experimentsQuery.isLoading ? (
                <ActivitySkeleton />
              ) : activeExperiments.length ? (
                <div className="space-y-4 mt-4">
                  {activeExperiments.map((experiment) => {
                    const overdue = todayDay > experiment.endDay;
                    const progress = progressPercent(experiment, todayDay);
                    return (
                      <div className="cyber-panel p-4 space-y-3" key={experiment.id}>
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-label-caps text-label-caps text-primary-fixed">{statusLabel(experiment.status)}</span>
                            <h3 className="font-data-lg text-data-lg text-primary">{experiment.title}</h3>
                          </div>
                          <span className="font-data-sm text-data-sm text-on-surface-variant">Day {Math.max(1, Math.min(todayDay - experiment.startDay + 1, experiment.durationDays))} / {experiment.durationDays}</span>
                        </div>
                        <div className="h-1 w-full bg-surface-variant">
                          <div className="h-full bg-primary-fixed" style={{ width: `${progress}%` }}></div>
                        </div>
                        <div className="flex justify-between items-center text-xs text-on-surface-variant">
                          <span>Streak: {experiment.currentStreak} days</span>
                          <span>Compliance: {formatPercent(experiment.complianceRate)}</span>
                        </div>
                        {overdue ? (
                          <button
                            className="w-full bg-[#0566d9] text-on-secondary-container font-label-caps text-label-caps py-2 hover:opacity-90 transition-all text-xs"
                            onClick={() => handleFinalizeExperiment(experiment.id)}
                            disabled={anyMutationPending}
                          >
                            {finalizeExperimentMutation.isPending ? "Finalizing..." : "Finalize result"}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-surface-variant text-center py-8">No active experiment protocols found.</p>
              )}
            </Panel>
          </div>

          {/* Published Outcomes Panel */}
          <div id="outcomes">
            <Panel eyebrow="Published outcomes" title="Completed Challenges" body="Historical database of finished behavior protocols.">
              {experimentsQuery.isLoading ? (
                <ActivitySkeleton />
              ) : completedExperiments.length ? (
                <div className="space-y-4 mt-4">
                  {completedExperiments.slice(0, 6).map((experiment) => (
                    <div className="cyber-panel p-4 flex justify-between items-center" key={experiment.id}>
                      <div>
                        <span className="font-label-caps text-label-caps text-on-surface-variant">{statusLabel(experiment.status)}</span>
                        <h3 className="font-data-lg text-data-lg text-primary">{experiment.title}</h3>
                        <p className="text-xs text-surface-variant">{experiment.compliantDays} compliant days, {experiment.durationDays} days duration</p>
                      </div>
                      <div className="text-right">
                        <span className="font-data-lg text-data-lg text-primary-fixed block">{formatPercent(experiment.complianceRate)}</span>
                        <span className="text-[10px] text-surface-variant font-label-caps">Compliance</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-surface-variant text-center py-8">Finished protocols will publish here conclusions.</p>
              )}
            </Panel>
          </div>
        </section>
      </main>
    </div>
  );
}
