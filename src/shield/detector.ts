type Signal = { re: RegExp; weight: number; reason: string };

const SIGNALS: Signal[] = [
  {
    re: /\b(ignore|disregard)\b.{0,30}\b(previous|prior|above|earlier)\b.{0,20}\binstructions?\b/i,
    weight: 3,
    reason: "tries to override earlier instructions",
  },
  {
    re: /\bsystem (override|notice|message)\b|\boverride\b/i,
    weight: 2,
    reason: "pretends to be a system message",
  },
  {
    re: /\b(ai|assistants?|agents?|llm|model)\b.{0,50}\b(must|should|need to|required|please|shall)\b|\bto ai assistants?\b/i,
    weight: 2,
    reason: "addresses the AI assistant directly",
  },
  {
    re: /\b(read|open|check|forward|get)\b.{0,40}\b(inbox|e-?mails?|mailbox)\b|\b(read_email|send_email)\b/i,
    weight: 3,
    reason: "asks the agent to touch the user's email",
  },
  {
    re: /\b(send|e-?mail|forward)\b.{0,80}[\w.+-]+@[\w-]+\.[\w.-]+/i,
    weight: 3,
    reason: "asks for data to be sent to an email address",
  },
  {
    re: /[\w.+-]+@[\w-]+\.[\w.-]+/,
    weight: 3,
    reason: "contains an email address the page has no reason to include",
  },
  {
    re: /\b(urgent|immediately|critical|priority|mandatory)\b/i,
    weight: 1,
    reason: "uses urgency pressure",
  },
  {
    re: /\b(pre-?approved|pre-?authorized|pre-?validated|compliance|audit|administrator)\b/i,
    weight: 1,
    reason: "claims authority or pre-approval",
  },
  {
    re: /\bdo not (mention|tell)\b|\bwithout (telling|informing)\b/i,
    weight: 2,
    reason: "asks the agent to hide the action from the user",
  },
  {
    re: /\bend of (web)?page content\b|\bmessage from the user\b|\buser \(follow-?up/i,
    weight: 2,
    reason: "fakes a page boundary or a message from the user",
  },
];

export const THRESHOLD = 3;

export function scoreText(t: string) {
  let score = 0;
  const reasons: string[] = [];
  for (const s of SIGNALS) {
    if (s.re.test(t)) {
      score += s.weight;
      reasons.push(s.reason);
    }
  }
  return { score, reasons };
}

export function redactSuspicious(text: string) {
  const sentences = text.split(/(?<=[.!?।])\s+/);
  const redacted: { sentence: string; reasons: string[]; score: number }[] = [];
  const kept = sentences.map((s) => {
    const { score, reasons } = scoreText(s);
    if (score >= THRESHOLD) {
      redacted.push({ sentence: s, reasons, score });
      return "[removed: suspected instruction aimed at the AI]";
    }
    return s;
  });
  return { text: kept.join(" "), redacted };
}
