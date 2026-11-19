"""Pruebas: análisis de restricciones y explicación de resultados con IA."""

import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework.test import APIClient

from ..ai_modeling import (
    AzureOpenAIConfigurationError,
    AzureOpenAIServiceError,
    explicar_resultado,
)
from ..explanations import hechos_portafolio, hechos_problema
from ..models import (
    EjecucionOptimizacion,
    EjecucionPortafolio,
    PerfilUsuario,
    UsoIA,
)
from ..serializers import ProblemaOptimizacionCrearSerializer
from ..services import resolver_problema

EXPLICACION = {
    "resumen": "La capacidad limita la utilidad máxima de 19.5.",
    "puntos_clave": ["La restricción capacidad está activa."],
    "sugerencias": ["Verifica si la capacidad de 12 horas es correcta."],
}


def crear_problema(user, tipo_x="CONT"):
    data = {
        "nombre": "Producción",
        "tipo_objetivo": "MAX",
        "variables": [
            {"nombre": "x", "tipo": tipo_x, "limite_inferior": "0"},
            {"nombre": "y", "tipo": "CONT", "limite_inferior": "0"},
        ],
        "terminos_objetivo": [
            {"variable_nombre": "x", "coeficiente": "3"},
            {"variable_nombre": "y", "coeficiente": "5"},
        ],
        "restricciones": [
            {
                "nombre": "capacidad",
                "operador": "LE",
                "lado_derecho": "12",
                "terminos": [
                    {"variable_nombre": "x", "coeficiente": "2"},
                    {"variable_nombre": "y", "coeficiente": "3"},
                ],
            },
            {
                "nombre": "limite_x",
                "operador": "LE",
                "lado_derecho": "4",
                "terminos": [{"variable_nombre": "x", "coeficiente": "1"}],
            },
            {
                "nombre": "limite_y",
                "operador": "LE",
                "lado_derecho": "3",
                "terminos": [{"variable_nombre": "y", "coeficiente": "1"}],
            },
        ],
    }
    serializer = ProblemaOptimizacionCrearSerializer(
        data=data,
        context={"request": SimpleNamespace(user=user)},
    )
    serializer.is_valid(raise_exception=True)
    return serializer.save()


class ConstraintAnalysisTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="analysis-user", password="Fuerte-contraseña-739!"
        )

    def test_modelo_continuo_guarda_holguras_y_precios_sombra(self):
        ejecucion = resolver_problema(crear_problema(self.user).pk)

        self.assertEqual(ejecucion.estado, EjecucionOptimizacion.Estado.OPTIMO)
        analisis = {
            item["nombre"]: item
            for item in ejecucion.detalles["restricciones_analisis"]
        }
        self.assertTrue(analisis["capacidad"]["activa"])
        self.assertAlmostEqual(analisis["capacidad"]["precio_sombra"], 1.5)
        self.assertTrue(analisis["limite_y"]["activa"])
        self.assertAlmostEqual(analisis["limite_y"]["precio_sombra"], 0.5)
        self.assertFalse(analisis["limite_x"]["activa"])
        self.assertAlmostEqual(analisis["limite_x"]["holgura"], 2.5)
        self.assertEqual(analisis["limite_x"]["precio_sombra"], 0.0)

    def test_modelo_entero_es_optimo_y_no_informa_precios_sombra(self):
        ejecucion = resolver_problema(crear_problema(self.user, "ENT").pk)

        self.assertEqual(ejecucion.estado, EjecucionOptimizacion.Estado.OPTIMO)
        self.assertAlmostEqual(float(ejecucion.valor_objetivo), 19.3333, places=3)
        valores = {v.variable_nombre: float(v.valor) for v in ejecucion.valores.all()}
        self.assertAlmostEqual(valores["x"], 2.0)
        self.assertTrue(all(
            item["precio_sombra"] is None
            for item in ejecucion.detalles["restricciones_analisis"]
        ))

    def test_hechos_del_modelo_incluyen_definicion_y_analisis(self):
        ejecucion = resolver_problema(crear_problema(self.user).pk)

        hechos = hechos_problema(ejecucion)

        self.assertEqual(hechos["tipo"], "modelo")
        self.assertEqual(hechos["estado"], "Óptimo")
        self.assertEqual(hechos["valor_objetivo"], 19.5)
        self.assertEqual(hechos["objetivo"], "Maximizar 3.0*x + 5.0*y")
        capacidad = hechos["restricciones"][0]
        self.assertEqual(capacidad["definicion"], "2.0*x + 3.0*y <= 12.0")
        self.assertTrue(capacidad["activa"])
        variable_y = next(v for v in hechos["variables"] if v["nombre"] == "y")
        self.assertEqual(variable_y["valor"], 3.0)
        self.assertTrue(hechos["analisis_de_restricciones_disponible"])


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, CELERY_TASK_EAGER_PROPAGATES=True)
class ExplainEndpointTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="explain-user", password="Fuerte-contraseña-739!"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.problema = crear_problema(self.user)
        self.ejecucion = resolver_problema(self.problema.pk)
        self.url = (
            f"/api/problemas/{self.problema.pk}/ejecuciones/"
            f"{self.ejecucion.pk}/explicar/"
        )

    def create_portfolio_execution(self):
        created = self.client.post(
            "/api/portafolios/",
            {
                "nombre": "Cartera",
                "activos": ["Bono", "Acción"],
                "rendimientos_esperados": ["0.10", "0.20"],
                "covarianza": [["0.04", "0"], ["0", "0.09"]],
                "aversion_riesgo": "2",
                "categorias": ["Renta fija", "Renta variable"],
                "pesos_minimos": ["0", "0"],
                "pesos_maximos": ["1", "0.4"],
                "limites_categoria": {"Renta variable": "0.4"},
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        self.client.post(f"/api/portafolios/{created.data['id']}/resolver/")
        return EjecucionPortafolio.objects.get(optimizacion_id=created.data["id"])

    def test_explica_guarda_y_registra_el_uso(self):
        with patch(
            "optimizacion.views.explanations.explicar_resultado",
            return_value=EXPLICACION,
        ) as explain:
            response = self.client.post(self.url)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, EXPLICACION)
        hechos = explain.call_args.args[0]
        self.assertEqual(hechos["valor_objetivo"], 19.5)
        self.ejecucion.refresh_from_db()
        self.assertEqual(self.ejecucion.explicacion_ia, EXPLICACION)
        self.assertEqual(
            UsoIA.objects.filter(usuario=self.user, tipo="explicacion").count(), 1
        )

    def test_explicacion_guardada_no_se_vuelve_a_cobrar(self):
        self.ejecucion.explicacion_ia = EXPLICACION
        self.ejecucion.save()

        with patch("optimizacion.views.explanations.explicar_resultado") as explain:
            response = self.client.post(self.url)

        self.assertEqual(response.status_code, 200)
        explain.assert_not_called()
        self.assertEqual(UsoIA.objects.count(), 0)

    def test_la_ejecucion_expone_su_explicacion(self):
        self.ejecucion.explicacion_ia = EXPLICACION
        self.ejecucion.save()

        history = self.client.get(f"/api/problemas/{self.problema.pk}/historial/")

        self.assertEqual(history.data[0]["explicacion_ia"], EXPLICACION)

    def test_cuota_mensual_del_plan(self):
        UsoIA.objects.bulk_create(
            [UsoIA(usuario=self.user, tipo="borrador") for _ in range(10)]
        )

        with patch("optimizacion.views.explanations.explicar_resultado") as explain:
            response = self.client.post(self.url)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "plan_limit")
        self.assertIn("10 consultas de IA al mes", response.data["detail"])
        explain.assert_not_called()

    def test_cuenta_sin_limites_no_tiene_cuota(self):
        PerfilUsuario.objects.create(usuario=self.user, sin_limites=True)
        UsoIA.objects.bulk_create(
            [UsoIA(usuario=self.user, tipo="borrador") for _ in range(50)]
        )

        with patch(
            "optimizacion.views.explanations.explicar_resultado",
            return_value=EXPLICACION,
        ):
            response = self.client.post(self.url)

        self.assertEqual(response.status_code, 200)

    def test_no_explica_ejecuciones_con_error_ni_ajenas(self):
        error = EjecucionOptimizacion.objects.create(
            problema=self.problema, estado=EjecucionOptimizacion.Estado.ERROR
        )
        response = self.client.post(
            f"/api/problemas/{self.problema.pk}/ejecuciones/{error.pk}/explicar/"
        )
        self.assertEqual(response.status_code, 400)

        other = APIClient()
        other.force_authenticate(
            get_user_model().objects.create_user(
                username="explain-other", password="Fuerte-contraseña-739!"
            )
        )
        self.assertEqual(other.post(self.url).status_code, 404)

    def test_errores_de_azure_se_informan_sin_cobrar(self):
        for side_effect, expected in (
            (AzureOpenAIConfigurationError("Configura Azure."), 503),
            (AzureOpenAIServiceError("falló"), 502),
        ):
            with self.subTest(expected=expected), patch(
                "optimizacion.views.explanations.explicar_resultado",
                side_effect=side_effect,
            ):
                if expected == 502:
                    with self.assertLogs("optimizacion.views.explanations", "ERROR"):
                        response = self.client.post(self.url)
                else:
                    response = self.client.post(self.url)
            self.assertEqual(response.status_code, expected)
        self.assertEqual(UsoIA.objects.count(), 0)

    def test_explica_portafolios(self):
        ejecucion = self.create_portfolio_execution()
        hechos = hechos_portafolio(ejecucion)
        self.assertEqual(hechos["tipo"], "portafolio")
        accion = next(a for a in hechos["activos"] if a["activo"] == "Acción")
        self.assertTrue(accion["en_peso_maximo"])
        self.assertTrue(hechos["limites_por_categoria"][0]["activo_el_limite"])

        with patch(
            "optimizacion.views.explanations.explicar_resultado",
            return_value=EXPLICACION,
        ):
            response = self.client.post(
                f"/api/portafolios/{ejecucion.optimizacion_id}/ejecuciones/"
                f"{ejecucion.pk}/explicar/"
            )

        self.assertEqual(response.status_code, 200, response.data)

    def test_borrador_de_modelo_usa_la_cuota(self):
        payload = {"texto": "Maximizar utilidad con dos productos y horas limitadas."}
        modelo = json.dumps({
            "nombre": "Borrador",
            "tipo_objetivo": "MAX",
            "variables": [{"nombre": "x", "tipo": "CONT"}],
            "terminos_objetivo": [{"variable_nombre": "x", "coeficiente": "1"}],
            "restricciones": [],
        })
        with patch(
            "optimizacion.views.problems.generar_modelo", return_value=modelo
        ):
            self.assertEqual(
                self.client.post("/api/problemas/generar/", payload, format="json")
                .status_code,
                200,
            )
            self.assertEqual(UsoIA.objects.filter(tipo="borrador").count(), 1)

            UsoIA.objects.bulk_create(
                [UsoIA(usuario=self.user, tipo="borrador") for _ in range(9)]
            )
            blocked = self.client.post(
                "/api/problemas/generar/", payload, format="json"
            )
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.data["code"], "plan_limit")


class ExplainServiceTests(TestCase):
    def test_usa_instrucciones_de_portafolio_sin_asesoria_financiera(self):
        with patch(
            "optimizacion.ai_modeling._call_model",
            return_value=json.dumps(EXPLICACION),
        ) as call:
            result = explicar_resultado({"tipo": "portafolio", "nombre": "P"})

        self.assertEqual(result, EXPLICACION)
        instructions, content = call.call_args.args
        self.assertIn("No des asesoría financiera", instructions)
        self.assertEqual(json.loads(content)["nombre"], "P")

    def test_rechaza_respuestas_invalidas(self):
        for respuesta in (
            "no es json",
            json.dumps({"puntos_clave": []}),
            json.dumps({"resumen": "ok", "sugerencias": "no es lista"}),
            json.dumps({"resumen": "ok", "puntos_clave": ["x" * 500]}),
        ):
            with self.subTest(respuesta=respuesta[:20]), patch(
                "optimizacion.ai_modeling._call_model", return_value=respuesta
            ), self.assertRaises(AzureOpenAIServiceError):
                explicar_resultado({"tipo": "modelo"})
