@echo off
:: Launcher - Mesa de Distribuicao BKO
:: Inicia o Electron a partir da pasta do projeto.

cd /d "%~dp0"
echo Iniciando Mesa de Distribuicao...
npx electron .
pause
