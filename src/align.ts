import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { AppConfig } from "./config";

/**
 * Dynamically checks the installed version of `@actual-app/api` and programmatically
 * installs the target version on the fly if a version mismatch is detected.
 */
export const alignApiDependency = async (config: AppConfig): Promise<void> => {
  // 1. Resolve target version: prioritises env variable first, fallback to config YAML, then dynamic lookup
  let targetVersion = process.env.ACTUAL_API_VERSION ?? config.actual?.apiVersion;

  if (!targetVersion && config.actual?.url) {
    const infoUrl = `${config.actual.url.replace(/\/$/, "")}/info`;
    try {
      const response = await fetch(infoUrl);
      if (response.ok) {
        const data: any = await response.json();
        const serverVersion = data?.build?.version;
        if (serverVersion) {
          console.log(`Resolved target API version dynamically from server info: ${serverVersion}`);
          targetVersion = serverVersion;
        }
      }
    } catch (err) {
      console.warn(`Warning: Could not dynamically resolve server version from ${infoUrl}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!targetVersion) {
    console.log("No target API version specified or resolved. Skipping alignment.");
    return;
  }

  const packageJsonPath = path.join(process.cwd(), "node_modules", "@actual-app", "api", "package.json");
  let currentVersion = "";

  if (fs.existsSync(packageJsonPath)) {
    try {
      currentVersion = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version;
    } catch (e) {
      // Ignored: if file is unreadable, we treat it as not installed
    }
  }

  // 2. Align if mismatch exists
  if (currentVersion !== targetVersion) {
    console.log(
      chalk.yellow(`⚠️ API Version mismatch! Local: ${currentVersion || "None"} | Target: ${targetVersion}`),
    );
    console.log(chalk.blue(`🔄 Programmatically aligning @actual-app/api to version ${targetVersion}...`));

    // Detect if we should use pnpm or npm
    let installCmd = `npm install --no-save @actual-app/api@${targetVersion}`;
    
    // Check if we are running in a pnpm environment (pnpm-lock.yaml exists)
    const hasPnpmLock = fs.existsSync(path.join(process.cwd(), "pnpm-lock.yaml"));
    if (hasPnpmLock) {
      // Ephemeral container filesystems render saving to package.json moot, so plain 'add' is robust and correct
      installCmd = `pnpm add @actual-app/api@${targetVersion}`;
    }

    try {
      console.log(chalk.gray(`Running command: ${installCmd}`));
      execSync(installCmd, {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "production" },
      });
      console.log(chalk.green("✅ @actual-app/api successfully aligned!"));
    } catch (error) {
      console.error(chalk.red("❌ Failed to dynamically align `@actual-app/api`:"), error);
      process.exit(1);
    }
  }
};
