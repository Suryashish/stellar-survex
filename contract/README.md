# Survex — Soroban Contracts

This workspace holds the two Soroban smart contracts that back the Survex dApp.

## Workspace layout

```text
.
├── contracts/
│   ├── hello-world/          # SurveyBuilder — survey lifecycle, escrow, co-admins, visibility
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   └── points-token/         # SurvexPointsToken — reward token (mint, transfer, balance)
│       ├── src/lib.rs
│       └── Cargo.toml
├── Cargo.toml                # Workspace manifest (includes both crates via contracts/*)
└── README.md
```

The top-level [Cargo.toml](Cargo.toml) is a Cargo workspace; both crates inherit `soroban-sdk` from `[workspace.dependencies]` and the same release profile.

## Contracts

### `hello-world` — SurveyBuilder

The main survey contract. Handles:

- Survey CRUD (`create_survey`, `pause_survey`, `resume_survey`, `extend_survey`, `close_survey`, `withdraw_unused_funds`).
- XLM reward escrow — total `reward × max_responses` is held inside the contract on creation and paid out atomically per `submit_response`.
- Co-admins — original creator can `add_co_admin` / `remove_co_admin`; admin or co-admin authorisation for lifecycle and list management.
- Public / Private visibility — `set_visibility`, `add_allowed_viewers`, `remove_allowed_viewer`. Private surveys reject submissions from non-listed wallets via `NotAllowedViewer`.
- Response whitelist (orthogonal to visibility) — `enable_whitelist`, `add_to_whitelist`.
- Cross-contract minting — calls `mint()` on the `points-token` contract during `create_survey` and `submit_response` when the points integration is configured. The typed client is declared inline via `#[contractclient]` so this crate doesn't depend on the `points-token` source.

### `points-token` — SurvexPointsToken

A small Soroban token contract used for reward points (e.g. `SXP`, "Survex Points").

- One-time `initialize(admin, name, symbol, decimals)`.
- Admin-controlled `set_minter(minter)` — authorises a single contract address (the survey contract) to mint.
- `mint(caller, to, amount)` — admin or registered minter only.
- `transfer(from, to, amount)`, `balance(addr)`, plus standard `name` / `symbol` / `decimals` / `total_supply` reads.

## Build & deploy

From this directory:

```bash
stellar contract build
```

That produces both WASMs under `target/wasm32v1-none/release/`:

- `points_token.wasm`
- `hello_world.wasm`

Deploy the points token first, then the survey contract:

```bash
stellar contract deploy --wasm target/wasm32v1-none/release/points_token.wasm \
  --source-account alice2 --network testnet
# → POINTS_TOKEN_ID

stellar contract deploy --wasm target/wasm32v1-none/release/hello_world.wasm \
  --source-account alice2 --network testnet
# → CONTRACT_ID
```

After deploying, paste both ids into the frontend at [../lib/stellar.js](../lib/stellar.js) (`CONTRACT_ID` on line 25, `POINTS_TOKEN_ID` on line 33) and finish the wiring from the app's Manage tab — see the root [README](../README.md#wiring-the-points-integration-no-cli-needed) for the four-step setup wizard.
