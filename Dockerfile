# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.js ./
COPY frontend ./frontend
RUN npm run build

FROM python:3.13-slim-bookworm AS python-build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
WORKDIR /build
COPY requirements.txt ./
RUN python -m venv /opt/venv && /opt/venv/bin/pip install -r requirements.txt

FROM python:3.13-slim-bookworm AS runtime
LABEL org.opencontainers.image.title="DeltaAnime" \
      org.opencontainers.image.description="Anime catalog, federated search and streaming player" \
      org.opencontainers.image.source="https://github.com/bekjonbegmatov/DeltaAnime"
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/dist \
    CATALOG_DB_PATH=/data/catalog.sqlite3 \
    ALLOWED_HOSTS=localhost,127.0.0.1
WORKDIR /app
RUN groupadd --gid 10001 delta && useradd --uid 10001 --gid delta --no-create-home --shell /usr/sbin/nologin delta \
    && mkdir /data && chown delta:delta /data
COPY --from=python-build /opt/venv /opt/venv
COPY --from=frontend-build /build/dist ./dist
COPY backend ./backend
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import json,urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3))['ok']"]
# Playback handles are process-local: keep exactly one worker.
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
