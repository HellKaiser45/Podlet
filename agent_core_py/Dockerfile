FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

COPY core.py .
COPY identity_headers.py .
COPY main.py .

# Runtime caches on the container filesystem (ephemeral), not under $HOME
# (which is a bind-mount target at runtime). agent-core itself only needs pip.
RUN mkdir -p /var/cache/podlet/pip /var/cache/podlet/uv/cache \
  /var/cache/podlet/xdg/cache /var/cache/podlet/xdg/config /var/cache/podlet/xdg/data \
  && find /var/cache/podlet -type d -exec chmod 1777 {} +

ENV PIP_CACHE_DIR=/var/cache/podlet/pip
ENV UV_CACHE_DIR=/var/cache/podlet/uv/cache
ENV XDG_CACHE_HOME=/var/cache/podlet/xdg/cache
ENV XDG_CONFIG_HOME=/var/cache/podlet/xdg/config
ENV XDG_DATA_HOME=/var/cache/podlet/xdg/data

EXPOSE 8000

# The runtime UID/GID is supplied by compose from the host user.
# Do not bake a host-specific UID into the image.

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
