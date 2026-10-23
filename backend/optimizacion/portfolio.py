import numpy as np
from scipy.optimize import linprog, minimize


def _constraints(mu, categories, category_caps, minimum_return=None):
    n = len(mu)
    constraints = [{
        "type": "eq",
        "fun": lambda weights: np.sum(weights) - 1,
        "jac": lambda weights: np.ones(n),
    }]
    if minimum_return is not None:
        constraints.append({
            "type": "ineq",
            "fun": lambda weights: mu @ weights - minimum_return,
            "jac": lambda weights: mu,
        })
    for category, cap in category_caps.items():
        indices = np.array(
            [name == category for name in categories],
            dtype=float,
        )
        constraints.append({
            "type": "ineq",
            "fun": lambda weights, mask=indices, bound=cap: (
                bound - mask @ weights
            ),
            "jac": lambda weights, mask=indices: -mask,
        })
    return constraints


def _feasible_return_extremes(mu, categories, category_caps, bounds):
    category_rows = []
    category_limits = []
    for category, cap in category_caps.items():
        category_rows.append([
            1.0 if name == category else 0.0
            for name in categories
        ])
        category_limits.append(cap)

    common = {
        "A_ub": category_rows or None,
        "b_ub": category_limits or None,
        "A_eq": [np.ones(len(mu))],
        "b_eq": [1.0],
        "bounds": bounds,
        "method": "highs",
    }
    minimum = linprog(c=mu, **common)
    maximum = linprog(c=-mu, **common)
    if not minimum.success or not maximum.success:
        raise ValueError("Los límites indicados no permiten una cartera factible.")
    return float(mu @ minimum.x), float(mu @ maximum.x), minimum.x, maximum.x


def optimizar_media_varianza(
    rendimientos,
    covarianza,
    aversion_riesgo,
    bounds=None,
    categorias=None,
    limites_categoria=None,
    periodos_por_anio=1,
    escenarios_estres=None,
):
    mu = np.asarray(rendimientos, dtype=float)
    sigma = np.asarray(covarianza, dtype=float)
    n = len(mu)
    bounds = bounds or [(0.0, 1.0)] * n
    categories = categorias or [""] * n
    category_caps = limites_categoria or {}
    _, _, _, max_return_weights = _feasible_return_extremes(
        mu, categories, category_caps, bounds
    )

    def objective(weights):
        return -(mu @ weights - aversion_riesgo * (weights @ sigma @ weights))

    def gradient(weights):
        return -(mu - 2 * aversion_riesgo * sigma @ weights)

    result = minimize(
        objective,
        max_return_weights,
        jac=gradient,
        method="SLSQP",
        bounds=bounds,
        constraints=_constraints(mu, categories, category_caps),
        options={"maxiter": 500, "ftol": 1e-12},
    )
    if (
        not result.success
        or not np.all(np.isfinite(result.x))
        or abs(float(np.sum(result.x)) - 1) > 1e-7
    ):
        raise ValueError("No se encontró una solución de portafolio válida.")

    weights = result.x
    variance = float(weights @ sigma @ weights)
    if variance < -1e-10:
        raise ValueError("La matriz de covarianza produjo varianza negativa.")
    variance = max(variance, 0.0)
    expected_return = float(mu @ weights)
    volatility = float(np.sqrt(variance))
    variance_contributions = weights * (sigma @ weights)
    volatility_contributions = (
        variance_contributions / volatility
        if volatility > 0
        else np.zeros(n)
    )
    risk_contributions = [
        {
            "contribucion_volatilidad": float(contribution),
            "proporcion_volatilidad": (
                float(contribution / volatility)
                if volatility > 0
                else 0.0
            ),
        }
        for contribution in volatility_contributions
    ]
    annualized_return = expected_return * periodos_por_anio
    annualized_volatility = volatility * float(np.sqrt(periodos_por_anio))
    return {
        "rendimientos_portafolio": expected_return,
        "varianza_portafolio": variance,
        "volatilidad_portafolio": volatility,
        "utilidad_riesgo": float(
            expected_return - aversion_riesgo * variance
        ),
        "ponderaciones": weights.tolist(),
        "contribuciones_riesgo": risk_contributions,
        "rendimiento_anualizado": annualized_return,
        "volatilidad_anualizada": annualized_volatility,
        "resultados_estres": {
            label: float(np.asarray(scenario, dtype=float) @ weights)
            for label, scenario in (escenarios_estres or {}).items()
        },
    }


def calcular_frontera_eficiente(
    rendimientos,
    covarianza,
    bounds=None,
    categorias=None,
    limites_categoria=None,
    puntos=21,
):
    mu = np.asarray(rendimientos, dtype=float)
    sigma = np.asarray(covarianza, dtype=float)
    n = len(mu)
    bounds = bounds or [(0.0, 1.0)] * n
    categories = categorias or [""] * n
    category_caps = limites_categoria or {}
    min_return, max_return, initial_weights, _ = _feasible_return_extremes(
        mu, categories, category_caps, bounds
    )
    targets = np.linspace(min_return, max_return, max(2, puntos))
    frontier = []
    initial = initial_weights

    for target in targets:
        result = minimize(
            lambda weights: float(weights @ sigma @ weights),
            initial,
            jac=lambda weights: 2 * sigma @ weights,
            method="SLSQP",
            bounds=bounds,
            constraints=_constraints(
                mu,
                categories,
                category_caps,
                minimum_return=float(target),
            ),
            options={"maxiter": 500, "ftol": 1e-12},
        )
        if not result.success or not np.all(np.isfinite(result.x)):
            raise ValueError("No se pudo calcular toda la frontera eficiente.")
        weights = result.x
        variance = max(float(weights @ sigma @ weights), 0.0)
        achieved_return = float(mu @ weights)
        frontier.append({
            "rendimientos_portafolio": achieved_return,
            "varianza_portafolio": variance,
            "volatilidad_portafolio": float(np.sqrt(variance)),
            "ponderaciones": weights.tolist(),
        })
        initial = weights

    return frontier
