
import json

from django.contrib.auth import authenticate, login, logout
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_protect
from django.views.decorators.http import require_GET, require_POST
from django.shortcuts import get_object_or_404, render
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import ProblemaOptimizacion, EjecucionOptimizacion
from .serializers import (
    ProblemaOptimizacionSerializer,
    ProblemaOptimizacionCrearSerializer,
    EjecucionOptimizacionSerializer,
    RegistroUsuarioSerializer,
)
from .services import resolver_problema
from .throttles import (
    InicioSesionRateThrottle,
    RegistroRateThrottle,
    ResolverRateThrottle,
)


def _json_body(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _user_data(user):
    return {"id": user.pk, "username": user.get_username()}


def _rate_limit_response(throttle):
    response = JsonResponse(
        {"detail": "Demasiadas solicitudes. Inténtalo de nuevo más tarde."},
        status=429,
    )
    wait = throttle.wait()
    if wait:
        response["Retry-After"] = str(max(1, int(wait)))
    return response


@csrf_protect
@require_POST
def registrar_usuario(request):
    throttle = RegistroRateThrottle()
    if not throttle.allow_request(request, None):
        return _rate_limit_response(throttle)

    if not settings.ALLOW_REGISTRATION:
        return JsonResponse(
            {"detail": "El registro de nuevas cuentas está desactivado."},
            status=403,
        )

    datos = _json_body(request)
    if datos is None:
        return JsonResponse(
            {"detail": "El cuerpo debe ser JSON válido."},
            status=400,
        )

    serializer = RegistroUsuarioSerializer(data=datos)
    if not serializer.is_valid():
        return JsonResponse(serializer.errors, status=400)

    usuario = serializer.save()
    login(request, usuario)
    return JsonResponse(_user_data(usuario), status=201)


@csrf_protect
@require_POST
def iniciar_sesion(request):
    throttle = InicioSesionRateThrottle()
    if not throttle.allow_request(request, None):
        return _rate_limit_response(throttle)

    datos = _json_body(request)
    if datos is None:
        return JsonResponse(
            {"detail": "El cuerpo debe ser JSON válido."},
            status=400,
        )

    nombre_usuario = datos.get("username")
    password = datos.get("password")
    if not isinstance(nombre_usuario, str) or not isinstance(password, str):
        return JsonResponse(
            {"detail": "Usuario o contraseña incorrectos."},
            status=400,
        )

    usuario = authenticate(
        request,
        username=nombre_usuario,
        password=password,
    )
    if usuario is None:
        return JsonResponse(
            {"detail": "Usuario o contraseña incorrectos."},
            status=400,
        )

    login(request, usuario)
    return JsonResponse(_user_data(usuario))


@require_GET
def usuario_actual(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Debes iniciar sesión."}, status=401)
    return JsonResponse(_user_data(request.user))


@require_GET
def configuracion_autenticacion(request):
    return JsonResponse({
        "registration_enabled": settings.ALLOW_REGISTRATION,
    })


@csrf_protect
@require_POST
def cerrar_sesion(request):
    logout(request)
    return JsonResponse({"detail": "Sesión cerrada."})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def listar_problemas(request):
    """Lista los problemas activos o crea un problema nuevo."""

    if request.method == "POST":
        serializer = ProblemaOptimizacionCrearSerializer(
            data=request.data,
            context={"request": request},
        )

        if serializer.is_valid():
            problema = serializer.save()

            respuesta = ProblemaOptimizacionSerializer(problema)

            return Response(
                respuesta.data,
                status=status.HTTP_201_CREATED,
            )

        return Response(
            serializer.errors,
            status=status.HTTP_400_BAD_REQUEST,
        )

    problemas = ProblemaOptimizacion.objects.filter(
        activo=True,
        propietario=request.user,
    )
    serializer = ProblemaOptimizacionSerializer(
        problemas,
        many=True,
    )

    return Response(serializer.data)



@api_view(["GET"])
@permission_classes([IsAuthenticated])
def detalle_problema(request, problema_id):
    """Devuelve un problema con sus variables y restricciones."""
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
    )
    serializer = ProblemaOptimizacionSerializer(problema)

    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ResolverRateThrottle])
def resolver_problema_api(request, problema_id):
    """Ejecuta el solucionador y devuelve el resultado."""
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
    )

    if not problema.activo:
        return Response(
            {"error": "El problema está inactivo y no puede ejecutarse."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    ejecucion = resolver_problema(problema.id)

    serializer = EjecucionOptimizacionSerializer(ejecucion)

    if ejecucion.estado == EjecucionOptimizacion.Estado.ERROR:
        return Response(
            {
                "detail": (
                    "El solucionador no pudo completar el modelo. "
                    "Revisa los datos e inténtalo de nuevo."
                )
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response(
        serializer.data,
        status=status.HTTP_200_OK,
    )

@ensure_csrf_cookie
def inicio(request):
    return render(request, "index.html")
