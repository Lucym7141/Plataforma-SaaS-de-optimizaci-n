"""Planes de suscripción: plan de cada cuenta y aplicación de sus límites."""

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.response import Response

from .models import OptimizacionPortafolio, PerfilUsuario, ProblemaOptimizacion

RESOURCE_LABELS = {
    "models": ("modelo de optimización", "modelos de optimización"),
    "portfolios": ("portafolio", "portafolios"),
}


class PlanLimitError(Exception):
    """La acción superaría un límite del plan de la cuenta."""


def get_plan(plan_id=""):
    plans = settings.SUBSCRIPTION_PLANS
    for plan in plans:
        if plan["id"] == plan_id:
            return plan
    return plans[0]


def _profile(user):
    return PerfilUsuario.objects.filter(usuario=user).first()


def user_plan(user):
    """Devuelve (plan, sin_limites) de la cuenta."""
    profile = _profile(user)
    unlimited = user.is_superuser or bool(profile and profile.sin_limites)
    return get_plan(profile.plan if profile else ""), unlimited


def _limit(user, resource):
    plan, unlimited = user_plan(user)
    if unlimited:
        return plan, None
    return plan, plan.get("limits", {}).get(resource)


def _usage(user):
    return {
        "models": ProblemaOptimizacion.objects.filter(
            propietario=user, archivado=False
        ).count(),
        "portfolios": OptimizacionPortafolio.objects.filter(
            propietario=user, archivado=False
        ).count(),
    }


def plan_summary(user):
    plan, unlimited = user_plan(user)
    limits = {} if unlimited else plan.get("limits", {})
    return {
        "id": plan["id"],
        "name": plan["name"],
        "unlimited": unlimited,
        "limits": {
            "models": limits.get("models"),
            "portfolios": limits.get("portfolios"),
            "assets_per_portfolio": limits.get("assets_per_portfolio"),
        },
        "usage": _usage(user),
    }


def lock_account(user):
    """Bloquea la fila del usuario para que dos creaciones simultáneas no
    superen el límite. Debe llamarse dentro de transaction.atomic()."""
    get_user_model().objects.select_for_update().filter(pk=user.pk).first()


def check_can_add(user, resource, adding=1):
    """Lanza PlanLimitError si la cuenta no puede tener `adding` elementos más."""
    plan, limit = _limit(user, resource)
    if limit is None:
        return
    current = _usage(user)[resource]
    if current + adding > limit:
        singular, plural = RESOURCE_LABELS[resource]
        noun = singular if limit == 1 else plural
        raise PlanLimitError(
            f"Tu plan {plan['name']} permite hasta {limit} {noun} y ya "
            f"tienes {current}. Archiva alguno o mejora tu plan para continuar."
        )


def check_asset_count(user, count):
    plan, limit = _limit(user, "assets_per_portfolio")
    if limit is not None and count > limit:
        raise PlanLimitError(
            f"Tu plan {plan['name']} permite hasta {limit} activos por "
            f"portafolio y este tiene {count}. Reduce los activos o mejora "
            "tu plan."
        )


def plan_limit_response(error):
    return Response(
        {"detail": str(error), "code": "plan_limit"},
        status=status.HTTP_403_FORBIDDEN,
    )
