
import json
import logging
import mimetypes
import smtplib
import uuid

from PIL import Image, UnidentifiedImageError
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import PasswordChangeForm, SetPasswordForm
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth import update_session_auth_hash
from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.core import signing
from django.db import DatabaseError, connection
from django.db.models import Count
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.http import FileResponse, HttpResponse, JsonResponse, StreamingHttpResponse
from django.utils.encoding import force_str
from django.utils.text import slugify
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_protect
from django.views.decorators.http import require_GET, require_POST
from django.shortcuts import render
from rest_framework import serializers, status
from rest_framework.decorators import (
    api_view,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import (
    EjecucionPortafolio,
    EjecucionOptimizacion,
    ProblemaOptimizacion,
    OptimizacionPortafolio,
    VerificacionCorreo,
    PerfilUsuario,
)
from .serializers import (
    ProblemaOptimizacionSerializer,
    ProblemaOptimizacionCrearSerializer,
    ProblemaDesdeTextoSerializer,
    EjecucionOptimizacionSerializer,
    RegistroUsuarioSerializer,
    DatosPortafolioSerializer,
    OptimizacionPortafolioSerializer,
    EjecucionPortafolioSerializer,
)
from .account_services import (
    VERIFICATION_MAX_AGE,
    VERIFICATION_SALT,
    send_password_reset_email,
    send_verification_email,
)
from .portfolio import (
    calcular_frontera_eficiente,
    optimizar_media_varianza,
)
from .portfolio_import import preview_portfolio_csv
from .services import resolver_problema
from .reporting import build_portfolio_report, build_problem_report
from .ai_modeling import (
    AzureOpenAIConfigurationError,
    AzureOpenAIServiceError,
    generar_modelo,
)
from .throttles import (
    InicioSesionRateThrottle,
    RestablecerContrasenaRateThrottle,
    RegistroRateThrottle,
    ResolverRateThrottle,
    VerificacionRateThrottle,
    GenerarModeloRateThrottle,
)

logger = logging.getLogger(__name__)


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
    try:
        send_verification_email(usuario)
    except (OSError, smtplib.SMTPException):
        logger.exception("No se pudo enviar el email de verificación.")
        return JsonResponse(
            {
                "detail": (
                    "La cuenta se creó, pero no se pudo enviar el correo. "
                    "Solicita el reenvío de verificación."
                )
            },
            status=503,
        )
    return JsonResponse(
        {"detail": "Revisa tu correo para verificar y activar la cuenta."},
        status=201,
    )


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
            {"detail": "Credenciales incorrectas o cuenta sin verificar."},
            status=400,
        )

    if not usuario.is_active:
        return JsonResponse(
            {"detail": "Credenciales incorrectas o cuenta sin verificar."},
            status=400,
        )
    login(request, usuario)
    return JsonResponse(_user_data(usuario))


@csrf_protect
@require_POST
def verificar_correo(request):
    throttle = VerificacionRateThrottle()
    if not throttle.allow_request(request, None):
        return _rate_limit_response(throttle)

    datos = _json_body(request)
    token = datos.get("token", "") if datos else ""
    try:
        payload = signing.loads(
            token,
            salt=VERIFICATION_SALT,
            max_age=VERIFICATION_MAX_AGE,
        )
        user_id = payload["user_id"]
        email = payload["email"]
    except (
        signing.BadSignature,
        signing.SignatureExpired,
        KeyError,
        TypeError,
    ):
        return JsonResponse(
            {"detail": "El enlace de verificación no es válido o expiró."},
            status=400,
        )

    try:
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(
                pk=user_id,
                email=email,
            )
            verificacion, _ = VerificacionCorreo.objects.get_or_create(
                usuario=user
            )
            if verificacion.verificado_en is None:
                from django.utils import timezone

                user.is_active = True
                user.save(update_fields=["is_active"])
                verificacion.verificado_en = timezone.now()
                verificacion.save(update_fields=["verificado_en"])
    except (get_user_model().DoesNotExist, TypeError, ValueError):
        return JsonResponse(
            {"detail": "El enlace de verificación no es válido o expiró."},
            status=400,
        )
    return JsonResponse(
        {"detail": "Correo verificado. Ya puedes iniciar sesión."}
    )


@csrf_protect
@require_POST
def reenviar_verificacion(request):
    throttle = VerificacionRateThrottle()
    if not throttle.allow_request(request, None):
        return _rate_limit_response(throttle)

    datos = _json_body(request)
    email = datos.get("email") if datos else None
    generic = {
        "detail": (
            "Si la cuenta existe y aún no está verificada, "
            "recibirás un enlace por correo."
        )
    }
    if isinstance(email, str):
        user = get_user_model().objects.filter(
            email__iexact=email,
            is_active=False,
        ).first()
        if user:
            try:
                send_verification_email(user)
            except (OSError, smtplib.SMTPException):
                logger.exception("No se pudo reenviar verificación de correo.")
                return JsonResponse(
                    {"detail": "No se pudo enviar el correo. Inténtalo más tarde."},
                    status=503,
                )
    return JsonResponse(generic)


@csrf_protect
@require_POST
def solicitar_restablecimiento(request):
    throttle = RestablecerContrasenaRateThrottle()
    if not throttle.allow_request(request, None):
        return _rate_limit_response(throttle)

    datos = _json_body(request)
    email = datos.get("email") if datos else None
    generic = {
        "detail": (
            "Si hay una cuenta activa con ese correo, recibirás "
            "instrucciones para restablecer la contraseña."
        )
    }
    if isinstance(email, str):
        users = get_user_model().objects.filter(
            email__iexact=email,
            is_active=True,
        )
        try:
            for user in users:
                send_password_reset_email(user)
        except (OSError, smtplib.SMTPException):
            logger.exception("No se pudo enviar restablecimiento de contraseña.")
            return JsonResponse(
                {"detail": "No se pudo enviar el correo. Inténtalo más tarde."},
                status=503,
            )
    return JsonResponse(generic)


@csrf_protect
@require_POST
def confirmar_restablecimiento(request):
    throttle = RestablecerContrasenaRateThrottle()
    if not throttle.allow_request(request, None):
        return _rate_limit_response(throttle)

    datos = _json_body(request)
    if datos is None:
        return JsonResponse({"detail": "El cuerpo debe ser JSON válido."}, status=400)
    try:
        user_id = force_str(urlsafe_base64_decode(datos["uid"]))
        user = get_user_model().objects.get(pk=user_id, is_active=True)
    except (
        ValueError,
        TypeError,
        KeyError,
        get_user_model().DoesNotExist,
    ):
        return JsonResponse(
            {"detail": "El enlace para restablecer la contraseña no es válido."},
            status=400,
        )
    if not default_token_generator.check_token(user, datos.get("token", "")):
        return JsonResponse(
            {"detail": "El enlace para restablecer la contraseña no es válido."},
            status=400,
        )

    password = datos.get("password")
    form = SetPasswordForm(
        user,
        data={
            "new_password1": password,
            "new_password2": password,
        },
    )
    if not form.is_valid():
        return JsonResponse(form.errors, status=400)
    form.save()
    return JsonResponse({"detail": "Contraseña actualizada. Ya puedes entrar."})


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


@api_view(["GET"])
@permission_classes([AllowAny])
def listar_planes(request):
    return Response(settings.SUBSCRIPTION_PLANS)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def perfil_usuario(request):
    profile, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)

    if request.method == "GET":
        return Response({
            "nombre_visible": profile.nombre_visible,
            "descripcion": profile.descripcion,
            "foto_url": "/api/profile/photo/" if profile.foto else None,
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
        propietario=request.user,
        archivado=False,
    )
    serializer = ProblemaOptimizacionSerializer(
        problemas,
        many=True,
    )

    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([GenerarModeloRateThrottle])
def generar_problema_desde_texto(request):
    solicitud = ProblemaDesdeTextoSerializer(data=request.data)
    if not solicitud.is_valid():
        return Response(
            solicitud.errors,
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        respuesta_ia = generar_modelo(solicitud.validated_data["texto"])
    except AzureOpenAIConfigurationError as error:
        return Response(
            {"detail": str(error)},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    except AzureOpenAIServiceError:
        logger.exception("Azure OpenAI no pudo generar un modelo.")
        return Response(
            {
                "detail": (
                    "No se pudo generar el borrador con Azure OpenAI. "
                    "Verifica el despliegue y vuelve a intentarlo."
                )
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    try:
        modelo = json.loads(respuesta_ia)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Azure OpenAI devolvió JSON inválido para un modelo.")
        return Response(
            {
                "detail": (
                    "La respuesta de IA no tuvo un formato válido. "
                    "Reformula la descripción e inténtalo de nuevo."
                )
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    if not isinstance(modelo, dict):
        return Response(
            {"detail": "La IA no devolvió un objeto de modelo válido."},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    validacion = ProblemaOptimizacionCrearSerializer(data=modelo)
    if not validacion.is_valid():
        logger.warning("Azure OpenAI devolvió un borrador que no pasó validación.")
        return Response(
            {
                "detail": (
                    "El borrador de IA no cumple las validaciones del modelo. "
                    "Aclara variables, objetivo y restricciones, y vuelve a intentarlo."
                )
            },
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    return Response(validacion.validated_data)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def detalle_problema(request, problema_id):
    """Devuelve un problema con sus variables y restricciones."""
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
    )
    if request.method == "DELETE":
        problema.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    if request.method == "PUT":
        if problema.archivado:
            return Response(
                {"detail": "No puedes editar un problema archivado."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = ProblemaOptimizacionCrearSerializer(
            problema,
            data=request.data,
            context={"request": request},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(ProblemaOptimizacionSerializer(problema).data)

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

    if not problema.activo or problema.archivado:
        return Response(
            {"error": "El problema está inactivo o archivado y no puede ejecutarse."},
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def reporte_ejecucion_problema(request, problema_id, ejecucion_id, formato):
    execution = get_object_or_404(
        EjecucionOptimizacion.objects.select_related("problema"),
        pk=ejecucion_id,
        problema_id=problema_id,
        problema__propietario=request.user,
    )
    return _execution_report_response(
        execution,
        formato,
        build_problem_report,
        execution.modelo_snapshot.get("nombre", execution.problema.nombre),
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def listar_problemas_archivados(request):
    problemas = ProblemaOptimizacion.objects.filter(
        propietario=request.user,
        archivado=True,
    )
    return Response(ProblemaOptimizacionSerializer(problemas, many=True).data)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def archivar_problema(request, problema_id):
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
        archivado=False,
    )
    problema.archivado = True
    problema.save(update_fields=["archivado", "actualizado_en"])
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def restaurar_problema(request, problema_id):
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
        archivado=True,
    )
    problema.archivado = False
    problema.save(update_fields=["archivado", "actualizado_en"])
    return Response(ProblemaOptimizacionSerializer(problema).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def duplicar_problema(request, problema_id):
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
        archivado=False,
    )
    datos = ProblemaOptimizacionSerializer(problema).data
    datos["nombre"] = f"{problema.nombre} (copia)"[:150]
    serializer = ProblemaOptimizacionCrearSerializer(
        data=datos,
        context={"request": request},
    )
    serializer.is_valid(raise_exception=True)
    copia = serializer.save()
    return Response(
        ProblemaOptimizacionSerializer(copia).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def historial_problema(request, problema_id):
    problema = get_object_or_404(
        ProblemaOptimizacion,
        pk=problema_id,
        propietario=request.user,
    )
    ejecuciones = EjecucionOptimizacion.objects.filter(
        problema=problema,
    ).prefetch_related("valores")
    return Response(EjecucionOptimizacionSerializer(ejecuciones, many=True).data)


def _portfolio_values(validated_data):
    values = dict(validated_data)
    values["rendimientos_esperados"] = [
        str(value) for value in values["rendimientos_esperados"]
    ]
    values["covarianza"] = [
        [str(value) for value in row]
        for row in values["covarianza"]
    ]
    values["pesos_minimos"] = [
        str(value) for value in values["pesos_minimos"]
    ]
    values["pesos_maximos"] = [
        str(value) for value in values["pesos_maximos"]
    ]
    values["limites_categoria"] = {
        name: str(value)
        for name, value in values["limites_categoria"].items()
    }
    values["escenarios_estres"] = {
        name: [str(value) for value in returns]
        for name, returns in values["escenarios_estres"].items()
    }
    return values


def _portfolio_solver_inputs(item):
    count = len(item.activos)
    minimums = item.pesos_minimos or [0] * count
    maximums = item.pesos_maximos or [1] * count
    return {
        "bounds": list(zip(
            [float(value) for value in minimums],
            [float(value) for value in maximums],
        )),
        "categorias": item.categorias or [""] * count,
        "limites_categoria": {
            name: float(value)
            for name, value in item.limites_categoria.items()
        },
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def listar_portafolios(request):
    if request.method == "GET":
        items = OptimizacionPortafolio.objects.filter(
            propietario=request.user,
            archivado=False,
        )
        return Response(
            OptimizacionPortafolioSerializer(items, many=True).data
        )

    serializer = DatosPortafolioSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    item = OptimizacionPortafolio.objects.create(
        propietario=request.user,
        **_portfolio_values(serializer.validated_data),
    )
    return Response(
        OptimizacionPortafolioSerializer(item).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def previsualizar_importacion_portafolio(request):
    uploaded_file = request.FILES.get("archivo")
    if uploaded_file is None:
        return Response(
            {"archivo": ["Adjunta un archivo CSV para importar."]},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        preview = preview_portfolio_csv(
            uploaded_file,
            request.data.get("nombre", ""),
        )
    except serializers.ValidationError as error:
        return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)
    return Response({"preview": preview})


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def detalle_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
    )
    if request.method == "GET":
        return Response(OptimizacionPortafolioSerializer(item).data)
    if request.method == "DELETE":
        item.archivado = True
        item.save(update_fields=["archivado", "actualizado_en"])
        return Response(status=status.HTTP_204_NO_CONTENT)
    if item.archivado:
        return Response(
            {"detail": "No puedes editar un portafolio archivado."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = DatosPortafolioSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    for field, value in _portfolio_values(serializer.validated_data).items():
        setattr(item, field, value)
    item.save()
    return Response(OptimizacionPortafolioSerializer(item).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def duplicar_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
        archivado=False,
    )
    copia = OptimizacionPortafolio.objects.create(
        propietario=request.user,
        nombre=f"{item.nombre} (copia)"[:150],
        activos=item.activos,
        rendimientos_esperados=item.rendimientos_esperados,
        covarianza=item.covarianza,
        aversion_riesgo=item.aversion_riesgo,
        periodos_por_anio=item.periodos_por_anio,
        categorias=item.categorias or [""] * len(item.activos),
        pesos_minimos=item.pesos_minimos or ["0"] * len(item.activos),
        pesos_maximos=item.pesos_maximos or ["1"] * len(item.activos),
        limites_categoria=item.limites_categoria,
        escenarios_estres=item.escenarios_estres,
    )
    return Response(
        OptimizacionPortafolioSerializer(copia).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def historial_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
    )
    ejecuciones = item.ejecuciones.all()
    return Response(
        EjecucionPortafolioSerializer(ejecuciones, many=True).data
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def reporte_ejecucion_portafolio(request, portafolio_id, ejecucion_id, formato):
    execution = get_object_or_404(
        EjecucionPortafolio.objects.select_related("optimizacion"),
        pk=ejecucion_id,
        optimizacion_id=portafolio_id,
        optimizacion__propietario=request.user,
    )
    return _execution_report_response(
        execution,
        formato,
        build_portfolio_report,
        execution.modelo_snapshot.get("nombre", execution.optimizacion.nombre),
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ResolverRateThrottle])
def resolver_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
        archivado=False,
    )
    try:
        result = optimizar_media_varianza(
            [float(value) for value in item.rendimientos_esperados],
            [
                [float(value) for value in row]
                for row in item.covarianza
            ],
            float(item.aversion_riesgo),
            **_portfolio_solver_inputs(item),
            periodos_por_anio=item.periodos_por_anio,
            escenarios_estres={
                name: [float(value) for value in returns]
                for name, returns in item.escenarios_estres.items()
            },
        )
    except (ValueError, ArithmeticError):
        logger.exception("No se pudo optimizar el portafolio %s.", item.pk)
        return Response(
            {"detail": "No se pudo encontrar una solución válida."},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    execution = EjecucionPortafolio.objects.create(
        optimizacion=item,
        modelo_snapshot=OptimizacionPortafolioSerializer(item).data,
        **result,
    )
    return Response(EjecucionPortafolioSerializer(execution).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([ResolverRateThrottle])
def frontera_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
        archivado=False,
    )
    try:
        frontier = calcular_frontera_eficiente(
            [float(value) for value in item.rendimientos_esperados],
            [[float(value) for value in row] for row in item.covarianza],
            **_portfolio_solver_inputs(item),
        )
    except (ValueError, ArithmeticError):
        logger.exception("No se pudo calcular la frontera del portafolio %s.", item.pk)
        return Response(
            {"detail": "No se pudo calcular una frontera eficiente válida."},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    return Response({
        "activos": item.activos,
        "puntos": frontier,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portafolios_archivados(request):
    items = OptimizacionPortafolio.objects.filter(
        propietario=request.user,
        archivado=True,
    )
    return Response(OptimizacionPortafolioSerializer(items, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def restaurar_portafolio(request, portafolio_id):
    item = get_object_or_404(
        OptimizacionPortafolio,
        pk=portafolio_id,
        propietario=request.user,
        archivado=True,
    )
    item.archivado = False
    item.save(update_fields=["archivado", "actualizado_en"])
    return Response(OptimizacionPortafolioSerializer(item).data)


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


@ensure_csrf_cookie
def inicio(request):
    return render(request, "index.html")


def pagina_planes(request):
    return render(request, "plans.html")
