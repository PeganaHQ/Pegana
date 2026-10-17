#!/usr/bin/env bash
set -euo pipefail

CASE="${1:-2025-10-10-usde-depeg}"
case "${2:-run}" in
  run) cargo run -p xtask -- backtest --case "$CASE" ;;
  capture|--capture) cargo run -p xtask -- backtest --case "$CASE" --capture ;;
  check|--check) cargo run -p xtask -- backtest --case "$CASE" --check ;;
  *)
    echo "usage: $0 [case] [run|capture|check|--capture|--check]" >&2
    exit 1
    ;;
esac
