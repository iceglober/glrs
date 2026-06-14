In this harness, EVERY MCP tool call (e.g. linear_get_issue) fails with:

  The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received undefined

Built-in tools (read, grep, bash) work fine, and the MCP servers themselves are healthy. Identify the ROOT CAUSE in the code: what exactly goes wrong, and where (file + the specific line/expression). Do NOT modify any code — this is diagnosis only. End with a crisp statement of the cause and its location.
