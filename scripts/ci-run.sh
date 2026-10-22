#!/usr/bin/env bash
# Ejecuta un comando de CI y, si falla, publica las últimas líneas de su
# salida como anotación de GitHub para poder leer el error sin abrir el log.
# Uso: scripts/ci-run.sh "Título" comando args...
set -uo pipefail
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  # Quita códigos de color y codifica saltos de línea para la anotación.
  body="$(sed -e 's/\x1b\[[0-9;]*m//g' "$log" | grep -v '^\s*$' | tail -n 80 | sed -e 's/%/%25/g' | awk '{printf "%s%%0A", $0}')"
  echo "::error title=${title}::${body}"
fi
exit "$status"
