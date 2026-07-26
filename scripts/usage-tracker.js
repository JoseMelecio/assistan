#!/usr/bin/env node
/**
 * Accumulates estimated time / tokens / cost per Jira ticket across pipeline runs
 * (create-ticket, normalize-ticket, execute-task, pr-review) by reading the
 * per-subagent transcripts Claude Code already writes to disk under
 * ~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl, each with a
 * companion agent-<id>.meta.json ({"agentType": "assistant:spock", "description": "..."}).
 *
 * No Claude Code hook is used on purpose: SubagentStop's payload shape isn't
 * publicly documented, and a plugin-wide hook would fire for every subagent in
 * every project. Instead, the assistant pipeline's own command markdown calls
 * this script explicitly right after each agent stage completes.
 *
 * Subcommands:
 *   record <TICKET> <agentType> [descSubstr]   append one stage's usage to the ledger
 *   add-duration <TICKET> <seconds> [label]    add orchestration overhead not tied to an agent
 *   summary <TICKET> [--markdown|--plain]      print the accumulated summary
 *
 * Never throws past main() — a tracking failure must not break the pipeline.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const LEDGER_DIR = path.join(os.homedir(), ".claude", "assistant-plugin", "usage");

// $ per token, converted from $ per 1M tokens. Source: platform.claude.com/docs/pricing
// (cached 2026-06-24 via the claude-api skill). Update if pricing changes.
// Cache writes are billed at ~1.25x the input rate, cache reads at ~0.1x — applied below.
const PRICING = {
  "claude-sonnet-4-6": { input: 3 / 1e6, output: 15 / 1e6 },
  "claude-sonnet-5": { input: 3 / 1e6, output: 15 / 1e6 },
  "claude-sonnet-4-5": { input: 3 / 1e6, output: 15 / 1e6 },
  "claude-haiku-4-5": { input: 1 / 1e6, output: 5 / 1e6 },
  "claude-opus-4-8": { input: 5 / 1e6, output: 25 / 1e6 },
  "claude-opus-4-7": { input: 5 / 1e6, output: 25 / 1e6 },
  "claude-opus-4-6": { input: 5 / 1e6, output: 25 / 1e6 },
  "claude-opus-4-5": { input: 5 / 1e6, output: 25 / 1e6 },
  "claude-fable-5": { input: 10 / 1e6, output: 50 / 1e6 },
};

function priceFor(model) {
  if (PRICING[model]) return PRICING[model];
  // Dated snapshot ids (e.g. claude-haiku-4-5-20251001) fall back to their base alias.
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  return key ? PRICING[key] : null;
}

function costForTokens(model, t) {
  const price = priceFor(model);
  if (!price) return null;
  return (
    t.input * price.input +
    t.output * price.output +
    t.cacheCreation * price.input * 1.25 +
    t.cacheRead * price.input * 0.1
  );
}

// ---- Locating subagent transcripts ----

function findMetaFiles() {
  const metas = [];
  if (!fs.existsSync(PROJECTS_ROOT)) return metas;
  for (const projectDir of safeReaddir(PROJECTS_ROOT)) {
    const projectPath = path.join(PROJECTS_ROOT, projectDir);
    if (!isDir(projectPath)) continue;
    for (const sessionDir of safeReaddir(projectPath)) {
      const subagentsPath = path.join(projectPath, sessionDir, "subagents");
      if (!isDir(subagentsPath)) continue;
      for (const f of safeReaddir(subagentsPath)) {
        if (f.endsWith(".meta.json")) metas.push(path.join(subagentsPath, f));
      }
    }
  }
  return metas;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Finds the most recently modified subagent transcript whose meta.json has the
// given agentType (e.g. "assistant:spock") and, if descSubstr is given, whose
// description contains it (used to pin the match to a specific ticket ID and
// avoid cross-talk between parallel /execute-task runs on different tickets).
function findLatestMatch(agentType, descSubstr) {
  const candidates = [];
  for (const metaPath of findMetaFiles()) {
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      continue;
    }
    if (meta.agentType !== agentType) continue;
    if (descSubstr && !(meta.description || "").includes(descSubstr)) continue;
    const jsonlPath = metaPath.replace(/\.meta\.json$/, ".jsonl");
    if (!fs.existsSync(jsonlPath)) continue;
    const mtime = fs.statSync(jsonlPath).mtimeMs;
    candidates.push({ meta, jsonlPath, mtime });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] || null;
}

// ---- Parsing usage out of a transcript ----

function parseTranscript(jsonlPath) {
  const lines = fs.readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);
  const perModel = {};
  const seenMessageIds = new Set();
  let firstTs = null;
  let lastTs = null;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.timestamp) {
      const t = Date.parse(entry.timestamp);
      if (!Number.isNaN(t)) {
        if (firstTs === null || t < firstTs) firstTs = t;
        if (lastTs === null || t > lastTs) lastTs = t;
      }
    }

    if (entry.type !== "assistant" || !entry.message || !entry.message.usage) continue;

    // A single API response is often split across several JSONL lines (one per
    // content block — text, tool_use, ...), but they all repeat the SAME usage
    // object. Dedupe by message id so multi-block turns aren't double-counted.
    const msgId = entry.message.id || entry.uuid;
    if (seenMessageIds.has(msgId)) continue;
    seenMessageIds.add(msgId);

    const model = entry.message.model || "unknown";
    const u = entry.message.usage;
    if (!perModel[model]) {
      perModel[model] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    }
    perModel[model].input += u.input_tokens || 0;
    perModel[model].output += u.output_tokens || 0;
    perModel[model].cacheCreation += u.cache_creation_input_tokens || 0;
    perModel[model].cacheRead += u.cache_read_input_tokens || 0;
  }

  const durationSeconds =
    firstTs !== null && lastTs !== null ? Math.max(0, Math.round((lastTs - firstTs) / 1000)) : 0;

  return { perModel, durationSeconds };
}

// ---- Ledger persistence ----

function sanitizeTicket(ticket) {
  return String(ticket).replace(/[^A-Za-z0-9_-]/g, "_");
}

function ledgerPath(ticket) {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
  return path.join(LEDGER_DIR, `${sanitizeTicket(ticket)}.json`);
}

function loadLedger(ticket) {
  const p = ledgerPath(ticket);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      // fall through to a fresh ledger rather than crashing
    }
  }
  return {
    ticket,
    stages: [],
    overhead: [],
    totals: { tokens: 0, cost_usd: 0, cost_partial: false, duration_seconds: 0, extra_duration_seconds: 0 },
  };
}

function saveLedger(ticket, ledger) {
  const p = ledgerPath(ticket);
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, p);
}

function recalcTotals(ledger) {
  let tokens = 0;
  let cost = 0;
  let duration = ledger.totals.extra_duration_seconds || 0;
  let partial = false;

  for (const s of ledger.stages) {
    tokens += s.total_tokens || 0;
    duration += s.duration_seconds || 0;
    if (s.total_cost_usd === null) partial = true;
    else cost += s.total_cost_usd || 0;
  }

  ledger.totals = {
    tokens,
    cost_usd: cost,
    cost_partial: partial,
    duration_seconds: duration,
    extra_duration_seconds: ledger.totals.extra_duration_seconds || 0,
  };
}

// ---- Formatting ----

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function formatUsd(n) {
  return `$${n.toFixed(2)}`;
}

function formatCostLine(totals) {
  return totals.cost_partial
    ? `${formatUsd(totals.cost_usd)}+ (estimado; costo desconocido para al menos una etapa)`
    : `${formatUsd(totals.cost_usd)} (estimado)`;
}

// ---- Subcommands ----

function cmdRecord(args) {
  const [ticket, agentType, descSubstr] = args;
  if (!ticket || !agentType) {
    process.stderr.write("usage: usage-tracker.js record <TICKET> <agentType> [descSubstr]\n");
    return;
  }

  const match = findLatestMatch(agentType, descSubstr);
  if (!match) {
    process.stderr.write(`[usage-tracker] no matching subagent transcript found for ${agentType} (skipped)\n`);
    return;
  }

  const { perModel, durationSeconds } = parseTranscript(match.jsonlPath);
  const models = {};
  let totalTokens = 0;
  let totalCost = 0;
  let costKnown = true;

  for (const [model, t] of Object.entries(perModel)) {
    const cost = costForTokens(model, t);
    if (cost === null) costKnown = false;
    else totalCost += cost;
    totalTokens += t.input + t.output + t.cacheCreation + t.cacheRead;
    models[model] = {
      input_tokens: t.input,
      output_tokens: t.output,
      cache_creation_tokens: t.cacheCreation,
      cache_read_tokens: t.cacheRead,
      cost_usd: cost,
    };
  }

  const ledger = loadLedger(ticket);
  ledger.stages.push({
    agent: agentType.split(":").pop(),
    agent_type: agentType,
    models,
    total_tokens: totalTokens,
    total_cost_usd: costKnown ? totalCost : null,
    duration_seconds: durationSeconds,
    recorded_at: new Date().toISOString(),
    source: path.basename(match.jsonlPath),
  });
  recalcTotals(ledger);
  saveLedger(ticket, ledger);

  process.stdout.write(
    `[usage-tracker] recorded ${ledger.stages[ledger.stages.length - 1].agent}: ` +
      `${totalTokens} tokens, ${costKnown ? formatUsd(totalCost) : "cost unknown"}, ${durationSeconds}s\n`,
  );
}

function cmdAddDuration(args) {
  const [ticket, secondsStr, label] = args;
  const seconds = parseInt(secondsStr, 10);
  if (!ticket || Number.isNaN(seconds)) {
    process.stderr.write("usage: usage-tracker.js add-duration <TICKET> <seconds> [label]\n");
    return;
  }

  const ledger = loadLedger(ticket);
  ledger.totals.extra_duration_seconds = (ledger.totals.extra_duration_seconds || 0) + seconds;
  ledger.overhead = ledger.overhead || [];
  ledger.overhead.push({ seconds, label: label || "overhead", recorded_at: new Date().toISOString() });
  recalcTotals(ledger);
  saveLedger(ticket, ledger);

  process.stdout.write(`[usage-tracker] added ${seconds}s (${label || "overhead"})\n`);
}

function cmdSummary(args) {
  const ticket = args.find((a) => !a.startsWith("--"));
  const format = args.includes("--plain") ? "plain" : "markdown";
  if (!ticket) {
    process.stderr.write("usage: usage-tracker.js summary <TICKET> [--markdown|--plain]\n");
    return;
  }

  const p = ledgerPath(ticket);
  if (!fs.existsSync(p)) {
    process.stdout.write(
      format === "plain"
        ? "Sin datos de uso registrados todavia para este ticket.\n"
        : "_Sin datos de uso registrados todavia para este ticket._\n",
    );
    return;
  }

  const ledger = JSON.parse(fs.readFileSync(p, "utf8"));
  const { totals } = ledger;
  const costLine = formatCostLine(totals);

  if (format === "plain") {
    let out = "";
    out += `Tiempo total: ${formatDuration(totals.duration_seconds)}\n`;
    out += `Tokens totales: ${totals.tokens.toLocaleString("es-MX")}\n`;
    out += `Costo estimado: ${costLine}\n`;
    out += `Etapas registradas: ${ledger.stages.length}\n`;
    process.stdout.write(out);
    return;
  }

  let md = "## 📊 Resumen de ejecución\n\n";
  md += "| Etapa | Modelo(s) | Tokens | Costo est. | Duración |\n";
  md += "|---|---|---|---|---|\n";
  for (const s of ledger.stages) {
    const modelNames = Object.keys(s.models).join(", ");
    const cost = s.total_cost_usd === null ? "desconocido" : formatUsd(s.total_cost_usd);
    md += `| ${s.agent} | ${modelNames} | ${s.total_tokens.toLocaleString("es-MX")} | ${cost} | ${formatDuration(s.duration_seconds)} |\n`;
  }
  md += `\n**Total acumulado:** ${totals.tokens.toLocaleString("es-MX")} tokens · ${costLine} · ${formatDuration(totals.duration_seconds)}\n`;
  md += `\n_Última actualización: ${new Date().toISOString()} — costo estimado, no es facturación exacta._\n`;
  process.stdout.write(md);
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case "record":
        cmdRecord(rest);
        break;
      case "add-duration":
        cmdAddDuration(rest);
        break;
      case "summary":
        cmdSummary(rest);
        break;
      default:
        process.stderr.write("usage: usage-tracker.js <record|add-duration|summary> ...\n");
    }
  } catch (err) {
    process.stderr.write(`[usage-tracker] error (ignored): ${err && err.message}\n`);
  }
  process.exitCode = 0;
}

main();
