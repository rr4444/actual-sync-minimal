import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import { AppConfig } from "./config";
import { generateHtmlDashboard } from "./sync";

// Interface for Job Info
interface JobInfo {
  status: "pending" | "running" | "success" | "failed";
  logs: string;
}

// In-memory jobs store for local mode
const localJobs = new Map<string, JobInfo>();

// In-memory cache for K8s jobs
const k8sJobLogsCache = new Map<string, JobInfo>();

// Kubernetes config helper
const getK8sConfig = () => {
  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token";
  const caPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
  const namespacePath = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

  if (!fs.existsSync(tokenPath)) {
    return null;
  }

  try {
    return {
      token: fs.readFileSync(tokenPath, "utf8").trim(),
      ca: fs.readFileSync(caPath),
      namespace: fs.readFileSync(namespacePath, "utf8").trim(),
      host: "kubernetes.default.svc",
    };
  } catch (err) {
    console.error("Failed to read K8s service account credentials:", err);
    return null;
  }
};

// Kubernetes API request helper using built-in https module
const k8sRequest = (
  config: any,
  method: string,
  urlPath: string,
  body?: any
): Promise<any> => {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: config.host,
      port: 443,
      path: urlPath,
      method: method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      ca: config.ca,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`K8s API responded with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

export const startServer = (config: AppConfig, port: number = 8080) => {
  const k8s = getK8sConfig();
  const isK8s = k8s !== null;
  const cronjobName = process.env.ACTUAL_SYNC_CRONJOB_NAME || "actual-bank-sync";
  const dashboardDir = process.env.DASHBOARD_DATA_DIR || "/app/data";

  console.log(
    chalk.cyan(
      `Booting actual-sync dashboard backend (Mode: ${isK8s ? "Kubernetes" : "Local"}, Port: ${port})`
    )
  );

  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || "/";
    const parsedUrl = new URL(url, `http://${req.headers.host || "localhost"}`);
    let pathname = parsedUrl.pathname;

    // Strip Traefik subpath prefix if present
    if (pathname.startsWith("/actual-sync-minimal")) {
      pathname = pathname.substring("/actual-sync-minimal".length);
    }
    if (pathname === "") {
      pathname = "/";
    }

    // --- Serve static files ---
    if (pathname === "/" || pathname === "/index.html") {
      const summaryPath = path.join(dashboardDir, "sync-summary.json");
      if (fs.existsSync(summaryPath)) {
        try {
          const summaryData = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(generateHtmlDashboard(summaryData));
          return;
        } catch (err: any) {
          console.error("Failed to dynamically generate dashboard:", err);
        }
      }

      const filePath = path.join(dashboardDir, "index.html");
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Actual Sync Dashboard</title>
            <style>
              body { background: #080c14; color: #f3f4f6; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: rgba(17, 24, 39, 0.6); padding: 2rem; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); text-align: center; max-width: 450px; }
              button { background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 1rem; }
              button:hover { background: #2563eb; }
              #console { display: none; margin-top: 1.5rem; background: black; padding: 1rem; border-radius: 8px; text-align: left; max-height: 200px; overflow-y: auto; font-family: monospace; white-space: pre-wrap; font-size: 0.85rem; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>Dashboard Initializing</h2>
              <p>The visual sync dashboard has not been generated yet because no sync has run.</p>
              <button id="runBtn" onclick="runSync()">Run Initial Sync</button>
              <div id="console"></div>
            </div>
            <script>
              let basePath = window.location.pathname;
              if (!basePath.endsWith('/')) basePath += '/';
              async function runSync() {
                const btn = document.getElementById('runBtn');
                const consoleDiv = document.getElementById('console');
                btn.disabled = true;
                btn.innerText = 'Syncing...';
                consoleDiv.style.display = 'block';
                consoleDiv.innerText = 'Initializing sync run...\\n';
                try {
                  const res = await fetch(basePath + 'api/run', { method: 'POST' });
                  const data = await res.json();
                  if (data.job_id) {
                    pollLogs(data.job_id);
                  } else {
                    consoleDiv.innerText += 'Error triggering sync: ' + (data.error || 'unknown');
                    btn.disabled = false;
                  }
                } catch(e) {
                  consoleDiv.innerText += 'Connection failed: ' + e.message;
                  btn.disabled = false;
                }
              }
              function pollLogs(jobId) {
                const consoleDiv = document.getElementById('console');
                const interval = setInterval(async () => {
                  try {
                    const res = await fetch(basePath + 'api/logs/' + jobId);
                    const data = await res.json();
                    if (data.logs) {
                      consoleDiv.innerText = data.logs;
                    }
                    if (data.status === 'success' || data.status === 'failed') {
                      clearInterval(interval);
                      setTimeout(() => window.location.reload(), 2000);
                    }
                  } catch(e) {
                    clearInterval(interval);
                  }
                }, 1500);
              }
            </script>
          </body>
          </html>
        `);
      }
      return;
    }

    if (pathname === "/sync-summary.json") {
      const filePath = path.join(dashboardDir, "sync-summary.json");
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Sync summary not found" }));
      }
      return;
    }

    // --- API Endpoints ---
    if (pathname === "/api/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (isK8s) {
        try {
          // Verify we can read the CronJob
          await k8sRequest(
            k8s,
            "GET",
            `/apis/batch/v1/namespaces/${k8s.namespace}/cronjobs/${cronjobName}`
          );
          res.end(
            JSON.stringify({
              enabled: true,
              mode: "Kubernetes",
              cronjob: cronjobName,
              namespace: k8s.namespace,
            })
          );
        } catch (err: any) {
          res.end(
            JSON.stringify({
              enabled: false,
              mode: "Kubernetes",
              cronjob: cronjobName,
              namespace: k8s.namespace,
              error: err.message,
            })
          );
        }
      } else {
        res.end(
          JSON.stringify({
            enabled: true,
            mode: "Local",
            cronjob: cronjobName,
            namespace: "default",
          })
        );
      }
      return;
    }

    if (pathname === "/api/run" && req.method === "POST") {
      if (isK8s) {
        try {
          // 1. Fetch the CronJob template
          const cronjob = await k8sRequest(
            k8s,
            "GET",
            `/apis/batch/v1/namespaces/${k8s.namespace}/cronjobs/${cronjobName}`
          );

          // 2. Generate a unique name
          const uniqueId = Math.random().toString(36).substring(2, 8);
          const jobId = `${cronjobName}-manual-${uniqueId}`;

          // 3. Construct the Job manifest
          const jobManifest = {
            apiVersion: "batch/v1",
            kind: "Job",
            metadata: {
              name: jobId,
              namespace: k8s.namespace,
              ownerReferences: [
                {
                  apiVersion: cronjob.apiVersion || "batch/v1",
                  blockOwnerDeletion: true,
                  controller: false,
                  kind: cronjob.kind || "CronJob",
                  name: cronjob.metadata.name,
                  uid: cronjob.metadata.uid,
                },
              ],
              labels: {
                "app.kubernetes.io/managed-by": "actual-sync-dashboard",
                "cronjob-name": cronjobName,
              },
            },
            spec: {
              template: cronjob.spec.jobTemplate.spec.template,
              backoffLimit: 0,
            },
          };

          // 4. Submit the Job
          await k8sRequest(
            k8s,
            "POST",
            `/apis/batch/v1/namespaces/${k8s.namespace}/jobs`,
            jobManifest
          );

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, job_id: jobId, mode: "Kubernetes" }));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Failed to trigger K8s job: ${err.message}` }));
        }
      } else {
        // Local Mode: Spawns the CLI as a subprocess
        const jobId = `${cronjobName}-manual-${Math.random().toString(36).substring(2, 8)}`;
        localJobs.set(jobId, { status: "pending", logs: "Initializing local process...\n" });

        try {
          const mainFile = process.argv[1];
          const cp = spawn(process.argv[0], [mainFile, "sync"], {
            env: { ...process.env, DASHBOARD_DATA_DIR: dashboardDir },
          });

          localJobs.set(jobId, {
            status: "running",
            logs: `Starting local actual-sync-minimal process (${jobId})...\n----------------------------------------------------------\n`,
          });

          cp.stdout.on("data", (data) => {
            const job = localJobs.get(jobId);
            if (job) {
              job.logs = (job.logs + data.toString()).slice(-100000); // Keep last 100k chars
              localJobs.set(jobId, job);
            }
          });

          cp.stderr.on("data", (data) => {
            const job = localJobs.get(jobId);
            if (job) {
              job.logs = (job.logs + data.toString()).slice(-100000);
              localJobs.set(jobId, job);
            }
          });

          cp.on("close", (code) => {
            const job = localJobs.get(jobId);
            if (job) {
              job.status = code === 0 ? "success" : "failed";
              job.logs += `\n----------------------------------------------------------\nProcess exited with code ${code}.\n`;
              localJobs.set(jobId, job);
            }
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, job_id: jobId, mode: "Local" }));
        } catch (err: any) {
          localJobs.set(jobId, { status: "failed", logs: `Process spawn failed: ${err.message}` });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Failed to trigger local sync: ${err.message}` }));
        }
      }
      return;
    }

    if (pathname.startsWith("/api/logs/") && req.method === "GET") {
      const jobId = pathname.substring("/api/logs/".length);
      if (!jobId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing job ID" }));
        return;
      }

      if (isK8s) {
        // K8s Log Retrieval
        if (k8sJobLogsCache.has(jobId)) {
          const cached = k8sJobLogsCache.get(jobId)!;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(cached));
          return;
        }

        try {
          // 1. Get Job status
          const job = await k8sRequest(
            k8s,
            "GET",
            `/apis/batch/v1/namespaces/${k8s.namespace}/jobs/${jobId}`
          );

          const jobFailed = job.status.failed && job.status.failed > 0;
          const jobSuccess = job.status.succeeded && job.status.succeeded > 0;

          // 2. Find the pod
          const podList = await k8sRequest(
            k8s,
            "GET",
            `/api/v1/namespaces/${k8s.namespace}/pods?labelSelector=job-name=${jobId}`
          );

          if (!podList.items || podList.items.length === 0) {
            if (jobFailed) {
              const result: JobInfo = { status: "failed", logs: "Job failed. Pod was deleted before logs could be read." };
              k8sJobLogsCache.set(jobId, result);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } else if (jobSuccess) {
              const result: JobInfo = { status: "success", logs: "Job completed successfully." };
              k8sJobLogsCache.set(jobId, result);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } else {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ status: "pending", logs: "Job queued. Waiting for pod..." }));
            }
            return;
          }

          const pod = podList.items[0];
          const podName = pod.metadata.name;
          const phase = pod.status.phase;

          if (phase === "Pending") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "pending", logs: "Pod starting up (Pending)..." }));
            return;
          }

          // Fetch pod logs
          let logsText = "";
          try {
            logsText = await k8sRequest(
              k8s,
              "GET",
              `/api/v1/namespaces/${k8s.namespace}/pods/${podName}/log`
            );
          } catch (logErr: any) {
            logsText = `Waiting for logs: ${logErr.message}`;
          }

          let status: "pending" | "running" | "success" | "failed" = "running";
          if (phase === "Succeeded" || jobSuccess) {
            status = "success";
          } else if (phase === "Failed" || jobFailed) {
            status = "failed";
          }

          const responseObj: JobInfo = { status, logs: logsText };
          if (status === "success" || status === "failed") {
            k8sJobLogsCache.set(jobId, responseObj);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(responseObj));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Failed to fetch K8s logs: ${err.message}` }));
        }
      } else {
        // Local Log Retrieval
        if (localJobs.has(jobId)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(localJobs.get(jobId)));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Job ID not found" }));
        }
      }
      return;
    }

    // --- Not Found ---
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(chalk.green(`Server running at http://0.0.0.0:${port}/`));
  });
};
