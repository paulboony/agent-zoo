import { spawn } from "node:child_process";

async function waitForServer(url: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server at ${url} did not become ready`);
}

async function runSeed(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["seed", "--scenario", "demo"], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`seed exited ${code}`));
    });
    child.on("error", reject);
  });
}

export default async function globalSetup(): Promise<void> {
  await waitForServer("http://127.0.0.1:7777/healthz");
  await runSeed();
}
