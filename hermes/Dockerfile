# Build from the repository root: docker build -t mangorts-hermes:693641aa hermes
# Match the reviewed upstream UV/Python image and frozen dependency lock.
FROM ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie@sha256:b3c543b6c4f23a5f2df22866bd7857e5d304b67a564f4feab6ac22044dde719b

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/hermes
# Upstream's .python-version must not download an interpreter under root's private home.
RUN git init . \
    && git remote add origin https://github.com/NousResearch/hermes-agent.git \
    && git fetch --depth 1 origin 693641aa8b4359c602283bdbbc14041e03bc47bc \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "693641aa8b4359c602283bdbbc14041e03bc47bc" \
    && uv sync --python /usr/local/bin/python3.13 --frozen --no-dev --extra messaging --extra bedrock --extra mcp

COPY pyproject.toml mango_plugin.py mango_history.py mango_scope.py mango_integrations.py mango_recovery.py /opt/mango-plugin/
RUN uv pip install --python /opt/hermes/.venv/bin/python --no-deps /opt/mango-plugin \
    && useradd --create-home --uid 10001 hermes \
    && mkdir -p /data/profiles && chown hermes:hermes /data /data/profiles
COPY entrypoint.py /opt/mango-entrypoint.py
ENV PATH="/opt/hermes/.venv/bin:${PATH}" HERMES_HOME=/data PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8642
ENTRYPOINT ["python", "/opt/mango-entrypoint.py"]
