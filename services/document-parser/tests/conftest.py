"""Shared fixtures. Tests never read a developer's .env or reach the network."""

import os

for variable_name in list(os.environ):
    if variable_name.startswith("DOCUMENT_PARSER_"):
        del os.environ[variable_name]
