import { loadKernelConfig, loadSupervisorConfig } from "./config";
import { startKernel } from "./kernel";
import { runSupervisor } from "./supervisor";

const command = process.argv[2];

const main = async () => {
  switch (command) {
    case "kernel":
      await startKernel(loadKernelConfig());
      return;
    case "supervisor":
      await runSupervisor(loadSupervisorConfig());
      return;
    default:
      console.log("Usage: omnicore <kernel|supervisor>");
  }
};

void main();
