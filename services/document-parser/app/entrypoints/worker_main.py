"""Composition root: wire adapters into use cases, start the queue workers and the health server."""

import asyncio
import logging
import signal
import sys
from dataclasses import dataclass

import httpx
import redis.asyncio as redis
from aiohttp import web
from bullmq import Worker
from pydantic import ValidationError

from app import __version__
from app.adapters.bullmq_consumer import QueueBinding, WorkerSettings, create_worker
from app.adapters.image_conversion import PillowImageToPdfConverter
from app.adapters.llm_gateway_client import GatewayRetryPolicy, LlmGatewayClient
from app.adapters.nemotron_postprocessing import NvidiaNemotronPostprocessor
from app.adapters.pdfium_document import PdfiumOpener
from app.adapters.pdfminer_text_extractor import PdfminerTextExtractor
from app.adapters.s3_object_storage import S3ObjectStorage, create_s3_client
from app.adapters.tesseract_ocr import TesseractOcrEngine
from app.application.inspect_document import InspectDocument
from app.application.page_parser import PageParser, PageParserDependencies, PageParsingSettings
from app.application.parse_page_batch import ParsePageBatch
from app.application.source_loading import SourceLoader, SourcePolicy
from app.application.validation_messages import describe_validation_error
from app.config import Settings
from app.contracts.generated.parse_inspect_v1 import ParseInspectPayload
from app.contracts.generated.parse_pages_v1 import ParsePagesPayload
from app.entrypoints.health_server import ReadinessProbe, create_health_application, start_health_server
from app.observability.logging_config import configure_logging

PARSE_INSPECT_QUEUE = "parse.inspect"
PARSE_PAGES_QUEUE = "parse.pages"
INVALID_CONFIGURATION_EXIT_CODE = 2

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RunningService:
    workers: list[Worker]
    worker_tasks: list["asyncio.Task[None]"]
    health_runner: web.AppRunner
    http_client: httpx.Client
    redis_client: "redis.Redis"
    is_accepting_jobs: bool = True


def main() -> None:
    try:
        settings = Settings()
    except ValidationError as error:
        print(f"Invalid document-parser configuration: {describe_validation_error(error)}", file=sys.stderr)
        sys.exit(INVALID_CONFIGURATION_EXIT_CODE)
    configure_logging(settings.log_level, settings.log_format)
    asyncio.run(run_service(settings))


async def run_service(settings: Settings) -> None:
    service = await start_service(settings)
    await wait_for_shutdown_signal()
    await stop_service(service, settings.graceful_shutdown_timeout_seconds)


async def start_service(settings: Settings) -> RunningService:
    ocr_engine = TesseractOcrEngine(settings.tesseract_languages)
    ocr_engine.ensure_available()
    s3_client = create_s3_client(
        endpoint_url=str(settings.s3_endpoint) if settings.s3_endpoint else None,
        region=settings.s3_region,
        access_key_id=settings.s3_access_key_id,
        secret_access_key=settings.s3_secret_access_key.get_secret_value(),
        force_path_style=settings.s3_force_path_style,
        timeout_seconds=settings.s3_timeout_seconds,
    )
    object_storage = S3ObjectStorage(s3_client)
    http_client = httpx.Client()
    bindings = build_queue_bindings(settings, object_storage, ocr_engine, http_client)
    workers = [create_worker(binding, worker_settings(settings, binding.queue_name)) for binding in bindings]
    redis_client = redis.from_url(
        settings.redis_url.get_secret_value(),
        socket_timeout=settings.readiness_timeout_seconds,
        socket_connect_timeout=settings.readiness_timeout_seconds,
    )
    service = RunningService(
        workers=workers,
        worker_tasks=[asyncio.create_task(worker.run()) for worker in workers],
        health_runner=web.AppRunner(web.Application()),
        http_client=http_client,
        redis_client=redis_client,
    )
    probe = ReadinessProbe(
        checks={
            "redis": lambda: _ping_redis(redis_client),
            "object_storage": lambda: asyncio.to_thread(
                object_storage.ensure_bucket_is_reachable, settings.s3_bucket
            ),
        },
        timeout_seconds=settings.readiness_timeout_seconds,
        is_accepting_jobs=lambda: (
            service.is_accepting_jobs and all(not task.done() for task in service.worker_tasks)
        ),
    )
    service.health_runner = await start_health_server(
        create_health_application(probe), settings.host, settings.port
    )
    logger.info("document-parser %s consuming %s", __version__, [binding.queue_name for binding in bindings])
    return service


def build_queue_bindings(
    settings: Settings,
    object_storage: S3ObjectStorage,
    ocr_engine: TesseractOcrEngine,
    http_client: httpx.Client,
) -> list[QueueBinding]:
    source_loader = SourceLoader(
        object_storage,
        SourcePolicy(allowed_bucket=settings.s3_bucket, maximum_source_bytes=settings.maximum_source_bytes),
    )
    pdf_opener = PdfiumOpener(maximum_render_pixels=settings.maximum_render_pixels)
    inspect_document = InspectDocument(
        source_loader, object_storage, pdf_opener, PillowImageToPdfConverter(settings.maximum_image_pixels)
    )
    page_parser = PageParser(
        PageParserDependencies(
            object_storage=object_storage,
            native_text_extractor=PdfminerTextExtractor(),
            ocr_engine=ocr_engine,
            gateway=build_gateway_client(settings, http_client),
            nemotron_postprocessor=NvidiaNemotronPostprocessor(),
        ),
        PageParsingSettings(
            ocr_render_dpi=settings.ocr_render_dpi, minimum_ocr_seconds=settings.minimum_ocr_seconds
        ),
    )
    parse_page_batch = ParsePageBatch(source_loader, object_storage, pdf_opener, page_parser)
    return [
        QueueBinding(PARSE_INSPECT_QUEUE, ParseInspectPayload, inspect_document.execute),
        QueueBinding(PARSE_PAGES_QUEUE, ParsePagesPayload, parse_page_batch.execute),
    ]


def build_gateway_client(settings: Settings, http_client: httpx.Client) -> LlmGatewayClient:
    return LlmGatewayClient(
        base_url=str(settings.llm_gateway_url),
        api_key=settings.llm_gateway_api_key,
        http_client=http_client,
        retry_policy=GatewayRetryPolicy(
            maximum_attempts=settings.gateway_max_attempts,
            initial_backoff_seconds=settings.gateway_initial_backoff_seconds,
            maximum_backoff_seconds=settings.gateway_max_backoff_seconds,
        ),
        max_tokens=settings.document_parse_max_tokens,
    )


def worker_settings(settings: Settings, queue_name: str) -> WorkerSettings:
    concurrency = (
        settings.parse_inspect_concurrency
        if queue_name == PARSE_INSPECT_QUEUE
        else settings.parse_pages_concurrency
    )
    return WorkerSettings(
        redis_url=settings.redis_url.get_secret_value(),
        queue_prefix=settings.queue_prefix,
        concurrency=concurrency,
        lock_duration_milliseconds=settings.lock_duration_milliseconds,
        stalled_interval_milliseconds=settings.stalled_interval_seconds * 1000,
    )


async def wait_for_shutdown_signal() -> None:
    shutdown_requested = asyncio.Event()
    event_loop = asyncio.get_running_loop()
    for shutdown_signal in (signal.SIGTERM, signal.SIGINT):
        event_loop.add_signal_handler(shutdown_signal, shutdown_requested.set)
    await shutdown_requested.wait()
    logger.info("Shutdown requested; finishing active jobs")


async def stop_service(service: RunningService, graceful_timeout_seconds: float) -> None:
    service.is_accepting_jobs = False
    try:
        await asyncio.wait_for(
            asyncio.gather(*(worker.close() for worker in service.workers)), timeout=graceful_timeout_seconds
        )
    except TimeoutError:
        logger.warning(
            "Active jobs did not finish in %.0f s; they will be retried as stalled", graceful_timeout_seconds
        )
        await asyncio.gather(
            *(worker.close(force=True) for worker in service.workers), return_exceptions=True
        )
    for task in service.worker_tasks:
        task.cancel()
    await asyncio.gather(*service.worker_tasks, return_exceptions=True)
    await service.health_runner.cleanup()
    await service.redis_client.aclose()
    service.http_client.close()
    logger.info("document-parser stopped")


async def _ping_redis(redis_client: "redis.Redis") -> None:
    await redis_client.ping()
