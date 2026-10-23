from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle

from .models import RateLimitCounter


def consume_rate_limit(key, limit, duration):
    now = timezone.now()
    expires_at = now + timedelta(seconds=duration)

    with transaction.atomic():
        try:
            counter = RateLimitCounter.objects.select_for_update().get(key=key)
        except RateLimitCounter.DoesNotExist:
            try:
                with transaction.atomic():
                    RateLimitCounter.objects.create(
                        key=key,
                        count=1,
                        expires_at=expires_at,
                    )
                return True
            except IntegrityError:
                counter = RateLimitCounter.objects.select_for_update().get(
                    key=key
                )

        if counter.expires_at <= now:
            counter.count = 1
            counter.expires_at = expires_at
        else:
            counter.count = min(counter.count + 1, limit + 1)

        counter.save(update_fields=["count", "expires_at"])
        return counter.count <= limit


class AtomicRateThrottle:
    def allow_request(self, request, view):
        if self.rate is None:
            return True

        self.key = self.get_cache_key(request, view)
        if self.key is None:
            return True

        return consume_rate_limit(
            self.key,
            self.num_requests,
            self.duration,
        )

    def wait(self):
        return self.duration


class IPRateThrottle(AtomicRateThrottle, SimpleRateThrottle):
    def get_cache_key(self, request, view):
        identity = self.get_ident(request)
        return salted_hmac(
            f"throttle-{self.scope}",
            identity,
        ).hexdigest()


class RegistroRateThrottle(IPRateThrottle):
    scope = "signup"


class InicioSesionRateThrottle(IPRateThrottle):
    scope = "login"


class ResolverRateThrottle(AtomicRateThrottle, UserRateThrottle):
    scope = "solve"

    def get_cache_key(self, request, view):
        identity = str(request.user.pk)
        return salted_hmac(
            f"throttle-{self.scope}",
            identity,
        ).hexdigest()
