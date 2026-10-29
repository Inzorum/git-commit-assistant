#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for vscode_node in "$HOME"/.vscode-server/bin/*/node; do
  if [[ -x "$vscode_node" ]]; then
    typescript_js="$(dirname "$vscode_node")/extensions/node_modules/typescript/lib/typescript.js"
    if [[ -f "$typescript_js" ]]; then
      TYPESCRIPT_JS="$typescript_js" "$vscode_node" "$project_dir/scripts/build_offline.cjs"
      exit 0
    fi
  fi
done

echo 'Не найден Node.js и TypeScript из VS Code Server. Установите npm-зависимости и выполните npm run compile.' >&2
exit 1
