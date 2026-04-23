# ExperimentX

[![CI](https://github.com/praveengarakot/experimentx-soroban/actions/workflows/ci.yml/badge.svg)](https://github.com/praveengarakot/experimentx-soroban/actions/workflows/ci.yml)

ExperimentX is a Soroban mini-dApp for self-experiment tracking on Stellar. Users connect Freighter, create a public experimenter profile, launch fixed-duration experiments like `No Social Media` or `5AM Wake-Up`, log daily compliance on-chain, and publish transparent success or failure outcomes through live contract events.

## Submission Links

- Public repository: `https://github.com/praveengarakot/experimentx-soroban`
- Vercel production deployment: `https://experimentx-ten.vercel.app`
- CI workflow: `https://github.com/praveengarakot/experimentx-soroban/actions/workflows/ci.yml`

## Overview

ExperimentX turns habit-change experiments into wallet-backed public records. The current implementation supports:

- public experimenter profiles with display names
- fixed experiment durations of `7`, `14`, or `30` days
- daily compliant or missed check-ins stored on Soroban
- compliance streak tracking across days
- active and completed experiment analytics
- public event feed visibility without a wallet connection

## Architecture

### Smart contract

Location: [`contracts/experiment_x/src/lib.rs`](./contracts/experiment_x/src/lib.rs)

Core methods:

- `save_profile(experimenter, display_name)`
- `create_experiment(experimenter, title, duration_days)`
- `log_compliance(experimenter, experiment_id, compliant)`
- `finalize_experiment(experimenter, experiment_id)`
- `get_dashboard(experimenter)`
- `get_experiment_count(experimenter)`
- `get_experiment(experimenter, index)`
- `get_log_count(experimenter)`
- `get_log(experimenter, index)`
- `get_global_stats()`
- `has_profile(experimenter)`

Stored data:

- per-wallet experimenter profiles
- per-wallet experiment definitions
- public aggregate contract stats

Validation:

- display name: `3-32` characters
- experiment title: `3-48` characters
- experiment duration: `7`, `14`, or `30` days
- one compliance log per experiment per day

Result model:

- experiments start as `active`
- experiments settle to `succeeded` or `failed`
- success is currently defined as reaching at least `80%` compliance across the fixed duration
- overdue experiments can be finalized on-chain if they were not settled during the final daily log

### Frontend

Location: [`frontend/src`](./frontend/src)

Frontend stack:

- React + Vite
- TanStack Query
- Freighter wallet integration
- Soroban RPC reads and writes through `@stellar/stellar-sdk`

Frontend capabilities:

- profile save flow for wallet-backed identity
- experiment creation and daily compliance logging
- active experiment and completed result cards
- public Soroban event feed polling
- responsive desktop and mobile layout

## Events

ExperimentX emits the following public contract events:

- `profile_saved`
- `experiment_created`
- `compliance_logged`
- `experiment_succeeded`
- `experiment_failed`

These events drive the public activity feed and make experiment results visible even when no wallet is connected.

## Deployment Notes

- Network: `Stellar Testnet`
- Contract alias: `experiment_x`
- Current contract ID: `CCGHRJRNERJDETUKJ57IZWNKUULS2X7AR5OKGA2AKCJI2BYZGXSK3DDU`
- Contract explorer: `https://lab.stellar.org/r/testnet/contract/CCGHRJRNERJDETUKJ57IZWNKUULS2X7AR5OKGA2AKCJI2BYZGXSK3DDU`
- Deployment record: [`deployments/testnet.json`](./deployments/testnet.json)

Deployment transactions:

- WASM upload tx: `https://stellar.expert/explorer/testnet/tx/a139aab0328fa57b5d7a468edbc9dc0f3b22f665de227ee30008591acac1f58e`
- Contract deploy tx: `https://stellar.expert/explorer/testnet/tx/5e7cf23681b0a6d1c7c29a0aab8fe9411a13def1e5a62a82eac2e227ec4fb38d`

Verification transactions:

- Profile save tx: `https://stellar.expert/explorer/testnet/tx/5e5fb3bff31cb485304d93e2c9f64b56425c66da0a407c977120946e36fe468d`
- Experiment creation tx: `https://stellar.expert/explorer/testnet/tx/e87bc05112ac7a2d96d40f63b8b57252f90757c192df8312403c47df9297c7e1`

## Local Setup

### 1. Install dependencies

```powershell
npm install
```

### 2. Run contract tests

```powershell
npm run contract:test
```

### 3. Export frontend config

```powershell
npm run export:frontend
```

### 4. Build the frontend

```powershell
npm run build:frontend
```

### 5. Start the app locally

```powershell
npm run dev
```

## Environment Example

Use `.env.example` as the base:

```env
STELLAR_ACCOUNT=alice
STELLAR_NETWORK=testnet
STELLAR_CONTRACT_ALIAS=experiment_x
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_CONTRACT_ID=
```

## Build, Test, and Deploy Commands

### Contract test suite

```powershell
npm run contract:test
```

### Contract wasm build

```powershell
npm run contract:wasm
```

### Contract deploy

```powershell
$env:STELLAR_ACCOUNT='alice'
$env:STELLAR_NETWORK='testnet'
$env:STELLAR_CONTRACT_ALIAS='experiment_x'
npm run contract:deploy
```

### Frontend config export

```powershell
npm run export:frontend
```

### Frontend production build

```powershell
npm run build:frontend
```

### Production deploy

```powershell
npx --yes vercel@latest deploy --prod --yes
```

## Verification Steps

### Contract verification

After deployment, verify a fresh ExperimentX contract with commands like:

```powershell
stellar contract invoke --id YOUR_CONTRACT_ID --source-account alice --network testnet -- get_global_stats
stellar contract invoke --id YOUR_CONTRACT_ID --source-account alice --network testnet -- get_dashboard --experimenter YOUR_PUBLIC_KEY
```

### Frontend verification

1. Open the local or deployed frontend.
2. Confirm the contract panel shows the exported ExperimentX contract ID.
3. Connect Freighter on Stellar Testnet.
4. Save a profile, launch an experiment, and log a daily compliance entry.
5. Confirm the transaction link opens in Stellar Expert.
6. Confirm the public contract activity feed refreshes with new ExperimentX events.

## Current Status Note

- Local contract tests pass, including the compliance flow, and the frontend build and CI pipeline are green.
- The latest live testnet deployment and profile or experiment creation writes are working.
- `log_compliance` is still hitting a Soroban testnet-only runtime trap when invoked against the live deployed contract, even though the same path passes in local contract tests. This needs one more round of live-chain debugging before the write flow is fully production-safe.

## Screenshots

### Desktop UI

![Desktop UI](./ui%20ss.png)

### Mobile UI

![Mobile UI](./mobile%20ss.png)

### CI/CD Pipeline

![CI/CD Pipeline](./ci%20cd%20ss.png)

## Inter-contract and Token Notes

- Inter-contract calls: `Not used in this version`
- Transaction hash for inter-contract calls: `Not applicable`
- Custom token deployed: `No`
- Liquidity pool deployed: `No`
- Token or pool address: `Not applicable`
