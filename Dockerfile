# One always-on Python process: voice + map WebSockets with in-memory sessions.
# The frontend bundles in static/ are prebuilt and committed.
FROM python:3.12-slim
RUN pip install --no-cache-dir uv==0.11.26
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
ENV PORT=8000
CMD ["sh", "-c", "uv run --no-sync uvicorn main:app --host 0.0.0.0 --port ${PORT} --ws wsproto"]
