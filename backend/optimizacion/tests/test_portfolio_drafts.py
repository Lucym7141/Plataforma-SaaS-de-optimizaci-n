"""Pruebas: borrador de portafolio a partir de una descripción con IA."""

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from ..ai_modeling import PORTFOLIO_DRAFT_INSTRUCTIONS, generar_portafolio
from ..models import OptimizacionPortafolio, UsoIA
from ..portfolio_drafts import BorradorIncompleto, BorradorInvalido, construir_borrador

TEXTO = (
    "Quiero un portafolio con Bonos que rinden 6 % al año con volatilidad 5 % "
    "y Acciones que rinden 10 % con volatilidad 20 %, correlación 0,3."
)


def respuesta_ia(**cambios):
    datos = {
        "faltantes": [],
        "nombre": "Bonos y acciones",
        "formato": "porcentaje",
        "activos": [
            {
                "nombre": "Bonos",
                "categoria": "Renta fija",
                "rendimiento_esperado": 6,
                "volatilidad": 5,
                "peso_minimo": None,
                "peso_maximo": None,
            },
            {
                "nombre": "Acciones",
                "categoria": "Renta variable",
                "rendimiento_esperado": 10,
                "volatilidad": 20,
                "peso_minimo": 10,
                "peso_maximo": 70,
            },
        ],
        "covarianza": None,
        "correlaciones": [[1, 0.3], [0.3, 1]],
        "sin_correlacion": False,
        "limites_categoria": {"Renta variable": 70},
        "escenarios_estres": {"Recesión": [-2, -25]},
        "aversion_riesgo": 3,
        "periodos_por_anio": 1,
        "supuestos": ["Los rendimientos son anuales."],
    }
    datos.update(cambios)
    return datos


class ConstruirBorradorTests(TestCase):
    def test_convierte_porcentajes_y_calcula_la_covarianza(self):
        payload, supuestos = construir_borrador(respuesta_ia())

        self.assertEqual(payload["activos"], ["Bonos", "Acciones"])
        self.assertEqual(payload["rendimientos_esperados"], [0.06, 0.1])
        self.assertEqual(payload["covarianza"], [[0.0025, 0.003], [0.003, 0.04]])
        self.assertEqual(payload["pesos_minimos"], [0.0, 0.1])
        self.assertEqual(payload["pesos_maximos"], [1.0, 0.7])
        self.assertEqual(payload["limites_categoria"], {"Renta variable": 0.7})
        self.assertEqual(payload["escenarios_estres"], {"Recesión": [-0.02, -0.25]})
        self.assertEqual(payload["aversion_riesgo"], 3)
        self.assertIn("Los rendimientos son anuales.", supuestos)
        self.assertTrue(any("volatilidades y correlaciones" in s for s in supuestos))

    def test_usa_la_covarianza_indicada_tal_cual(self):
        payload, _ = construir_borrador(respuesta_ia(
            formato="decimal",
            activos=[
                {"nombre": "A", "rendimiento_esperado": 0.05},
                {"nombre": "B", "rendimiento_esperado": 0.08},
            ],
            covarianza=[[0.01, 0.002], [0.002, 0.03]],
            correlaciones=None,
            limites_categoria={},
            escenarios_estres={},
        ))

        self.assertEqual(payload["covarianza"], [[0.01, 0.002], [0.002, 0.03]])
        self.assertEqual(payload["rendimientos_esperados"], [0.05, 0.08])

    def test_sin_correlacion_solo_si_se_indica(self):
        payload, supuestos = construir_borrador(
            respuesta_ia(correlaciones=None, sin_correlacion=True)
        )
        self.assertEqual(payload["covarianza"], [[0.0025, 0.0], [0.0, 0.04]])
        self.assertTrue(any("correlación 0" in s for s in supuestos))

        with self.assertRaises(BorradorIncompleto) as raised:
            construir_borrador(respuesta_ia(correlaciones=None))
        self.assertIn("correlaciones", raised.exception.faltantes[0])

    def test_no_completa_datos_faltantes(self):
        sin_rendimiento = respuesta_ia()
        sin_rendimiento["activos"][1]["rendimiento_esperado"] = None
        with self.assertRaises(BorradorIncompleto) as raised:
            construir_borrador(sin_rendimiento)
        self.assertEqual(
            raised.exception.faltantes, ["Rendimiento esperado de Acciones."]
        )

        sin_volatilidad = respuesta_ia()
        sin_volatilidad["activos"][0]["volatilidad"] = None
        with self.assertRaises(BorradorIncompleto):
            construir_borrador(sin_volatilidad)

        with self.assertRaises(BorradorIncompleto) as raised:
            construir_borrador(respuesta_ia(faltantes=["Horizonte de inversión"]))
        self.assertEqual(raised.exception.faltantes, ["Horizonte de inversión"])

    def test_aversion_por_defecto_queda_anotada(self):
        payload, supuestos = construir_borrador(respuesta_ia(aversion_riesgo=None))
        self.assertEqual(payload["aversion_riesgo"], 1)
        self.assertTrue(any("aversión al riesgo de 1" in s for s in supuestos))

    def test_rechaza_estructuras_invalidas(self):
        for datos in (
            [],
            respuesta_ia(activos="no es lista"),
            respuesta_ia(correlaciones=[[1, 2], [2, 1]]),
            respuesta_ia(correlaciones=[[1, 0.3]]),
            respuesta_ia(aversion_riesgo="alta"),
        ):
            with self.subTest(datos=str(datos)[:30]), self.assertRaises(
                BorradorInvalido
            ):
                construir_borrador(datos)


class GenerarPortafolioEndpointTests(TestCase):
    url = "/api/portafolios/generar/"

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="draft-user", password="Fuerte-contraseña-739!"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def post(self, respuesta):
        with patch(
            "optimizacion.views.portfolios.generar_portafolio",
            return_value=json.dumps(respuesta) if not isinstance(respuesta, str) else respuesta,
        ) as generate:
            response = self.client.post(self.url, {"texto": TEXTO}, format="json")
        return response, generate

    def test_devuelve_un_borrador_valido_sin_guardarlo(self):
        response, generate = self.post(respuesta_ia())

        self.assertEqual(response.status_code, 200, response.data)
        generate.assert_called_once_with(TEXTO)
        self.assertEqual(response.data["borrador"]["activos"], ["Bonos", "Acciones"])
        self.assertTrue(response.data["supuestos"])
        self.assertEqual(UsoIA.objects.filter(usuario=self.user).count(), 1)
        self.assertFalse(
            OptimizacionPortafolio.objects.filter(propietario=self.user).exists()
        )

    def test_informa_los_datos_faltantes(self):
        response, _ = self.post(respuesta_ia(faltantes=["Rendimiento de Acciones"]))

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["faltantes"], ["Rendimiento de Acciones"])
        self.assertEqual(UsoIA.objects.count(), 1)

    def test_respuesta_con_formato_invalido(self):
        with self.assertLogs("optimizacion.views.portfolios", "WARNING"):
            response, _ = self.post("no es json")
        self.assertEqual(response.status_code, 502)

    def test_covarianza_no_valida(self):
        response, _ = self.post(respuesta_ia(
            covarianza=[[0.01, 0.5], [0.5, 0.01]], correlaciones=None
        ))

        self.assertEqual(response.status_code, 422)
        self.assertIn("errores", response.data)

    def test_respeta_la_cuota_y_los_activos_del_plan(self):
        UsoIA.objects.bulk_create(
            [UsoIA(usuario=self.user, tipo="borrador") for _ in range(10)]
        )
        response, generate = self.post(respuesta_ia())
        self.assertEqual(response.status_code, 403)
        generate.assert_not_called()

        UsoIA.objects.all().delete()
        activos = [
            {"nombre": f"A{i}", "rendimiento_esperado": 5, "volatilidad": 10}
            for i in range(11)
        ]
        response, _ = self.post(respuesta_ia(
            activos=activos,
            correlaciones=None,
            sin_correlacion=True,
            limites_categoria={},
            escenarios_estres={},
        ))
        self.assertEqual(response.status_code, 403)
        self.assertIn("hasta 10 activos", response.data["detail"])

    def test_instrucciones_prohiben_inventar_datos(self):
        self.assertIn("No uses datos de\n  mercado", PORTFOLIO_DRAFT_INSTRUCTIONS)
        self.assertIn("No recomiendes activos", PORTFOLIO_DRAFT_INSTRUCTIONS)
        with patch(
            "optimizacion.ai_modeling._call_model", return_value="{}"
        ) as call:
            generar_portafolio(TEXTO)
        self.assertEqual(call.call_args.args[1], TEXTO)
