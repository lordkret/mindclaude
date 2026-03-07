Reload the MindClaude mindmap and act on new/changed nodes.

1. Call the `session_apply` MCP tool to detect new/modified nodes
2. Review the returned nodes — each has a short ID in brackets like [abc123]
3. For each actionable node, implement it
4. After completing a node (or batch of related nodes), call `mark_applied` with their IDs:
   - For task branch nodes (under "Bugs to fix", "Features to add", "Improvements to add"): use action="delete" to remove them
   - For nodes you want to keep but mark complete: use action="done"
   - To relocate a node to another branch: use action="move" with move_target="Branch Name"
5. Update the mindmap to reflect completed work if needed
