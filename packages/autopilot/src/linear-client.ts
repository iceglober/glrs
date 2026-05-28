/**
 * Minimal Linear API client for issue status management.
 *
 * Smart-optional: returns null from createLinearClient() when no API key
 * is available. All methods are fire-and-forget — failures log but never
 * throw or block execution.
 */

const LINEAR_API_URL = "https://api.linear.app/graphql";

export interface LinearClient {
  moveIssue(issueId: string, statusName: string): Promise<boolean>;
}

interface WorkflowState {
  id: string;
  name: string;
  type: string;
}

/**
 * Create a Linear client. Returns null when no API key is found.
 * Checks: opts.apiKey > process.env.LINEAR_API_KEY
 */
export function createLinearClient(opts?: { apiKey?: string }): LinearClient | null {
  const apiKey = opts?.apiKey ?? process.env["LINEAR_API_KEY"];
  if (!apiKey) return null;

  const stateCache = new Map<string, WorkflowState[]>();

  async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await fetch(LINEAR_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey!,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: T };
      return json.data ?? null;
    } catch {
      return null;
    }
  }

  async function getTeamStates(issueId: string): Promise<WorkflowState[]> {
    const cached = stateCache.get(issueId);
    if (cached) return cached;

    const data = await graphql<{
      issue: { team: { states: { nodes: WorkflowState[] } } };
    }>(
      `query($id: String!) {
        issue(id: $id) {
          team { states { nodes { id name type } } }
        }
      }`,
      { id: issueId },
    );

    const states = data?.issue?.team?.states?.nodes ?? [];
    if (states.length > 0) stateCache.set(issueId, states);
    return states;
  }

  return {
    async moveIssue(issueId: string, statusName: string): Promise<boolean> {
      const states = await getTeamStates(issueId);
      const target = states.find((s) => s.name.toLowerCase() === statusName.toLowerCase());
      if (!target) return false;

      const data = await graphql<{ issueUpdate: { success: boolean } }>(
        `mutation($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) { success }
        }`,
        { id: issueId, stateId: target.id },
      );

      return data?.issueUpdate?.success ?? false;
    },
  };
}
