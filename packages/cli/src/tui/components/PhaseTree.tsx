import React from "react";
import { Box, Text } from "ink";
import type { SessionHandle } from "@glrs-dev/autopilot";

interface PhaseTreeProps {
  handle: SessionHandle;
}

/**
 * Visual phase progress tree.
 * Shows each phase with status icon: ✓ (complete), ● (in progress), ○ (pending).
 */
export function PhaseTree({ handle }: PhaseTreeProps) {
  const { currentPhase } = handle;

  if (!currentPhase) {
    return (
      <Box flexDirection="column">
        <Text bold>Phase Progress</Text>
        <Text dimColor>  No phase information available</Text>
      </Box>
    );
  }

  const { phase, current, total } = currentPhase;
  const phases: string[] = [];

  // Build a synthetic list of phases based on what we know.
  // We only have the current phase name; for others we show generic labels.
  for (let i = 1; i <= total; i++) {
    if (i < current) {
      phases.push(`phase_${i - 1}.md`);
    } else if (i === current) {
      phases.push(phase);
    } else {
      phases.push(`phase_${i - 1}.md`);
    }
  }

  return (
    <Box flexDirection="column">
      <Text bold>Phase Progress</Text>
      {phases.map((p, i) => {
        const phaseNum = i + 1;
        let icon: string;
        let color: string;
        let extra = "";

        if (phaseNum < current) {
          icon = "✓";
          color = "green";
        } else if (phaseNum === current) {
          icon = "●";
          color = "blue";
          if (handle.currentIteration) {
            extra = ` (iter ${handle.currentIteration.iteration}/${handle.currentIteration.max})`;
          }
        } else {
          icon = "○";
          color = "gray";
        }

        return (
          <Box key={i}>
            <Text color={color}>  {icon} </Text>
            <Text dimColor={phaseNum !== current}>
              {p}
              {extra}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
