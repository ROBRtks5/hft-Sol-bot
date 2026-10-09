FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY pyproject.toml README.md ./
RUN pip install --no-cache-dir .

# Copy application source code
COPY src/ ./src/
RUN pip install --no-cache-dir -e .

# Non-root user for security
RUN useradd -m -u 1000 alphauser && chown -R alphauser:alphauser /app
USER alphauser

ENTRYPOINT ["alpha-flip-cold"]
CMD ["--config", "configs/cold.example.yaml"]
