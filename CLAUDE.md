# Project: mindclaude

This project uses MindClaude for memory. At conversation start:

1. `start_session` with project="mindclaude" project_path="<path-to-this-repo>"
2. Review reported changes — ask user if any need action
3. Consult Context branch for architecture, Memory for conventions
4. When done: `end_session` with summary of what was done

All knowledge lives in the mindmap at ~/.mindclaude/maps/mindclaude.xmind
