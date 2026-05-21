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
  // 1. Resolve target version: prioritises env variable first, then fallback to config YAML
  const targetVersion = process.env.ACTUAL_API_VERSION ?? config.actual?.apiVersion;
  if (!targetVersion) return;

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

    try {
      // Runs npm install --no-save to dynamically align the runtime dependencies
      execSync(`npm install --no-save @actual-app/api@${targetVersion}`, {
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
