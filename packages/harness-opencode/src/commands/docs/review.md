```
/review 87
/review feat/auth-middleware
/review abc1234
```

Read-only adversarial review. Accepts a PR number, branch name, or commit SHA. Fetches the diff, runs [typecheck and lint](/harness/tools), delegates to the [`code-reviewer`](/harness/agents) agent, and outputs a structured verdict.
