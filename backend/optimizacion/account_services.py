from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.core import signing


VERIFICATION_SALT = "optimizacion.email-verification"
VERIFICATION_MAX_AGE = 60 * 60 * 24


def send_verification_email(user):
    token = signing.dumps(
        {"user_id": user.pk, "email": user.email},
        salt=VERIFICATION_SALT,
    )
    url = f"{settings.PUBLIC_APP_URL}/?{urlencode({'verify': token})}"
    send_mail(
        "Verifica tu correo de OptiPortfolio",
        (
            f"Hola {user.username},\n\n"
            "Confirma tu correo para activar tu cuenta:\n"
            f"{url}\n\nEl enlace expira en 24 horas."
        ),
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        fail_silently=False,
    )


def send_password_reset_email(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    url = f"{settings.PUBLIC_APP_URL}/?{urlencode({'reset_uid': uid, 'reset_token': token})}"
    send_mail(
        "Restablece tu contraseña de OptiPortfolio",
        (
            f"Hola {user.username},\n\n"
            "Usa este enlace para elegir una contraseña nueva:\n"
            f"{url}\n\nSi no solicitaste el cambio, ignora este mensaje."
        ),
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        fail_silently=False,
    )
