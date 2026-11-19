from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from optimizacion.models import OptimizationJob
from optimizacion.tasks import expire_stale_jobs


class Command(BaseCommand):
    help = (
        "Marca como fallidos los trabajos de optimización colgados y elimina "
        "los trabajos terminados más antiguos que el periodo indicado. Los "
        "resultados de problemas y portafolios siguen en su historial."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=30,
            help="Conserva los trabajos terminados de los últimos N días (por defecto 30).",
        )

    def handle(self, *args, **options):
        days = options["days"]
        if days < 1:
            raise CommandError("--days debe ser al menos 1.")

        expired = expire_stale_jobs()
        cutoff = timezone.now() - timedelta(days=days)
        deleted, _ = OptimizationJob.objects.filter(
            status__in=[
                OptimizationJob.Status.COMPLETED,
                OptimizationJob.Status.FAILED,
            ],
            completed_at__lt=cutoff,
        ).delete()
        self.stdout.write(
            f"Se marcaron {expired} trabajos colgados como fallidos y se "
            f"eliminaron {deleted} trabajos terminados hace más de {days} días."
        )
