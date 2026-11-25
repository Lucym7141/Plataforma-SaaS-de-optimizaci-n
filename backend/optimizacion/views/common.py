"""Utilidades compartidas por las vistas."""

import json

from django.http import HttpResponse, JsonResponse
from django.utils.text import slugify
from rest_framework import status
from rest_framework.response import Response


def _json_body(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _user_data(user):
    profile = getattr(user, "perfil", None)
    return {
        "id": user.pk,
        "username": user.get_username(),
        "es_demo": bool(profile and profile.es_demo),
    }


def _rate_limit_response(throttle):
    response = JsonResponse(
        {"detail": "Demasiadas solicitudes. Inténtalo de nuevo más tarde."},
        status=429,
    )
    wait = throttle.wait()
    if wait:
        response["Retry-After"] = str(max(1, int(wait)))
    return response


def _execution_report_response(execution, output_format, builder, name):
    if output_format not in {"pdf", "xlsx"}:
        return Response(
            {"detail": "El formato debe ser pdf o xlsx."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    content = builder(execution, output_format)
    extension = "xlsx" if output_format == "xlsx" else "pdf"
    content_type = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if extension == "xlsx"
        else "application/pdf"
    )
    filename = f"{slugify(name) or 'reporte'}-{execution.pk}.{extension}"
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "private, no-store"
    return response
