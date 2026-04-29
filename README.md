# Survex — On-Chain Surveys on Stellar Soroban

A decentralized survey-builder dApp where creators publish surveys on-chain, escrow XLM rewards in a Soroban smart contract, and respondents get paid automatically the moment they submit a valid response. Built with React + Vite on the frontend and a Rust/Soroban smart contract on the Stellar Testnet.

> **Live demo:** https://survex.vercel.app
>
> _(Replace with your actual deployment URL — Vercel / Netlify / GitHub Pages.)_

---

## Highlights

- **Trustless reward escrow** — total payout (`reward × max_responses`) is locked inside the contract on creation; payouts happen atomically on `submit_response`.
- **Wallet-level dedup** — one response per address per survey, enforced on-chain.
- **Optional whitelist** — creators can gate participation to a fixed address list.
- **Lifecycle controls** — pause, resume, extend, close, and withdraw unused funds (`withdraw_unused_funds`) once a survey is closed or expired.
- **Freighter wallet** integration for signing.
- **CSV export** of all responses for analytics.
- **Fully mobile-responsive** UI.

---

## Screenshots

### Desktop — Explore & Create
![Desktop overview](pictures/1.jpg)

### Mobile — Responsive view
![Mobile responsive view](pictures/2.jpg)

### Survey detail & response submission
![Survey detail](pictures/3.jpg)

### Manage panel — pause / extend / withdraw
![Manage panel](pictures/4.jpg)

### Analytics & CSV export
![Analytics](pictures/5.jpg)

---

## CI/CD

[![Vercel Deployment](https://img.shields.io/badge/Vercel-Deployed-black?logo=vercel)](https://survex.vercel.app)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](#)

Pipeline screenshot:

![CI/CD pipeline](pictures/6.jpg)

_Auto-deployed on every push to `main` via Vercel. Replace the badge URLs with your real project links once connected._

---

## Contract Addresses (Stellar Testnet)

| Purpose | Address |
| --- | --- |
| **SurveyBuilder contract** | `CDKBFFYYMW2WFKMYWT6DHSSPUUZPHMXG5WDZGJ5562OCGDTNV5OYED5P` |
| **Native XLM Stellar Asset Contract (reward token)** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Network | `Testnet` (`Test SDF Network ; September 2015`) |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |

View the deployed contract on [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDKBFFYYMW2WFKMYWT6DHSSPUUZPHMXG5WDZGJ5562OCGDTNV5OYED5P).

Configured in [lib/stellar.js](lib/stellar.js#L25-L30).

---

## Tech Stack

- **Frontend** — React 19, Vite 8
- **Wallet** — `@stellar/freighter-api`
- **Chain SDK** — `@stellar/stellar-sdk` (Soroban RPC client)
- **Smart contract** — Rust + `soroban-sdk` (`#![no_std]`)
- **Hosting** — Vercel (frontend) + Stellar Testnet (contract)

---

## Project Structure

```
.
├── contract/                 # Soroban smart contract (Rust)
│   └── contracts/hello-world/src/lib.rs
├── lib/stellar.js            # Contract bindings, RPC client, helpers
├── src/
│   ├── App.jsx               # Root app + routing
│   ├── pages/                # Explore / Create / Manage / Analytics / SharedRespond
│   ├── components/           # Field, Section, TxDrawer, PaymentModal, etc.
│   └── utils/                # constants, survey helpers, CSV export
├── pictures/                 # README screenshots (1.jpg … 6.jpg)
└── package.json
```

---

## Smart Contract API

Defined in [contract/contracts/hello-world/src/lib.rs](contract/contracts/hello-world/src/lib.rs).

**Mutating**
- `create_survey(id, creator, title, description, questions, end_time, max_responses, reward_per_response, reward_token)` — escrows `reward × max_responses` upfront.
- `pause_survey` / `resume_survey` / `close_survey` / `extend_survey`
- `enable_whitelist` / `add_to_whitelist`
- `submit_response(survey_id, respondent, answers)` — auto-pays from escrow.
- `withdraw_unused_funds(id, creator)` — refund leftover escrow once closed/expired.

**Read-only**
- `get_survey`, `list_surveys`, `get_total_count`
- `get_response_count`, `has_responded`, `is_accepting_responses`
- `get_responses`

---

## Getting Started

### Prerequisites
- Node.js 18+
- [Freighter Wallet](https://www.freighter.app/) (Testnet mode, funded via friendbot)
- Rust + `stellar-cli` (only if you want to rebuild/redeploy the contract)

### Run the frontend

```bash
npm install
npm run dev
```

Open http://localhost:5173 and connect Freighter on Testnet.

### Build for production

```bash
npm run build
npm run preview
```

### Rebuild & redeploy the contract

From [personal.md](personal.md):

```bash
cd contract
stellar contract build
stellar keys generate alice2
stellar keys fund alice2 --network testnet
stellar contract deploy \
  --wasm target/wasm32v1-none/release/hello_world.wasm \
  --source-account alice2 \
  --network testnet
```

After redeploying, update `CONTRACT_ID` in [lib/stellar.js](lib/stellar.js#L25).

---

## Deploying the frontend to Vercel

1. Push this repo to GitHub.
2. Import the project at [vercel.com/new](https://vercel.com/new).
3. Framework preset: **Vite**. Build command: `npm run build`. Output dir: `dist`.
4. Deploy — every push to `main` triggers an automatic rebuild.

---

## License

MIT
