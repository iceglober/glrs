---
description: Show subagent dispatch totals accrued by the dispatch-tracker plugin. Reads ~/.glrs/opencode/dispatches.json (or $GLRS_COST_TRACKER_DIR/dispatches.json) and prints a human-readable breakdown by agent and tier. Pass `--json` to dump the raw rollup; pass `--log` to tail the event log; pass `--reset` to delete all dispatch data.
---

User input: $ARGUMENTS

You are a read-only reporter for the dispatch-tracker plugin. Your job: run a short node one-liner to read the rollup file and print results. Do NOT guess, do NOT invent numbers, do NOT modify any files (except when `--reset` is given).

## What to do

Parse the user's input for flags. Behavior:

- **No args** (default) → pretty-print the rollup.
- **`--json`** → dump the raw `dispatches.json` content verbatim.
- **`--log`** or **`--tail`** → show the last 20 lines of `dispatches.jsonl`.
- **`--reset`** → delete both `dispatches.jsonl` and `dispatches.json`, print confirmation.

## Resolving the data directory

The rollup lives at `${GLRS_COST_TRACKER_DIR:-~/.glrs/opencode}/dispatches.json` (tilde-expand `~` via `$HOME`). Check `$GLRS_COST_TRACKER_DIR` first; fall back to `$HOME/.glrs/opencode`.

## Pretty-print (default)

Run this node one-liner (node is always available under OpenCode/Claude Code). Use the `bash` tool:

```bash
node -e '
const fs=require("fs"),path=require("path"),os=require("os");
const overrideDir=process.env.GLRS_COST_TRACKER_DIR;
let dir;
if(overrideDir){dir=overrideDir.startsWith("~")?path.join(os.homedir(),overrideDir.slice(1)):overrideDir;}
else{dir=path.join(os.homedir(),".glrs","opencode");}
const p=path.join(dir,"dispatches.json");
let r;
try{r=JSON.parse(fs.readFileSync(p,"utf8"));}
catch(e){
  if(e.code==="ENOENT"){console.log("No dispatch data yet at "+p+". Start a session with the dispatch-tracker plugin enabled and come back.");process.exit(0);}
  console.error("Failed to read "+p+": "+e.message);process.exit(1);
}
console.log("");
console.log("  Total dispatches: "+r.total);
console.log("  Updated: "+r.updatedAt);
console.log("");
const tiers=Object.entries(r.byTier||{}).sort((a,b)=>b[1]-a[1]);
if(tiers.length){
  console.log("  By tier:");
  for(const[tier,count]of tiers){console.log("    "+tier+": "+count);}
  console.log("");
}
const agents=Object.entries(r.byAgent||{}).sort((a,b)=>b[1]-a[1]);
if(agents.length){
  console.log("  By agent:");
  for(const[agent,count]of agents){console.log("    "+agent+": "+count);}
  console.log("");
}
console.log("  Source: "+p);
'
```

## `--json` branch

```bash
node -e '
const fs=require("fs"),path=require("path"),os=require("os");
const overrideDir=process.env.GLRS_COST_TRACKER_DIR;
const dir=overrideDir?(overrideDir.startsWith("~")?path.join(os.homedir(),overrideDir.slice(1)):overrideDir):path.join(os.homedir(),".glrs","opencode");
const p=path.join(dir,"dispatches.json");
try{process.stdout.write(fs.readFileSync(p,"utf8"));}
catch(e){if(e.code==="ENOENT"){console.log("{}");process.exit(0);}console.error(e.message);process.exit(1);}
'
```

## `--log` / `--tail` branch

Show the last 20 lines of `dispatches.jsonl`:

```bash
node -e '
const fs=require("fs"),path=require("path"),os=require("os");
const overrideDir=process.env.GLRS_COST_TRACKER_DIR;
const dir=overrideDir?(overrideDir.startsWith("~")?path.join(os.homedir(),overrideDir.slice(1)):overrideDir):path.join(os.homedir(),".glrs","opencode");
const p=path.join(dir,"dispatches.jsonl");
try{const lines=fs.readFileSync(p,"utf8").split(/\n/).filter(Boolean);for(const l of lines.slice(-20))console.log(l);}
catch(e){if(e.code==="ENOENT"){console.log("No event log yet at "+p+".");process.exit(0);}console.error(e.message);process.exit(1);}
'
```

## `--reset` branch

Delete both files and print confirmation:

```bash
node -e '
const fs=require("fs"),path=require("path"),os=require("os");
const overrideDir=process.env.GLRS_COST_TRACKER_DIR;
const dir=overrideDir?(overrideDir.startsWith("~")?path.join(os.homedir(),overrideDir.slice(1)):overrideDir):path.join(os.homedir(),".glrs","opencode");
const jsonl=path.join(dir,"dispatches.jsonl");
const json=path.join(dir,"dispatches.json");
let deleted=0;
try{fs.unlinkSync(jsonl);deleted++;}catch(e){if(e.code!=="ENOENT")console.error(e.message);}
try{fs.unlinkSync(json);deleted++;}catch(e){if(e.code!=="ENOENT")console.error(e.message);}
console.log("Dispatch data reset. Deleted "+deleted+" file(s) from "+dir+".");
'
```

## Output

Print the node output verbatim. Do NOT add commentary unless the user asked a specific question. Keep it tight.
