#!/bin/bash
echo "==================================================="
echo "  CineXchange AI - Autonomous Procurement Platform"
echo "==================================================="
echo ""
echo "Select an option:"
echo "[1] Start Backend (FastAPI on Port 8000)"
echo "[2] Start Frontend (Next.js on Port 3000)"
echo "[3] Run Full Integration Test Suite (Pytest)"
echo "[4] Run Frontend TypeScript Check & Build"
echo "[5] Exit"
echo ""
read -p "Enter choice [1-5]: " choice

if [ "$choice" = "1" ]; then
    echo "Starting FastAPI backend..."
    python3 -m uvicorn backend.app.main:app --port 8000 --reload
elif [ "$choice" = "2" ]; then
    echo "Starting Next.js frontend..."
    npm run dev
elif [ "$choice" = "3" ]; then
    echo "Running automated test suite..."
    python3 -m pytest backend/tests -v
elif [ "$choice" = "4" ]; then
    echo "Checking types and building Next.js..."
    npm run typecheck && npm run build
else
    echo "Exiting."
fi
