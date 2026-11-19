"""Pruebas: Asistente de modelos con Azure OpenAI."""

import json
import io
from unittest.mock import patch

from django.test import TestCase
from django.test.utils import override_settings

from ..ai_modeling import (
    AzureOpenAIConfigurationError,
    generar_modelo,
)


class AzureOpenAIServiceTests(TestCase):
    @override_settings(
        AZURE_OPENAI_ENDPOINT=(
            "https://test.services.ai.azure.com/openai/v1/responses"
        ),
        AZURE_OPENAI_DEPLOYMENT="gpt-4.1-mini",
        AZURE_OPENAI_API_VERSION="",
    )
    def test_responses_api_uses_foundry_endpoint_and_does_not_store_response(self):
        body = json.dumps({
            "output_text": '{"nombre":"modelo"}'
        }).encode("utf-8")
        with (
            patch(
                "optimizacion.ai_modeling._access_token",
                return_value="token-test",
            ) as token_mock,
            patch(
                "optimizacion.ai_modeling.urlopen",
                return_value=io.BytesIO(body),
            ) as urlopen_mock,
        ):
            result = generar_modelo("Descripción privada del modelo")

        self.assertEqual(result, '{"nombre":"modelo"}')
        request = urlopen_mock.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://test.services.ai.azure.com/openai/v1/responses",
        )
        self.assertEqual(request.get_header("Authorization"), "Bearer token-test")
        token_mock.assert_called_once_with("https://ai.azure.com/.default")
        sent = json.loads(request.data.decode("utf-8"))
        self.assertEqual(sent["model"], "gpt-4.1-mini")
        self.assertEqual(
            sent["input"][1]["content"],
            "Descripción privada del modelo",
        )
        self.assertEqual(sent["text"]["format"]["type"], "json_object")
        self.assertFalse(sent["store"])
        self.assertEqual(urlopen_mock.call_args.kwargs["timeout"], 30)

    @override_settings(
        AZURE_OPENAI_ENDPOINT="https://test.openai.azure.com",
        AZURE_OPENAI_DEPLOYMENT="unit-test",
        AZURE_OPENAI_API_VERSION="2024-10-21",
    )
    def test_request_uses_managed_identity_and_configured_deployment(self):
        body = json.dumps({
            "choices": [{
                "message": {"content": '{"nombre":"modelo"}'}
            }]
        }).encode("utf-8")
        with (
            patch("optimizacion.ai_modeling._access_token", return_value="token-test"),
            patch(
                "optimizacion.ai_modeling.urlopen",
                return_value=io.BytesIO(body),
            ) as urlopen_mock,
        ):
            result = generar_modelo("Descripción privada del modelo")

        self.assertEqual(result, '{"nombre":"modelo"}')
        request = urlopen_mock.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://test.openai.azure.com/openai/deployments/"
            "unit-test/chat/completions?api-version=2024-10-21",
        )
        self.assertEqual(request.get_header("Authorization"), "Bearer token-test")
        sent = json.loads(request.data.decode("utf-8"))
        self.assertEqual(sent["messages"][1]["content"], "Descripción privada del modelo")
        self.assertEqual(urlopen_mock.call_args.kwargs["timeout"], 30)

    @override_settings(
        AZURE_OPENAI_ENDPOINT="http://not-secure.example",
        AZURE_OPENAI_DEPLOYMENT="unit-test",
        AZURE_OPENAI_API_VERSION="2024-10-21",
    )
    def test_service_rejects_non_https_endpoint(self):
        with self.assertRaises(AzureOpenAIConfigurationError):
            generar_modelo("Descripción suficientemente larga para probar")

    @override_settings(
        AZURE_OPENAI_ENDPOINT="https://test.openai.azure.com/unexpected/path",
        AZURE_OPENAI_DEPLOYMENT="unit-test",
        AZURE_OPENAI_API_VERSION="2024-10-21",
    )
    def test_service_rejects_unsupported_endpoint_path(self):
        with self.assertRaises(AzureOpenAIConfigurationError):
            generar_modelo("Descripción suficientemente larga para probar")
