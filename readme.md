# Actual Sync (Minimal Fork)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> [!IMPORTANT]
> **IaC & Self-Alignment Architecture**
> This repository is a specialized fork of `andrewinci/actual-sync` designed to maximize **Infrastructure as Code (IaC) idempotency**, deployment maintainability, and container self-healing.
> 
> In traditional containerized deployments, aligning a client API library with the server version requires host-side scripting, build-time overrides, or manual recompilations. This creates fragile, platform-dependent builds that violate declarative IaC principles.
> 
> To enforce absolute deployment idempotency, this fork shifts the version alignment from build-time to **runtime**. The container dynamically boots, self-inspects, and upgrades its `@actual-app/api` library to match the target Actual Budget server on the fly—driven declaratively by environment variables or configuration files. This results in:
> * **Zero Build Hacks:** No more `sed` regex patches or custom shell wrapper scripts in your deployment playbooks.
> * **Platform Agnosticism:** Standardized Docker builds that run identically on Kubernetes, bare metal, or raw Docker (once configuration data is created)
> * **Declarative Upgrades:** Upgrading your Actual server version setting automatically triggers a dynamic library alignment in the sync container upon its next scheduled run.

---

A minimal command-line tool that automatically syncs bank transactions from various financial providers directly into [Actual Budget](https://actualbudget.org/).

## ✨ Features

- 🔄 **Automatic Transaction Sync** - Import transactions from supported banks
- 🏦 **Multi-Bank Support** - Connect multiple accounts from different providers
- 📊 **Flexible Account Mapping** - Configure how accounts sync to Actual Budget
- 🔔 **Notifications** - Optional ntfy integration for sync status notifications
- 🐋 **Docker Ready** - Easy deployment and containerization

## 🔄 Dynamic Runtime API Alignment

To ensure compatibility with your self-hosted [Actual Budget](https://actualbudget.org/) server without lagging behind or suffering from out-of-sync database migrations, this fork features an **automatic runtime self-updater**.

Instead of hardcoding a static version of `@actual-app/api` during image build time, the application programmatically aligns its dependencies **on the fly at startup** to match your server's API version. This guarantees the client remains perfectly up-to-date with your Actual server without requiring you to manually rebuild Docker images or patch package files.

### How it works
On startup, the application checks for a target version via two pathways:
1. **Environment Variable:** `ACTUAL_API_VERSION` (Recommended for containerized environments like Kubernetes).
2. **Configuration File:** `actual.apiVersion` property inside your `.config.yml` (Recommended for bare-metal or standard Docker).

If the currently installed library version in `node_modules` does not match the target version, the application programmatically downloads and installs the matching `@actual-app/api` version from the npm registry instantly (taking only ~3 seconds) before running the sync command.

### Configuration

#### Option A: Via Environment Variable (Docker/Kubernetes)
Pass the target version directly as an environment variable in your container specification:
```yaml
env:
  - name: ACTUAL_API_VERSION
    value: "26.4.0" # Match your Actual server version
```

#### Option B: Via Configuration File (`.config.yml`)
Add the `apiVersion` property under the `actual` section of your configuration file:
```yaml
actual:
  password: "your-actual-password"
  syncId: "your-sync-id"
  url: "https://your-actual-server.com"
  apiVersion: "26.4.0" # Match your Actual server version
```

## 🏦 Supported Providers

- **[TrueLayer](https://truelayer.com/)** - Connect to 300+ banks across UK and Europe
- **Trading 212** - _Coming soon_

## 📊 Monitoring Dashboard

This fork features a basic **visual observability dashboard** that generates dynamic monitoring assets automatically at the conclusion of every sync cycle, making it appropriate for contexts where cron/cronjobs are used.

### Key Features
* **Real-Time Alignment Status:** Displays bank-specific online balances in comparison with your local Actual Budget ledger balances.
* **Persistent Sync History:** Maintains a rolling history of the **last 20 sync execution runs** (capturing exact timestamps, balances, and counts of Added, Updated, Preview/Staged, and Error items) saved completely offline inside a persistent volume.
* **Chronological History Drawer:** A responsive, glassmorphic slide-out panel accessible by clicking any bank card, color-coded to instantly highlight ledger/bank alignment (`🟢 Match` / `🔴 Mismatch`).
* **Zero Host Dependencies:** Rendered static and served by a lightweight Nginx sidecar mounted to a shared PVC.

### How it works
At the end of a sync cycle, `actual-sync` outputs:
1. `sync-summary.json`: The raw structured monitoring state (including rolling historical execution records).
2. `index.html`: A premium visual single-page application dashboard featuring HSL tailored colors, dark-mode styling, glassmorphism, responsive alignment, and interactive keyboard/overlay panel control.

### Serving the Dashboard 24/7 (Kubernetes/Docker)
To serve the dashboard continuously even when the sync CronJob is idle, run a lightweight Nginx container sharing a `PersistentVolumeClaim` with your sync executor:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: actual-sync-dashboard
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: nginx
        image: nginx:alpine
        volumeMounts:
        - name: dashboard-data
          mountPath: /usr/share/nginx/html/actual-sync-minimal
      volumes:
      - name: dashboard-data
        persistentVolumeClaim:
          claimName: actual-sync-dashboard-pvc
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ or Docker
- An [Actual Budget](https://actualbudget.org/) server instance
- Account with a supported financial provider (e.g., TrueLayer)

### Installation

#### Using pnpm (Recommended)

```bash
git clone https://github.com/andrewinci/actual-sync.git
cd actual-sync
pnpm install
pnpm run build
```

#### Using Docker

```bash
# Use pre-built image from GitHub Container Registry
docker pull ghcr.io/andrewinci/actual-sync:latest

# Or build locally
git clone https://github.com/andrewinci/actual-sync.git
cd actual-sync
docker build -t actual-sync .
```

## 📖 Usage

1. **Create a configuration file**:

   ```bash
   ./actual-sync config create
   ```

2. **Edit the generated `.config.yml`** with your credentials:

   ```yaml
   actual:
     password: "your-actual-password"
     syncId: "your-sync-id" # Found in Actual Settings > Advanced
     url: "https://your-actual-server.com" # or "localhost" for local
     cacheDir: ".cache/"

   truelayer:
     redirectUri: "https://console.truelayer.com/redirect-page"
     clientId: "your-truelayer-client-id"
     clientSecret: "your-truelayer-client-secret"
   ```

3. **Add Truelayer accounts following the wizard**
   ```bash
   ./actual-sync truelayer add-account
   ```
4. **List the Actual budget accounts**
   ```bash
   ./actual-sync actual list-accounts
   ```
5. **List the Truelayer accounts**
   ```bash
   ./actual-sync truelayer list-accounts
   ```
6. **Add sync configurations**
   ```yaml
   sync:
     map:
       - name: Amex
         truelayerAccountId: truelayer-sample-id-amex
         actualAccountId: actual-budget-sample-account-id-amex
         mapConfig:
           invertAmount: true
   ```
7. **Run sync**
   ```bash
   ./actual-sync sync
   ```

## 📋 Command Reference

| Command                                   | Description                              |
| ----------------------------------------- | ---------------------------------------- |
| `config create`                           | Create a default configuration file      |
| `actual list-accounts`                    | List all Actual Budget accounts          |
| `truelayer add-account`                   | Add TrueLayer bank accounts via OAuth    |
| `truelayer list-accounts`                 | List configured TrueLayer accounts       |
| `truelayer list-transactions <accountId>` | View transactions for a specific account |
| `truelayer get-balance <accountId>`       | Check balance for a specific account     |
| `sync`                                    | Synchronize all configured accounts      |

## 📄 Configuration File Reference

```yaml
actual:
  password: "your-actual-password"
  syncId: "your-sync-id" # Found in Actual Settings > Advanced
  url: "https://your-actual-server.com" # or "localhost" for local
  cacheDir: ".cache/"
# Optional: Get notifications via ntfy (https://ntfy.sh)
ntfy:
  url: "https://ntfy.sh" # or your self-hosted ntfy server
  topic: "your-topic-name" # choose a topic name
truelayer:
  redirectUri: "https://console.truelayer.com/redirect-page" #no need to change this uri
  # you need a truelayer live app to get the below clientId and secret
  clientId: "your-truelayer-client-id"
  clientSecret: "your-truelayer-client-secret"
  # use the `truelayer add-account` command to generate the below
  accounts:
    - id: truelayer-sample-id-amex
      name: Amex # set the name you prefer
      type: CARD
      refreshToken: ....
    - id: truelayer-sample-id-monzo
      name: Monzo
      type: ACCOUNT
      refreshToken: ....
    - id: truelayer-sample-id-starling
      name: Starling
      type: ACCOUNT
      refreshToken: ....
sync:
  # manually create the map below to match truelayer accounts to actual
  map:
    - name: Amex # set the name you prefer
      truelayerAccountId: truelayer-sample-id-amex
      actualAccountId: actual-budget-sample-account-id-amex
      mapConfig:
        invertAmount: true # use this for credit cards for example
    - name: Monzo
      truelayerAccountId: truelayer-sample-id-monzo
      actualAccountId: actual-budget-sample-account-id-monzo
      mapConfig: {}
    - name: Starling
      truelayerAccountId: truelayer-sample-id-starling
      actualAccountId: actual-budget-sample-account-id-starling
      mapConfig: {}
# Optional: Get notifications via ntfy (https://ntfy.sh)
ntfy:
  url: "https://ntfy.sh" # or your self-hosted ntfy server
  topic: "your-topic-name" # choose a unique topic name
```

## 🔔 Notifications

Actual-sync supports optional notifications via [ntfy](https://ntfy.sh) to keep you informed about sync status.

### Configuration

Add the `ntfy` section to your `.config.yml`:

```yaml
ntfy:
  url: "https://ntfy.sh" # or your self-hosted ntfy server URL
  topic: "your-unique-topic-name" # choose a topic name
```

## 🚀 Deployment

### ☸️ Kubernetes with Helm

The easiest way to deploy actual-sync to Kubernetes is using the included Helm chart. The deployment creates a CronJob that automatically syncs your bank transactions every 4 hours.

#### Prerequisites

- Kubernetes cluster
- Helm 3.x installed
- A `.config.yml` file with your credentials

#### Installation

1. **Deploy using your local configuration file:**

   ```bash
   # Create namespace and install with your config
   helm upgrade --install actual-sync ./helm \
     --set config.create=true \
     --set-file config.data=.config.yml \
     -n actual-sync --create-namespace
   ```

2. **Or use an existing ConfigMap:**
   ```bash
   # If you already have a ConfigMap named 'my-config'
   helm upgrade --install actual-sync ./helm \
     --set existingConfigMap=my-config \
     -n actual-sync --create-namespace
   ```

## 🔧 Development

### Setup

```bash
git clone https://github.com/andrewinci/actual-sync.git
cd actual-sync
pnpm install
```

### Available Scripts

- `pnpm run dev` - Run in development mode with ts-node
- `pnpm run build` - Build the application
- `pnpm run pretty` - Format code with Prettier

## 🐳 Docker

Docker images are automatically built and published to GitHub Container Registry on every release.

### Pre-built Images

```bash
# Pull the latest image
docker pull ghcr.io/andrewinci/actual-sync:latest

# Pull a specific version
docker pull ghcr.io/andrewinci/actual-sync:v1.0.0
```

### Build Locally

```bash
docker build -t actual-sync .
```

### Run

```bash
# Use pre-built image from GitHub Container Registry
docker run -e CONFIG_FILE_PATH=/config/.config.yml \
  -v ${PWD}/:/config/ \
  ghcr.io/andrewinci/actual-sync:latest [command]

# Examples:
# List accounts
docker run -e CONFIG_FILE_PATH=/config/.config.yml \
  -v ${PWD}/:/config/ \
  ghcr.io/andrewinci/actual-sync:latest actual list-accounts

# Run sync
docker run -e CONFIG_FILE_PATH=/config/.config.yml \
  -v ${PWD}/:/config/ \
  ghcr.io/andrewinci/actual-sync:latest sync
```

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This project is not officially associated with Actual Budget, TrueLayer, or any other financial institutions. Use at your own risk and always verify your financial data. The developers are not responsible for any financial discrepancies or data loss.
