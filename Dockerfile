FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY cinex ./cinex
COPY services ./services
COPY seeds ./seeds
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
ENV PATH="/app/.venv/bin:$PATH"
ENTRYPOINT ["./entrypoint.sh"]
