"""Registro, inicio de sesión, verificación y recuperación de cuentas."""

import logging
import secrets
import smtplib
from datetime import timedelta

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import SetPasswordForm
from django.contrib.auth.tokens import default_token_generator
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST

from ..models import (
    PerfilUsuario,
    VerificacionCorreo,
)
from ..serializers import (
    RegistroUsuarioSerializer,
)
from ..account_services import (
    VERIFICATION_MAX_AGE,
    VERIFICATION_SALT,
    send_password_reset_email,
    send_verification_email,
)
from ..throttles import (
    DemoRateThrottle,
    InicioSesionRateThrottle,
    RestablecerContrasenaRateThrottle,
    RegistroRateThrottle,
    VerificacionRateThrottle,
)

from .common import _json_body, _rate_limit_response, _user_data

logger = logging.getLogger(__name__)


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
        "demo_enabled": settings.DEMO_ACCOUNTS_ENABLED,
        "demo_ttl_hours": settings.DEMO_ACCOUNT_TTL_HOURS,
    })


def _delete_expired_demos():
    limit = timezone.now() - timedelta(hours=settings.DEMO_ACCOUNT_TTL_HOURS)
    get_user_model().objects.filter(
        perfil__es_demo=True,
        date_joined__lt=limit,
    ).delete()


@csrf_protect
@require_POST
def iniciar_demo(request):
    """Crea una cuenta temporal sin contraseña e inicia sesión con ella.

    La cuenta se borra pasado DEMO_ACCOUNT_TTL_HOURS (al crear la siguiente
    demo o con `manage.py limpiar_demos`) y tiene menos consultas de IA."""
    throttle = DemoRateThrottle()
    if not throttle.allow_request(request, None):
        return _rate_limit_response(throttle)
    if not settings.DEMO_ACCOUNTS_ENABLED:
        return JsonResponse(
            {"detail": "La demostración no está disponible."},
            status=403,
        )

    _delete_expired_demos()
    User = get_user_model()
    with transaction.atomic():
        for _ in range(5):
            username = f"demo-{secrets.token_hex(4)}"
            if not User.objects.filter(username=username).exists():
                break
        else:
            return JsonResponse(
                {"detail": "No se pudo crear la demostración. Inténtalo de nuevo."},
                status=503,
            )
        usuario = User(username=username, is_active=True)
        usuario.set_unusable_password()
        usuario.save()
        PerfilUsuario.objects.create(
            usuario=usuario,
            nombre_visible="Demo",
            es_demo=True,
        )
    login(request, usuario, backend="django.contrib.auth.backends.ModelBackend")
    return JsonResponse(_user_data(usuario), status=201)


@csrf_protect
@require_POST
def cerrar_sesion(request):
    logout(request)
    return JsonResponse({"detail": "Sesión cerrada."})
