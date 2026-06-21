# ExperimentX (Stellar / Soroban dApp)

ExperimentX is a Soroban mini-dApp for self-experiment tracking on the Stellar network. Users connect their Freighter wallet, create a public experimenter profile, launch fixed-duration experiments like `No Social Media` or `5AM Wake-Up`, log daily compliance on-chain, and publish transparent success or failure outcomes through live contract events.

This repository represents the fulfillment of **Level 1 (White Belt)**, **Level 2 (Yellow Belt)**, and **Level 3 (Orange Belt)** of the RiseIn Stellar Developer curriculum.

## Live Application
**Live Demo URL:** [Placeholder for Netlify URL]

**Video Walkthrough:** [Placeholder for Video URL]

---

## 📸 Screenshots

*(Add your screenshots here for the final submission)*

### Level 1: Wallet Connection & XLM Transaction
![Wallet Connection & Balance](#)
![XLM Send Transaction Feedback](#)

### Level 2: Smart Contract Interaction
![ExperimentX Dashboard](#)
![Transaction Confirmation Toast](#)

### Level 3: Advanced Features & Event Streaming
![Live Event Feed from Contract](#)
![Mobile Responsive View](#)

---

## Requirements Met

### Level 1 — White Belt (Fundamentals)
- [x] **Wallet Setup:** Configured to run on the Stellar Testnet using the Freighter Wallet.
- [x] **Wallet Connection:** Users can securely **Connect** and **Disconnect** their Freighter wallet from the UI.
- [x] **Balance Handling:** Automatically fetches and displays the connected wallet's native **XLM balance** via Horizon.
- [x] **Transaction Flow:** Provides a dedicated "Send XLM" panel to submit native XLM transfers on the testnet.
- [x] **Transaction Feedback:** Displays success, failure, and transaction hashes with links to stellar.expert.
- [x] **Open Source:** Public GitHub repository under `praveengarakot`.

### Level 2 — Yellow Belt (Contract Integration)
- [x] **Wallet Integration:** Robust wallet connection flow handling missing Freighter extensions and incorrect network selection.
- [x] **Error Handling:** Gracefully catches and displays errors for: (1) Missing wallet extension, (2) Wrong network, and (3) Contract validation failures.
- [x] **Smart Contract Integration:** Fully functional Soroban contract deployed to the Stellar testnet.
- [x] **Frontend Contract Calls:** UI seamlessly invokes contract writes (`save_profile`, `create_experiment`, `log_compliance`) and reads (`get_dashboard`, `get_experiment`).
- [x] **State Visibility:** Real-time visibility into transaction statuses (Pending, Success, Error).
- [x] **Version Control:** 10+ meaningful commits documenting the development process.

### Level 3 — Orange Belt (Advanced Engineering)
- [x] **Advanced Smart Contract:** Complex state management (tracking days, streaks, compliance rates) and comprehensive contract methods.
- [x] **Event Streaming:** React frontend continuously polls the Soroban RPC for live contract events (`profile_saved`, `compliance_logged`), parsing XDR into readable public activity feeds without needing a wallet connection.
- [x] **CI/CD Pipeline:** Fully configured GitHub Actions workflow (`.github/workflows/ci.yml`) handling automated Rust contract builds and React frontend checks on every push.
- [x] **Deployment Workflow:** Automated scripts for contract deployment and frontend config injection.
- [x] **Mobile Responsiveness:** A highly polished, custom-built CSS architecture utilizing grid layouts, flexbox, and dynamic media queries to ensure 100% mobile compatibility.
- [x] **Error Boundaries & Load States:** Uses React Query with optimistic UI loading states and skeleton loaders for smooth async operations.
- [x] **Production Architecture:** Monorepo configuration linking Rust workspaces and Vite.js frontend pipelines cleanly.

---

## Architecture

### Smart contract
Location: [`contracts/experiment_x/src/lib.rs`](./contracts/experiment_x/src/lib.rs)

Core methods:
- `save_profile(experimenter, display_name)`
- `create_experiment(experimenter, title, duration_days)`
- `log_compliance(experimenter, experiment_id, compliant)`
- `finalize_experiment(experimenter, experiment_id)`
- `get_dashboard(experimenter)`
- `get_global_stats()`

Validation:
- Display name: `3-32` characters
- Experiment title: `3-48` characters
- Experiment duration: `7`, `14`, or `30` days
- One compliance log per experiment per day

### Frontend
Location: [`frontend/src`](./frontend/src)

Stack:
- React + Vite
- TanStack Query
- Freighter wallet integration (`@stellar/freighter-api`)
- Soroban RPC reads and writes through `@stellar/stellar-sdk`

---

## Local Development Guide

### Prerequisites
- Node.js `v20+`
- Rust toolchain (`wasm32-unknown-unknown` target)
- Stellar CLI

### Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/praveengarakot/experimentx-soroban.git
   cd experimentx-soroban
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build and Deploy the Smart Contract:**
   Ensure you have a funded Alice keypair on the Stellar Testnet.
   ```bash
   stellar keys generate alice --network testnet --fund
   npm run contract:build
   npm run contract:deploy
   ```

4. **Export Contract Configuration:**
   This writes the deployed contract ID into the frontend config.
   ```bash
   npm run export:frontend
   ```

5. **Run the Frontend Development Server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---
*Developed by praveengarakot*
