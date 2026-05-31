---
name: cloud-credentials
description: "Use when the task requires AWS or GCP credentials — deploying infrastructure, reading from S3, querying DynamoDB, running Terraform, calling cloud APIs. This skill configures the gsa MCP server if not already set up, then teaches the agent how to use cloud credentials safely through the permission-gated agent interface. Activate proactively whenever you detect cloud SDK usage, IaC files, or AWS/GCP API calls in the task."
---

# Cloud Credentials

This skill gives you access to AWS and GCP credentials via `gsa` (glrs-assume). Credentials are permission-gated — only contexts the user has explicitly approved are available to you.

## Setup check

Before doing any cloud work, verify the MCP server is available:

1. Check if you have the `run_with_credentials` tool. If yes, skip to **Using credentials**.
2. If not, tell the user:

```
The gsa MCP server isn't configured. To enable cloud credentials for agents:

1. Approve which contexts I can access:
   gsa agent allow

2. Add the MCP server to your config:

   For Claude Code (~/.claude/settings.json):
   {
     "mcpServers": {
       "gsa": { "command": "gsa", "args": ["agent", "mcp"] }
     }
   }

   For OpenCode (opencode.json → mcp section):
   {
     "mcp": {
       "gsa": {
         "command": "gsa",
         "args": ["agent", "mcp"]
       }
     }
   }

3. Restart your session.
```

Then stop and wait — don't attempt cloud operations without credentials.

## Using credentials

### Running commands

Use the `run_with_credentials` MCP tool for any command that needs cloud access:

```
run_with_credentials: aws s3 ls
run_with_credentials: terraform plan
run_with_credentials: aws sts get-caller-identity
run_with_credentials: gcloud projects list
```

The tool injects credentials from the user's active context. Credentials auto-refresh — long-running commands won't expire mid-execution.

### Listing available contexts

Use the `list_contexts` MCP tool to see which contexts the user has approved for agent access. Only these contexts are available to you.

### Wrapping other tools

For tools that need persistent credentials (like MCP servers that call AWS APIs), the user can wrap them:

```json
{
  "mcpServers": {
    "aws-tools": { "command": "gsa", "args": ["agent", "exec", "--", "npx", "@aws/mcp-server"] }
  }
}
```

## Rules

1. **Never hardcode or log credentials.** The credential endpoint handles injection. You never see access keys.
2. **Never modify credential configuration.** Don't edit `~/.aws/credentials`, `~/.aws/config`, or gsa config files.
3. **Check context before destructive operations.** Before deleting resources, running migrations, or modifying infrastructure, confirm the active context with the user: "You're in [context]. Proceed?"
4. **Respect the permission boundary.** If `list_contexts` returns no approved contexts, tell the user to run `gsa agent allow` and stop. Don't try to work around it.
5. **Prefer `run_with_credentials` over `exec` in bash.** The MCP tool is permission-gated. Raw `aws` or `terraform` in bash uses whatever credentials are in the shell environment, which bypasses the agent permission model.
