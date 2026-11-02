FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY public ./public
ENV HOST=0.0.0.0
# Monter un volume persistant sur /app/data (base SQLite + clé secrète)
VOLUME ["/app/data"]
CMD ["python3", "server.py"]
