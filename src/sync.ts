import chalk from "chalk";
import { openActualSession, ActualTransaction } from "./actual";
import { AppConfig } from "./config";
import {
  Truelayer,
  TruelayerConnectionExpiredError,
  TruelayerTransaction,
} from "./truelayer";
import * as YAML from "yaml";
import { Ntfy } from "./ntfy";
import * as fs from "fs";
import * as path from "path";

export type SyncConfig = {
  map: {
    name: string;
    truelayerAccountId: string;
    actualAccountId: string;
    mapConfig: { invertAmount?: boolean };
  }[];
};

const generateHtmlDashboard = (data: any): string => {
  const commitHash = process.env.GIT_COMMIT_HASH || "unknown";
  const repoLinkText = commitHash !== "unknown" ? `actual-sync-minimal (${commitHash})` : "actual-sync-minimal";
  const repoLinkUrl = commitHash !== "unknown" ? `https://github.com/rr4444/actual-sync-minimal/commit/${commitHash}` : "https://github.com/rr4444/actual-sync-minimal";

  const accountsHtml = data.accounts.map((acc: any, index: number) => {
    const matchStatus = acc.balances.match
      ? `<span class="badge badge-success">Match</span>`
      : `<span class="badge badge-warning">Mismatch</span>`;
      
    const balanceDiff = Math.abs(acc.balances.online - acc.balances.actual);
    const diffText = acc.balances.match
      ? ""
      : `<div class="diff-amount">Difference: ${acc.balances.currency} ${balanceDiff.toFixed(2)}</div>`;

    return `
      <div class="card account-card" onclick="showTransactions(${index})">
        <div class="account-header">
          <h3 class="account-name">${acc.name}</h3>
          ${matchStatus}
        </div>
        <div class="account-body">
          <div class="stat-row">
            <span class="stat-label">Online Balance:</span>
            <span class="stat-value val-online">${acc.balances.currency} ${acc.balances.online?.toFixed(2) ?? "0.00"}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Actual Balance:</span>
            <span class="stat-value val-actual">${acc.balances.currency} ${acc.balances.actual?.toFixed(2) ?? "0.00"}</span>
          </div>
          ${diffText}
          <div class="divider"></div>
          <div class="sync-details">
            <div class="detail-item">
              <span class="detail-label">Added</span>
              <span class="detail-val val-added">${acc.added}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Updated</span>
              <span class="detail-val val-updated">${acc.updated}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Preview</span>
              <span class="detail-val ${acc.updatedPreview > 0 ? "val-preview" : "val-zero"}">${acc.updatedPreview}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Errors</span>
              <span class="detail-val ${acc.errors > 0 ? "val-error" : "val-zero"}">${acc.errors}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("\n");

  const overallStatus = data.overall.balanceMismatches > 0
    ? `<span class="badge badge-warning">Attention Needed</span>`
    : `<span class="badge badge-success">All Synced & Matching</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Actual Sync Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    :root {
      --bg-color: #080c14;
      --card-bg: rgba(17, 24, 39, 0.6);
      --card-border: rgba(255, 255, 255, 0.08);
      --text-primary: #f3f4f6;
      --text-secondary: #9ca3af;
      --text-muted: #6b7280;
      --accent-primary: #3b82f6;
      --accent-success: #10b981;
      --accent-warning: #f59e0b;
      --accent-error: #ef4444;
      --glow-color: rgba(59, 130, 246, 0.15);
    }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg-color);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
      background-image: 
        radial-gradient(circle at 10% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 90% 80%, rgba(16, 185, 129, 0.05) 0%, transparent 40%);
    }
    .container {
      width: 100%;
      max-width: 1200px;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem 2rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
    }
    h1 {
      font-family: 'Outfit', sans-serif;
      font-weight: 800;
      font-size: 1.75rem;
      background: linear-gradient(135deg, #f3f4f6 30%, #9ca3af 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.02em;
    }
    .subtitle {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-top: 0.25rem;
    }
    .header-right {
      text-align: right;
    }
    .last-sync {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .badge-success {
      background-color: rgba(16, 185, 129, 0.12);
      color: var(--accent-success);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .badge-warning {
      background-color: rgba(245, 158, 11, 0.12);
      color: var(--accent-warning);
      border: 1px solid rgba(245, 158, 11, 0.2);
    }
    .overall-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.5rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px var(--glow-color);
    }
    .stat-card-title {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }
    .stat-card-value {
      font-family: 'Outfit', sans-serif;
      font-size: 2rem;
      font-weight: 700;
    }
    .stat-card-value.success {
      color: var(--accent-success);
    }
    .stat-card-value.warning {
      color: var(--accent-warning);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 1.5rem;
    }
    .account-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.75rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .account-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(255, 255, 255, 0.02);
    }
    .account-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .account-name {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.95rem;
      margin-bottom: 0.75rem;
    }
    .stat-label {
      color: var(--text-secondary);
    }
    .stat-value {
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
    }
    .val-online {
      color: var(--text-primary);
    }
    .val-actual {
      color: #93c5fd;
    }
    .diff-amount {
      font-size: 0.8rem;
      color: var(--accent-warning);
      text-align: right;
      margin-top: -0.5rem;
      font-weight: 500;
    }
    .divider {
      height: 1px;
      background-color: var(--card-border);
      width: 100%;
    }
    .sync-details {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      text-align: center;
      gap: 0.5rem;
    }
    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .detail-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .detail-val {
      font-family: 'Outfit', sans-serif;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .val-added {
      color: var(--accent-success);
    }
    .val-updated {
      color: var(--accent-primary);
    }
    .val-preview {
      color: #a855f7;
    }
    .val-zero {
      color: var(--text-muted);
    }
    .val-error {
      color: var(--accent-error);
    }
    /* Clickable accounts styling */
    .account-card {
      cursor: pointer;
      position: relative;
    }
    .account-card::after {
      content: "Click to view recent transactions";
      position: absolute;
      bottom: 0.5rem;
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.7rem;
      color: var(--text-muted);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .account-card:hover::after {
      opacity: 0.8;
    }
    /* Transaction Drawer Styles */
    .drawer-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      z-index: 999;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .drawer-overlay.open {
      opacity: 1;
      pointer-events: auto;
    }
    .transaction-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 100%;
      max-width: 500px;
      height: 100vh;
      background: rgba(8, 12, 20, 0.95);
      backdrop-filter: blur(25px);
      border-left: 1px solid var(--card-border);
      z-index: 1000;
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
    }
    .transaction-drawer.open {
      transform: translateX(0);
    }
    .drawer-header {
      padding: 1.5rem 2rem;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .drawer-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 700;
      background: linear-gradient(135deg, #f3f4f6 30%, #9ca3af 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .close-btn {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text-primary);
      font-size: 1.5rem;
      cursor: pointer;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }
    .close-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .drawer-content {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem 2rem;
    }
    .tx-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    .tx-table th, .tx-table td {
      padding: 0.75rem 0.5rem;
      text-align: left;
    }
    .tx-table th {
      border-bottom: 1px solid var(--card-border);
      color: var(--text-muted);
      font-weight: 500;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    .tx-table tr {
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }
    .tx-date {
      color: var(--text-secondary);
      white-space: nowrap;
      font-family: 'Outfit', sans-serif;
    }
    .tx-payee {
      font-weight: 500;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .match-ok {
      color: var(--text-primary);
    }
    .match-mismatch {
      color: var(--accent-warning);
      font-weight: 600;
    }
    .tx-amount {
      text-align: right;
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
    }
    .tx-credit {
      color: var(--accent-success);
    }
    .tx-updated {
      color: var(--accent-primary);
    }
    .tx-preview {
      color: #a855f7;
    }
    .tx-error {
      color: var(--accent-error);
      font-weight: 600;
    }
    .tx-zero {
      color: var(--text-muted);
    }
    .no-tx {
      text-align: center;
      color: var(--text-muted);
      padding: 2rem 0;
    }
    footer {
      text-align: center;
      margin-top: auto;
      padding-top: 3rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    footer a {
      color: var(--text-secondary);
      text-decoration: none;
    }
    footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Actual Sync Dashboard</h1>
        <div class="subtitle">Real-time platform-agnostic runtime alignment monitoring</div>
      </div>
      <div class="header-right">
        ${overallStatus}
        <div class="last-sync" id="last-sync-time" data-timestamp="${data.lastSyncTime}">Last updated: ${new Date(data.lastSyncTime).toUTCString()}</div>
      </div>
    </header>

    <div class="overall-stats">
      <div class="stat-card">
        <div class="stat-card-title">Accounts Synced</div>
        <div class="stat-card-value">${data.overall.accountSyncs}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-title">New Transactions</div>
        <div class="stat-card-value success">${data.overall.newTransactions}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-title">Balance Mismatches</div>
        <div class="stat-card-value ${data.overall.balanceMismatches > 0 ? "warning" : ""}">${data.overall.balanceMismatches}</div>
      </div>
    </div>

    <div class="grid">
      ${accountsHtml}
    </div>
  </div>

  <div class="drawer-overlay" id="drawer-overlay" onclick="closeDrawer()"></div>
  <div class="transaction-drawer" id="transaction-drawer">
    <div class="drawer-header">
      <h2 class="drawer-title" id="drawer-title">Sync History</h2>
      <button class="close-btn" onclick="closeDrawer()">&times;</button>
    </div>
    <div class="drawer-content">
      <table class="tx-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Online / Actual</th>
            <th style="text-align: right;">Add</th>
            <th style="text-align: right;">Upd</th>
            <th style="text-align: right;">Prv</th>
            <th style="text-align: right;">Err</th>
          </tr>
        </thead>
        <tbody id="drawer-table-body">
          <!-- Dynamic sync history rows inserted here -->
        </tbody>
      </table>
    </div>
  </div>

  <footer>
    <a href="${repoLinkUrl}" target="_blank">${repoLinkText}</a> &bull; <a href="/actual-sync-minimal/data/sync-summary.json" target="_blank">View raw JSON</a>
  </footer>

  <script>
    const accountsData = ${JSON.stringify(data.accounts)};
    
    // Format last updated time in client's local timezone
    const lastSyncEl = document.getElementById('last-sync-time');
    if (lastSyncEl) {
      const timestamp = lastSyncEl.getAttribute('data-timestamp');
      if (timestamp) {
        const date = new Date(timestamp);
        try {
          const formatted = date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
          });
          lastSyncEl.innerText = 'Last updated: ' + formatted;
        } catch (e) {
          lastSyncEl.innerText = 'Last updated: ' + date.toLocaleString();
        }
      }
    }
    
    function showTransactions(accountIndex) {
      const account = accountsData[accountIndex];
      if (!account) return;
      
      const drawer = document.getElementById('transaction-drawer');
      const drawerTitle = document.getElementById('drawer-title');
      const tableBody = document.getElementById('drawer-table-body');
      
      drawerTitle.innerText = account.name + ' - Sync History';
      
      if (!account.history || account.history.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="no-tx">No sync history recorded yet.</td></tr>';
      } else {
        tableBody.innerHTML = account.history.map(run => {
          const matchClass = run.balances.match ? 'match-ok' : 'match-mismatch';
          const date = new Date(run.timestamp);
          const dateStr = date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) + ' ' + 
                          date.toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit', timeZoneName: 'short'});
          return \`
            <tr>
              <td class="tx-date">\${dateStr}</td>
              <td class="tx-payee \${matchClass}">
                \${account.balances.currency} \${run.balances.online.toFixed(2)} / 
                \${account.balances.currency} \${run.balances.actual.toFixed(2)}
              </td>
              <td class="tx-amount tx-credit">\${run.added}</td>
              <td class="tx-amount tx-updated">\${run.updated}</td>
              <td class="tx-amount tx-preview">\${run.updatedPreview}</td>
              <td class="tx-amount \${run.errors > 0 ? 'tx-error' : 'tx-zero'}">\${run.errors}</td>
            </tr>
          \`;
        }).join('');
      }
      
      drawer.classList.add('open');
      document.getElementById('drawer-overlay').classList.add('open');
    }

    function closeDrawer() {
      document.getElementById('transaction-drawer').classList.remove('open');
      document.getElementById('drawer-overlay').classList.remove('open');
    }

    // Keyboard support (Escape key to close drawer)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDrawer();
      }
    });
  </script>
</body>
</html>`;
};

export const Sync = (config: AppConfig) => {
  const mapTx = (
    tx: TruelayerTransaction,
    accountId: string,
    mapConfig: { invertAmount?: boolean },
  ): ActualTransaction => {
    const date = new Date(tx.timestamp);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");

    return {
      account: accountId,
      date: `${yyyy}-${mm}-${dd}`,
      amount: (mapConfig.invertAmount ? -1 : +1) * Math.round(tx.amount * 100),
      notes: tx.description,
      imported_id: tx.transaction_id,
      payee_name:
        tx.meta.provider_merchant_name ??
        tx.meta.counter_party_preferred_name ??
        tx.description,
      cleared: false,
    };
  };

  const sync = async () => {
    const actual = await openActualSession(config.actual);
    try {
      const truelayer = Truelayer(config.truelayer);
      const actualAccounts = await actual.listAccounts();
      const truelayerAccounts = truelayer.listAccounts();
      let syncResult = {
        accountSyncs: 0,
        newTransactions: 0,
        balanceMismatches: 0,
        mismatchedBanks: [] as string[],
      };
      
      const dashboardDir = process.env.DASHBOARD_DATA_DIR || "/app/data";
      let existingDashboardData: any = null;
      try {
        const jsonPath = path.join(dashboardDir, "sync-summary.json");
        if (fs.existsSync(jsonPath)) {
          existingDashboardData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        }
      } catch (e) {
        // ignore errors
      }

      let dashboardData = {
        lastSyncTime: new Date().toISOString(),
        overall: {
          accountSyncs: 0,
          newTransactions: 0,
          balanceMismatches: 0,
          mismatchedBanks: [] as string[],
        },
        accounts: [] as any[],
      };

      for (var syncConfig of config.sync.map) {
        console.log(
          chalk.bold.bgYellow(`\nSync transactions for ${syncConfig.name}`),
        );
        const actualAccount = actualAccounts.find(
          (a) => a.id === syncConfig.actualAccountId,
        );
        const truelayerAccount = truelayerAccounts.find(
          (a) => a.id === syncConfig.truelayerAccountId,
        );
        if (!actualAccount)
          throw new Error(
            `Actual account id ${syncConfig.actualAccountId} not found for bank "${syncConfig.name}". Check your sync config`,
          );
        if (!truelayerAccount)
          throw new Error(
            `Truelayer account id ${syncConfig.truelayerAccountId} not found for bank "${syncConfig.name}". Check your sync config`,
          );
        const truelayerTransactions = await truelayer
          .getTransactions(truelayerAccount)
          .catch((error) => {
            if (error instanceof TruelayerConnectionExpiredError)
              throw new TruelayerConnectionExpiredError(syncConfig.name);
            throw new Error(
              `Failed to get transactions for bank "${syncConfig.name}": ${error.message || error}`,
            );
          });
        const actualTransactions = truelayerTransactions.map((t) =>
          mapTx(t, syncConfig.actualAccountId, syncConfig.mapConfig),
        );
        const report = await actual.loadTransactions(
          syncConfig.actualAccountId,
          actualTransactions,
        );
        console.log(chalk.green("Sync result"));
        console.log(YAML.stringify(report, null, 2));
        // verify balances
        const truelayerBalance = await truelayer
          .getBalance(truelayerAccount)
          .catch((error) => {
            if (error instanceof TruelayerConnectionExpiredError)
              throw new TruelayerConnectionExpiredError(syncConfig.name);
            throw new Error(
              `Failed to get balance for bank "${syncConfig.name}": ${error.message || error}`,
            );
          });
        const actualBalance = await actual.getBalance(actualAccount.id);
        const sign = truelayerAccount.type === "CARD" ? -1 : 1;
        syncResult.newTransactions += report.added;
        
        const isMatch = truelayerBalance?.current === (actualBalance / 100) * sign;
        
        const existingAcc = existingDashboardData?.accounts?.find(
          (a: any) => a.actualAccountId === syncConfig.actualAccountId
        );
        const existingHistory = existingAcc?.history || [];
        
        const currentHistoryEntry = {
          timestamp: new Date().toISOString(),
          added: report.added,
          updated: report.updated,
          updatedPreview: report.updatedPreview,
          errors: report.errors,
          balances: {
            online: truelayerBalance?.current ?? 0,
            actual: (actualBalance / 100) * sign,
            match: isMatch
          }
        };

        const accountHistory = [currentHistoryEntry, ...existingHistory].slice(0, 20);

        dashboardData.accounts.push({
          name: syncConfig.name,
          truelayerAccountId: syncConfig.truelayerAccountId,
          actualAccountId: syncConfig.actualAccountId,
          added: report.added,
          updated: report.updated,
          errors: report.errors,
          updatedPreview: report.updatedPreview,
          balances: {
            online: truelayerBalance?.current ?? 0,
            actual: (actualBalance / 100) * sign,
            match: isMatch,
            currency: truelayerBalance?.currency || "GBP",
          },
          history: accountHistory
        });

        if (isMatch)
          console.log(chalk.green(`Account balances match`));
        else {
          syncResult.balanceMismatches += 1;
          syncResult.mismatchedBanks.push(syncConfig.name);
          console.log(chalk.red(`Account balances DO NOT match`));
          console.log(chalk.green("\nOnline balance"));
          console.log(YAML.stringify(truelayerBalance, null, 2));
          console.log(chalk.green("\nActual balance"));
          console.log(actualBalance / 100);
        }
        syncResult.accountSyncs += 1;
      }

      // Populate overall stats
      dashboardData.overall = {
        accountSyncs: syncResult.accountSyncs,
        newTransactions: syncResult.newTransactions,
        balanceMismatches: syncResult.balanceMismatches,
        mismatchedBanks: syncResult.mismatchedBanks,
      };

      // Write dashboard outputs to disk
      try {
        if (!fs.existsSync(dashboardDir)) {
          fs.mkdirSync(dashboardDir, { recursive: true });
        }
        
        const jsonPath = path.join(dashboardDir, "sync-summary.json");
        fs.writeFileSync(jsonPath, JSON.stringify(dashboardData, null, 2), "utf8");
        console.log(chalk.green(`\n📊 Raw dashboard JSON written to ${jsonPath}`));
        
        const htmlPath = path.join(dashboardDir, "index.html");
        fs.writeFileSync(htmlPath, generateHtmlDashboard(dashboardData), "utf8");
        console.log(chalk.green(`🖥️  Beautiful HTML dashboard written to ${htmlPath}`));
      } catch (err) {
        console.error(chalk.red("\n❌ Failed to write dashboard summary files:"), err);
      }

      if (config.ntfy) {
        console.log(chalk.blue("\n📱 Sending notification..."));
        const hasIssues = syncResult.balanceMismatches > 0;
        const title = hasIssues
          ? "Actual Sync - Issues Detected"
          : "Actual Sync Completed";
        const tags = hasIssues
          ? ["warning", "bank"]
          : ["white_check_mark", "bank"];

        const body = [
          `Sync Summary`,
          `- Accounts synced: ${syncResult.accountSyncs}`,
          `- New transactions: ${syncResult.newTransactions}`,
          `- Balance mismatches: ${syncResult.balanceMismatches}`,
          "",
          hasIssues
            ? `Balance mismatches detected in: ${syncResult.mismatchedBanks.join(", ")}`
            : "All accounts synced successfully with matching balances!",
        ].join("\n");

        try {
          await Ntfy(config.ntfy).post({
            title,
            body,
            tags,
            priority: hasIssues ? "high" : "default",
          });
        } catch (error) {
          console.error(chalk.red("Failed to send notification:"), error);
        }
      }
    } finally {
      await actual.shutdown();
    }
  };

  return { sync };
};
