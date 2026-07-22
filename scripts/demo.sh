#!/usr/bin/env bash
set -euo pipefail

# YASS demo: encena um final de sessao do Claude Code e dispara a narracao real.
# Uso: grave a tela com Cmd+Shift+5 (fonte de audio = microfone), rode este script,
# pare a gravacao quando o YASS terminar de falar.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3891}"
BASE="http://localhost:${PORT}"

say_line() { printf '%s\n' "$1"; sleep "${2:-0.6}"; }
type_cmd() { printf '\033[1;35m❯\033[0m %s\n' "$1"; sleep 0.8; }

# 1. daemon vivo
if ! curl -s -o /dev/null "${BASE}/config"; then
  ( node "${ROOT}/yass-daemon.js" >/tmp/yass-daemon.log 2>&1 & )
  sleep 2.5
fi

# 2. abre a janela do YASS (ela toca o audio)
open "${BASE}" >/dev/null 2>&1 || true
sleep 2
printf '\033[1;33m→ clique uma vez na janela do YASS (libera o audio) e tecle Enter.\033[0m\n'
read -r _

clear
say_line ""
say_line "\033[2m~/projects/checkout-api\033[0m" 0.4
type_cmd "claude"
say_line "\033[2m● Analisando a falha no fluxo de pagamento...\033[0m" 1.0
say_line "\033[2m● Reproduzi o bug: expiracao do token usa < em vez de <=.\033[0m" 1.0
say_line "\033[2m● Corrigi src/auth/token.ts e adicionei o teste de borda.\033[0m" 1.0
say_line "\033[32m✓ Tarefa concluida. 1 arquivo, 1 teste, suite verde.\033[0m" 1.2
say_line ""
say_line "\033[2m[Stop hook → YASS]\033[0m" 0.6

# 3. narracao real (Fish TTS via daemon; a janela toca em voz alta)
MSG="Terminei. O bug era a checagem de expiracao do token usando menor-que em vez de menor-ou-igual. Corrigi, cobri com um teste de borda, e a suite esta verde."
printf '%s' "${MSG}" | node "${ROOT}/yass-enqueue.js" \
  --project "${ROOT}" --session demo >/dev/null

say_line "\033[1;35m♪ YASS falando...\033[0m" 0.2
# deixa o audio tocar antes de encerrar a gravacao
sleep 12
say_line "\033[2m(fim da demo)\033[0m" 0.2
