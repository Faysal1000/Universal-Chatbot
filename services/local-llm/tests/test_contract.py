from scripts.export_openapi import CONTRACT_PATH, build_openapi_document, render_contract


def test_the_published_openapi_contract_matches_the_code() -> None:
    assert CONTRACT_PATH.read_text(encoding="utf-8") == render_contract(build_openapi_document()), (
        "contracts/local-llm.openapi.json is stale; run `python -m scripts.export_openapi`"
    )
