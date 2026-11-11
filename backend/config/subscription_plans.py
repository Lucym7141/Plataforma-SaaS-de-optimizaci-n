import json
import math
import re

from django.core.exceptions import ImproperlyConfigured


DEFAULT_SUBSCRIPTION_PLANS = [
    {
        "id": "inicial",
        "name": "Inicial",
        "description": "Para comenzar a explorar tus modelos y portafolios.",
        "price": 0,
        "currency": "USD",
        "interval": "monthly",
        "features": [
            "Hasta 3 modelos de optimización",
            "1 portafolio",
            "Hasta 10 activos por portafolio",
        ],
        "featured": False,
    },
    {
        "id": "profesional",
        "name": "Profesional",
        "description": "Más capacidad para análisis frecuentes.",
        "price": 3.95,
        "currency": "USD",
        "interval": "monthly",
        "features": [
            "Hasta 25 modelos de optimización",
            "Hasta 10 portafolios",
            "Hasta 50 activos por portafolio",
        ],
        "featured": True,
    },
    {
        "id": "profesional-pro",
        "name": "Profesional Pro",
        "description": "Mayor capacidad para análisis y portafolios amplios.",
        "price": 10.5,
        "currency": "USD",
        "interval": "monthly",
        "features": [
            "Hasta 100 modelos de optimización",
            "Hasta 25 portafolios",
            "Hasta 100 activos por portafolio",
        ],
        "featured": False,
    },
]


def load_subscription_plans(raw_value):
    if not raw_value:
        return DEFAULT_SUBSCRIPTION_PLANS

    try:
        plans = json.loads(raw_value)
    except json.JSONDecodeError as error:
        raise ImproperlyConfigured(
            "SUBSCRIPTION_PLANS_JSON debe contener JSON válido."
        ) from error

    if not isinstance(plans, list) or not 1 <= len(plans) <= 6:
        raise ImproperlyConfigured(
            "SUBSCRIPTION_PLANS_JSON debe definir entre 1 y 6 planes."
        )

    identifiers = set()
    for plan in plans:
        if not isinstance(plan, dict):
            raise ImproperlyConfigured("Cada plan debe ser un objeto JSON.")
        if set(plan) != {
            "id",
            "name",
            "description",
            "price",
            "currency",
            "interval",
            "features",
            "featured",
        }:
            raise ImproperlyConfigured(
                "Cada plan debe incluir id, name, description, price, "
                "currency, interval, features y featured."
            )
        plan_id = plan["id"]
        if (
            not isinstance(plan_id, str)
            or not re.fullmatch(r"[a-z0-9-]{1,40}", plan_id)
            or plan_id in identifiers
        ):
            raise ImproperlyConfigured(
                "Cada plan requiere un id único en minúsculas."
            )
        identifiers.add(plan_id)
        if not isinstance(plan["name"], str) or not 1 <= len(plan["name"]) <= 60:
            raise ImproperlyConfigured(
                "El nombre de cada plan debe tener entre 1 y 60 caracteres."
            )
        if (
            not isinstance(plan["description"], str)
            or len(plan["description"]) > 200
        ):
            raise ImproperlyConfigured(
                "La descripción de cada plan no puede superar 200 caracteres."
            )
        price = plan["price"]
        if price is not None and (
            isinstance(price, bool)
            or not isinstance(price, (int, float))
            or not math.isfinite(price)
            or price < 0
        ):
            raise ImproperlyConfigured(
                "El precio de cada plan debe ser un número no negativo o null."
            )
        currency = plan["currency"]
        if currency is not None and (
            not isinstance(currency, str)
            or not re.fullmatch(r"[A-Z]{3}", currency)
        ):
            raise ImproperlyConfigured(
                "La moneda debe ser un código ISO de tres letras o null."
            )
        if price is not None and currency is None:
            raise ImproperlyConfigured(
                "Los planes con precio requieren indicar su moneda."
            )
        if plan["interval"] not in {"monthly", "yearly", "one_time"}:
            raise ImproperlyConfigured(
                "interval debe ser monthly, yearly o one_time."
            )
        features = plan["features"]
        if (
            not isinstance(features, list)
            or len(features) > 10
            or any(
                not isinstance(feature, str) or len(feature) > 120
                for feature in features
            )
        ):
            raise ImproperlyConfigured(
                "Cada plan admite hasta 10 características de 120 caracteres."
            )
        if not isinstance(plan["featured"], bool):
            raise ImproperlyConfigured("featured debe ser true o false.")

    return plans
