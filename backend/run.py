import uvicorn
import os
import sys

# Ensure root directory is on Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if __name__ == "__main__":
    print("=" * 60)
    print("  CineXchange AI — Multi-Agent Procurement Backend")
    print("  Host: http://localhost:8000")
    print("  Swagger Docs: http://localhost:8000/docs")
    print("=" * 60)
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
