#!/usr/bin/env node

// Polyfill global.navigator to prevent upstream @actual-app/api >=26.3.0 from crashing in Node.js
if (typeof (global as any).navigator === "undefined") {
  (global as any).navigator = { userAgent: "Node" };
}

import { program } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import * as YAML from "yaml";
import { loadConfig, createConfig } from "./config";

program.version("1.2.1-fork.1").description("Actual sync");

// Config
program
  .command("config")
  .command("create")
  .action(() => {
    inquirer
      .prompt({
        type: "confirm",
        name: "confirm",
        message:
          "Create default config file? (if a file exists it will be overwritten)",
      })
      .then(({ confirm }) => {
        if (confirm) createConfig();
      });
  });
// Actual
const actualCommand = program.command("actual");
actualCommand.command("list-accounts").action(async () => {
  const config = await loadConfig();
  const { alignApiDependency } = await import("./align");
  await alignApiDependency(config);

  const { openActualSession } = await import("./actual");
  const actual = await openActualSession(config.actual);
  try {
    const accounts = await actual.listAccounts();
    console.log(YAML.stringify(accounts, null, 2));
  } finally {
    await actual.shutdown();
  }
});

// Truelayer
const truelayerCommand = program.command("truelayer");
truelayerCommand.command("add-account").action(async () => {
  const config = await loadConfig();
  const { Truelayer } = await import("./truelayer");
  const truelayer = Truelayer(config.truelayer);
  const accounts = await truelayer.addAccounts();
  console.log(
    chalk.green("Update your truelayer config with the following accounts"),
  );
  console.log(YAML.stringify(accounts));
});
truelayerCommand.command("list-accounts").action(async () => {
  const config = await loadConfig();
  const { Truelayer } = await import("./truelayer");
  const truelayer = Truelayer(config.truelayer);
  console.log(YAML.stringify(truelayer.listAccounts(), null, 2));
});
truelayerCommand
  .command("list-transactions")
  .argument("accountId")
  .action(async (accountId) => {
    const config = await loadConfig();
    const account = config.truelayer.accounts.find((a) => a.id === accountId);
    if (account) {
      const { Truelayer } = await import("./truelayer");
      const truelayer = Truelayer(config.truelayer);
      const transactions = await truelayer.getTransactions(account);
      console.log(YAML.stringify(transactions, null, 2));
    } else {
      console.log(
        chalk.red(
          "The account doesn't exists. Check the id and make sure the account is added first",
        ),
      );
    }
  });

truelayerCommand
  .command("get-balance")
  .argument("accountId")
  .action(async (accountId) => {
    const config = await loadConfig();
    const account = config.truelayer.accounts.find((a) => a.id === accountId);
    if (account) {
      const { Truelayer } = await import("./truelayer");
      const truelayer = Truelayer(config.truelayer);
      const balance = await truelayer.getBalance(account);
      console.log(JSON.stringify(balance, null, 2));
    } else {
      console.log(
        chalk.red(
          "The account doesn't exists. Check the id and make sure the account is added first",
        ),
      );
    }
  });

program.command("sync").action(async () => {
  const commitHash = process.env.GIT_COMMIT_HASH || "unknown";
  console.log(chalk.bold.cyan(`\nStarting actual-sync-minimal (commit: ${commitHash})`));
  const config = await loadConfig();
  const { alignApiDependency } = await import("./align");
  await alignApiDependency(config);

  try {
    const { Sync } = await import("./sync");
    await Sync(config).sync();
  } catch (error) {
    console.error(chalk.red("❌ Sync failed:"), error);

    // Send error notification if ntfy is configured
    if (config.ntfy) {
      try {
        const { Ntfy } = await import("./ntfy");
        await Ntfy(config.ntfy).post({
          title: "Actual Sync - Error",
          body: `Sync failed with error:\n${error instanceof Error ? error.message : JSON.stringify(error)}`,
          tags: ["x", "bank", "error"],
          priority: "high",
        });
      } catch (notifyError) {
        console.error(
          chalk.red("Failed to send error notification:"),
          notifyError,
        );
      }
    }

    process.exit(1);
  }
});
program.parse(process.argv);
