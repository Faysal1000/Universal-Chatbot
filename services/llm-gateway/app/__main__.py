"""Production entrypoint: ``python -m app``.

One Uvicorn worker per process; the gateway is I/O-bound (asyncio handles thousands
of concurrent streams), so scale with more replicas rather than more workers.
"""

import uvicorn

from app.core.config import get_settings


def main() -> None:
    """Start Uvicorn with host, port, and shutdown timing taken from settings."""
    settings = get_settings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        workers=1,
        log_config=None,  # app.core.logging_config owns all log formatting.
        access_log=settings.log_level == "DEBUG",
        server_header=False,
        proxy_headers=True,
        timeout_graceful_shutdown=int(settings.graceful_shutdown_timeout_seconds),
        timeout_keep_alive=5,
    )


if __name__ == "__main__":
    main()
