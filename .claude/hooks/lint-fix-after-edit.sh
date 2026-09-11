#!/bin/bash

FILE_PATH=$(jq -r '.tool_input.file_path' < /dev/stdin)

if [[ ! "$FILE_PATH" =~ \.tsx?$ ]]; then
  exit 0
fi

if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

source ~/.nvm/nvm.sh && nvm use > /dev/null 2>&1

npx eslint --fix "$FILE_PATH" 2>&1