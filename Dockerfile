FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY requirements.txt requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY backend ./backend
COPY pipeline ./pipeline
COPY config.yaml ./
RUN useradd --create-home pitwall && mkdir -p /app/data/raw /app/data/processed /app/artifacts && chown -R pitwall:pitwall /app
USER pitwall
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8080}"]

FROM base AS test
COPY --chown=pitwall:pitwall tests ./tests
COPY --chown=pitwall:pitwall pytest.ini ./

# Data and artifacts are explicit deployment inputs, never secrets or raw telemetry.
# Build --target base for ingestion/training; default serving includes prepared assets.
FROM base AS serving
COPY --chown=pitwall:pitwall data/processed/ /app/data/processed/
COPY --chown=pitwall:pitwall artifacts/ /app/artifacts/
