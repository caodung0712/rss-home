FROM python:3.12-alpine

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bridge_core.py linkedin_rss.py social_free.py social_metrics.py web_free.py app.py ./
COPY tests ./tests

EXPOSE 8000

HEALTHCHECK --interval=60s --timeout=5s --retries=3 --start-period=10s \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
