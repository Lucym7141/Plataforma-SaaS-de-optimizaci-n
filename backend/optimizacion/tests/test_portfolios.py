"""Pruebas: Optimización de portafolios."""

import io
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.test.utils import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl import load_workbook
from rest_framework.test import APIClient

from ..portfolio import (
    PortfolioSolverError,
    calcular_frontera_eficiente,
    optimizar_media_varianza,
)
from ..models import (
    OptimizacionPortafolio,
    EjecucionPortafolio,
)


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_TASK_EAGER_PROPAGATES=True,
)
class PortfolioOptimizationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="portfolio-user",
            password="Fuerte-contraseña-739!",
        )
        self.client.force_authenticate(user=self.user)
        self.payload = {
            "nombre": "Cartera equilibrada",
            "activos": ["Bono", "Acción"],
            "rendimientos_esperados": ["0.10", "0.20"],
            "covarianza": [["0.04", "0"], ["0", "0.09"]],
            "aversion_riesgo": "2",
        }

    def job_result(self, response):
        self.assertEqual(response.status_code, 202, response.data)
        job_response = self.client.get(response.data["status_url"])
        self.assertEqual(job_response.status_code, 200, job_response.data)
        self.assertEqual(job_response.data["status"], "completed")
        return job_response.data["result"]

    def test_limites_infactibles_explican_que_revisar(self):
        with self.assertRaises(PortfolioSolverError) as raised:
            optimizar_media_varianza(
                [0.10, 0.20],
                [[0.04, 0], [0, 0.09]],
                2,
                bounds=[(0.6, 1.0), (0.6, 1.0)],
            )

        self.assertIn("no permiten una cartera factible", str(raised.exception))
        self.assertIn("pesos mínimos", str(raised.exception))

    def test_trabajo_muestra_el_motivo_cuando_el_modelo_no_tiene_solucion(self):
        created = self.client.post(
            "/api/portafolios/",
            self.payload,
            format="json",
        )
        message = "Los límites indicados no permiten una cartera factible."

        with patch(
            "optimizacion.tasks.optimizar_media_varianza",
            side_effect=PortfolioSolverError(message),
        ), self.assertLogs("optimizacion.tasks", level="WARNING"):
            response = self.client.post(
                f"/api/portafolios/{created.data['id']}/resolver/"
            )

        job = self.client.get(response.data["status_url"]).data
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error"], message)

    def test_error_inesperado_no_expone_detalles_internos(self):
        created = self.client.post(
            "/api/portafolios/",
            self.payload,
            format="json",
        )

        with patch(
            "optimizacion.tasks.optimizar_media_varianza",
            side_effect=RuntimeError("detalle interno"),
        ), self.assertLogs("optimizacion.tasks", level="ERROR"):
            response = self.client.post(
                f"/api/portafolios/{created.data['id']}/resolver/"
            )

        job = self.client.get(response.data["status_url"]).data
        self.assertEqual(job["status"], "failed")
        self.assertNotIn("detalle interno", job["error"])

    @patch(
        "optimizacion.views.jobs.run_optimization_job.delay",
        return_value=SimpleNamespace(id="queued-task"),
    )
    def test_no_encola_frontera_mientras_se_optimiza(self, enqueue):
        created = self.client.post(
            "/api/portafolios/",
            self.payload,
            format="json",
        )
        portfolio_url = f"/api/portafolios/{created.data['id']}/"

        solve = self.client.post(f"{portfolio_url}resolver/")
        frontier = self.client.post(f"{portfolio_url}frontera/")
        solve_again = self.client.post(f"{portfolio_url}resolver/")

        self.assertEqual(solve.status_code, 202)
        self.assertEqual(frontier.status_code, 409)
        self.assertEqual(solve_again.status_code, 409)
        enqueue.assert_called_once()

    def test_api_encola_portafolio_y_frontera_eficiente(self):
        created = self.client.post(
            "/api/portafolios/",
            self.payload,
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        portfolio_url = f"/api/portafolios/{created.data['id']}/"

        solve_response = self.client.post(f"{portfolio_url}resolver/")
        result = self.job_result(solve_response)
        self.assertEqual(
            result["modelo_snapshot"]["nombre"],
            self.payload["nombre"],
        )
        self.assertEqual(
            EjecucionPortafolio.objects.filter(
                optimizacion_id=created.data["id"],
            ).count(),
            1,
        )

        frontier_response = self.client.post(f"{portfolio_url}frontera/")
        frontier_result = self.job_result(frontier_response)
        self.assertEqual(frontier_result["activos"], self.payload["activos"])
        self.assertEqual(len(frontier_result["puntos"]), 21)
        # Datos para el gráfico interactivo: activos de referencia y la
        # última cartera óptima, que coincide con los supuestos actuales.
        references = frontier_result["referencias_activos"]
        self.assertEqual(
            [item["nombre"] for item in references],
            self.payload["activos"],
        )
        for index, item in enumerate(references):
            self.assertAlmostEqual(
                item["volatilidad"] ** 2,
                float(self.payload["covarianza"][index][index]),
                places=8,
            )
        optimum = frontier_result["cartera_optima"]
        self.assertIsNotNone(optimum)
        self.assertAlmostEqual(
            optimum["volatilidad_portafolio"],
            float(result["volatilidad_portafolio"]),
            places=8,
        )
        self.assertEqual(
            frontier_result["periodos_por_anio"],
            result["modelo_snapshot"]["periodos_por_anio"],
        )

        # Si cambian los supuestos, la cartera anterior deja de marcarse.
        changed = dict(self.payload, rendimientos_esperados=["0.12", "0.25"])
        self.assertEqual(
            self.client.put(portfolio_url, changed, format="json").status_code,
            200,
        )
        changed_frontier = self.job_result(
            self.client.post(f"{portfolio_url}frontera/")
        )
        self.assertIsNone(changed_frontier["cartera_optima"])

    def test_media_varianza_respeta_restricciones_y_optimo(self):
        resultado = optimizar_media_varianza(
            [0.10, 0.20],
            [[0.04, 0], [0, 0.09]],
            2,
        )

        self.assertAlmostEqual(sum(resultado["ponderaciones"]), 1, places=8)
        self.assertAlmostEqual(resultado["ponderaciones"][0], 0.5, places=4)
        self.assertAlmostEqual(resultado["rendimientos_portafolio"], 0.15, places=5)
        self.assertAlmostEqual(resultado["varianza_portafolio"], 0.0325, places=5)

    def test_rechaza_pesos_que_violan_limites_aunque_solver_indique_exito(self):
        with patch(
            "optimizacion.portfolio.minimize",
            return_value=SimpleNamespace(success=True, x=[0.6, 0.4]),
        ):
            with self.assertRaisesRegex(
                ValueError,
                "solución de portafolio válida",
            ):
                optimizar_media_varianza(
                    [0.10, 0.20],
                    [[0.04, 0], [0, 0.09]],
                    2,
                    bounds=[(0.7, 1), (0, 1)],
                )

    def test_rechaza_pesos_que_exceden_tope_de_categoria(self):
        with patch(
            "optimizacion.portfolio.minimize",
            return_value=SimpleNamespace(success=True, x=[0.6, 0.4]),
        ):
            with self.assertRaisesRegex(
                ValueError,
                "solución de portafolio válida",
            ):
                optimizar_media_varianza(
                    [0.10, 0.20],
                    [[0.04, 0], [0, 0.09]],
                    2,
                    categorias=["Renta fija", "Acciones"],
                    limites_categoria={"Acciones": 0.3},
                )

    def test_frontera_rechaza_punto_que_no_alcanza_rendimiento_objetivo(self):
        with patch(
            "optimizacion.portfolio.minimize",
            side_effect=[
                SimpleNamespace(success=True, x=[1.0, 0.0]),
                SimpleNamespace(success=True, x=[0.5, 0.5]),
            ],
        ):
            with self.assertRaisesRegex(
                ValueError,
                "frontera eficiente",
            ):
                calcular_frontera_eficiente(
                    [0.10, 0.20],
                    [[0.04, 0], [0, 0.09]],
                    puntos=2,
                )

    def test_descarga_reporte_de_portafolio_con_asignacion_y_metricas(self):
        created = self.client.post(
            "/api/portafolios/",
            self.payload,
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        solved = self.client.post(
            f"/api/portafolios/{created.data['id']}/resolver/"
        )
        result = self.job_result(solved)
        report_url = (
            f"/api/portafolios/{created.data['id']}/ejecuciones/"
            f"{result['id']}/reporte"
        )

        pdf = self.client.get(f"{report_url}/pdf/")
        self.assertEqual(pdf.status_code, 200)
        self.assertTrue(pdf.content.startswith(b"%PDF-"))

        excel = self.client.get(f"{report_url}/xlsx/")
        self.assertEqual(excel.status_code, 200)
        workbook = load_workbook(io.BytesIO(excel.content), read_only=True)
        self.assertIn("Asignación", workbook.sheetnames)
        self.assertIn("Escenarios de estrés", workbook.sheetnames)
        allocation_rows = list(workbook["Asignación"].values)
        self.assertEqual(allocation_rows[2][0], "Bono")

    def test_rechaza_covarianza_no_semidefinida_positiva(self):
        invalid = dict(self.payload)
        invalid["covarianza"] = [["1", "2"], ["2", "1"]]

        response = self.client.post(
            "/api/portafolios/",
            invalid,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("covarianza", response.data)

    def test_limites_por_activo_y_categoria_se_validan_y_aplican(self):
        payload = dict(
            self.payload,
            categorias=["Renta fija", "Acciones"],
            pesos_minimos=["0.25", "0"],
            pesos_maximos=["1", "1"],
            limites_categoria={"Acciones": "0.40"},
        )
        created = self.client.post(
            "/api/portafolios/",
            payload,
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)

        solved = self.client.post(
            f"/api/portafolios/{created.data['id']}/resolver/"
        )
        result = self.job_result(solved)
        weights = result["ponderaciones"]
        self.assertGreaterEqual(weights[0], 0.25 - 1e-6)
        self.assertLessEqual(weights[1], 0.40 + 1e-6)
        self.assertAlmostEqual(sum(weights), 1, places=7)

    def test_frontera_eficiente_cumple_el_limite_de_categoria(self):
        frontier = calcular_frontera_eficiente(
            [0.04, 0.10],
            [[0.01, 0], [0, 0.04]],
            bounds=[(0.2, 1), (0, 1)],
            categorias=["Renta fija", "Acciones"],
            limites_categoria={"Acciones": 0.5},
            puntos=7,
        )

        self.assertEqual(len(frontier), 7)
        for point in frontier:
            self.assertAlmostEqual(sum(point["ponderaciones"]), 1, places=7)
            self.assertGreaterEqual(point["ponderaciones"][0], 0.2 - 1e-6)
            self.assertLessEqual(point["ponderaciones"][1], 0.5 + 1e-6)
        self.assertLessEqual(
            frontier[0]["rendimientos_portafolio"],
            frontier[-1]["rendimientos_portafolio"] + 1e-7,
        )

    def test_rechaza_limites_de_peso_incompatibles(self):
        payload = dict(
            self.payload,
            pesos_minimos=["0.7", "0.7"],
        )
        response = self.client.post(
            "/api/portafolios/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("pesos_minimos", response.data)

    def test_rechaza_topes_de_categoria_infactibles(self):
        payload = dict(
            self.payload,
            categorias=["Renta fija", "Acciones"],
            limites_categoria={"Renta fija": "0.3", "Acciones": "0.3"},
        )
        response = self.client.post(
            "/api/portafolios/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("limites_categoria", response.data)

    def test_metricas_anualizadas_aportaciones_y_estres(self):
        result = optimizar_media_varianza(
            [0.10, 0.20],
            [[0.04, 0], [0, 0.09]],
            2,
            periodos_por_anio=12,
            escenarios_estres={"Recesión": [-0.10, -0.20]},
        )

        self.assertAlmostEqual(result["rendimiento_anualizado"], 1.8, places=5)
        self.assertAlmostEqual(
            result["volatilidad_anualizada"],
            result["volatilidad_portafolio"] * (12 ** 0.5),
            places=7,
        )
        contributions = result["contribuciones_riesgo"]
        self.assertAlmostEqual(
            sum(item["proporcion_volatilidad"] for item in contributions),
            1,
            places=7,
        )
        self.assertAlmostEqual(
            result["resultados_estres"]["Recesión"],
            -0.15,
            places=5,
        )

    def test_previsualiza_importacion_csv_con_delimitador_punto_y_coma(self):
        csv_content = (
            "asset;expected_return;cov:Bonos;cov:Acciones;category;min_weight;max_weight\n"
            "Bonos;0.04;0.01;0;Renta fija;0.1;1\n"
            "Acciones;0.10;0;0.04;Renta variable;0;0.9\n"
        ).encode("utf-8")
        uploaded = SimpleUploadedFile(
            "cartera.csv",
            csv_content,
            content_type="text/csv",
        )

        response = self.client.post(
            "/api/portafolios/importar/preview/",
            {"archivo": uploaded, "nombre": "Desde CSV"},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.data)
        preview = response.data["preview"]
        self.assertEqual(preview["nombre"], "Desde CSV")
        self.assertEqual(preview["activos"], ["Bonos", "Acciones"])
        self.assertEqual(preview["categorias"], ["Renta fija", "Renta variable"])
        self.assertEqual(preview["pesos_minimos"], ["0.10000000", "0.00000000"])
        self.assertEqual(
            OptimizacionPortafolio.objects.count(),
            0,
            "La vista previa no debe guardar el portafolio.",
        )

    def test_previsualizacion_csv_rechaza_matriz_asimetrica(self):
        csv_content = (
            "asset,expected_return,cov:Bonos,cov:Acciones\n"
            "Bonos,0.04,0.01,0.02\n"
            "Acciones,0.10,0.01,0.04\n"
        ).encode("utf-8")
        uploaded = SimpleUploadedFile(
            "invalido.csv",
            csv_content,
            content_type="text/csv",
        )

        response = self.client.post(
            "/api/portafolios/importar/preview/",
            {"archivo": uploaded},
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("covarianza", response.data)

    def test_previsualizacion_csv_rechaza_codificacion_invalida(self):
        uploaded = SimpleUploadedFile(
            "invalido.csv",
            b"\xff\xfe\x00",
            content_type="text/csv",
        )
        response = self.client.post(
            "/api/portafolios/importar/preview/",
            {"archivo": uploaded},
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("archivo", response.data)

    def test_crea_resuelve_edita_y_preserva_historial(self):
        payload = dict(
            self.payload,
            periodos_por_anio=12,
            escenarios_estres={"Recesión": ["-0.10", "-0.20"]},
        )
        response = self.client.post(
            "/api/portafolios/",
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        portfolio_id = response.data["id"]
        portfolio = OptimizacionPortafolio.objects.get(pk=portfolio_id)
        self.assertEqual(portfolio.propietario, self.user)
        self.assertEqual(portfolio.pesos_minimos, ["0", "0"])
        self.assertEqual(portfolio.pesos_maximos, ["1", "1"])

        solve = self.client.post(
            f"/api/portafolios/{portfolio_id}/resolver/"
        )
        self.job_result(solve)
        self.assertEqual(EjecucionPortafolio.objects.filter(
            optimizacion=portfolio,
        ).count(), 1)

        edited = dict(self.payload, nombre="Cartera actualizada")
        update = self.client.put(
            f"/api/portafolios/{portfolio_id}/",
            edited,
            format="json",
        )
        history = self.client.get(
            f"/api/portafolios/{portfolio_id}/historial/"
        )

        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.data["nombre"], "Cartera actualizada")
        self.assertEqual(len(history.data), 1)
        self.assertEqual(history.data[0]["modelo_snapshot"]["nombre"], "Cartera equilibrada")
        self.assertEqual(
            history.data[0]["modelo_snapshot"]["periodos_por_anio"],
            12,
        )
        self.assertEqual(len(history.data[0]["contribuciones_riesgo"]), 2)
        self.assertAlmostEqual(
            history.data[0]["rendimiento_anualizado"],
            1.8,
            places=5,
        )
        self.assertAlmostEqual(
            history.data[0]["resultados_estres"]["Recesión"],
            -0.15,
            places=5,
        )

    def test_no_expone_portafolios_de_otros_usuarios(self):
        other_user = get_user_model().objects.create_user(
            username="other-portfolio-user",
            password="Fuerte-contraseña-739!",
        )
        portfolio = OptimizacionPortafolio.objects.create(
            propietario=other_user,
            **{
                **self.payload,
                "rendimientos_esperados": ["0.10", "0.20"],
                "covarianza": [["0.04", "0"], ["0", "0.09"]],
                "aversion_riesgo": "2",
            },
        )

        response = self.client.get(f"/api/portafolios/{portfolio.pk}/")

        self.assertEqual(response.status_code, 404)
