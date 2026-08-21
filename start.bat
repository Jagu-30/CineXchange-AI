@echo off
echo ===================================================
echo   CineXchange AI - Autonomous Procurement Platform
echo ===================================================
echo.
echo Select an option:
echo [1] Start Backend (FastAPI on Port 8000)
echo [2] Start Frontend (Next.js on Port 3000)
echo [3] Run Full Integration Test Suite (Pytest)
echo [4] Run Frontend TypeScript Check & Build
echo [5] Exit
echo.
set /p choice="Enter choice [1-5]: "

if "%choice%"=="1" (
    echo Starting FastAPI backend...
    python -m uvicorn backend.app.main:app --port 8000 --reload
) else if "%choice%"=="2" (
    echo Starting Next.js frontend...
    npm run dev
) else if "%choice%"=="3" (
    echo Running automated test suite...
    python -m pytest backend/tests -v
) else if "%choice%"=="4" (
    echo Checking types and building Next.js...
    npm run typecheck && npm run build
) else (
    echo Exiting.
)
