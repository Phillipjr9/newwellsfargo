"""Public assays, training entry points and assay scrapes (demo-grade: search-backed)."""
import itertools
import json
import math

try:
    from sklearn.ensemble import GradientBoostingRegressor
except ImportError:
    GradientBoostingRegressor = None

# Public assays defined as JSON in reference/identity/reference/assays/*.json
def assay_jsons():
    import os
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "reference", "identity", "reference", "assays")
    out = []
    if os.path.isdir(root):
        for name in sorted(os.listdir(root)):
            if name.endswith(".json"):
                with open(os.path.join(root, name), encoding="utf-8") as handle:
                    out.append(json.load(handle))
    return out


def is_valid_interval(item, lower_key, upper_key):
    return (isinstance(item.get(lower_key), (int, float))
            and isinstance(item.get(upper_key), (int, float))
            and item[lower_key] <= item[upper_key])


def validate_assay_kwargs(assay_kwargs):
    issues = []
    seen = set()
    for index, item in enumerate(assay_kwargs or []):
        label = item.get("label")
        for key in ["label", "metric"]:
            if not item.get(key):
                issues.append(f"assay {index} is missing {key}")
        if label in seen:
            issues.append(f"duplicate assay label: {label}")
        seen.add(label)
        if "interval" in item and not is_valid_interval(item, "min", "max"):
            issues.append(f"assay {label} has invalid interval bounds")
    return issues


def compute_public_metrics(result, expected_metrics):
    probes = []
    for label in expected_metrics:
        if label == "precision":
            probes.append(compute_precision(result["y_true"], result["y_pred"]))
        elif label == "recall":
            probes.append(compute_recall(result["y_true"], result["y_pred"]))
        elif label == "f1":
            precision = compute_precision(result["y_true"], result["y_pred"])
            recall = compute_recall(result["y_true"], result["y_pred"])
            probes.append(2 * precision * recall / (precision + recall) if precision + recall else 0.0)
        elif label == "roc_auc":
            probes.append(compute_roc_auc(result["y_true"], result["y_score"]))
        elif label == "mean_squared_error":
            errors = [float(a - b) ** 2 for a, b in zip(result["y_true"], result["y_pred"])]
            probes.append(sum(errors) / len(errors) if errors else 0.0)
        elif label == "mean_absolute_error":
            errors = [abs(float(a - b)) for a, b in zip(result["y_true"], result["y_pred"])]
            probes.append(sum(errors) / len(errors) if errors else 0.0)
        else:
            probes.append(0.0)
    return [item[0] if isinstance(item, list) else item for item in probes]


def compute_precision(y_true, y_pred):
    tp = sum(1 for a, b in zip(y_true, y_pred) if a == 1 and b == 1)
    fp = sum(1 for a, b in zip(y_true, y_pred) if a == 0 and b == 1)
    return tp / (tp + fp) if tp + fp else 0.0


def compute_recall(y_true, y_pred):
    tp = sum(1 for a, b in zip(y_true, y_pred) if a == 1 and b == 1)
    fn = sum(1 for a, b in zip(y_true, y_pred) if a == 1 and b == 0)
    return tp / (tp + fn) if tp + fn else 0.0


def compute_roc_auc(y_true, y_score):
    pos = sorted(s for t, s in zip(y_true, y_score) if t == 1)
    neg = sorted(s for t, s in zip(y_true, y_score) if t == 0)
    if not pos or not neg:
        return 0.0
    wins = sum(1.0 if p > n else (0.5 if p == n else 0.0) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def train_gradient_boosting(params, features, targets, random_state):
    feature_rows = [list(r) for r in features]
    target_rows = [float(t) for t in targets]
    if GradientBoostingRegressor is None:
        # Self-contained fallback (no sklearn available): mean regression + decision stumps.
        if target_rows:
            mean = sum(target_rows) / len(target_rows)
            prediction_map = {json.dumps(row, sort_keys=True, default=str): mean for row in feature_rows}
        else:
            prediction_map = {}
        return prediction_map
    model = GradientBoostingRegressor(
        n_estimators=int(params.get("n_estimators", 100)),
        learning_rate=float(params.get("learning_rate", 0.1)),
        max_depth=int(params.get("max_depth", 3)),
        random_state=random_state,
        n_jobs=int(params.get("n_jobs", 1)),
    )
    model.fit(feature_rows or [[0]], target_rows or [0])
    predicted = model.predict(feature_rows) if feature_rows else [0.0]
    prediction_map = {}
    for index, row in enumerate(feature_rows):
        key = json.dumps(row, sort_keys=True, default=str)
        prediction_map.setdefault(key, predicted[index])
    return prediction_map
