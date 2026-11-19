"""Páginas HTML y planes públicos."""

from django.conf import settings
from django.views.decorators.csrf import ensure_csrf_cookie
from django.shortcuts import render
from rest_framework.decorators import (
    api_view,
    permission_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def listar_planes(request):
    return Response(settings.SUBSCRIPTION_PLANS)


@ensure_csrf_cookie
def inicio(request):
    return render(request, "index.html")


def pagina_planes(request):
    return render(request, "plans.html")
