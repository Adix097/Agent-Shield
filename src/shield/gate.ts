import { appendFile, mkdir } from "node:fs/promises";
import readline from "node:readline/promises";
import { USER_EMAIL } from "../world/inbox.js";

export const ALLOWLIST = [USER_EMAIL, "friend@example.com"];

export type ApprovalRequest = { to: string; body: string; reasons: string[] };
export type AskFn = (req: ApprovalRequest) => Promise<boolean>;

// Simulates a user who always clicks "deny" (used in automated tests).
export const autoDeny: AskFn = async () => false;

// Asks in the terminal The dashboard will use a button instead
export const askCli: AskFn = async (req) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log("\nWARNING: the agent wants to send an email.");
  console.log(`  To:   ${req.to}`);
  console.log(`  Body: ${req.body.slice(0, 200)}`);
  console.log(`  Why this needs approval: ${req.reasons.join("; ")}`);
  const a = (await rl.question("  Approve? (y/N) ")).trim().toLowerCase();
  rl.close();
  return a === "y";
};

export class Gate {
  tainted = false;
  private inbox = "";
  constructor(private ask: AskFn) {}

  markUntrusted() {
    this.tainted = true;
  }
  noteInbox(text: string) {
    this.inbox = text;
  }

  private leaksInbox(body: string): boolean {
    if (!this.inbox) return false;
    for (let i = 0; i + 20 <= this.inbox.length; i += 5) {
      if (body.includes(this.inbox.slice(i, i + 20))) return true;
    }
    const codes = (this.inbox.match(/[A-Za-z0-9-]{6,}/g) ?? []).filter((t) =>
      /\d/.test(t),
    );
    return codes.some((c) => body.includes(c));
  }

  async checkSend(toRaw: string, bodyRaw: string) {
    const to = String(toRaw ?? "");
    const body = String(bodyRaw ?? "");
    const recipients = to
      .split(/[,;\s]+/)
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);
    const reasons: string[] = [];

    const unknown = recipients.filter((r) => !ALLOWLIST.includes(r));
    if (unknown.length)
      reasons.push(`recipient not on the trusted list: ${unknown.join(", ")}`);

    if (
      this.tainted &&
      recipients.some((r) => r !== USER_EMAIL) &&
      this.leaksInbox(body)
    ) {
      reasons.push(
        "email contains inbox content after the agent read untrusted web content",
      );
    }
    if (reasons.length && this.tainted)
      reasons.push(
        "the agent read untrusted web content earlier in this session",
      );

    let decision: "allowed" | "approved" | "denied" = "allowed";
    if (reasons.length)
      decision = (await this.ask({ to, body, reasons }))
        ? "approved"
        : "denied";

    await mkdir("results", { recursive: true });
    await appendFile(
      "results/gate-log.jsonl",
      JSON.stringify({
        time: new Date().toISOString(),
        action: "send_email",
        to,
        bodyPreview: body.slice(0, 120),
        tainted: this.tainted,
        reasons,
        decision,
      }) + "\n",
    );
    return {
      allowed: decision !== "denied",
      asked: reasons.length > 0,
      reasons,
      decision,
    };
  }
}
