"""Pruebas: API de problemas de optimización y trabajos en cola."""

import json
import io
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pulp
from kombu.exceptions import OperationalError
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.test.utils import override_settings
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.test import APIClient

from ..serializers import ProblemaOptimizacionCrearSerializer
from ..services import resolver_problema
from ..tasks import run_optimization_job
from ..ai_modeling import (
    AzureOpenAIConfigurationError,
)
from ..models import (
    ProblemaOptimizacion,
    EjecucionOptimizacion,
    OptimizationJob,
    VariableDecision,
    TerminoObjetivo,
    Restriccion,
    TerminoRestriccion,
)


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_TASK_EAGER_PROPAGATES=True,
)
class ApiOptimizacionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="inversionista",
            password="Fuerte-contraseña-739!",
        )
        self.client.force_authenticate(user=self.user)

        self.problema = ProblemaOptimizacion.objects.create(
            nombre="Problema de prueba API",
            descripcion="Prueba automatizada",
            tipo_objetivo="MAX",
            activo=True,
            propietario=self.user,
        )

        self.x = VariableDecision.objects.create(
            problema=self.problema,
            nombre="x",
            tipo="CONT",
            limite_inferior=0,
        )

        self.y = VariableDecision.objects.create(
            problema=self.problema,
            nombre="y",
            tipo="CONT",
            limite_inferior=0,
        )

        TerminoObjetivo.objects.create(
            problema=self.problema,
            variable=self.x,
            coeficiente=3,
        )

        TerminoObjetivo.objects.create(
            problema=self.problema,
            variable=self.y,
            coeficiente=5,
        )

        capacidad = Restriccion.objects.create(
            problema=self.problema,
            nombre="capacidad",
            operador="LE",
            lado_derecho=12,
        )

        TerminoRestriccion.objects.create(
            restriccion=capacidad,
            variable=self.x,
            coeficiente=2,
        )

        TerminoRestriccion.objects.create(
            restriccion=capacidad,
            variable=self.y,
            coeficiente=3,
        )

        limite_x = Restriccion.objects.create(
            problema=self.problema,
            nombre="limite_x",
            operador="LE",
            lado_derecho=4,
        )

        TerminoRestriccion.objects.create(
            restriccion=limite_x,
            variable=self.x,
            coeficiente=1,
        )

        limite_y = Restriccion.objects.create(
            problema=self.problema,
            nombre="limite_y",
            operador="LE",
            lado_derecho=3,
        )

        TerminoRestriccion.objects.create(
            restriccion=limite_y,
            variable=self.y,
            coeficiente=1,
        )

    def job_result(self, response):
        self.assertEqual(response.status_code, 202, response.data)
        job_response = self.client.get(response.data["status_url"])
        self.assertEqual(job_response.status_code, 200, job_response.data)
        self.assertEqual(job_response.data["status"], "completed")
        return job_response.data["result"]

    def test_listar_problemas(self):
        respuesta = self.client.get("/api/problemas/")

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(len(respuesta.data), 1)
        self.assertEqual(
            respuesta.data[0]["nombre"],
            "Problema de prueba API",
        )

    def test_api_requiere_autenticacion(self):
        respuesta = APIClient().get("/api/problemas/")

        self.assertEqual(respuesta.status_code, 403)

    def test_usuario_no_puede_ver_problemas_ajenos(self):
        otro_usuario = get_user_model().objects.create_user(
            username="otro",
            password="Fuerte-contraseña-739!",
        )
        problema_ajeno = ProblemaOptimizacion.objects.create(
            nombre="Privado de otra cuenta",
            tipo_objetivo="MAX",
            propietario=otro_usuario,
        )

        lista = self.client.get("/api/problemas/")
        detalle = self.client.get(
            f"/api/problemas/{problema_ajeno.pk}/"
        )
        resolver = self.client.post(
            f"/api/problemas/{problema_ajeno.pk}/resolver/"
        )
        eliminar = self.client.delete(
            f"/api/problemas/{problema_ajeno.pk}/"
        )

        self.assertEqual(len(lista.data), 1)
        self.assertEqual(detalle.status_code, 404)
        self.assertEqual(resolver.status_code, 404)
        self.assertEqual(eliminar.status_code, 404)
        self.assertTrue(
            ProblemaOptimizacion.objects.filter(
                pk=problema_ajeno.pk
            ).exists()
        )

    def test_detalle_problema(self):
        respuesta = self.client.get(
            f"/api/problemas/{self.problema.id}/"
        )

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(
            respuesta.data["variables"].__len__(),
            2,
        )
        self.assertEqual(
            respuesta.data["restricciones"].__len__(),
            3,
        )

    def test_eliminar_problema_borra_su_historial(self):
        solved = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )
        result = self.job_result(solved)
        execution_id = result["id"]

        response = self.client.delete(
            f"/api/problemas/{self.problema.pk}/"
        )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(
            ProblemaOptimizacion.objects.filter(
                pk=self.problema.pk
            ).exists()
        )
        self.assertFalse(
            EjecucionOptimizacion.objects.filter(pk=execution_id).exists()
        )

    def test_editar_archivar_duplicar_y_conservar_historial(self):
        solution = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )
        self.job_result(solution)

        payload = {
            "nombre": "Problema actualizado",
            "descripcion": "Descripción nueva",
            "tipo_objetivo": "MAX",
            "variables": [
                {"nombre": "x", "tipo": "CONT", "limite_inferior": "0"},
                {"nombre": "y", "tipo": "CONT", "limite_inferior": "0"},
            ],
            "terminos_objetivo": [
                {"variable_nombre": "x", "coeficiente": "3"},
                {"variable_nombre": "y", "coeficiente": "5"},
            ],
            "restricciones": [],
        }
        update = self.client.put(
            f"/api/problemas/{self.problema.pk}/",
            payload,
            format="json",
        )
        history = self.client.get(
            f"/api/problemas/{self.problema.pk}/historial/"
        )
        old_value = history.data[0]["valores"][0]
        duplicate = self.client.post(
            f"/api/problemas/{self.problema.pk}/duplicar/"
        )
        archive = self.client.delete(
            f"/api/problemas/{self.problema.pk}/archivar/"
        )

        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.data["nombre"], "Problema actualizado")
        self.assertEqual(old_value["variable_nombre"], "x")
        self.assertIsNone(old_value["variable"])
        self.assertEqual(duplicate.status_code, 201)
        self.assertEqual(duplicate.data["nombre"], "Problema actualizado (copia)")
        self.assertEqual(archive.status_code, 204)
        self.assertEqual(
            self.client.get("/api/problemas/").data,
            [duplicate.data],
        )

    def test_resolver_problema(self):
        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        resultado = self.job_result(respuesta)
        self.assertEqual(resultado["estado"], "OPT")
        self.assertAlmostEqual(
            float(resultado["valor_objetivo"]),
            19.5,
            places=4,
        )

    @patch(
        "optimizacion.views.jobs.run_optimization_job.delay",
        return_value=SimpleNamespace(id="queued-task"),
    )
    def test_trabajo_pendiente_se_consulta_y_bloquea_ediciones(self, enqueue):
        response = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )
        self.assertEqual(response.status_code, 202)
        job = OptimizationJob.objects.get(pk=response.data["id"])
        self.assertEqual(job.status, OptimizationJob.Status.QUEUED)
        self.assertEqual(job.celery_task_id, "queued-task")

        status_response = self.client.get(response.data["status_url"])
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.data["status"], "queued")

        update = self.client.put(
            f"/api/problemas/{self.problema.pk}/",
            {"nombre": "No modificar", "variables": [], "restricciones": []},
            format="json",
        )
        self.assertEqual(update.status_code, 409)
        enqueue.assert_called_once()

    @patch(
        "optimizacion.views.jobs.run_optimization_job.delay",
        return_value=SimpleNamespace(id="queued-task"),
    )
    def test_no_encola_dos_calculos_del_mismo_problema(self, enqueue):
        first = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )
        second = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )

        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(
            OptimizationJob.objects.filter(problem=self.problema).count(),
            1,
        )
        enqueue.assert_called_once()

    @patch(
        "optimizacion.views.jobs.run_optimization_job.delay",
        return_value=SimpleNamespace(id="queued-task"),
    )
    def test_trabajo_colgado_expira_y_permite_reintentar(self, enqueue):
        stale = OptimizationJob.objects.create(
            owner=self.user,
            problem=self.problema,
            job_type=OptimizationJob.Type.PROBLEM,
            status=OptimizationJob.Status.RUNNING,
            started_at=timezone.now() - timedelta(hours=1),
        )

        response = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )

        self.assertEqual(response.status_code, 202)
        stale.refresh_from_db()
        self.assertEqual(stale.status, OptimizationJob.Status.FAILED)
        self.assertIn("interrumpió", stale.error)
        self.assertIsNotNone(stale.completed_at)

    def test_reentrega_de_trabajo_en_proceso_no_lo_repite(self):
        job = OptimizationJob.objects.create(
            owner=self.user,
            problem=self.problema,
            job_type=OptimizationJob.Type.PROBLEM,
            status=OptimizationJob.Status.RUNNING,
            started_at=timezone.now(),
        )

        with patch("optimizacion.tasks._run_job") as run_job:
            with self.assertLogs("optimizacion.tasks", level="WARNING"):
                run_optimization_job(str(job.pk))

        run_job.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, OptimizationJob.Status.FAILED)
        self.assertIn("interrumpió", job.error)

    def test_trabajo_terminado_no_se_vuelve_a_ejecutar(self):
        job = OptimizationJob.objects.create(
            owner=self.user,
            problem=self.problema,
            job_type=OptimizationJob.Type.PROBLEM,
            status=OptimizationJob.Status.COMPLETED,
            result={"estado": "OPT"},
        )

        with patch("optimizacion.tasks._run_job") as run_job:
            run_optimization_job(str(job.pk))

        run_job.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, OptimizationJob.Status.COMPLETED)
        self.assertEqual(job.result, {"estado": "OPT"})

    @patch(
        "optimizacion.views.jobs.run_optimization_job.delay",
        side_effect=OperationalError("connection refused"),
    )
    def test_no_encola_si_redis_no_esta_disponible(self, enqueue):
        with self.assertLogs("optimizacion.views.jobs", level="ERROR"):
            response = self.client.post(
                f"/api/problemas/{self.problema.pk}/resolver/"
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("Redis", response.data["detail"])
        job = OptimizationJob.objects.latest("created_at")
        self.assertEqual(job.status, OptimizationJob.Status.FAILED)
        enqueue.assert_called_once()

    def test_trabajo_no_es_visible_a_otro_usuario(self):
        response = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )
        job = self.job_result(response)
        other_user = get_user_model().objects.create_user(
            username="otro-trabajo",
            password="Fuerte-contraseña-739!",
        )
        other_client = APIClient()
        other_client.force_authenticate(user=other_user)

        self.assertEqual(
            other_client.get(response.data["status_url"]).status_code,
            404,
        )
        self.assertTrue(job["id"])

    @patch(
        "optimizacion.services.pulp.COIN_CMD",
        wraps=pulp.COIN_CMD,
    )
    def test_solucionador_recibe_limite_de_tiempo_y_un_hilo(self, coin_cmd):
        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        self.job_result(respuesta)
        coin_cmd.assert_called_once_with(
            msg=False,
            timeLimit=30,
            threads=1,
        )

    def test_no_resolver_problema_inactivo(self):
        self.problema.activo = False
        self.problema.save()

        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("error", respuesta.data)


    def test_crear_problema_completo(self):
        datos = {
            "nombre": "Nuevo problema",
            "descripcion": "Prueba de creación desde la API",
            "tipo_objetivo": "MAX",
            "variables": [
                {
                    "nombre": "x",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
                {
                    "nombre": "y",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
            ],
            "terminos_objetivo": [
                {
                    "variable_nombre": "x",
                    "coeficiente": "3",
                },
                {
                    "variable_nombre": "y",
                    "coeficiente": "5",
                },
            ],
            "restricciones": [
                {
                    "nombre": "capacidad",
                    "operador": "LE",
                    "lado_derecho": "12",
                    "terminos": [
                        {
                            "variable_nombre": "x",
                            "coeficiente": "2",
                        },
                        {
                            "variable_nombre": "y",
                            "coeficiente": "3",
                        },
                    ],
                },
            ],
        }

        respuesta = self.client.post(
            "/api/problemas/",
            datos,
            format="json",
        )

        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(respuesta.data["nombre"], "Nuevo problema")
        self.assertEqual(len(respuesta.data["variables"]), 2)
        self.assertEqual(
            len(respuesta.data["terminos_objetivo"]),
            2,
        )
        self.assertEqual(len(respuesta.data["restricciones"]), 1)

        problema_creado = ProblemaOptimizacion.objects.get(
            nombre="Nuevo problema"
        )
        self.assertEqual(problema_creado.propietario, self.user)
        self.assertEqual(problema_creado.variables.count(), 2)
        self.assertEqual(problema_creado.terminos_objetivo.count(), 2)
        self.assertEqual(problema_creado.restricciones.count(), 1)

    def test_generar_borrador_con_ia_valida_y_no_guarda_el_modelo(self):
        modelo = {
            "nombre": "Plan generado",
            "descripcion": "Borrador desde texto.",
            "tipo_objetivo": "MAX",
            "variables": [
                {
                    "nombre": "x",
                    "descripcion": "Unidades de producto",
                    "unidad": "unidades",
                    "tipo": "ENT",
                    "limite_inferior": "0",
                    "limite_superior": "10",
                },
                {
                    "nombre": "y",
                    "descripcion": "",
                    "unidad": "",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                    "limite_superior": None,
                },
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
            ],
        }
        with patch(
            "optimizacion.views.problems.generar_modelo",
            return_value=json.dumps(modelo),
        ) as generate:
            response = self.client.post(
                "/api/problemas/generar/",
                {
                    "texto": (
                        "Maximiza utilidad con dos variables y una restricción "
                        "de capacidad de doce unidades."
                    )
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["nombre"], "Plan generado")
        self.assertEqual(len(response.data["variables"]), 2)
        self.assertEqual(len(response.data["restricciones"]), 1)
        self.assertEqual(
            ProblemaOptimizacion.objects.filter(
                propietario=self.user,
            ).count(),
            1,
        )
        generate.assert_called_once()

    def test_generar_borrador_con_ia_rechaza_entrada_corta(self):
        with patch("optimizacion.views.problems.generar_modelo") as generate:
            response = self.client.post(
                "/api/problemas/generar/",
                {"texto": "Muy corto"},
                format="json",
            )

        self.assertEqual(response.status_code, 400)
        generate.assert_not_called()

    def test_generar_borrador_con_ia_rechaza_salida_invalida(self):
        with patch(
            "optimizacion.views.problems.generar_modelo",
            return_value=json.dumps({
                "nombre": "Modelo inválido",
                "tipo_objetivo": "MAX",
                "variables": [{"nombre": "x", "tipo": "CONT"}],
                "terminos_objetivo": [
                    {"variable_nombre": "variable_inexistente", "coeficiente": "1"}
                ],
                "restricciones": [],
            }),
        ):
            response = self.client.post(
                "/api/problemas/generar/",
                {"texto": "Maximiza una función con una variable y restricciones."},
                format="json",
            )

        self.assertEqual(response.status_code, 422)
        self.assertIn("no cumple las validaciones", response.data["detail"])

    def test_generar_borrador_con_ia_informa_si_azure_no_esta_configurado(self):
        with patch(
            "optimizacion.views.problems.generar_modelo",
            side_effect=AzureOpenAIConfigurationError(
                "Configura Azure OpenAI."
            ),
        ):
            response = self.client.post(
                "/api/problemas/generar/",
                {"texto": "Maximiza utilidad con dos variables de decisión."},
                format="json",
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["detail"], "Configura Azure OpenAI.")

    def test_rechazar_variable_inexistente(self):
        datos = {
            "nombre": "Problema inválido",
            "tipo_objetivo": "MAX",
            "variables": [
                {
                    "nombre": "x",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
            ],
            "terminos_objetivo": [
                {
                    "variable_nombre": "z",
                    "coeficiente": "5",
                },
            ],
            "restricciones": [],
        }

        respuesta = self.client.post(
            "/api/problemas/",
            datos,
            format="json",
        )

        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(
            ProblemaOptimizacion.objects.filter(
                nombre="Problema inválido"
            ).count(),
            0,
        )

    @override_settings(
        OPTIMIZER_MAX_VARIABLES=1,
        OPTIMIZER_MAX_CONSTRAINTS=1,
        OPTIMIZER_MAX_TERMS=10,
        OPTIMIZER_MAX_ABS_VALUE=1000,
    )
    def test_rechazar_modelo_que_supera_limite_de_variables(self):
        serializer = ProblemaOptimizacionCrearSerializer(data={
            "nombre": "Modelo excesivo",
            "variables": [
                {"nombre": "x", "tipo": "CONT"},
                {"nombre": "y", "tipo": "CONT"},
            ],
            "terminos_objetivo": [
                {"variable_nombre": "x", "coeficiente": "1"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("variables", serializer.errors)

    @override_settings(
        OPTIMIZER_MAX_VARIABLES=2,
        OPTIMIZER_MAX_CONSTRAINTS=1,
        OPTIMIZER_MAX_TERMS=10,
        OPTIMIZER_MAX_ABS_VALUE=1000,
    )
    def test_rechazar_coeficiente_fuera_de_rango(self):
        serializer = ProblemaOptimizacionCrearSerializer(data={
            "nombre": "Coeficiente excesivo",
            "variables": [{"nombre": "x", "tipo": "CONT"}],
            "terminos_objetivo": [
                {"variable_nombre": "x", "coeficiente": "1001"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)

    @override_settings(OPTIMIZER_MAX_VARIABLES=1)
    def test_solucionador_tambien_limita_modelos_existentes(self):
        ejecucion = resolver_problema(self.problema.pk)

        self.assertEqual(ejecucion.estado, "ERR")
        self.assertIn("límite de variables", ejecucion.mensaje)

    def test_descarga_reporte_pdf_y_excel_de_una_ejecucion(self):
        solved = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )
        result = self.job_result(solved)
        execution_id = result["id"]
        report_url = (
            f"/api/problemas/{self.problema.pk}/ejecuciones/"
            f"{execution_id}/reporte"
        )

        pdf = self.client.get(f"{report_url}/pdf/")
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF-"))
        self.assertIn("attachment;", pdf["Content-Disposition"])

        excel = self.client.get(f"{report_url}/xlsx/")
        self.assertEqual(excel.status_code, 200)
        self.assertIn(
            "spreadsheetml.sheet",
            excel["Content-Type"],
        )
        workbook = load_workbook(io.BytesIO(excel.content), read_only=True)
        self.assertEqual(workbook.sheetnames[0], "Resumen")
        values = list(workbook["Resumen"].values)
        self.assertIn(
            ("Modelo", self.problema.nombre),
            values,
        )
        self.assertEqual(
            self.client.get(f"{report_url}/csv/").status_code,
            400,
        )

    def test_reporte_de_ejecucion_no_es_visible_a_otra_cuenta(self):
        solved = self.client.post(
            f"/api/problemas/{self.problema.pk}/resolver/"
        )
        result = self.job_result(solved)
        other_user = get_user_model().objects.create_user(
            username="reporte-ajeno",
            password="Fuerte-contraseña-739!",
        )
        other_client = APIClient()
        other_client.force_authenticate(user=other_user)

        response = other_client.get(
            f"/api/problemas/{self.problema.pk}/ejecuciones/"
            f"{result['id']}/reporte/pdf/"
        )

        self.assertEqual(response.status_code, 404)
