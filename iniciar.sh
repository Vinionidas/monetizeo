#!/usr/bin/env sh
# Abre o Monetizeo neste computador e libera o acesso para celulares no mesmo Wi-Fi.
cd "$(dirname "$0")" && exec python3 server.py --lan
