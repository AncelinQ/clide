@echo off
rem Lance claude-ide et ouvre le navigateur. Double-cliquable, ou epinglable
rem a la barre des taches. Fermer cette fenetre arrete le serveur et ses terminaux.
cd /d "%~dp0"
title claude-ide
if not exist node_modules (
  echo Premiere execution : installation des dependances...
  call pnpm install || goto :erreur
)
rem Le client et le guide se construisent une fois ; ensuite, le lancement est direct.
if not exist packages\web\dist\index.html (
  call pnpm --filter @claude-ide/web build || goto :erreur
)
if not exist docs\guide\.vitepress\dist\index.html (
  call pnpm docs:build || goto :erreur
)
node_modules\.bin\tsx packages\server\src\main.ts
goto :eof

:erreur
echo.
echo L'installation a echoue. Lancer "pnpm install" a la main pour voir pourquoi.
pause
