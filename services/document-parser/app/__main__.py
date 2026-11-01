"""Production entrypoint: ``python -m app``."""

from app.entrypoints.worker_main import main

if __name__ == "__main__":
    main()
