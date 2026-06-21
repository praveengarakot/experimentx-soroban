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
    <div className="brand-mark" aria-hidden="true">
      <span className="brand-ring" />
      <span className="brand-core" />
      <span className="brand-trace" />
    </div>
  );
}

function Panel({ eyebrow, title, body, children, tone = "stone" }) {
  return (
    <section className={`panel panel-${tone}`}>
      <div className="panel-head">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {body ? <p className="panel-body">{body}</p> : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value, note, loading = false }) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <div className={loading ? "skeleton skeleton-metric" : "metric-value"}>
        {loading ? "" : value}
      </div>
      <p className="metric-note">{loading ? <span className="skeleton skeleton-note" /> : note}</p>
    </article>
  );
}

function ActivitySkeleton() {
  return (
    <div className="stack-list">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="list-card list-card-skeleton" key={index}>
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-note" />
          <span className="skeleton skeleton-badge" />
        </div>
      ))}
    </div>
  );
}

function ActivityTicker({ active = false }) {
  return (
    <span className={`ticker ${active ? "ticker-live" : ""}`}>
      <span />
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
    <div className="app-shell">
      <div className="atmosphere atmosphere-one" />
      <div className="atmosphere atmosphere-two" />
      <div className="atmosphere atmosphere-three" />

      <header className="hero">
        <div className="hero-main">
          <div className="brand-row">
            <BrandMark />
            <div>
              <p className="kicker">On-chain self-experiment studio</p>
              <h1>ExperimentX</h1>
            </div>
          </div>

          <p className="lead">
            Run behavior-change experiments on Stellar, log daily compliance, and publish clean
            public results for every streak, miss, and outcome that matters.
          </p>

          <div className="hero-actions">
            {wallet.account && !wrongNetwork ? (
              <span className="pill" style={{ borderColor: "#00f0ff", color: "#00f0ff", background: "rgba(0, 240, 255, 0.1)" }}>
                {balanceQuery.data ? `${balanceQuery.data} XLM` : "Loading XLM..."}
              </span>
            ) : null}
            {wallet.account ? (
              <button className="button button-secondary" onClick={handleDisconnectWallet}>
                Disconnect {shortAddress(wallet.account)}
              </button>
            ) : (
              <button
                className="button button-primary"
                onClick={handleConnectWallet}
                disabled={wallet.isConnecting}
              >
                {wallet.isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
            )}
            <div className="hero-badges">
              <span className="pill">Soroban-backed</span>
              <span className="pill">Public results</span>
              <span className="pill">Daily compliance</span>
            </div>
          </div>
        </div>

        <div className="hero-side">
          <div className="hero-side-top">
            <div>
              <p className="side-label">Experimenter</p>
              <strong>{wallet.account ? shortAddress(wallet.account) : "Wallet not connected"}</strong>
            </div>
            <div>
              <p className="side-label">Network</p>
              <strong>
                {wallet.networkPassphrase
                  ? getNetworkLabel(wallet.networkPassphrase)
                  : "Awaiting Freighter"}
              </strong>
            </div>
          </div>

          <div className="hero-side-stat">
            <span>Contract</span>
            <strong>{configuredContractId ? shortAddress(configuredContractId) : "Deploy ExperimentX"}</strong>
            <div className="hero-side-links">
              {contractExplorerLink ? (
                <a href={contractExplorerLink} target="_blank" rel="noreferrer">
                  Open in Stellar Lab
                </a>
              ) : null}
              <a href={configuredRpcUrl} target="_blank" rel="noreferrer">
                View RPC
              </a>
            </div>
          </div>

          <div className="progress-shell">
            <div className="progress-labels">
              <span>Result rate</span>
              <span>{formatPercent(successRate)}</span>
            </div>
            <div className="progress-track">
              <span className="progress-fill" style={{ width: `${successRate}%` }} />
            </div>
          </div>

          <p className="hero-note">
            Wallet-backed identity, fixed-duration experiments, live contract events, and public
            accountability in one calm, responsive Soroban product.
          </p>
        </div>
      </header>

      <section className="status-banner">
        <div>
          <p className="status-label">Live status</p>
          <p className="status-copy">
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
          <a className="status-link" href={txExplorerLink} target="_blank" rel="noreferrer">
            View transaction
          </a>
        ) : null}
      </section>

      <section className="metrics-grid">
        <MetricCard
          label="Active experiments"
          value={dashboard ? String(dashboard.activeExperiments) : "0"}
          note={dashboard ? "Live runs still in progress" : "Create a profile to begin"}
          loading={dashboardQuery.isLoading}
        />
        <MetricCard
          label="Completed results"
          value={dashboard ? String(dashboard.completedExperiments) : "0"}
          note={dashboard ? "Finished experiments with a final outcome" : "Results appear after your first completion"}
          loading={dashboardQuery.isLoading}
        />
        <MetricCard
          label="Compliance streak"
          value={dashboard ? formatDayCount(dashboard.currentStreak) : "0 days"}
          note={dashboard ? "Consecutive days with compliant check-ins" : "Build momentum day by day"}
          loading={dashboardQuery.isLoading}
        />
        <MetricCard
          label="Success rate"
          value={formatPercent(successRate)}
          note={dashboard ? `${dashboard.successfulExperiments} successful experiments so far` : "Calculated from completed experiments"}
          loading={dashboardQuery.isLoading}
        />
        <MetricCard
          label="Public experimenters"
          value={globalStats ? String(globalStats.experimenterCount) : "0"}
          note={contractReady ? "Profiles created on this contract" : "Deploy contract to activate"}
          loading={globalStatsQuery.isLoading}
        />
        <MetricCard
          label="Network check-ins"
          value={globalStats ? String(globalStats.totalCheckIns) : "0"}
          note={globalStats ? `${globalStats.totalExperiments} experiments launched on-chain` : "Recent activity across the contract"}
          loading={globalStatsQuery.isLoading}
        />
      </section>

      {!contractReady ? (
        <Panel
          eyebrow="Deployment runway"
          title="Redeploy the ExperimentX contract"
          body="The ABI changed for experiments and daily compliance, so the frontend intentionally waits for a fresh deployment record before enabling contract reads and writes."
          tone="moss"
        >
          <div className="code-stack">
            <code>stellar keys generate alice --network testnet --fund</code>
            <code>npm run contract:build</code>
            <code>npm run contract:deploy</code>
            <code>npm run export:frontend</code>
          </div>
        </Panel>
      ) : null}

      <section className="panel-grid">
        <Panel
          eyebrow="Contract snapshot"
          title="Live Soroban network overview"
          body="These reads stay public so anyone can inspect adoption, output volume, and recent ExperimentX activity before connecting a wallet."
          tone="stone"
        >
          <div className="detail-stack">
            <div className="detail-row">
              <span>Network</span>
              <strong>{getNetworkLabel(configuredNetworkPassphrase)}</strong>
            </div>
            <div className="detail-row">
              <span>Contract ID</span>
              <strong>{configuredContractId || "Missing config"}</strong>
            </div>
            <div className="detail-row">
              <span>Last activity</span>
              <strong>{formatDateTime(globalStats?.latestActivityAt)}</strong>
            </div>
            <div className="detail-row">
              <span>RPC endpoint</span>
              <strong>{configuredRpcUrl}</strong>
            </div>
          </div>
          {contractExplorerLink ? (
            <a className="panel-link" href={contractExplorerLink} target="_blank" rel="noreferrer">
              Inspect contract in Stellar Lab
            </a>
          ) : null}
        </Panel>

        <Panel
          eyebrow="Profile setup"
          title="Create your public experimenter identity"
          body="Choose a clean public name for your wallet-backed profile so your experiments and outcomes can be recognized across the feed."
          tone="amber"
        >
          <form className="form-grid" onSubmit={handleProfileSubmit}>
            <label>
              <span>Display name</span>
              <input
                type="text"
                maxLength="32"
                required
                placeholder="Calm Architect"
                value={profileForm.displayName}
                onChange={(event) =>
                  setProfileForm((current) => ({ ...current, displayName: event.target.value }))
                }
              />
            </label>
            <button
              className="button button-primary"
              type="submit"
              disabled={anyMutationPending || !wallet.account || !contractReady}
            >
              {saveProfileMutation.isPending ? "Saving..." : "Save profile"}
            </button>
          </form>
        </Panel>

        <Panel
          eyebrow="Experiment launch"
          title="Start a fixed-duration challenge"
          body="Launch a 7, 14, or 30 day experiment like No Social Media, 5AM Wake-Up, or Daily Meditation and let Soroban track the outcome."
          tone="moss"
        >
          <form className="form-grid" onSubmit={handleExperimentSubmit}>
            <label>
              <span>Experiment title</span>
              <input
                type="text"
                maxLength="48"
                required
                placeholder="No Social Media"
                value={experimentForm.title}
                onChange={(event) =>
                  setExperimentForm((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Duration</span>
              <select
                value={experimentForm.durationDays}
                onChange={(event) =>
                  setExperimentForm((current) => ({
                    ...current,
                    durationDays: event.target.value
                  }))
                }
              >
                {(contractLimits.allowedDurations || [7, 14, 30]).map((duration) => (
                  <option key={duration} value={duration}>
                    {duration} days
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              type="submit"
              disabled={anyMutationPending || !wallet.account || !dashboard || !contractReady}
            >
              {createExperimentMutation.isPending ? "Launching..." : "Launch experiment"}
            </button>
          </form>
        </Panel>

        <Panel
          eyebrow="Daily check-in"
          title="Log today’s compliance"
          body="Choose an active experiment and mark whether you stayed compliant today. Each log updates streaks, analytics, and public contract activity."
          tone="ink"
        >
          <form className="form-grid" onSubmit={handleComplianceSubmit}>
            <label>
              <span>Active experiment</span>
              <select
                value={complianceForm.experimentId}
                onChange={(event) =>
                  setComplianceForm((current) => ({
                    ...current,
                    experimentId: event.target.value
                  }))
                }
                disabled={!activeExperiments.length}
              >
                {activeExperiments.length ? (
                  activeExperiments.map((experiment) => (
                    <option key={experiment.id} value={experiment.id}>
                      {experiment.title}
                    </option>
                  ))
                ) : (
                  <option value="">No active experiments</option>
                )}
              </select>
            </label>
            <label>
              <span>Today’s result</span>
              <select
                value={complianceForm.compliant}
                onChange={(event) =>
                  setComplianceForm((current) => ({
                    ...current,
                    compliant: event.target.value
                  }))
                }
              >
                <option value="true">Compliant</option>
                <option value="false">Missed</option>
              </select>
            </label>
            <button
              className="button button-primary"
              type="submit"
              disabled={anyMutationPending || !wallet.account || !activeExperiments.length || !contractReady}
            >
              {logComplianceMutation.isPending ? "Logging..." : "Log check-in"}
            </button>
          </form>
        </Panel>

        <Panel eyebrow="Wallet" title="Send XLM" body="Transfer native XLM on the testnet." tone="amber">
          <form className="form-grid" onSubmit={handleSendXlmSubmit}>
            <label>
              <span>Destination Address</span>
              <input
                type="text"
                placeholder="G..."
                value={sendXlmForm.destination}
                onChange={(event) =>
                  setSendXlmForm((current) => ({ ...current, destination: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Amount (XLM)</span>
              <input
                type="number"
                min="0.0000001"
                step="any"
                placeholder="10.5"
                value={sendXlmForm.amount}
                onChange={(event) =>
                  setSendXlmForm((current) => ({ ...current, amount: event.target.value }))
                }
              />
            </label>
            <button
              className="button button-primary"
              type="submit"
              disabled={anyMutationPending || !wallet.account || wrongNetwork}
            >
              {sendXlmMutation.isPending ? "Sending..." : "Send XLM"}
            </button>
          </form>
        </Panel>
      </section>

      <section className="panel-grid panel-grid-bottom">
        <Panel
          eyebrow="Active runs"
          title="Experiments still in motion"
          body="Track elapsed time, compliance pace, and overdue experiments that are ready for a final on-chain result."
          tone="stone"
        >
          {experimentsQuery.isLoading ? (
            <ActivitySkeleton />
          ) : activeExperiments.length ? (
            <div className="stack-list">
              {activeExperiments.map((experiment) => {
                const overdue = todayDay > experiment.endDay;
                const progress = progressPercent(experiment, todayDay);

                return (
                  <article className="list-card" key={experiment.id}>
                    <div className="list-copy">
                      <p className="card-eyebrow">{statusLabel(experiment.status)}</p>
                      <h3>{experiment.title}</h3>
                      <p>
                        {experiment.compliantDays} compliant days, {experiment.missedDays} misses,{" "}
                        {experiment.durationDays} day duration
                      </p>
                    </div>
                    <div className="list-meta">
                      <strong>{formatPercent(progress)}</strong>
                      <span>Progress</span>
                    </div>
                    <div className="progress-track compact-progress">
                      <span className="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="chip-row">
                      <span className="chip">Day {Math.max(1, Math.min(todayDay - experiment.startDay + 1, experiment.durationDays))}</span>
                      <span className="chip">Compliance {formatPercent(experiment.complianceRate)}</span>
                      {overdue ? <span className="chip chip-alert">Overdue</span> : null}
                    </div>
                    {overdue ? (
                      <button
                        className="button button-ghost"
                        type="button"
                        onClick={() => handleFinalizeExperiment(experiment.id)}
                        disabled={anyMutationPending}
                      >
                        {finalizeExperimentMutation.isPending ? "Finalizing..." : "Finalize result"}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">
              {dashboard
                ? "Launch your first experiment to start building a public ExperimentX track record."
                : "Save your profile first, then active experiments will appear here."}
            </p>
          )}
        </Panel>

        <Panel
          eyebrow="Published outcomes"
          title="Completed experiment results"
          body="Every finished run settles to a success or failure outcome, giving you a visible history of what held and what slipped."
          tone="amber"
        >
          {experimentsQuery.isLoading ? (
            <ActivitySkeleton />
          ) : completedExperiments.length ? (
            <div className="stack-list">
              {completedExperiments.slice(0, 6).map((experiment) => (
                <article className="list-card" key={experiment.id}>
                  <div className="list-copy">
                    <p className="card-eyebrow">{statusLabel(experiment.status)}</p>
                    <h3>{experiment.title}</h3>
                    <p>
                      {experiment.compliantDays} compliant days, {experiment.missedDays} misses,{" "}
                      {experiment.durationDays} day run
                    </p>
                  </div>
                  <div className="list-meta">
                    <strong>{formatPercent(experiment.complianceRate)}</strong>
                    <span>Final compliance</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              Finished experiments will publish here after a run concludes and lands on-chain.
            </p>
          )}
        </Panel>

        <Panel
          eyebrow="Recent logs"
          title="Latest personal check-ins"
          body="The newest compliance entries are read directly from the contract so you can confirm your ExperimentX record without leaving the app."
          tone="ink"
        >
          {logsQuery.isLoading ? (
            <ActivitySkeleton />
          ) : logs.length ? (
            <div className="stack-list">
              {logs.map((log) => (
                <article className="list-card" key={log.id}>
                  <div className="list-copy">
                    <p className="card-eyebrow">{log.compliant ? "Compliant" : "Missed"}</p>
                    <h3>{experimentTitleById[log.experimentId] || `Experiment #${log.experimentId}`}</h3>
                    <p>{formatDate(log.timestamp)}</p>
                  </div>
                  <div className="list-meta">
                    <strong>Day {log.dayNumber}</strong>
                    <span>Streak {log.streakAfterLog}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              Your check-in stream will populate after the first daily compliance log.
            </p>
          )}
        </Panel>

        <Panel
          eyebrow="Public event pulse"
          title="Recent contract activity"
          body="This feed stays visible without a wallet, which makes ExperimentX useful as a public ledger of experiment launches, daily check-ins, and final outcomes."
          tone="moss"
        >
          <div className="panel-toolbar">
            <ActivityTicker active={contractEventsQuery.isFetching} />
          </div>

          {contractEventsQuery.isLoading ? (
            <ActivitySkeleton />
          ) : contractEventsQuery.data?.length ? (
            <div className="stack-list">
              {contractEventsQuery.data.map((entry) => (
                <article className="list-card" key={entry.id}>
                  <div className="list-copy">
                    <p className="card-eyebrow">{entry.topics[0]?.replaceAll("_", " ") || "Contract event"}</p>
                    <h3>{entry.summary}</h3>
                    <p>{formatDateTime(entry.closedAt)}</p>
                  </div>
                  <div className="list-meta">
                    <strong>Ledger {entry.ledger}</strong>
                    {entry.txHash ? (
                      <a
                        href={getExplorerLink(configuredNetworkPassphrase, entry.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View tx
                      </a>
                    ) : (
                      <span>No tx link</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              No recent contract events are available in the current RPC retention window yet.
            </p>
          )}
        </Panel>

        <Panel
          eyebrow="Product story"
          title="How ExperimentX works"
          body="ExperimentX combines Freighter wallet access, Soroban contract writes, result-aware analytics, and a public event stream for transparent self-experiment tracking."
          tone="stone"
        >
          <ul className="check-list">
            <li>Connect a Freighter wallet on Stellar Testnet.</li>
            <li>Create a public experimenter profile tied to your wallet.</li>
            <li>Launch fixed-duration experiments like No Sugar or 5AM Wake-Up.</li>
            <li>Log daily compliance and publish success or failure results on-chain.</li>
          </ul>
        </Panel>
      </section>
    </div>
  );
}
