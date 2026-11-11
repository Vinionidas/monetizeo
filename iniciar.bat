@echo off
rem Abre o Monetizeo neste computador e libera o acesso para celulares no mesmo Wi-Fi.
cd /d "%~dp0"
where python >nul 2>nul || (echo Instale o Python 3 em https://www.python.org/downloads/ e tente de novo. & pause & exit /b 1)
start "" http://127.0.0.1:8765
python server.py --lan
pause
