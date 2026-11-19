"""Pruebas: historial de cálculos recientes."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from ..models import OptimizacionPortafolio, OptimizationJob, ProblemaOptimizacion


class JobHistoryTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="history-user",
            password="Fuerte-contraseña-739!",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.problem = ProblemaOptimizacion.objects.create(
            propietario=self.user,
            nombre="Mezcla de producción",
            tipo_objetivo="MAX",
        )
        self.portfolio = OptimizacionPortafolio.objects.create(
            propietario=self.user,
            nombre="Cartera conservadora",
            activos=["A", "B"],
            rendimientos_esperados=["0.1", "0.2"],
            covarianza=[["0.04", "0"], ["0", "0.09"]],
            aversion_riesgo="2",
        )

    def make_job(self, **fields):
        fields.setdefault("owner", self.user)
        fields.setdefault("job_type", OptimizationJob.Type.PROBLEM)
        return OptimizationJob.objects.create(**fields)

    def test_lista_calculos_recientes_sin_resultados(self):
        older = self.make_job(
            problem=self.problem,
            status=OptimizationJob.Status.COMPLETED,
            result={"estado": "OPT"},
        )
        OptimizationJob.objects.filter(pk=older.pk).update(
            created_at=timezone.now() - timedelta(hours=1)
        )
        newer = self.make_job(
            portfolio=self.portfolio,
            job_type=OptimizationJob.Type.FRONTIER,
            status=OptimizationJob.Status.FAILED,
            error="Los límites indicados no permiten una cartera factible.",
        )

        response = self.client.get("/api/trabajos-optimizacion/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["id"] for item in response.data],
            [str(newer.pk), str(older.pk)],
        )
        latest = response.data[0]
        self.assertEqual(latest["type"], "frontier")
        self.assertEqual(latest["status"], "failed")
        self.assertIn("cartera factible", latest["error"])
        self.assertEqual(
            latest["target"],
            {"kind": "portfolio", "id": self.portfolio.pk, "name": "Cartera conservadora"},
        )
        self.assertEqual(
            response.data[1]["target"],
            {"kind": "problem", "id": self.problem.pk, "name": "Mezcla de producción"},
        )
        self.assertNotIn("result", latest)
        self.assertEqual(
            latest["status_url"], f"/api/trabajos-optimizacion/{newer.pk}/"
        )

    def test_detalle_incluye_resultado_y_modelo(self):
        job = self.make_job(
            problem=self.problem,
            status=OptimizationJob.Status.COMPLETED,
            result={"estado": "OPT"},
        )

        data = self.client.get(f"/api/trabajos-optimizacion/{job.pk}/").data

        self.assertEqual(data["result"], {"estado": "OPT"})
        self.assertEqual(data["target"]["name"], "Mezcla de producción")

    def test_solo_muestra_calculos_propios(self):
        other = get_user_model().objects.create_user(
            username="history-other",
            password="Fuerte-contraseña-739!",
        )
        self.make_job(owner=other, status=OptimizationJob.Status.COMPLETED)

        self.assertEqual(self.client.get("/api/trabajos-optimizacion/").data, [])
        self.assertEqual(
            APIClient().get("/api/trabajos-optimizacion/").status_code, 403
        )

    def test_limita_la_cantidad_y_expira_calculos_colgados(self):
        for _ in range(20):
            self.make_job(status=OptimizationJob.Status.COMPLETED)
        stuck = self.make_job(
            status=OptimizationJob.Status.RUNNING,
            started_at=timezone.now() - timedelta(days=1),
        )

        data = self.client.get("/api/trabajos-optimizacion/").data

        self.assertEqual(len(data), 15)
        stuck.refresh_from_db()
        self.assertEqual(stuck.status, OptimizationJob.Status.FAILED)
