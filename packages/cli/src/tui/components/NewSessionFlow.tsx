import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { getUniqueRepos } from "../../repo-config.js";
import type { UniqueRepo } from "../../repo-config.js";
import type { SessionManager } from "../../session-manager.js";
import { RepoSelector } from "./RepoSelector.js";
import { PlanSelector } from "./PlanSelector.js";

type Step =
  | { kind: "repo" }
  | { kind: "plan"; repo: UniqueRepo }
  | { kind: "confirm"; repo: UniqueRepo; planPath: string }
  | { kind: "launching" }
  | { kind: "error"; message: string };

interface NewSessionFlowProps {
  manager: SessionManager;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Multi-step wizard for launching a new autopilot session.
 * Steps: repo → plan location → plan → confirm → auto-create worktree → launch
 *
 * The worktree is created automatically via `createWorktree({ repo })` —
 * same resolution as `glrs wt new <repo>`.
 */
export function NewSessionFlow({ manager, onDone, onCancel }: NewSessionFlowProps) {
  const [step, setStep] = useState<Step>({ kind: "repo" });
  const repos = useMemo(() => getUniqueRepos(), []);

  // Error view — must be before conditional returns but after all hooks
  useInput((_input, key) => {
    if (step.kind === "error" && (key.escape || key.return)) {
      onDone();
    }
  });

  if (step.kind === "repo") {
    return (
      <RepoSelector
        repos={repos}
        onSelect={(repo) => setStep({ kind: "plan", repo })}
        onCancel={onCancel}
      />
    );
  }

  if (step.kind === "plan") {
    return (
      <PlanSelector
        repoPath={step.repo.primaryPath}
        repoName={step.repo.name}
        onSelect={(planPath) =>
          setStep({ kind: "confirm", repo: step.repo, planPath })
        }
        onCancel={() => setStep({ kind: "repo" })}
      />
    );
  }

  if (step.kind === "launching") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box>
          <Spinner />
          <Text> Creating worktree and launching session...</Text>
        </Box>
      </Box>
    );
  }

  if (step.kind === "error") {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="red" bold>Launch failed</Text>
        </Box>
        <Text color="red">{step.message}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Esc to return to dashboard</Text>
        </Box>
      </Box>
    );
  }

  // Confirm step
  return (
    <ConfirmLaunch
      repo={step.repo}
      planPath={step.planPath}
      onConfirm={() => {
        setStep({ kind: "launching" });

        // Run synchronously in a microtask so the "launching" spinner renders
        setTimeout(() => {
          try {
            manager.launchSessionWithWorktree({
              repoName: step.repo.name,
              planPath: step.planPath,
            });
            onDone();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setStep({ kind: "error", message });
          }
        }, 50);
      }}
      onCancel={() =>
        setStep({ kind: "plan", repo: step.repo })
      }
    />
  );
}

interface ConfirmLaunchProps {
  repo: UniqueRepo;
  planPath: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmLaunch({
  repo,
  planPath,
  onConfirm,
  onCancel,
}: ConfirmLaunchProps) {
  useInput((_input, key) => {
    if (key.return) {
      onConfirm();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
  });

  const planName = planPath.split("/").pop() ?? planPath;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Launch Session</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text dimColor>Repo: </Text>
          <Text>{repo.name}</Text>
        </Box>
        <Box>
          <Text dimColor>Plan: </Text>
          <Text>{planName}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>A fresh worktree will be created via `glrs wt new {repo.name}`.</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Enter to launch · Esc to cancel</Text>
      </Box>
    </Box>
  );
}
