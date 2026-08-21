from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.config import settings
from backend.app.api.routes import router as api_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup tasks
    print(f"CineXchange AI Backend initialized. Mock Mode: {settings.USE_MOCK_BACKEND}, Gemini Mode: {settings.USE_GEMINI}")
    yield
    # Shutdown tasks
    print("CineXchange AI Backend shutting down.")

app = FastAPI(
    title="CineXchange AI Multi-Agent Production Planning API",
    description="Autonomous production planning, vendor discovery, deterministic negotiation, compliance, and emergency recovery.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "cinexchange-ai-backend",
        "mock_mode": settings.USE_MOCK_BACKEND,
        "gemini_mode": settings.USE_GEMINI,
        "version": "1.0.0"
    }

app.include_router(api_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
