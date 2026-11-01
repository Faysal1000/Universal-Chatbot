"""Production entrypoint: ``python -m app``.

Runs a single Uvicorn worker per process because each process holds its own copy of
the model; scale horizontally with more pods/replicas, not more workers.
"""

import uvicorn

from app.config import settings


def main() -> None:
    """Start Uvicorn with host, port, and shutdown timing taken from settings."""
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        workers=1,
        log_config=None,  # app.logging_config owns all log formatting.
        access_log=settings.log_level == "DEBUG",
        server_header=False,
        proxy_headers=True,
        timeout_graceful_shutdown=int(settings.graceful_shutdown_timeout_seconds),
        timeout_keep_alive=5,
    )


if __name__ == "__main__":
    main()
