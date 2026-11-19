from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from optimizacion.models import PerfilUsuario
from optimizacion.plans import plan_summary


class Command(BaseCommand):
    help = (
        "Asigna un plan a una cuenta o la exime de los límites. Ejemplos: "
        "`asignar_plan ana --plan profesional`, `asignar_plan demo --sin-limites`."
    )

    def add_arguments(self, parser):
        parser.add_argument("username", help="Nombre de usuario de la cuenta.")
        parser.add_argument(
            "--plan",
            help="Id del plan (vacío = plan por defecto).",
        )
        exemption = parser.add_mutually_exclusive_group()
        exemption.add_argument(
            "--sin-limites",
            dest="unlimited",
            action="store_true",
            default=None,
            help="Exime a la cuenta de todos los límites del plan.",
        )
        exemption.add_argument(
            "--con-limites",
            dest="unlimited",
            action="store_false",
            help="Vuelve a aplicar los límites del plan.",
        )

    def handle(self, *args, **options):
        if options["plan"] is None and options["unlimited"] is None:
            raise CommandError("Indica --plan, --sin-limites o --con-limites.")

        user = get_user_model().objects.filter(
            username=options["username"]
        ).first()
        if user is None:
            raise CommandError(
                f"No existe la cuenta {options['username']!r}. Créala antes "
                "de asignarle un plan."
            )

        profile, _ = PerfilUsuario.objects.get_or_create(usuario=user)
        if options["plan"] is not None:
            plan_ids = {plan["id"] for plan in settings.SUBSCRIPTION_PLANS}
            if options["plan"] and options["plan"] not in plan_ids:
                raise CommandError(
                    f"Plan desconocido. Usa uno de: {', '.join(sorted(plan_ids))}."
                )
            profile.plan = options["plan"]
        if options["unlimited"] is not None:
            profile.sin_limites = options["unlimited"]
        profile.save(update_fields=["plan", "sin_limites", "actualizado_en"])

        summary = plan_summary(user)
        limits = "sin límites" if summary["unlimited"] else "con los límites del plan"
        self.stdout.write(
            f"{user.username}: plan {summary['name']}, {limits}."
        )
