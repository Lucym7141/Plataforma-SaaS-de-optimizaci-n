# syntax=docker/dockerfile:1

# --- 1. Compila las islas React con Vite -------------------------------------
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json vite.config.js ./
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN npm run build

# --- 2. Imagen de la aplicación (web y worker de Celery) ----------------------
FROM python:3.12-slim AS app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_MEDIA_ROOT=/data/media

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY --from=frontend /app/frontend/react-build ./frontend/react-build

WORKDIR /app/backend
# collectstatic solo lee archivos; DEBUG evita exigir los secretos de
# producción durante el build. La imagen final arranca con DEBUG=false.
RUN DJANGO_DEBUG=true python manage.py collectstatic --noinput \
    && useradd --create-home --uid 10001 vertice \
    && mkdir -p /data/media \
    && chown vertice:vertice /data/media

USER vertice
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD ["python", "-c", "import os, urllib.request; host = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost').split(',')[0].strip(); urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000/health/', headers={'Host': host, 'X-Forwarded-Proto': 'https'}), timeout=4)"]

CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--timeout", "60", \
     "--access-logfile", "-"]
