from django.core.management.base import BaseCommand
from django.utils import timezone

from optimizacion.models import RateLimitCounter


class Command(BaseCommand):
    help = "Elimina contadores de rate limit que ya expiraron."

    def handle(self, *args, **options):
        deleted, _ = RateLimitCounter.objects.filter(
            expires_at__lte=timezone.now()
        ).delete()
        self.stdout.write(f"Se eliminaron {deleted} contadores expirados.")
