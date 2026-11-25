from django.core.management.base import BaseCommand

from optimizacion.views.auth import _delete_expired_demos


class Command(BaseCommand):
    help = "Elimina las cuentas de demostración que superaron su tiempo de vida."

    def handle(self, *args, **options):
        _delete_expired_demos()
        self.stdout.write("Cuentas de demostración vencidas eliminadas.")
