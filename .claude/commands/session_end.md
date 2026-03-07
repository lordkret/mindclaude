End the current MindClaude session.

1. Review what was accomplished this session (files changed, decisions made)
2. Build the project (`npm run build`) if any source files were changed
3. Commit all changes and push to git:
   - Stage modified files (not unrelated files)
   - Commit with a descriptive message
   - Push to remote
4. Call the `end_session` MCP tool with:
   - `summary`: concise description of what was done
   - `decisions`: key decisions made (if any)
   - `files_changed`: list of files modified (if any)
5. Confirm the session was saved and pushed

If the user provided arguments, use them as the summary: $ARGUMENTS
