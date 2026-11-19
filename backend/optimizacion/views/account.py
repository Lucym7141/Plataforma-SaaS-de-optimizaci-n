"""Perfil, datos y configuración de la cuenta del usuario."""

import json
import logging
import mimetypes
import uuid

from PIL import Image, UnidentifiedImageError
from django.contrib.auth import logout
from django.contrib.auth.forms import PasswordChangeForm
from django.contrib.auth import update_session_auth_hash
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Count
from django.db import transaction
from django.http import FileResponse, StreamingHttpResponse
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    ProblemaOptimizacion,
    OptimizacionPortafolio,
    PerfilUsuario,
)
from ..plans import plan_summary
from ..serializers import (
    ProblemaOptimizacionSerializer,
    EjecucionOptimizacionSerializer,
    OptimizacionPortafolioSerializer,
    EjecucionPortafolioSerializer,
)
from ..throttles import (
    RestablecerContrasenaRateThrottle,
)

logger = logging.getLogger(__name__)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def perfil_usuario(request):
    profile, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)

    if request.method == "GET":
        return Response({
            "nombre_visible": profile.nombre_visible,
            "descripcion": profile.descripcion,
            "foto_url": "/api/profile/photo/" if profile.foto else None,
            "plan": plan_summary(request.user),
        })

    for field, max_length in (("nombre_visible", 80), ("descripcion", 240)):
        if field not in request.data:
            continue
        value = request.data.get(field)
        if not isinstance(value, str) or len(value) > max_length:
            return Response(
                {field: f"El valor debe ser texto de hasta {max_length} caracteres."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        setattr(profile, field, value.strip())

    uploaded_photo = request.FILES.get("foto")
    previous_photo_name = profile.foto.name if profile.foto else None
    remove_photo = str(request.data.get("quitar_foto", "")).lower() in {
        "true",
        "1",
        "yes",
    }
    if uploaded_photo and remove_photo:
        return Response(
            {"detail": "Elige una foto nueva o quita la foto actual, no ambas."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if uploaded_photo:
        if uploaded_photo.size > 768 * 1024:
            return Response(
                {"foto": "La foto no puede superar 768 KiB."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with Image.open(uploaded_photo) as image:
                image_format = image.format
                width, height = image.size
                if image_format not in {"JPEG", "PNG", "WEBP"}:
                    return Response(
                        {"foto": "Usa una imagen JPEG, PNG o WebP."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if width > 4096 or height > 4096:
                    return Response(
                        {"foto": "La imagen no puede superar 4096 píxeles por lado."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                image.verify()
        except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError):
            return Response(
                {"foto": "El archivo no contiene una imagen válida."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        uploaded_photo.seek(0)
        uploaded_photo.name = f"{uuid.uuid4().hex}.{image_format.lower()}"
        profile.foto = uploaded_photo
    elif remove_photo and profile.foto:
        profile.foto = ""

    profile.save()
    if previous_photo_name and (
        remove_photo or (uploaded_photo and profile.foto.name != previous_photo_name)
    ):
        try:
            profile.foto.storage.delete(previous_photo_name)
        except OSError:
            logger.exception("No se pudo eliminar la foto de perfil anterior.")
            return Response(
                {
                    "detail": (
                        "El perfil se actualizó, pero no se pudo eliminar la foto "
                        "anterior del almacenamiento."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
    return Response({
        "nombre_visible": profile.nombre_visible,
        "descripcion": profile.descripcion,
        "foto_url": "/api/profile/photo/" if profile.foto else None,
        "plan": plan_summary(request.user),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def foto_perfil_usuario(request):
    try:
        photo = PerfilUsuario.objects.get(usuario=request.user).foto
        if not photo:
            return Response(status=status.HTTP_404_NOT_FOUND)
        image_file = photo.storage.open(photo.name, "rb")
    except PerfilUsuario.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)
    content_type = mimetypes.guess_type(photo.name)[0] or "application/octet-stream"
    response = FileResponse(image_file, content_type=content_type)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def exportar_datos_usuario(request):
    user = request.user

    def chunks():
        yield b'{"cuenta":'
        yield json.dumps(
            {
                "username": user.get_username(),
                "email": user.email,
            },
            cls=DjangoJSONEncoder,
            ensure_ascii=False,
        ).encode("utf-8")
        yield b',"problemas":['
        problemas = ProblemaOptimizacion.objects.filter(
            propietario=user,
        ).iterator(chunk_size=100)
        first = True
        for problema in problemas:
            data = ProblemaOptimizacionSerializer(problema).data
            data["historial"] = EjecucionOptimizacionSerializer(
                problema.ejecuciones.prefetch_related("valores").all(),
                many=True,
            ).data
            if not first:
                yield b","
            first = False
            yield json.dumps(
                data,
                cls=DjangoJSONEncoder,
                ensure_ascii=False,
            ).encode("utf-8")
        yield b'],"portafolios":['
        portafolios = OptimizacionPortafolio.objects.filter(
            propietario=user,
        ).iterator(chunk_size=100)
        first = True
        for portafolio in portafolios:
            data = OptimizacionPortafolioSerializer(portafolio).data
            data["historial"] = EjecucionPortafolioSerializer(
                portafolio.ejecuciones.all(),
                many=True,
            ).data
            if not first:
                yield b","
            first = False
            yield json.dumps(
                data,
                cls=DjangoJSONEncoder,
                ensure_ascii=False,
            ).encode("utf-8")
        yield b"]}"

    response = StreamingHttpResponse(
        chunks(),
        content_type="application/json; charset=utf-8",
    )
    response["Content-Disposition"] = (
        'attachment; filename="optportfolio-datos.json"'
    )
    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def eliminar_cuenta(request):
    password = request.data.get("password")
    confirmation = request.data.get("confirmacion")
    if (
        not isinstance(password, str)
        or not request.user.check_password(password)
        or confirmation != request.user.get_username()
    ):
        return Response(
            {
                "detail": (
                    "La contraseña es incorrecta o la confirmación no "
                    "coincide con el nombre de usuario."
                )
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        user = request.user
        ProblemaOptimizacion.objects.filter(propietario=user).delete()
        user_id = user.pk
        logout(request)
        user.delete()
    logger.info("La cuenta %s eliminó sus datos y fue borrada.", user_id)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([RestablecerContrasenaRateThrottle])
def cambiar_contrasena(request):
    form = PasswordChangeForm(request.user, data=request.data)
    if not form.is_valid():
        return Response(form.errors, status=status.HTTP_400_BAD_REQUEST)
    user = form.save()
    update_session_auth_hash(request, user)
    return Response({"detail": "Contraseña actualizada."})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def resumen_usuario(request):
    """Resumen ligero para el dashboard del usuario autenticado."""
    user = request.user
    problemas_activos = ProblemaOptimizacion.objects.filter(
        propietario=user, archivado=False
    )
    problemas_archivados = ProblemaOptimizacion.objects.filter(
        propietario=user, archivado=True
    )
    portafolios_activos = OptimizacionPortafolio.objects.filter(
        propietario=user, archivado=False
    )
    portafolios_archivados = OptimizacionPortafolio.objects.filter(
        propietario=user, archivado=True
    )
    problemas_por_objetivo = list(
        problemas_activos.values("tipo_objetivo")
        .annotate(total=Count("pk"))
        .order_by("tipo_objetivo")
    )
    portafolios_por_activos = {}
    activos_totales = 0
    for activos in portafolios_activos.values_list("activos", flat=True).iterator():
        cantidad = len(activos) if isinstance(activos, list) else 0
        activos_totales += cantidad
        grupo = str(cantidad) if cantidad < 5 else "5+"
        portafolios_por_activos[grupo] = portafolios_por_activos.get(grupo, 0) + 1

    return Response({
        "problemas": problemas_activos.count(),
        "problemas_archivados": problemas_archivados.count(),
        "portafolios": portafolios_activos.count(),
        "portafolios_archivados": portafolios_archivados.count(),
        "analitica": {
            "problemas_por_objetivo": problemas_por_objetivo,
            "portafolios_por_cantidad_activos": [
                {
                    "cantidad_activos": grupo,
                    "total_portafolios": portafolios_por_activos[grupo],
                }
                for grupo in sorted(
                    portafolios_por_activos,
                    key=lambda value: int(value.rstrip("+")),
                )
            ],
            "activos_totales": activos_totales,
        },
        "ultimos_problemas": [
            {
                "id": problema.pk,
                "nombre": problema.nombre,
                "tipo_objetivo": problema.tipo_objetivo,
                "actualizado_en": problema.actualizado_en,
            }
            for problema in problemas_activos.order_by("-actualizado_en")[:5]
        ],
        "ultimos_portafolios": [
            {
                "id": portafolio.pk,
                "nombre": portafolio.nombre,
                "activos": portafolio.activos,
                "actualizado_en": portafolio.actualizado_en,
            }
            for portafolio in portafolios_activos.order_by("-actualizado_en")[:5]
        ],
    })
