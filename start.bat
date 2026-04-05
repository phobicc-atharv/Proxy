@echo off
title ORCHATHON — Proxy Demo Launcher
color 0B
cls

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║   ORCHATHON — Next-Gen Reverse Proxy Demo               ║
echo  ║   Starting all servers...                               ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

REM Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js not found. Please install Node.js from nodejs.org
  pause
  exit
)

echo  [1/4] Starting ShopSecure Backend (port 8080)...
start "ShopSecure Backend :8080" cmd /k "node website.js"
timeout /t 1 /nobreak >nul

echo  [2/4] Starting OrchProxy (port 9090 + dashboard 9091)...
start "OrchProxy :9090" cmd /k "node proxy.js"
timeout /t 2 /nobreak >nul

echo  [3/4] Starting Demo Controller (port 3000)...
start "Demo Controller :3000" cmd /k "node demo_controller.js"
timeout /t 1 /nobreak >nul

echo  [4/4] Opening presentation in browser...
timeout /t 2 /nobreak >nul
start http://localhost:3000

echo.
echo  ✓ All servers running!
echo.
echo  ┌─────────────────────────────────────────────────┐
echo  │  OPEN THIS IN BROWSER / ON PROJECTOR:           │
echo  │  http://localhost:3000                          │
echo  │                                                  │
echo  │  Port Map:                                       │
echo  │  :3000  Demo Presentation Controller            │
echo  │  :8080  Target Website (ShopSecure)             │
echo  │  :9090  OrchProxy (invisible middleman)         │
echo  │  :9091  Live Security Dashboard                 │
echo  └─────────────────────────────────────────────────┘
echo.
echo  Press any key to close this launcher window.
echo  (The server windows will keep running)
pause >nul