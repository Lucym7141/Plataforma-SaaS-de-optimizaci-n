"""Pruebas: limpieza de trabajos de optimización antiguos."""

import io
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from ..models import OptimizationJob


class CleanupOptimizationJobsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="cleanup-user",
            password="Fuerte-contraseña-739!",
        )

    def make_job(self, status, *, completed_days_ago=None, started_days_ago=None):
        now = timezone.now()
        return OptimizationJob.objects.create(
            owner=self.user,
            job_type=OptimizationJob.Type.FRONTIER,
            status=status,
            started_at=(
                now - timedelta(days=started_days_ago)
                if started_days_ago is not None
                else None
            ),
            completed_at=(
                now - timedelta(days=completed_days_ago)
                if completed_days_ago is not None
                else None
            ),
        )

    def test_elimina_solo_trabajos_terminados_antiguos(self):
        old_completed = self.make_job(
            OptimizationJob.Status.COMPLETED, completed_days_ago=40
        )
        old_failed = self.make_job(
            OptimizationJob.Status.FAILED, completed_days_ago=31
        )
        recent = self.make_job(
            OptimizationJob.Status.COMPLETED, completed_days_ago=2
        )
        queued = self.make_job(OptimizationJob.Status.QUEUED)
        output = io.StringIO()

        call_command("cleanup_optimization_jobs", stdout=output)

        remaining = set(OptimizationJob.objects.values_list("pk", flat=True))
        self.assertNotIn(old_completed.pk, remaining)
        self.assertNotIn(old_failed.pk, remaining)
        self.assertIn(recent.pk, remaining)
        self.assertIn(queued.pk, remaining)
        self.assertIn("eliminaron 2 trabajos", output.getvalue())

    def test_respeta_el_periodo_indicado(self):
        job = self.make_job(OptimizationJob.Status.COMPLETED, completed_days_ago=10)

        call_command("cleanup_optimization_jobs", days=7, stdout=io.StringIO())

        self.assertFalse(OptimizationJob.objects.filter(pk=job.pk).exists())

    def test_marca_como_fallidos_los_trabajos_colgados(self):
        stuck = self.make_job(OptimizationJob.Status.RUNNING, started_days_ago=1)

        call_command("cleanup_optimization_jobs", stdout=io.StringIO())

        stuck.refresh_from_db()
        self.assertEqual(stuck.status, OptimizationJob.Status.FAILED)

    def test_rechaza_periodos_invalidos(self):
        with self.assertRaises(CommandError):
            call_command("cleanup_optimization_jobs", days=0, stdout=io.StringIO())
